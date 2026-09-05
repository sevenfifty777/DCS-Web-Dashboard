//! DCS-gRPC-backed REST handlers (the unary endpoints).
//!
//! These port the promise wrappers in `web-dashboard/src/lib/grpc.ts` plus the
//! Next.js API routes (`/api/health`, `/api/players`, `/api/chat`,
//! `/api/console`, `/api/triggers`, `/api/mission`) onto
//! tonic. JSON response shapes are hand-assembled to match the original routes
//! exactly (the source used `keepCase: true` / `enums: String`).
//!
//! All endpoints except `/api/health` require a valid session (the [`AuthUser`]
//! extractor). The filesystem-backed parts of the mission route
//! (`serverSettings.lua` parsing, mission queue mutation, uploaded-mission
//! listing) are provided by [`crate::settings_lua`].

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::path::Path;

use crate::auth::AuthUser;
use crate::carrier_recovery;
use crate::grpc;
use crate::pb::dcs::common::v0::Coalition;
use crate::settings_lua;
use crate::state::AppState;

// --- error helpers ---------------------------------------------------------

/// 500 with `{ "error": <prefix>, "details": <grpc message> }` (matches the
/// health/players/chat routes).
pub fn err_detail(prefix: &str, status: tonic::Status) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": prefix, "details": status.message() })),
    )
        .into_response()
}

/// 500 with `{ "error": <grpc message> }` (matches the console/triggers/
/// mission routes which surface `err.message` directly).
fn err_simple(status: tonic::Status) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": status.message() })),
    )
        .into_response()
}

/// 400 with `{ "error": <msg> }`.
fn bad_request(msg: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
}

/// Render a `Coalition` discriminant back to its proto string name (the source
/// emitted enum string names via `enums: String`).
fn coalition_name(value: i32) -> &'static str {
    Coalition::try_from(value)
        .map(|c| c.as_str_name())
        .unwrap_or("COALITION_ALL")
}

// --- /api/health (public) --------------------------------------------------

/// `GET /api/health` → DCS server health + version (MetadataService).
///
/// Intentionally public so the login screen can surface server status before a
/// session exists. Process liveness lives at `GET /healthz`.
#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, description = "Server health and version"),
        (status = 500, description = "Failed to connect to DCS server")
    ),
    tags = ["dcs"]
)]
pub async fn health(State(state): State<AppState>) -> Response {
    let health = grpc::get_health(state.grpc.clone()).await;
    let version = grpc::get_version(state.grpc.clone()).await;
    match (health, version) {
        (Ok(h), Ok(v)) => Json(json!({
            "health": { "alive": h.alive },
            "version": { "version": v.version },
        }))
        .into_response(),
        (Err(e), _) | (_, Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to connect to DCS server", "details": e.message() })),
        )
            .into_response(),
    }
}

// --- /api/players ----------------------------------------------------------

/// `GET /api/players` → connected players (NetService.GetPlayers).
#[utoipa::path(
    get,
    path = "/api/players",
    responses(
        (status = 200, description = "List of connected players"),
        (status = 500, description = "Failed to fetch players")
    ),
    security(
        ("jwt" = [])
    ),
    tags = ["dcs"]
)]
pub async fn players(_user: AuthUser, State(state): State<AppState>) -> Response {
    match grpc::get_players(state.grpc.clone()).await {
        Ok(resp) => {
            let players: Vec<_> = resp
                .players
                .into_iter()
                .map(|p| {
                    json!({
                        "id": p.id,
                        "name": p.name,
                        "coalition": coalition_name(p.coalition),
                        "slot": p.slot,
                        "ping": p.ping,
                        "remote_address": p.remote_address,
                        "ucid": p.ucid,
                        "locale": p.locale,
                    })
                })
                .collect();
            Json(json!({ "players": players })).into_response()
        }
        Err(e) => err_detail("Failed to fetch players", e),
    }
}

