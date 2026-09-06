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

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use axum::{
    extract::{Multipart, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::Command;
use std::process::{Command as StdCommand};

use crate::auth::{self, AuthUser};
use crate::config::Config;
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

// --- /api/server/dcs-process, /api/server/srs-process -----------------------
//
// DCS and SRS are host processes the dashboard can start, stop and restart.
// Because the dashboard runs as a service (Session 0, no desktop), starting is
// delegated to a Windows scheduled task configured "run only when user is
// logged on" (`DCS_SCHEDULED_TASK_NAME` / `SRS_SCHEDULED_TASK_NAME`), which
// launches the process on the user's desktop. `*_START_CMD` remains as a
// hidden-window fallback. See `docs/src/process_control_setup.md`.
//
// Stop leaves a marker file in the DCS Saved Games folder so the boot-time
// watchdog (`Features/Services/Watchdog-DCS-SRS.ps1`) does not restart a
// process that was stopped on purpose; Start/Restart remove it.

/// Seconds to wait for a killed process to disappear before starting it again.
const STOP_WAIT_SECS: u64 = 30;
/// Seconds to wait for the process to appear after a scheduled task was run.
const TASK_START_TIMEOUT_SECS: u64 = 15;
/// Task Scheduler "the task is currently running" (SCHED_S_TASK_RUNNING).
const TASK_RESULT_RUNNING: i64 = 0x0004_1301;
/// Task Scheduler "the task has not yet run" (SCHED_S_TASK_HAS_NOT_RUN).
const TASK_RESULT_NEVER_RAN: i64 = 0x0004_1303;
/// Win32 ERROR_NOT_LOGGED_ON as an HRESULT: the task's user has no session.
const TASK_RESULT_NOT_LOGGED_ON: i64 = 0x8007_04DD;

/// One controllable host process and everything needed to drive it.
struct ProcessTarget {
    /// Label for log lines and error messages ("DCS", "SRS").
    label: &'static str,
    /// Image names (without `.exe`) that count as "the process".
    process_names: &'static [&'static str],
    /// Scheduled task run by Start/Restart (preferred).
    scheduled_task: Option<String>,
    /// Fallback executable + arguments launched by the dashboard itself.
    start_cmd: Option<String>,
    /// Marker file the watchdog honours while the process is stopped on purpose.
    stop_flag: PathBuf,
    /// Env var names quoted in the "not configured" error.
    env_hint: &'static str,
    /// Log file the start script writes, quoted in error messages.
    start_log: &'static str,
}

impl ProcessTarget {
    fn dcs(config: &Config) -> Self {
        Self {
            label: "DCS",
            process_names: &["DCS", "DCS_server"],
            scheduled_task: config.dcs_scheduled_task.clone(),
            start_cmd: config.dcs_start_cmd.clone(),
            stop_flag: config.dcs_saved_games_dir.join("dashboard_stop_dcs.flag"),
            env_hint: "DCS_SCHEDULED_TASK_NAME nor DCS_START_CMD",
            start_log: "dcs_start.log",
        }
    }

    fn srs(config: &Config) -> Self {
        Self {
            label: "SRS",
            process_names: &["SRS-Server"],
            scheduled_task: config.srs_scheduled_task.clone(),
            start_cmd: config.srs_start_cmd.clone(),
            stop_flag: config.dcs_saved_games_dir.join("dashboard_stop_srs.flag"),
            env_hint: "SRS_SCHEDULED_TASK_NAME nor SRS_START_CMD",
            start_log: "srs_start.log",
        }
    }

    /// `'DCS','DCS_server'` for `-Name` parameters.
    fn ps_name_list(&self) -> String {
        self.process_names
            .iter()
            .map(|n| format!("'{n}'"))
            .collect::<Vec<_>>()
            .join(",")
    }
}

/// Run a PowerShell snippet and return its output.
async fn run_powershell(script: &str) -> std::io::Result<std::process::Output> {
    Command::new("powershell")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-Command")
        .arg(script)
        .output()
        .await
}

/// Whether any of the target's image names is currently running.
async fn process_running(target: &ProcessTarget) -> bool {
    let ps = format!(
        "Get-Process -Name {} -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count",
        target.ps_name_list()
    );
    match run_powershell(&ps).await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse::<i32>()
            .map(|n| n > 0)
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Kill the process, wait for it to be gone, and leave the watchdog stop flag.
async fn stop_target(target: &ProcessTarget) {
    let names = target.ps_name_list();
    tracing::info!("Stopping {} ({})", target.label, names);
    let ps = format!(
        "Stop-Process -Name {names} -Force -ErrorAction SilentlyContinue; \
         Wait-Process -Name {names} -Timeout {STOP_WAIT_SECS} -ErrorAction SilentlyContinue"
    );
    if let Err(e) = run_powershell(&ps).await {
        tracing::warn!("Stop-Process for {} could not run: {}", target.label, e);
    }

    match tokio::fs::write(&target.stop_flag, b"stopped from the dashboard\r\n").await {
        Ok(()) => tracing::info!("Created stop flag {}", target.stop_flag.display()),
        Err(e) => tracing::warn!(
            "Could not create stop flag {} (the watchdog, if any, will restart {}): {}",
            target.stop_flag.display(),
            target.label,
            e
        ),
    }
}

/// Remove the watchdog stop flag, then start via the scheduled task or the
/// fallback command. `Err` carries a message suitable for the UI.
async fn start_target(target: &ProcessTarget) -> Result<(), String> {
    match tokio::fs::remove_file(&target.stop_flag).await {
        Ok(()) => tracing::info!("Removed stop flag {}", target.stop_flag.display()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!("Could not remove stop flag {}: {}", target.stop_flag.display(), e),
    }

    if let Some(task) = &target.scheduled_task {
        start_via_task(target, task).await
    } else if let Some(raw_cmd) = &target.start_cmd {
        start_via_command(target, raw_cmd);
        Ok(())
    } else {
        Err(format!("Neither {} is configured", target.env_hint))
    }
}

/// Snapshot of a scheduled task's last run, from `Get-ScheduledTaskInfo`.
struct TaskInfo {
    last_run_time: String,
    last_task_result: i64,
}

async fn task_info(task: &str) -> Option<TaskInfo> {
    let safe = task.replace('\'', "''");
    let ps = format!(
        "$i = Get-ScheduledTaskInfo -TaskName '{safe}' -ErrorAction Stop; \
         @{{ t = \"$($i.LastRunTime)\"; r = [int64]$i.LastTaskResult }} | ConvertTo-Json -Compress"
    );
    let out = run_powershell(&ps).await.ok()?;
    let v: Value = serde_json::from_str(String::from_utf8_lossy(&out.stdout).trim()).ok()?;
    Some(TaskInfo {
        last_run_time: v.get("t")?.as_str()?.to_string(),
        last_task_result: v.get("r")?.as_i64()?,
    })
}

/// Human explanation of a non-zero task result.
fn describe_task_result(target: &ProcessTarget, task: &str, result: i64) -> String {
    match result {
        TASK_RESULT_NOT_LOGGED_ON => format!(
            "task \"{task}\" could not run: its user is not logged on to the server \
             (no desktop session; set up auto-logon, or connect by Remote Desktop and disconnect without signing out)"
        ),
        1 => format!(
            "task \"{task}\" ran but the start script found no executable or config file (exit code 1, see {})",
            target.start_log
        ),
        2 => format!(
            "task \"{task}\" ran but the start script could not launch {} (exit code 2, see {})",
            target.label, target.start_log
        ),
        TASK_RESULT_NEVER_RAN => format!("task \"{task}\" did not run"),
        other => format!("task \"{task}\" ended with result 0x{other:X}"),
    }
}

/// Run the scheduled task and wait until the process shows up, translating
/// task failures (user not logged on, script exit codes) into messages.
async fn start_via_task(target: &ProcessTarget, task: &str) -> Result<(), String> {
    tracing::info!("Starting {} via scheduled task \"{}\"", target.label, task);
    let before = task_info(task).await;

    let out = Command::new("schtasks")
        .arg("/run")
        .arg("/tn")
        .arg(task)
        .output()
        .await
        .map_err(|e| format!("could not run schtasks: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        return Err(format!("schtasks /run \"{task}\" failed: {detail}"));
    }

    // `schtasks /run` reports success even when the task cannot start (e.g. no
    // logged-on user). Watch for the process, and read the task result meanwhile.
    let deadline = Instant::now() + Duration::from_secs(TASK_START_TIMEOUT_SECS);
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;

        if process_running(target).await {
            tracing::info!("{} is running after task \"{}\"", target.label, task);
            return Ok(());
        }

        if let Some(info) = task_info(task).await {
            let is_new_run = before
                .as_ref()
                .is_none_or(|b| b.last_run_time != info.last_run_time);
            let result = info.last_task_result;
            if is_new_run && result != 0 && result != TASK_RESULT_RUNNING {
                return Err(describe_task_result(target, task, result));
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "task \"{task}\" was started but no {} process appeared within {}s (see {})",
                target.label, TASK_START_TIMEOUT_SECS, target.start_log
            ));
        }
    }
}

