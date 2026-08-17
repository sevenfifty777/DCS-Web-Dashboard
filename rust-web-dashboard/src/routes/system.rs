//! Filesystem- and OS-backed REST handlers (Phase 5).
//!
//! These port the Next.js API routes that touch the host machine rather than
//! DCS-gRPC: server-settings editing (`/api/settings`), mission upload/browse
//! (`/api/mission/upload`, `/api/mission/browse`), the authentication audit log
//! (`/api/logs/access`), Windows session/scheduled-task control
//! (`/api/rdp-status`, `/api/server/tasks`) and the DCS Dynamic Weather bridge
//! (`/api/weather`, `/api/weather/apply`).
//!
//! JSON response shapes mirror the original routes exactly. All endpoints
//! require a valid session (the [`AuthUser`] extractor). Lua parsing and
//! byte-faithful serialization live in [`crate::settings_lua`].

use std::convert::Infallible;
use std::path::Path;
use std::time::Duration;
use std::io::SeekFrom;

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Response, sse::{Event, KeepAlive, Sse}},
    Json,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_stream::{Stream, wrappers::ReceiverStream};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;
use std::process::{Command as StdCommand};

use crate::auth::{self, AuthUser};
use crate::grpc;
use crate::settings_lua;
use crate::state::AppState;

// --- error helpers ---------------------------------------------------------

/// 500 with `{ "error": <msg> }` (matches the source routes' `err.message`).
fn err_500(msg: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": msg })),
    )
        .into_response()
}

/// 400 with `{ "error": <msg> }`.
fn err_400(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

/// 403 with `{ "error": <msg> }`.
fn err_403(msg: &str) -> Response {
    (StatusCode::FORBIDDEN, Json(json!({ "error": msg }))).into_response()
}

// --- shared helpers --------------------------------------------------------

/// Read and parse a JSON file, returning `None` on any I/O or parse failure
/// (the source routes treat a missing/corrupt file as "no data").
async fn read_json(path: &Path) -> Option<Value> {
    let bytes = tokio::fs::read(path).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Strip a trailing `_A` / `_B` mission-rotation suffix (JS `/_[AB]$/`).
fn strip_ab_suffix(name: &str) -> &str {
    name.strip_suffix("_A")
        .or_else(|| name.strip_suffix("_B"))
        .unwrap_or(name)
}

/// Mirror JS `value?.key || {}`: clone an object key, substituting an empty
/// object for a missing or `null` value.
fn object_or_empty(value: Option<&Value>) -> Value {
    match value {
        Some(v) if !v.is_null() => v.clone(),
        _ => json!({}),
    }
}

// --- /api/settings ---------------------------------------------------------

/// `GET /api/settings` → parsed `serverSettings.lua` (flat object with the
/// `advanced` block, `missionList` array, and primitive keys).
#[utoipa::path(
    get,
    path = "/api/settings",
    responses(
        (status = 200, description = "Server settings JSON object"),
        (status = 500, description = "Failed to read settings")
    ),
    security(
        ("jwt" = [])
    ),
    tags = ["system"]
)]
pub async fn settings_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    match settings_lua::read_settings(&state.config.server_settings_path()).await {
        Ok(settings) => Json(settings).into_response(),
        Err(e) => err_500(&e.to_string()),
    }
}

/// `POST /api/settings` → rewrite `serverSettings.lua` (byte-faithful CRLF/tabs).
#[utoipa::path(
    post,
    path = "/api/settings",
    tags = ["system"],
    security(("jwt" = [])),
    request_body(content = inline(serde_json::Value), description = "New server settings"),
    responses((status = 200, description = "Settings saved successfully"))
)]
pub async fn settings_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Response {
    match settings_lua::write_settings(&state.config.server_settings_path(), &payload).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_500(&e.to_string()),
    }
}

// --- /api/mission/upload ---------------------------------------------------