/// `GET /api/players/banned` → banned players (HookService.GetBannedPlayers).
#[utoipa::path(
    get,
    path = "/api/players/banned",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "List of banned players"),
    )
)]
pub async fn banned_players(_user: AuthUser, State(state): State<AppState>) -> Response {
    match grpc::get_banned_players(state.grpc.clone()).await {
        Ok(resp) => {
            let bans: Vec<_> = resp
                .bans
                .into_iter()
                .map(|b| {
                    json!({
                        "ucid": b.ucid,
                        "ip_address": b.ip_address,
                        "player_name": b.player_name,
                        "reason": b.reason,
                        "banned_from": b.banned_from,
                        "banned_until": b.banned_until,
                    })
                })
                .collect();
            Json(json!({ "bans": bans })).into_response()
        }
        Err(e) => err_detail("Failed to fetch banned players", e),
    }
}

// --- /api/chat -------------------------------------------------------------

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ChatBody {
    message: Option<String>,
    coalition: Option<String>,
}

/// `POST /api/chat` → broadcast chat (NetService.SendChat).
#[utoipa::path(
    post,
    path = "/api/chat",
    request_body = ChatBody,
    responses(
        (status = 200, description = "Message sent successfully"),
        (status = 400, description = "Message is required"),
        (status = 500, description = "Failed to send chat")
    ),
    security(
        ("jwt" = [])
    ),
    tags = ["dcs"]
)]
pub async fn chat(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ChatBody>,
) -> Response {
    let message = match body.message {
        Some(m) if !m.is_empty() => m,
        _ => return bad_request("Message is required"),
    };
    // Default to COALITION_ALL, matching the source default.
    let coalition = body
        .coalition
        .as_deref()
        .and_then(Coalition::from_str_name)
        .unwrap_or(Coalition::All) as i32;

    match grpc::send_chat(state.grpc.clone(), message, coalition).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to send chat", e),
    }
}

// --- /api/console ----------------------------------------------------------

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ConsoleBody {
    lua: Option<String>,
}

/// `POST /api/console` → evaluate Lua in the mission (CustomService.Eval).
#[utoipa::path(
    post,
    path = "/api/console",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = ConsoleBody,
    responses(
        (status = 200, description = "Lua evaluation result"),
    )
)]
pub async fn console(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<ConsoleBody>,
) -> Response {
    let lua = match body.lua {
        Some(l) if !l.is_empty() => l,
        _ => return bad_request("Lua script is required"),
    };
    match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => Json(json!({ "result": resp.json })).into_response(),
        Err(e) => err_simple(e),
    }
}

// --- /api/triggers ---------------------------------------------------------

#[derive(Deserialize, utoipa::IntoParams)]
pub struct FlagQuery {
    flag: Option<String>,
}

/// `GET /api/triggers?flag=...` → read user flag (TriggerService.GetUserFlag).
#[utoipa::path(
    get,
    path = "/api/triggers",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(FlagQuery),
    responses(
        (status = 200, description = "Flag value"),
    )
)]
pub async fn get_flag(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<FlagQuery>,
) -> Response {
    let flag = match q.flag {
        Some(f) if !f.is_empty() => f,
        _ => return bad_request("Flag parameter is required"),
    };
    match grpc::get_user_flag(state.grpc.clone(), flag.clone()).await {
        Ok(resp) => Json(json!({ "flag": flag, "value": resp.value })).into_response(),
        Err(e) => err_simple(e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SetFlagBody {
    #[schema(value_type = Object)]
    flag: Option<serde_json::Value>,
    #[schema(value_type = Object)]
    value: Option<serde_json::Value>,
}

/// `POST /api/triggers` → set user flag (TriggerService.SetUserFlag). The
/// source coerced `flag` via `.toString()` and `value` via `Number(...)`.
#[utoipa::path(
    post,
    path = "/api/triggers",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = SetFlagBody,
    responses(
        (status = 200, description = "Flag set successfully"),
    )
)]
pub async fn set_flag(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<SetFlagBody>,
) -> Response {
    let flag = match body.flag.as_ref() {
        Some(v) => value_to_string(v),
        None => return bad_request("Flag and value are required"),
    };
    let value = match body.value.as_ref().and_then(value_to_u32) {
        Some(v) => v,
        None => return bad_request("Flag and value are required"),
    };
    match grpc::set_user_flag(state.grpc.clone(), flag.clone(), value).await {
        Ok(()) => Json(json!({ "success": true, "flag": flag, "value": value })).into_response(),
        Err(e) => err_simple(e),
    }
}

/// Coerce a JSON scalar to a string (mirrors JS `String(value)` for the flag).
fn value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

/// Coerce a JSON scalar to a non-negative `u32` (mirrors JS `Number(value)`).
fn value_to_u32(v: &serde_json::Value) -> Option<u32> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().map(|f| f.max(0.0).round() as u32),
        serde_json::Value::String(s) => s
            .trim()
            .parse::<f64>()
            .ok()
            .map(|f| f.max(0.0).round() as u32),
        _ => None,
    }
}