/// Split `"C:\path\exe" args` / `C:\path\exe args` into (exe, args).
fn split_command(raw_cmd: &str) -> (&str, &str) {
    let cmd_str = raw_cmd.trim().trim_matches('\'');
    if let Some(unquoted) = cmd_str.strip_prefix('"') {
        if let Some(end_quote) = unquoted.find('"') {
            return (&unquoted[..end_quote], unquoted[end_quote + 1..].trim());
        }
        return (cmd_str, "");
    }
    match cmd_str.find(' ') {
        Some(space) => (&cmd_str[..space], cmd_str[space + 1..].trim()),
        None => (cmd_str, ""),
    }
}

/// Fallback when no scheduled task is configured: launch in the console
/// session via Win32, else spawn from the service session via PowerShell
/// (window hidden by Session 0, not by choice).
fn start_via_command(target: &ProcessTarget, raw_cmd: &str) {
    let (exe_path, args) = split_command(raw_cmd);
    let working_dir = Path::new(exe_path).parent().and_then(|p| p.to_str());

    tracing::info!(
        "Attempting to launch {} in interactive session: \"{}\" {}",
        target.label, exe_path, args
    );
    match crate::win_session::launch_in_user_session(exe_path, args, working_dir) {
        Ok(()) => {
            tracing::info!("Successfully launched {} in interactive user session", target.label);
        }
        Err(e) => {
            tracing::warn!(
                "Win32 interactive session launch failed ({}), falling back to PowerShell Start-Process",
                e
            );

            let mut ps_cmd = format!("Start-Process -FilePath '{}'", exe_path.replace('\'', "''"));
            if !args.is_empty() {
                ps_cmd.push_str(&format!(" -ArgumentList '{}'", args.replace('\'', "''")));
            }
            if let Some(wd) = working_dir {
                ps_cmd.push_str(&format!(" -WorkingDirectory '{}'", wd.replace('\'', "''")));
            }

            tracing::info!("Spawning {} via PowerShell: {}", target.label, ps_cmd);
            match StdCommand::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_cmd)
                .spawn()
            {
                Ok(_) => tracing::info!("Successfully spawned PowerShell to start {}", target.label),
                Err(e) => tracing::error!("Failed to spawn PowerShell for {}: {}", target.label, e),
            }
        }
    }
}