/// `POST /api/mission/upload` → save a `.miz` upload into `Missions/Uploads`.
#[utoipa::path(
    post,
    path = "/api/mission/upload",
    tags = ["system"],
    security(("jwt" = [])),
    request_body(content_type = "multipart/form-data"),
    responses((status = 200, description = "Mission uploaded successfully"))
)]
pub async fn mission_upload(
    _user: AuthUser,
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Response {
    let mut uploaded: Option<(Option<String>, Vec<u8>)> = None;
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let name = field.file_name().map(str::to_string);
            match field.bytes().await {
                Ok(bytes) => uploaded = Some((name, bytes.to_vec())),
                Err(e) => return err_500(&e.to_string()),
            }
            break;
        }
    }

    let (name, bytes) = match uploaded {
        Some(f) => f,
        None => return err_400("No file provided"),
    };
    let name = match name {
        Some(n) if !n.is_empty() => n,
        _ => return err_400("No file provided"),
    };
    if !name.ends_with(".miz") {
        return err_400("Only .miz files are allowed");
    }

    // Sanitize the client-supplied name to a bare filename (no path traversal).
    let basename = Path::new(&name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(name);

    let upload_dir = state.config.uploads_dir();
    if let Err(e) = tokio::fs::create_dir_all(&upload_dir).await {
        return err_500(&e.to_string());
    }

    let file_path = upload_dir.join(&basename);
    if let Err(e) = tokio::fs::write(&file_path, &bytes).await {
        return err_500(&e.to_string());
    }

    Json(json!({
        "success": true,
        "message": "File uploaded successfully",
        "file_name": file_path.to_string_lossy(),
    }))
    .into_response()
}

// --- /api/mission/browse ---------------------------------------------------

/// `GET /api/mission/browse` → recursively list `.miz` files under `Missions`
/// (depth ≤ 3, skipping hidden folders and `Uploads`).
#[utoipa::path(
    get,
    path = "/api/mission/browse",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "List of .miz files"))
)]
pub async fn mission_browse(_user: AuthUser, State(state): State<AppState>) -> Response {
    let mut files: Vec<String> = Vec::new();
    let mut stack = vec![(state.config.missions_dir(), 0u32)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > 3 {
            continue;
        }
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if file_type.is_dir() {
                if name.starts_with('.') || name == "Uploads" {
                    continue;
                }
                stack.push((entry.path(), depth + 1));
            } else if name.ends_with(".miz") {
                let full_path = entry.path();
                if let Ok(rel_path) = full_path.strip_prefix(state.config.missions_dir()) {
                    files.push(rel_path.to_string_lossy().replace('\\', "/"));
                } else {
                    files.push(full_path.to_string_lossy().into_owned());
                }
            }
        }
    }

    // Defensive: exclude anything under Missions/Uploads to avoid duplication.
    files.retain(|f| !f.contains("Missions\\Uploads") && !f.contains("Missions/Uploads"));

    Json(json!({ "success": true, "files": files })).into_response()
}

// --- /api/logs/access ------------------------------------------------------

/// `GET /api/logs/access` → authentication audit log, mapped to the frontend
/// shape (`timestamp` ms / `userId`).
#[utoipa::path(
    get,
    path = "/api/logs/access",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Audit log data"))
)]
pub async fn logs_access(_user: AuthUser, State(state): State<AppState>) -> Response {
    let logs = auth::read_audit_logs(&state.config.audit_log_path).await;
    let mapped: Vec<Value> = logs
        .into_iter()
        .map(|l| {
            json!({
                "timestamp": l.timestamp_ms,
                "username": l.username,
                "userId": l.user_id,
                "status": l.status,
                "reason": l.reason,
            })
        })
        .collect();
    Json(json!({ "logs": mapped })).into_response()
}

// --- /api/rdp-status -------------------------------------------------------

/// `GET /api/rdp-status` → active Windows interactive/RDP sessions (`quser`).
#[utoipa::path(
    get,
    path = "/api/rdp-status",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "RDP session status"))
)]
pub async fn rdp_status(_user: AuthUser, State(_state): State<AppState>) -> Response {
    let output = match Command::new("quser").output().await {
        Ok(out) => out,
        // Command unavailable / spawn failure → report no sessions gracefully.
        Err(_) => return Json(json!({ "active": false, "users": [] })).into_response(),
    };

    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    if text.trim().is_empty() {
        text = String::from_utf8_lossy(&output.stderr).into_owned();
    }

    if text.contains("No User exists") {
        return Json(json!({ "active": false, "users": [] })).into_response();
    }

    let mut lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return Json(json!({ "active": false, "users": [] })).into_response();
    }
    // Drop the header row.
    lines.remove(0);

    let mut users: Vec<Value> = Vec::new();
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }
        let username = parts[0].strip_prefix('>').unwrap_or(parts[0]);
        let lower = line.to_lowercase();
        let is_rdp = lower.contains("rdp-tcp");
        let is_active = lower.contains("active") || lower.contains("actif");
        if is_active && is_rdp {
            users.push(json!({ "username": username, "state": "Active", "isRdp": is_rdp }));
        }
    }

    Json(json!({ "active": !users.is_empty(), "users": users })).into_response()
}