// --- /api/mission ----------------------------------------------------------

/// `GET /api/mission` → current mission + paused state (HookService) plus
/// filesystem-derived `serverInfo`, `queue`, and `uploadedMissions`.
///
/// Per-call gRPC failures fall back to `"Unknown"` / `false`, matching the
/// source's individual `.catch(...)` handling. A `serverSettings.lua` parse
/// failure yields `serverInfo: null` and an empty queue, as in the source.
#[utoipa::path(
    get,
    path = "/api/mission",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Mission status details"),
    )
)]
pub async fn mission_status(_user: AuthUser, State(state): State<AppState>) -> Response {
    // Use a timeout so that if DCS is offline and the gRPC connection hangs,
    // we fail fast and still return the serverInfo from Lua.
    let (name, paused, is_offline) = match tokio::time::timeout(
        std::time::Duration::from_secs(2),
        async {
            tokio::join!(
                grpc::get_mission_name(state.grpc.clone()),
                grpc::get_paused(state.grpc.clone())
            )
        }
    ).await {
        Ok((Ok(n), Ok(p))) => (n.name, p.paused, false),
        _ => ("Unknown".to_string(), false, true),
    };

    let (server_info, queue) = match settings_lua::read_settings(&state.config.server_settings_path()).await
    {
        Ok(settings) => {
            let ip = settings_lua::public_ip(&state.http).await;
            let info = settings_lua::server_info(&settings, &ip);
            (info, settings_lua::mission_list(&settings))
        }
        Err(e) => {
            tracing::error!("Failed to read serverSettings.lua: {:#}", e);
            (serde_json::Value::Null, Vec::new())
        }
    };

    let lua = "return { theatre = env.mission.theatre, time = timer.getAbsTime() }";
    let env_data = match grpc::custom_eval(state.grpc.clone(), lua.to_string()).await {
        Ok(resp) => serde_json::from_str::<serde_json::Value>(&resp.json).unwrap_or(json!({})),
        Err(_) => json!({}),
    };

    let uploaded = list_uploaded_missions(&state.config.uploads_dir()).await;

    Json(json!({
        "currentMission": name,
        "isPaused": paused,
        "isOffline": is_offline,
        "serverInfo": server_info,
        "queue": queue,
        "uploadedMissions": uploaded,
        "theatre": env_data.get("theatre"),
        "time": env_data.get("time"),
    }))
    .into_response()
}