/// Shared handler body for `POST /api/server/{dcs,srs}-process`.
async fn process_action(target: ProcessTarget, action: &str) -> Response {
    if !matches!(action, "start" | "stop" | "restart") {
        return err_400("Invalid action");
    }

    if action == "stop" || action == "restart" {
        stop_target(&target).await;
    }

    if action == "start" || action == "restart" {
        if let Err(msg) = start_target(&target).await {
            tracing::error!("{} {} failed: {}", target.label, action, msg);
            return err_500(&msg);
        }
    }

    Json(json!({ "success": true })).into_response()
}

/// `GET /api/server/dcs-process` → check if DCS.exe or DCS_server.exe is running.
#[utoipa::path(
    get,
    path = "/api/server/dcs-process",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "DCS process running state"))
)]
pub async fn dcs_process_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    let running = process_running(&ProcessTarget::dcs(&state.config)).await;
    Json(json!({ "running": running })).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct DcsProcessAction {
    pub action: String,
}

/// `POST /api/server/dcs-process` → start/stop/restart DCS.
#[utoipa::path(
    post,
    path = "/api/server/dcs-process",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = DcsProcessAction,
    responses(
        (status = 200, description = "DCS process action executed"),
        (status = 400, description = "Invalid action"),
        (status = 500, description = "Start failed; `error` explains why")
    )
)]
pub async fn dcs_process_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<DcsProcessAction>,
) -> Response {
    process_action(ProcessTarget::dcs(&state.config), &payload.action).await
}