// --- /api/server/tasks -----------------------------------------------------

/// `GET /api/server/tasks` → root-folder scheduled tasks (PowerShell).
#[utoipa::path(
    get,
    path = "/api/server/tasks",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Scheduled tasks"))
)]
pub async fn tasks_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    let ps =
        "Get-ScheduledTask | Where-Object TaskPath -eq '\\' | Select-Object TaskName, State | ConvertTo-Json";
    let output = match Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(ps)
        .output()
        .await
    {
        Ok(out) => out,
        Err(e) => return err_500(&e.to_string()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.trim().is_empty() {
        return Json(json!({ "tasks": [] })).into_response();
    }

    let parsed: Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(e) => return err_500(&e.to_string()),
    };
    let raw_tasks: Vec<Value> = match parsed {
        Value::Array(a) => a,
        other => vec![other],
    };

    // (name, formatted-json) so we can filter/sort by name without re-parsing.
    let mut tasks: Vec<(String, Value)> = raw_tasks
        .into_iter()
        .map(|t| {
            let name = t
                .get("TaskName")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let raw_state = t.get("State").cloned().unwrap_or(Value::Null);
            let state = match raw_state.as_i64() {
                Some(4) => "Running",
                Some(3) => "Ready",
                Some(1) => "Disabled",
                _ => "Unknown",
            };
            let value = json!({ "name": name, "state": state, "rawState": raw_state });
            (name, value)
        })
        .collect();

    let whitelist = &state.config.task_whitelist;
    if !whitelist.is_empty() {
        let filtered: Vec<Value> = tasks
            .into_iter()
            .filter(|(name, _)| whitelist.contains(&name.to_lowercase()))
            .map(|(_, value)| value)
            .collect();
        return Json(json!({ "tasks": filtered })).into_response();
    }

    tasks.sort_by(|a, b| a.0.cmp(&b.0));
    let out: Vec<Value> = tasks.into_iter().map(|(_, value)| value).collect();
    Json(json!({ "tasks": out })).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct TaskActionBody {
    #[serde(rename = "taskName")]
    task_name: Option<String>,
    action: Option<String>,
}

/// `POST /api/server/tasks` → start/stop/restart a scheduled task.
#[utoipa::path(
    post,
    path = "/api/server/tasks",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = TaskActionBody,
    responses((status = 200, description = "Task action sent"))
)]
pub async fn tasks_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<TaskActionBody>,
) -> Response {
    let task_name = body.task_name.unwrap_or_default();
    let action = body.action.unwrap_or_default();
    if task_name.is_empty() || action.is_empty() {
        return err_400("Missing taskName or action");
    }

    let whitelist = &state.config.task_whitelist;
    if !whitelist.is_empty() && !whitelist.contains(&task_name.to_lowercase()) {
        return err_403("Task is not in the allowed whitelist.");
    }

    // PowerShell single-quoted string escaping (`'` → `''`).
    let safe = task_name.replace('\'', "''");
    let ps = match action.as_str() {
        "start" => format!("Start-ScheduledTask -TaskName '{safe}'"),
        "stop" => format!("Stop-ScheduledTask -TaskName '{safe}'"),
        "restart" => format!(
            "Stop-ScheduledTask -TaskName '{safe}'; Start-ScheduledTask -TaskName '{safe}'"
        ),
        _ => return err_400("Invalid action"),
    };

    match Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(&ps)
        .output()
        .await
    {
        Ok(out) if out.status.success() => Json(json!({
            "success": true,
            "message": format!("Task {task_name} {action} command sent successfully."),
        }))
        .into_response(),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            err_500(&format!(
                "powershell exited with status {}: {}",
                out.status, stderr
            ))
        }
        Err(e) => err_500(&e.to_string()),
    }
}

// --- /api/weather ----------------------------------------------------------