/// List uploaded `.miz` files as absolute paths (missing dir → empty list).
async fn list_uploaded_missions(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if file_name.ends_with(".miz") {
                out.push(dir.join(file_name.as_ref()).to_string_lossy().into_owned());
            }
        }
    }
    out
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct MissionBody {
    action: Option<String>,
    payload: Option<MissionPayload>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct MissionPayload {
    file_name: Option<String>,
}

/// `POST /api/mission` → mission control actions (HookService). Queue
/// mutation (`add_to_queue` / `remove_from_queue`) is filesystem-backed and
/// returns `501` until Phase 5.
#[utoipa::path(
    post,
    path = "/api/mission",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = MissionBody,
    responses(
        (status = 200, description = "Mission action successful"),
    )
)]
pub async fn mission_action(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<MissionBody>,
) -> Response {
    let action = body.action.unwrap_or_default();
    let result = match action.as_str() {
        "pause" => grpc::set_paused(state.grpc.clone(), true).await,
        "resume" => grpc::set_paused(state.grpc.clone(), false).await,
        "stop" => grpc::stop_mission(state.grpc.clone()).await,
        "reload" => grpc::reload_current_mission(state.grpc.clone()).await,
        "load_file" => {
            let file_name = match body.payload.and_then(|p| p.file_name) {
                Some(f) if !f.is_empty() => {
                    let p = std::path::Path::new(&f);
                    if p.is_absolute() {
                        f
                    } else {
                        state.config.missions_dir().join(p).to_string_lossy().into_owned()
                    }
                }
                _ => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "file_name is required" })),
                    )
                        .into_response()
                }
            };
            // Double-escape backslashes (DCS-gRPC interprets them literally).
            let escaped = file_name.replace('\\', "\\\\");
            grpc::load_mission(state.grpc.clone(), escaped).await
        }
        "add_to_queue" | "remove_from_queue" => {
            let file_name = match body.payload.and_then(|p| p.file_name) {
                Some(f) if !f.is_empty() => {
                    let p = std::path::Path::new(&f);
                    if p.is_absolute() {
                        f
                    } else {
                        state.config.missions_dir().join(p).to_string_lossy().into_owned()
                    }
                }
                _ => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "file_name is required" })),
                    )
                        .into_response()
                }
            };
            let kind = if action == "add_to_queue" {
                settings_lua::QueueAction::Add
            } else {
                settings_lua::QueueAction::Remove
            };
            return match settings_lua::mutate_queue(
                &state.config.server_settings_path(),
                kind,
                &file_name,
            )
            .await
            {
                Ok(()) => Json(json!({ "success": true, "action": action })).into_response(),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": e.to_string() })),
                )
                    .into_response(),
            };
        }
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Invalid action" }))).into_response(),
    };

    match result {
        Ok(()) => Json(json!({ "success": true, "action": action })).into_response(),
        Err(e) => err_simple(e),
    }
}// --- Recovered Endpoints ---

#[derive(Deserialize, utoipa::ToSchema)]
pub struct PlayerActionBody {
    id: Option<u32>,
    reason: Option<String>,
    period: Option<u32>, // for ban
    ucid: Option<String>, // for unban
}

#[utoipa::path(
    post,
    path = "/api/players/kick",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = PlayerActionBody,
    responses((status = 200, description = "Player kicked"))
)]
pub async fn kick_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<PlayerActionBody>) -> Response {
    let reason = payload.reason.unwrap_or_else(|| "Kicked".to_string());
    match grpc::kick_player(state.grpc.clone(), payload.id.unwrap_or(0), reason).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to kick player", e),
    }
}

#[utoipa::path(
    post,
    path = "/api/players/ban",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = PlayerActionBody,
    responses((status = 200, description = "Player banned"))
)]
pub async fn ban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<PlayerActionBody>) -> Response {
    let period = payload.period.unwrap_or(0);
    let reason = payload.reason.unwrap_or_else(|| "Banned".to_string());
    match grpc::ban_player(state.grpc.clone(), payload.id.unwrap_or(0), period, reason).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to ban player", e),
    }
}

#[utoipa::path(
    post,
    path = "/api/players/unban",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = PlayerActionBody,
    responses((status = 200, description = "Player unbanned"))
)]
pub async fn unban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<PlayerActionBody>) -> Response {
    let ucid = payload.ucid.unwrap_or_default();
    match grpc::unban_player(state.grpc.clone(), ucid).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to unban player", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AnnouncementBody {
    #[serde(alias = "text")]
    message: String,
    display_time: Option<u32>,
    coalition: Option<String>,
}

#[utoipa::path(
    post,
    path = "/api/announcements",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = AnnouncementBody,
    responses((status = 200, description = "Announcement sent"))
)]
pub async fn announcements(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<AnnouncementBody>) -> Response {
    let display_time = payload.display_time.unwrap_or(10);

    let coalition = match payload.coalition.as_deref() {
        Some(coalition_str) => match coalition_str {
            "COALITION_RED" => 1,
            "COALITION_BLUE" => 2,
            "COALITION_NEUTRAL" => 0,
            _ => -1,
        },
        None => -1,
    };

    let result = if coalition >= 0 {
        grpc::out_text_for_coalition(state.grpc.clone(), coalition, payload.message, display_time, false).await
    } else {
        grpc::out_text(state.grpc.clone(), payload.message, display_time, false).await
    };
    
    match result {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to send announcement", e),
    }
}