/// `GET /api/server/srs-process` → check if SRS-Server.exe is running.
#[utoipa::path(
    get,
    path = "/api/server/srs-process",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "SRS process running state"))
)]
pub async fn srs_process_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    let running = process_running(&ProcessTarget::srs(&state.config)).await;
    Json(json!({ "running": running })).into_response()
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
    responses(
        (status = 200, description = "SRS process action executed"),
        (status = 400, description = "Invalid action"),
        (status = 500, description = "Start failed; `error` explains why")
    )
)]
pub async fn srs_process_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<SrsProcessAction>,
) -> Response {
    process_action(ProcessTarget::srs(&state.config), &payload.action).await
}

#[cfg(test)]
mod process_tests {
    use super::*;

    #[test]
    fn split_command_handles_quoted_and_bare_paths() {
        assert_eq!(
            split_command(r#""C:\Program Files\DCS\bin\DCS_server.exe" --server --norender"#),
            (r"C:\Program Files\DCS\bin\DCS_server.exe", "--server --norender")
        );
        assert_eq!(
            split_command(r#"'"C:\x\SRS-Server.exe" -cfg="C:\x\server.cfg"'"#),
            (r"C:\x\SRS-Server.exe", r#"-cfg="C:\x\server.cfg""#)
        );
        assert_eq!(split_command(r"C:\x\app.exe launch"), (r"C:\x\app.exe", "launch"));
        assert_eq!(split_command(r"C:\x\app.exe"), (r"C:\x\app.exe", ""));
    }

    #[test]
    fn task_results_are_explained() {
        let cfg_dir = std::env::temp_dir();
        let target = ProcessTarget {
            label: "DCS",
            process_names: &["DCS_server"],
            scheduled_task: Some("DCS Server Start".into()),
            start_cmd: None,
            stop_flag: cfg_dir.join("dashboard_stop_dcs.flag"),
            env_hint: "DCS_SCHEDULED_TASK_NAME nor DCS_START_CMD",
            start_log: "dcs_start.log",
        };
        let msg = describe_task_result(&target, "DCS Server Start", TASK_RESULT_NOT_LOGGED_ON);
        assert!(msg.contains("not logged on"));
        let msg = describe_task_result(&target, "DCS Server Start", 1);
        assert!(msg.contains("exit code 1") && msg.contains("dcs_start.log"));
        let msg = describe_task_result(&target, "DCS Server Start", 0xC000_013A);
        assert!(msg.contains("0xC000013A"));
    }
}

// --- /api/server/services ----------------------------------------------------

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct WindowsServiceStatus {
    pub name: String,
    pub display_name: String,
    pub status: String,
}

/// `GET /api/server/services` -> list status of configured Windows services.
#[utoipa::path(
    get,
    path = "/api/server/services",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Status of configured Windows services", body = Vec<WindowsServiceStatus>))
)]
pub async fn windows_services_get(_user: AuthUser, State(state): State<AppState>) -> Response {
    if state.config.windows_services.is_empty() {
        return Json(Vec::<WindowsServiceStatus>::new()).into_response();
    }

    let names = state.config.windows_services.iter().map(|s| format!("'{}'", s.replace("'", "''"))).collect::<Vec<_>>().join(",");
    let ps = format!("Get-Service -Name {} -ErrorAction SilentlyContinue | Select-Object Name, DisplayName, Status | ConvertTo-Json -Compress -Depth 1", names);
    
    let output = match Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(&ps)
        .output()
        .await
    {
        Ok(out) => out,
        Err(_) => return Json(Vec::<WindowsServiceStatus>::new()).into_response(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();
    if stdout.is_empty() {
        return Json(Vec::<WindowsServiceStatus>::new()).into_response();
    }
    
    let mut results = Vec::new();
    if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(stdout) {
        if parsed.is_object() {
            results.push(parsed);
        } else if let Some(arr) = parsed.as_array_mut() {
            results.append(arr);
        }
    }

    let mut mapped = Vec::new();
    for r in results {
        let name = r.get("Name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let display_name = r.get("DisplayName").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        
        let status = if let Some(num) = r.get("Status").and_then(|v| v.as_u64()) {
            match num {
                1 => "Stopped".to_string(),
                2 => "StartPending".to_string(),
                3 => "StopPending".to_string(),
                4 => "Running".to_string(),
                5 => "ContinuePending".to_string(),
                6 => "PausePending".to_string(),
                7 => "Paused".to_string(),
                _ => "Unknown".to_string(),
            }
        } else if let Some(s) = r.get("Status").and_then(|v| v.as_str()) {
            s.to_string()
        } else {
            "Unknown".to_string()
        };

        mapped.push(WindowsServiceStatus { name, display_name, status });
    }

    Json(mapped).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct WindowsServiceAction {
    pub name: String,
    pub action: String,
}

/// `POST /api/server/services` -> start/stop/restart a specific Windows service.
#[utoipa::path(
    post,
    path = "/api/server/services",
    tags = ["system"],
    security(("jwt" = [])),
    request_body = WindowsServiceAction,
    responses((status = 200, description = "Windows service action executed"))
)]
pub async fn windows_services_post(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<WindowsServiceAction>,
) -> Response {
    if !state.config.windows_services.iter().any(|s| s.eq_ignore_ascii_case(&payload.name)) {
        return err_500("Service not found in configured WINDOWS_SERVICES list.");
    }

    let name = payload.name.replace("'", "''");

    if payload.action == "start" {
        let cmd = format!("Start-Service -Name '{}'", name);
        let _ = Command::new("powershell").arg("-NoProfile").arg("-Command").arg(&cmd).status().await;
        return Json(json!({ "success": true })).into_response();
    }

    if payload.action == "stop" {
        let cmd = format!("Stop-Service -Name '{}' -Force", name);
        let _ = Command::new("powershell").arg("-NoProfile").arg("-Command").arg(&cmd).status().await;
        return Json(json!({ "success": true })).into_response();
    }

    if payload.action == "restart" {
        let cmd = format!("Restart-Service -Name '{}' -Force", name);
        let _ = Command::new("powershell").arg("-NoProfile").arg("-Command").arg(&cmd).status().await;
        return Json(json!({ "success": true })).into_response();
    }

    (axum::http::StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid action" }))).into_response()
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

#[utoipa::path(
    get,
    path = "/api/foothold/config",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "Foothold configuration data"))
)]
pub async fn foothold_config_get(
    State(app_state): State<AppState>,
) -> Result<Json<crate::foothold::FootholdConfigResponse>, (StatusCode, String)> {
    crate::foothold::get_foothold_config(&app_state.config.foothold_saves_dir)
        .map(Json)
        .map_err(|e| {
            tracing::error!("Failed to parse Foothold config: {:#}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to parse Foothold config: {}", e))
        })
}

#[utoipa::path(
    post,
    path = "/api/foothold/config",
    tags = ["system"],
    security(("jwt" = [])),
    request_body(content = std::collections::HashMap<String, serde_json::Value>, description = "Updated foothold config values"),
    responses((status = 200, description = "Config updated successfully"))
)]
pub async fn foothold_config_post(
    State(app_state): State<AppState>,
    Json(payload): Json<std::collections::HashMap<String, serde_json::Value>>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    crate::foothold::update_foothold_config(&app_state.config.foothold_saves_dir, payload)
        .map(|_| Json(serde_json::json!({"status": "ok"})))
        .map_err(|e| {
            tracing::error!("Failed to update Foothold config: {:#}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to update Foothold config: {}", e))
        })
}