/// `GET /api/weather` → presets + current applied weather state. Overrides the
/// reported mission name with the live DCS mission when reachable.
#[utoipa::path(
    get,
    path = "/api/weather",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Weather state and presets"))
)]
pub async fn weather_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    let weather_dir = match &state.config.dcs_dynamic_weather_dir {
        Some(dir) => dir.clone(),
        None => return Json(json!({ "not_configured": true })).into_response(),
    };

    let presets = read_json(&weather_dir.join("weather_presets.json")).await;
    let mut dto = read_json(&weather_dir.join("data").join("dto.json")).await;

    // If DCS is reachable, make the reported mission match reality.
    if let Ok(resp) = grpc::get_mission_name(state.grpc.clone()).await {
        let active = resp.name;
        if !active.is_empty() {
            if let Some(dto_value) = dto.as_mut() {
                let base = strip_ab_suffix(&active);
                let includes = dto_value
                    .get("mission")
                    .and_then(Value::as_str)
                    .map(|m| m.contains(base))
                    .unwrap_or(false);
                if includes {
                    let current = dto_value
                        .get("mission")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let dir = Path::new(&current).parent().unwrap_or_else(|| Path::new(""));
                    let rebuilt = dir.join(format!("{active}.miz"));
                    dto_value["mission"] = json!(rebuilt.to_string_lossy());
                } else {
                    dto_value["mission"] = json!(format!("(Active in DCS) {active}.miz"));
                }
            }

            // Fetch current mission time
            if let Ok(eval_res) = grpc::custom_eval(state.grpc.clone(), "return timer.getAbsTime()".into()).await {
                if let Ok(time_seconds) = eval_res.json.trim().parse::<f64>() {
                    let total_seconds = time_seconds as u32;
                    let hours = (total_seconds / 3600) % 24;
                    let minutes = (total_seconds / 60) % 60;
                    if let Some(dto_value) = dto.as_mut() {
                        dto_value["mission_time"] = json!(format!("{:02}:{:02}", hours, minutes));
                    }
                }
            }
        }
    }

    let presets_ref = presets.as_ref();
    Json(json!({
        "presets": object_or_empty(presets_ref.and_then(|p| p.get("presets"))),
        "selection_rules": object_or_empty(presets_ref.and_then(|p| p.get("selection_rules"))),
        "dcs_cloud_presets": object_or_empty(presets_ref.and_then(|p| p.get("dcs_cloud_presets"))),
        "current_state": match dto {
            Some(v) if !v.is_null() => v,
            _ => json!({}),
        },
    }))
    .into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct WeatherApplyBody {
    #[schema(value_type = Object)]
    preset_id: Option<Value>,
    time_of_day: Option<String>,
}