// --- /api/airboss ----------------------------------------------------------
//
// Both routes drive the stand-alone `CarrierRecovery` Lua controller (see
// `crate::carrier_recovery`). The controller is injected into the mission on
// first use, so these work in any mission, with or without Foothold.

/// Run a controller call: the cheap probe first, the full install script only
/// when the mission does not have the module at the expected version yet.
async fn eval_controller(state: &AppState, scripts: carrier_recovery::Scripts) -> Result<serde_json::Value, tonic::Status> {
    let parse = |res: crate::pb::dcs::custom::v0::EvalResponse| {
        serde_json::from_str::<serde_json::Value>(&res.json).unwrap_or(serde_json::Value::Null)
    };
    let first = parse(grpc::custom_eval(state.grpc.clone(), scripts.probe).await?);
    if !carrier_recovery::needs_install(&first) {
        return Ok(first);
    }
    tracing::info!("installing CarrierRecovery {} into the mission", carrier_recovery::MODULE_VERSION);
    Ok(parse(grpc::custom_eval(state.grpc.clone(), scripts.install).await?))
}

/// Telemetry and recovery solution for one carrier group, as returned by the
/// Lua controller's `windReport`.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossDataResponse {
    /// Mission Editor group name of the carrier.
    pub carrier_name: String,
    /// DCS unit type name of the lead ship (e.g. `CVN_71`).
    pub type_name: String,
    /// Ship position, DCS map coordinates (x north, z east).
    pub carrier_u: f64,
    pub carrier_v: f64,
    /// Current ship course, degrees true.
    pub brc: f64,
    /// Current ship speed over ground, knots.
    pub ship_spd: f64,
    /// Natural wind at deck height: direction it blows from, degrees true.
    pub tw_dir: f64,
    /// Natural wind speed, knots.
    pub tw_spd: f64,
    /// Headwind component of the natural wind on the current course, knots.
    pub headwind: f64,
    /// Wind over deck on the current course, knots.
    pub wod: f64,
    /// Target wind over the angled deck the controller aims for, knots.
    pub target_wod: f64,
    /// Course the controller would steer for a recovery, degrees true.
    pub recovery_heading: f64,
    /// Speed the controller would order for a recovery, knots.
    pub recovery_speed: f64,
    /// Solver regime: `optimal`, `vmax_limited`, `vmin_limited`, `low_wind`, `weak_wind`.
    pub regime: String,
    /// Angled-deck offset used for this ship type, degrees.
    pub deck_offset: f64,
    pub min_speed: f64,
    pub max_speed: f64,
    /// Below this natural wind the ship keeps its course and only adjusts speed.
    pub angled_deck_min_wind: f64,
    /// `foothold` when the Foothold BattleCommander manages this group, else `standalone`.
    pub backend: String,
    /// Deck classification: `catobar`, `stobar`, `vstol`, `unknown`, or absent for a non-carrier ship.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deck_class: Option<String>,
    /// Coalition of the group (0 neutral, 1 red, 2 blue).
    pub coalition: i32,
    /// Recovery phase: `normal`, `pending`, `aligning` or `active`.
    pub recovery_phase: String,
}

/// Batched telemetry: one entry per requested group name. A ship that is not
/// in the mission gets `{ "error": "<name> is not available." }` instead.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossReportsResponse {
    #[schema(value_type = std::collections::HashMap<String, AirbossDataResponse>)]
    pub reports: serde_json::Value,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct AirbossQuery {
    /// Carrier group name (defaults to `CVN-72`). Ignored when `names` is given.
    name: Option<String>,
    /// Comma-separated carrier group names. When present the response is
    /// `{ "reports": { <name>: <report> } }` and costs one mission Eval for all of them.
    names: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/airboss",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(AirbossQuery),
    responses(
        (status = 200, description = "Current carrier telemetry and recovery solution (one report with `name`, `{ reports }` with `names`)", body = AirbossDataResponse),
        (status = 400, description = "Invalid carrier group name"),
        (status = 404, description = "Carrier group not found in the mission (single-name form only)")
    )
)]
pub async fn airboss_data(_user: AuthUser, State(state): State<AppState>, Query(q): Query<AirbossQuery>) -> Response {
    if let Some(names) = q.names.as_deref() {
        let names = match carrier_recovery::parse_group_names(names) {
            Ok(names) => names,
            Err(message) => return bad_request(&message),
        };
        return match eval_controller(&state, carrier_recovery::wind_reports_scripts(&names)).await {
            Ok(json) => {
                let reports = json.get("reports").cloned().unwrap_or(serde_json::Value::Null);
                if reports.is_object() {
                    Json(AirbossReportsResponse { reports }).into_response()
                } else if reports.is_array() && reports.as_array().is_some_and(|a| a.is_empty()) {
                    // An empty Lua table serialises as a list.
                    Json(AirbossReportsResponse { reports: json!({}) }).into_response()
                } else {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Invalid json from carrier recovery script" })),
                    )
                        .into_response()
                }
            }
            Err(e) => err_detail("Failed to evaluate carrier recovery script", e),
        };
    }

    let carrier = q.name.as_deref().unwrap_or(carrier_recovery::DEFAULT_GROUP);
    if !carrier_recovery::is_valid_group_name(carrier) {
        return bad_request("Invalid carrier group name");
    }
    match eval_controller(&state, carrier_recovery::wind_report_scripts(carrier)).await {
        Ok(json) => {
            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                (StatusCode::NOT_FOUND, Json(json!({ "error": err }))).into_response()
            } else if json.is_object() {
                Json(json).into_response()
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Invalid json from carrier recovery script" })),
                )
                    .into_response()
            }
        }
        Err(e) => err_detail("Failed to evaluate carrier recovery script", e),
    }
}

/// One carrier-type ship group detected in the mission.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossCarrier {
    /// Mission Editor group name (what every other airboss call takes).
    pub group: String,
    /// Name of the lead unit.
    pub unit: String,
    /// DCS unit type name of the lead ship (e.g. `CVN_72`, `LHA_Tarawa`).
    #[serde(rename = "type")]
    pub type_name: String,
    /// 0 neutral, 1 red, 2 blue.
    pub coalition: i32,
    /// `catobar`, `stobar`, `vstol` or `unknown` (type-name hint only).
    pub deck_class: String,
    /// DCS attributes that decided the classification.
    pub attributes: Vec<String>,
    /// Angled-deck offset the controller uses for this hull, degrees.
    pub deck_offset: f64,
    /// Target wind over deck currently in force for this group, knots.
    pub target_wod: f64,
    /// `foothold` or `standalone`.
    pub backend: String,
    /// `normal`, `pending`, `aligning` or `active`.
    pub recovery_phase: String,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossCarriersResponse {
    #[schema(value_type = Vec<AirbossCarrier>)]
    pub carriers: serde_json::Value,
    /// Version of the Lua controller that answered.
    pub version: String,
}