/// `POST /api/weather/apply` → run the weather generator and reload the mission.
#[utoipa::path(
    post,
    path = "/api/weather/apply",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = WeatherApplyBody,
    responses((status = 200, description = "Weather applied"))
)]
pub async fn weather_apply(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<WeatherApplyBody>,
) -> Response {
    let preset_id = match body.preset_id {
        Some(Value::String(s)) if !s.is_empty() => s,
        Some(Value::Number(n)) => n.to_string(),
        _ => return err_400("preset_id is required"),
    };

    let weather_dir = match &state.config.dcs_dynamic_weather_dir {
        Some(dir) => dir.clone(),
        None => return err_500("DCS_DYNAMIC_WEATHER_DIR is not configured in environment"),
    };
    let python_exe = state.config.python_exe.clone();
    let settings_path = state.config.server_settings_path();

    // Resolve the currently running mission (three fallbacks).
    let mut current_mission = String::new();

    // 1. Ask DCS for the active mission and rebuild its absolute path.
    if let Ok(resp) = grpc::get_mission_name(state.grpc.clone()).await {
        let active = resp.name;
        if !active.is_empty() {
            let base = strip_ab_suffix(&active).to_string();
            if let Ok(settings) = settings_lua::read_settings(&settings_path).await {
                for raw in settings_lua::mission_list(&settings) {
                    if raw.contains(&base) {
                        let dir = Path::new(&raw).parent().unwrap_or_else(|| Path::new(""));
                        current_mission =
                            dir.join(format!("{active}.miz")).to_string_lossy().into_owned();
                        break;
                    }
                }
            }
        }
    }

    // 2. Fall back to dto.json.
    if current_mission.is_empty() {
        if let Some(dto) = read_json(&weather_dir.join("data").join("dto.json")).await {
            if let Some(m) = dto.get("mission").and_then(Value::as_str) {
                current_mission = m.to_string();
            }
        }
    }

    // 3. Fall back to the first entry of the mission list.
    if current_mission.is_empty() {
        if let Ok(settings) = settings_lua::read_settings(&settings_path).await {
            if let Some(first) = settings_lua::mission_list(&settings).into_iter().next() {
                current_mission = first;
            }
        }
    }

    // A/B swap so the generator writes the inactive (unlocked) file.
    let target_mission = if let Some(stem) = current_mission.strip_suffix("_A.miz") {
        format!("{stem}_B.miz")
    } else if let Some(stem) = current_mission.strip_suffix("_B.miz") {
        format!("{stem}_A.miz")
    } else {
        current_mission.clone()
    };

    let script_path = weather_dir.join("weather_generator.py");
    let mut cmd = Command::new(&python_exe);
    cmd.arg(&script_path)
        .arg(&weather_dir)
        .arg(format!("--preset={preset_id}"));
    if let Some(tod) = body.time_of_day {
        cmd.arg(format!("--time={tod}"));
    }
    if !target_mission.is_empty() {
        cmd.arg(format!("--mission={target_mission}"));
    }
    cmd.current_dir(&weather_dir);

    let output = match tokio::time::timeout(Duration::from_secs(60), cmd.output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return err_500(&e.to_string()),
        Err(_) => return err_500("weather generator timed out"),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return err_500(&format!(
            "weather generator exited with status {}: {}",
            output.status, stderr
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();

    // Reload the regenerated mission in DCS.
    if !target_mission.is_empty() {
        let escaped = target_mission.replace('\\', "\\\\");
        if let Err(e) = grpc::load_mission(state.grpc.clone(), escaped).await {
            return err_500(e.message());
        }
    }

    Json(json!({ "success": true, "output": stdout })).into_response()
}

// --- /api/server/dcs-process ------------------------------------------------

/// `GET /api/server/dcs-process` → check if DCS.exe or DCS_server.exe is running.
#[utoipa::path(
    get,
    path = "/api/server/dcs-process",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "DCS process running state"))
)]
pub async fn dcs_process_get(_user: AuthUser, State(_state): State<AppState>) -> Response {
    let ps = "Get-Process -Name 'DCS', 'DCS_server' -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count";
    let output = match Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(ps)
        .output()
        .await
    {
        Ok(out) => out,
        Err(_) => return Json(json!({ "running": false })).into_response(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let count: i32 = stdout.trim().parse().unwrap_or(0);
    Json(json!({ "running": count > 0 })).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct DcsProcessAction {
    pub action: String,
}

/// `POST /api/server/dcs-process` → start/stop/restart DCS.exe.
#[utoipa::path(
    post,
    path = "/api/server/dcs-process",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = DcsProcessAction,
    responses((status = 200, description = "DCS process action executed"))
)]
pub async fn dcs_process_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<DcsProcessAction>,
) -> Response {
    let action = payload.action.as_str();

    if action == "stop" || action == "restart" {
        tracing::info!("Stopping DCS process via PowerShell");
        let _ = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg("Stop-Process -Name 'DCS', 'DCS_server' -Force -ErrorAction SilentlyContinue")
            .status()
            .await;
    }

    if action == "start" || action == "restart" {
        if action == "restart" {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        if let Some(task_name) = &state.config.dcs_scheduled_task {
            // Run via scheduled task
            tracing::info!("Starting DCS via scheduled task: {}", task_name);
            match Command::new("schtasks")
                .arg("/run")
                .arg("/tn")
                .arg(task_name)
                .spawn()
            {
                Ok(_) => tracing::info!("Successfully spawned schtasks for DCS"),
                Err(e) => tracing::error!("Failed to spawn schtasks for DCS: {}", e),
            }
        } else if let Some(raw_cmd) = &state.config.dcs_start_cmd {
            let cmd_str = raw_cmd.trim_matches('\'');
            let (exe_path, args_str) = if cmd_str.starts_with('"') {
                if let Some(end_quote) = cmd_str[1..].find('"') {
                    (&cmd_str[1..=end_quote], cmd_str[end_quote + 2..].trim())
                } else {
                    (cmd_str, "")
                }
            } else if let Some(space) = cmd_str.find(' ') {
                (&cmd_str[..space], cmd_str[space + 1..].trim())
            } else {
                (cmd_str, "")
            };

            let args_to_pass = if args_str.is_empty() { "" } else { args_str };
            let working_dir = std::path::Path::new(exe_path)
                .parent()
                .and_then(|p| p.to_str());

            // Try launching in the interactive user session first (solves
            // Session 0 / no-desktop issue when running as an NSSM service).
            tracing::info!("Attempting to launch DCS in interactive session: \"{}\" {}", exe_path, args_to_pass);
            match crate::win_session::launch_in_user_session(exe_path, args_to_pass, working_dir) {
                Ok(()) => {
                    tracing::info!("Successfully launched DCS in interactive user session");
                }
                Err(e) => {
                    tracing::warn!("Win32 interactive session launch failed ({}), falling back to PowerShell Start-Process", e);

                    // Fallback: PowerShell Start-Process (works if dashboard
                    // itself is already in an interactive session).
                    let mut ps_cmd = format!("Start-Process -FilePath '{}'", exe_path.replace("'", "''"));
                    if !args_to_pass.is_empty() {
                        ps_cmd.push_str(&format!(" -ArgumentList '{}'", args_to_pass.replace("'", "''")));
                    }
                    if let Some(wd) = working_dir {
                        ps_cmd.push_str(&format!(" -WorkingDirectory '{}'", wd.replace("'", "''")));
                    }
                    ps_cmd.push_str(" -WindowStyle Hidden");

                    tracing::info!("Spawning DCS via PowerShell: {}", ps_cmd);

                    match StdCommand::new("powershell")
                        .arg("-NoProfile")
                        .arg("-Command")
                        .arg(&ps_cmd)
                        .spawn()
                    {
                        Ok(_) => tracing::info!("Successfully spawned PowerShell to start DCS"),
                        Err(e) => tracing::error!("Failed to spawn PowerShell for DCS: {}", e),
                    }
                }
            }
        } else {
            return err_500("Neither DCS_SCHEDULED_TASK_NAME nor DCS_START_CMD is configured");
        }
    }

    Json(json!({ "success": true })).into_response()
}

// --- /api/server/srs-process ------------------------------------------------

/// `GET /api/server/srs-process` → check if SRS-Server.exe is running.
#[utoipa::path(
    get,
    path = "/api/server/srs-process",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "SRS process running state"))
)]
pub async fn srs_process_get(_user: AuthUser, State(_state): State<AppState>) -> Response {
    let ps = "Get-Process -Name 'SRS-Server' -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count";
    let output = match Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(ps)
        .output()
        .await
    {
        Ok(out) => out,
        Err(_) => return Json(json!({ "running": false })).into_response(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let count: i32 = stdout.trim().parse().unwrap_or(0);
    Json(json!({ "running": count > 0 })).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SrsProcessAction {
    pub action: String,
}

/// `POST /api/server/srs-process` → start/stop/restart SRS-Server.exe.
#[utoipa::path(
    post,
    path = "/api/server/srs-process",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = SrsProcessAction,
    responses((status = 200, description = "SRS process action executed"))
)]
pub async fn srs_process_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<SrsProcessAction>,
) -> Response {
    let action = payload.action.as_str();

    if action == "stop" || action == "restart" {
        let _ = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg("Stop-Process -Name 'SRS-Server' -Force -ErrorAction SilentlyContinue")
            .status()
            .await;
    }

    if action == "start" || action == "restart" {
        if action == "restart" {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        if let Some(task_name) = &state.config.srs_scheduled_task {
            // Run via scheduled task
            let _ = Command::new("schtasks")
                .arg("/run")
                .arg("/tn")
                .arg(task_name)
                .spawn();
        } else if let Some(raw_cmd) = &state.config.srs_start_cmd {
            let cmd_str = raw_cmd.trim_matches('\'');
            let (exe_path, args_str) = if cmd_str.starts_with('"') {
                if let Some(end_quote) = cmd_str[1..].find('"') {
                    (&cmd_str[1..=end_quote], cmd_str[end_quote + 2..].trim())
                } else {
                    (cmd_str, "")
                }
            } else if let Some(space) = cmd_str.find(' ') {
                (&cmd_str[..space], cmd_str[space + 1..].trim())
            } else {
                (cmd_str, "")
            };

            let working_dir = std::path::Path::new(exe_path)
                .parent()
                .and_then(|p| p.to_str());

            // Try launching in the interactive user session first.
            tracing::info!("Attempting to launch SRS in interactive session: \"{}\" {}", exe_path, args_str);
            match crate::win_session::launch_in_user_session(exe_path, args_str, working_dir) {
                Ok(()) => {
                    tracing::info!("Successfully launched SRS in interactive user session");
                }
                Err(e) => {
                    tracing::warn!("Win32 interactive session launch failed ({}), falling back to PowerShell Start-Process", e);

                    let mut ps_cmd = format!("Start-Process -FilePath '{}'", exe_path.replace("'", "''"));
                    if !args_str.is_empty() {
                        ps_cmd.push_str(&format!(" -ArgumentList '{}'", args_str.replace("'", "''")));
                    }
                    if let Some(wd) = working_dir {
                        ps_cmd.push_str(&format!(" -WorkingDirectory '{}'", wd.replace("'", "''")));
                    }
                    ps_cmd.push_str(" -WindowStyle Hidden");

                    tracing::info!("Spawning SRS via PowerShell: {}", ps_cmd);

                    match StdCommand::new("powershell")
                        .arg("-NoProfile")
                        .arg("-Command")
                        .arg(&ps_cmd)
                        .spawn()
                    {
                        Ok(_) => tracing::info!("Successfully spawned PowerShell to start SRS"),
                        Err(e) => tracing::error!("Failed to spawn PowerShell for SRS: {}", e),
                    }
                }
            }
        } else {
            return err_500("Neither SRS_SCHEDULED_TASK_NAME nor SRS_START_CMD is configured");
        }
    }

    Json(json!({ "success": true })).into_response()
}

// --- /api/logs/dcs/stream ---------------------------------------------------

/// `GET /api/logs/dcs/stream` → tail DCS log using SSE.
#[utoipa::path(
    get,
    path = "/api/logs/dcs/stream",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "SSE stream of DCS log"))
)]
pub async fn dcs_log_stream(
    _user: auth::AuthQueryUser,
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::channel(16);
    let log_path = state.config.dcs_log_path();

    tokio::spawn(async move {
        let mut file = match tokio::fs::File::open(&log_path).await {
            Ok(f) => f,
            Err(_) => {
                let _ = tx.send(Ok(Event::default().data(json!({"text": "DCS log file not found.\n"}).to_string()))).await;
                return;
            }
        };

        // Try to seek to end minus 64KB to provide initial context
        let meta = file.metadata().await;
        let file_size = meta.map(|m| m.len()).unwrap_or(0);
        let start_pos = file_size.saturating_sub(64 * 1024);
        let _ = file.seek(SeekFrom::Start(start_pos)).await;

        let mut buf = vec![0; 8192];
        loop {
            match file.read(&mut buf).await {
                Ok(0) => {
                    // EOF reached, wait and try again
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]);
                    let msg = json!({ "text": text }).to_string();
                    if tx.send(Ok(Event::default().data(msg))).await.is_err() {
                        break; // Client disconnected
                    }
                }
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(1000)).await;
                }
            }
        }
    });

    Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::default())
}



// --- /api/graveyard ---------------------------------------------------------

/// `GET /api/graveyard` -> Returns the current live graveyard JSON
#[utoipa::path(
    get,
    path = "/api/graveyard",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Graveyard state"))
)]
pub async fn graveyard_get(
    _user: auth::AuthUser,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let path = state.config.dcs_saved_games_dir.join("Logs").join("graveyard.json");
    let board = crate::graveyard::Graveyard::load_or_default(&path);
    Json(board).into_response()
}

#[utoipa::path(
    get,
    path = "/api/foothold",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Foothold data"))
)]
pub async fn foothold_get(
    State(app_state): State<AppState>,
) -> Result<Json<crate::foothold::FootholdData>, (StatusCode, String)> {
    crate::foothold::get_foothold_data(&app_state.config.foothold_saves_dir)
        .map(Json)
        .map_err(|e| {
            tracing::error!("Failed to parse Foothold data: {:#}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse Foothold data: {}", e))
        })
}