#[utoipa::path(
    get,
    path = "/api/airboss/carriers",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Every carrier-type ship group in the running mission", body = AirbossCarriersResponse)
    )
)]
pub async fn airboss_carriers(_user: AuthUser, State(state): State<AppState>) -> Response {
    match eval_controller(&state, carrier_recovery::list_carriers_scripts()).await {
        Ok(json) => {
            let carriers = match json.get("carriers") {
                Some(v) if v.is_array() => v.clone(),
                // An empty Lua table may serialise as `{}`.
                Some(v) if v.is_object() && v.as_object().is_some_and(|o| o.is_empty()) => json!([]),
                _ => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Invalid json from carrier recovery script" })),
                    )
                        .into_response()
                }
            };
            let version = json
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or(carrier_recovery::MODULE_VERSION)
                .to_string();
            Json(AirbossCarriersResponse { carriers, version }).into_response()
        }
        Err(e) => err_detail("Failed to list carriers", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AirbossConfigPayload {
    /// Carrier group name.
    pub carrier: String,
    /// Target wind over deck for this ship, knots (10 to 45).
    pub target_wod: f64,
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossConfigResponse {
    pub carrier_name: String,
    /// Effective target after clamping, knots.
    pub target_wod: f64,
    pub backend: String,
}

#[utoipa::path(
    post,
    path = "/api/airboss/config",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = AirbossConfigPayload,
    responses(
        (status = 200, description = "Per-carrier target applied", body = AirbossConfigResponse),
        (status = 400, description = "Invalid carrier group name or target out of range")
    )
)]
pub async fn airboss_config(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<AirbossConfigPayload>) -> Response {
    if !carrier_recovery::is_valid_group_name(&payload.carrier) {
        return bad_request("Invalid carrier group name");
    }
    if !carrier_recovery::is_valid_target_wod(payload.target_wod) {
        return bad_request(&format!(
            "target_wod must be between {} and {} kt",
            carrier_recovery::TARGET_WOD_MIN_KT,
            carrier_recovery::TARGET_WOD_MAX_KT
        ));
    }
    match eval_controller(&state, carrier_recovery::group_config_scripts(&payload.carrier, payload.target_wod)).await {
        Ok(json) => {
            if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": err }))).into_response()
            } else if json.is_object() {
                tracing::info!("carrier {} target WOD set to {} kt", payload.carrier, payload.target_wod);
                Json(json).into_response()
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Invalid json from carrier recovery script" })),
                )
                    .into_response()
            }
        }
        Err(e) => err_detail("Failed to apply carrier configuration", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AirbossActionPayload {
    /// `start` (turn into wind), `resume` (normal circuit) or `status`.
    pub action: String,
    /// Carrier group name (defaults to `CVN-72`).
    #[serde(default)]
    pub carrier: Option<String>,
}

/// Result of `start` / `resume`. `status` returns the controller's status table instead.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossActionResponse {
    pub success: bool,
    pub action: String,
    pub carrier: String,
}

/// Map a controller refusal to an HTTP status. Messages come from the Lua
/// controller (English) or, in Foothold missions, from Foothold's localized
/// strings, so unknown texts fall back to 400.
fn carrier_refusal_status(message: &str) -> StatusCode {
    let lower = message.to_ascii_lowercase();
    if lower.contains("already pending or active") || lower.contains("not in recovery-course mode") {
        StatusCode::CONFLICT
    } else if lower.starts_with("unable to turn into wind") || lower.contains("could not resume") {
        StatusCode::UNPROCESSABLE_ENTITY
    } else if lower.contains("is not available") || lower.contains("not found") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    }
}

#[utoipa::path(
    post,
    path = "/api/airboss/action",
    tags = ["dcs"],
    security(("jwt" = [])),
    request_body = AirbossActionPayload,
    responses(
        (status = 200, description = "Action accepted (start/resume) or status table (status)", body = AirbossActionResponse),
        (status = 400, description = "Invalid action or carrier group name"),
        (status = 404, description = "Carrier group not found in the mission"),
        (status = 409, description = "Recovery already active (start) or not active (resume)"),
        (status = 422, description = "Recovery leg unsafe (land clearance) or circuit could not be restored")
    )
)]
pub async fn airboss_action(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<AirbossActionPayload>) -> Response {
    let Some(action) = carrier_recovery::Action::parse(&payload.action) else {
        return bad_request("Invalid action");
    };
    let carrier = payload.carrier.as_deref().unwrap_or(carrier_recovery::DEFAULT_GROUP);
    if !carrier_recovery::is_valid_group_name(carrier) {
        return bad_request("Invalid carrier group name");
    }

    let result = match eval_controller(&state, carrier_recovery::action_scripts(action, carrier)).await {
        Ok(value) => value,
        Err(e) => return err_detail("Failed to execute carrier action", e),
    };

    match action {
        carrier_recovery::Action::Status => {
            if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
                (StatusCode::NOT_FOUND, Json(json!({ "error": err }))).into_response()
            } else if result.is_object() {
                Json(result).into_response()
            } else {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Invalid status from carrier recovery script" })),
                )
                    .into_response()
            }
        }
        carrier_recovery::Action::Start | carrier_recovery::Action::Resume => {
            let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            let message = result
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Carrier controller returned no result")
                .to_string();
            if ok {
                Json(AirbossActionResponse {
                    success: true,
                    action: payload.action,
                    carrier: carrier.to_string(),
                })
                .into_response()
            } else {
                (carrier_refusal_status(&message), Json(json!({ "error": message }))).into_response()
            }
        }
    }
}
