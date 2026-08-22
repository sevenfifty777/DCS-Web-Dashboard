//! DCS-gRPC-backed REST handlers (the unary endpoints).
//!
//! These port the promise wrappers in `web-dashboard/src/lib/grpc.ts` plus the
//! Next.js API routes (`/api/health`, `/api/players`, `/api/chat`,
//! `/api/console`, `/api/triggers`, `/api/atmosphere`, `/api/mission`) onto
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
/// atmosphere/mission routes which surface `err.message` directly).
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

pub async fn performance(State(state): State<AppState>) -> Response {
    let ballistics_fut = grpc::get_ballistics_count(state.grpc.clone());
    let model_time_fut = grpc::get_model_time(state.grpc.clone());
    let real_time_fut = grpc::get_real_time(state.grpc.clone());

    let (ballistics_res, model_time_res, real_time_res) = tokio::join!(ballistics_fut, model_time_fut, real_time_fut);

    let mut details = json!({});

    if let Ok(b) = ballistics_res {
        details["ballistics_count"] = json!(b.count);
    }
    if let Ok(m) = model_time_res {
        details["model_time"] = json!(m.time);
    }
    if let Ok(r) = real_time_res {
        details["real_time"] = json!(r.time);
    }

    Json(details).into_response()
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

// --- /api/atmosphere -------------------------------------------------------

#[derive(Deserialize, utoipa::IntoParams)]
pub struct AtmosphereQuery {
    lat: Option<f64>,
    lon: Option<f64>,
    alt: Option<f64>,
}

/// `GET /api/atmosphere?lat=&lon=&alt=` → wind + temperature/pressure
/// (AtmosphereService). `alt` defaults to 0, matching the source.
#[utoipa::path(
    get,
    path = "/api/atmosphere",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(AtmosphereQuery),
    responses(
        (status = 200, description = "Atmosphere data"),
    )
)]
pub async fn atmosphere(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<AtmosphereQuery>,
) -> Response {
    let (lat, lon) = match (q.lat, q.lon) {
        (Some(lat), Some(lon)) => (lat, lon),
        _ => return bad_request("Valid lat, lon, and alt are required"),
    };
    let alt = q.alt.unwrap_or(0.0);

    let wind = grpc::get_wind(state.grpc.clone(), lat, lon, alt).await;
    let temp = grpc::get_temperature_and_pressure(state.grpc.clone(), lat, lon, alt).await;
    match (wind, temp) {
        (Ok(w), Ok(t)) => Json(json!({
            "wind": { "heading": w.heading, "strength": w.strength },
            "atmosphere": { "temperature": t.temperature, "pressure": t.pressure },
        }))
        .into_response(),
        (Err(e), _) | (_, Err(e)) => err_simple(e),
    }
}

// --- /api/marks ------------------------------------------------------------

/// `GET /api/marks` → current mark panels (WorldService.GetMarkPanels).
#[utoipa::path(
    get,
    path = "/api/marks",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "List of mark panels"),
    )
)]
pub async fn get_marks(_user: AuthUser, State(state): State<AppState>) -> Response {
    match grpc::get_mark_panels(state.grpc.clone()).await {
        Ok(resp) => {
            let marks: Vec<_> = resp
                .mark_panels
                .into_iter()
                .map(|m| {
                    json!({
                        "id": m.id,
                        "time": m.time,
                        "coalition": m.coalition.map(coalition_name).unwrap_or("COALITION_ALL"),
                        "group_id": m.group_id,
                        "text": m.text,
                        "position": m.position.map(|p| json!({
                            "lat": p.lat,
                            "lon": p.lon,
                            "alt": p.alt,
                        })),
                    })
                })
                .collect();
            Json(json!({ "marks": marks })).into_response()
        }
        Err(e) => err_detail("Failed to fetch mark panels", e),
    }
}

// --- /api/airbases ---------------------------------------------------------

/// `GET /api/airbases` → current airbases (WorldService.GetAirbases).
#[utoipa::path(
    get,
    path = "/api/airbases",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "List of airbases"),
    )
)]
pub async fn get_airbases(_user: AuthUser, State(state): State<AppState>) -> Response {
    match grpc::get_airbases(state.grpc.clone()).await {
        Ok(resp) => {
            let airbases: Vec<_> = resp
                .airbases
                .into_iter()
                .map(|a| {
                    json!({
                        "name": a.name,
                        "callsign": a.callsign,
                        "display_name": a.display_name,
                        "coalition": coalition_name(a.coalition),
                        "category": a.category,
                        "position": a.position.map(|p| json!({
                            "lat": p.lat,
                            "lon": p.lon,
                            "alt": p.alt,
                        })),
                    })
                })
                .collect();
            Json(json!({ "airbases": airbases })).into_response()
        }
        Err(e) => err_detail("Failed to fetch airbases", e),
    }
}

// --- /api/zones ------------------------------------------------------------

/// `GET /api/zones` → current mission editor zones (CustomService.Eval).
#[utoipa::path(
    get,
    path = "/api/zones",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "List of zones"),
    )
)]
pub async fn get_zones(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = r#"
local res = {}
if env.mission and env.mission.triggers and env.mission.triggers.zones then
    for k, z in pairs(env.mission.triggers.zones) do
        if not (z.name and (string.find(string.lower(z.name), "hidden") or string.find(z.name, "-%d+$") or string.find(z.name, "^Scoot") or string.find(string.lower(z.name), "%-edge$"))) then
            local lat, lon = coord.LOtoLL({x = z.x, y = 0, z = z.y})
            local new_z = {
                name = z.name,
                zoneId = z.zoneId,
                color = z.color,
                type = z.type,
                radius = z.radius,
                hidden = z.hidden,
                lat = lat,
                lon = lon
            }
            if z.verticies then
                new_z.verticies = {}
                for i, v in ipairs(z.verticies) do
                    local vlat, vlon = coord.LOtoLL({x = v.x, y = 0, z = v.y})
                    table.insert(new_z.verticies, {lat = vlat, lon = vlon})
                end
            end
            table.insert(res, new_z)
        end
    end
end
return res
"#.to_string();

    match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            // The response contains a JSON string of the returned table.
            let json_val: serde_json::Value = match serde_json::from_str(&resp.json) {
                Ok(v) => v,
                Err(_) => json!([]),
            };
            Json(json!({ "zones": json_val })).into_response()
        }
        Err(e) => err_detail("Failed to fetch zones", e),
    }
}

// --- /api/zones/foothold ----------------------------------------------------

/// `GET /api/zones/foothold` → Foothold-specific zones (CustomService.Eval).
#[utoipa::path(
    get,
    path = "/api/zones/foothold",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "List of foothold zones"),
    )
)]
pub async fn get_foothold_zones(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = r#"
local mz = {}
if env.mission and env.mission.triggers and env.mission.triggers.zones then
    for k, z in pairs(env.mission.triggers.zones) do
        if not (z.name and (string.find(string.lower(z.name), "hidden") or string.find(z.name, "-%d+$") or string.find(z.name, "^Scoot") or string.find(string.lower(z.name), "%-edge$"))) then
            local lat, lon = coord.LOtoLL({x = z.x, y = 0, z = z.y})
            local new_z = {
                name = z.name,
                zoneId = z.zoneId,
                type = z.type,
                radius = z.radius,
                lat = lat,
                lon = lon
            }
            if z.verticies then
                new_z.verticies = {}
                for i, v in ipairs(z.verticies) do
                    local vlat, vlon = coord.LOtoLL({x = v.x, y = 0, z = v.y})
                    table.insert(new_z.verticies, {lat = vlat, lon = vlon})
                end
            end
            table.insert(mz, new_z)
        end
    end
end

local foothold_json = "[]"

-- Attempt 1: Live Memory (via net.dostring_in)
if net and net.dostring_in then
    local mission_script = [[
        local b_res = "["
        if BattleCommander and BattleCommander.zones then
            for i, bz in ipairs(BattleCommander.zones) do
                local name = bz.name or (bz.zone and bz.zone.name)
                if name then
                    local side = bz.side or 0
                    local level = bz.level or 1
                    b_res = b_res .. string.format('{"name":"%s", "side":%d, "level":%d},', name, side, level)
                end
            end
        end
        if b_res:sub(-1) == "," then
            b_res = b_res:sub(1, -2)
        end
        b_res = b_res .. "]"
        return b_res
    ]]
    local res = net.dostring_in("mission", mission_script)
    if res and res ~= "" and res ~= "[]" then
        foothold_json = res
    end
end

-- Attempt 2: Save File (Reads foothold.status from DCS server's disk)
if foothold_json == "[]" and lfs and io then
    local status_file_path = lfs.writedir() .. "Missions/Saves/foothold.status"
    local f = io.open(status_file_path, "r")
    if f then
        local save_file_path = f:read("*all")
        f:close()
        if save_file_path then
            save_file_path = save_file_path:gsub("^%s*(.-)%s*$", "%1") -- trim whitespace
            if save_file_path ~= "" then
                -- Check if file exists and execute it
                local sf = io.open(save_file_path, "r")
                if sf then
                    sf:close()
                    -- Use pcall to safely execute the lua save file in the current environment
                    local success, err = pcall(dofile, save_file_path)
                    if success and zonePersistance and zonePersistance.zones then
                        local b_res = "["
                        for name, bz in pairs(zonePersistance.zones) do
                            local side = bz.side or 0
                            local level = bz.level or 1
                            b_res = b_res .. string.format('{"name":"%s", "side":%d, "level":%d},', name, side, level)
                        end
                        if b_res:sub(-1) == "," then
                            b_res = b_res:sub(1, -2)
                        end
                        b_res = b_res .. "]"
                        foothold_json = b_res
                    end
                end
            end
        end
    end
end

return {
    footholdStr = foothold_json,
    missionZones = mz
}
"#.to_string();

    match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            let mut final_zones = vec![];
            
            let json_val: serde_json::Value = match serde_json::from_str(&resp.json) {
                Ok(v) => v,
                Err(_) => json!({}),
            };
            
            // Extract foothold array
            let mut foothold_map = std::collections::HashMap::new();
            if let Some(foothold_str) = json_val.get("footholdStr").and_then(|v| v.as_str()) {
                if let Ok(fh_zones) = serde_json::from_str::<Vec<serde_json::Value>>(foothold_str) {
                    for fh_z in fh_zones {
                        if let Some(name) = fh_z.get("name").and_then(|n| n.as_str()) {
                            foothold_map.insert(name.to_string(), fh_z);
                        }
                    }
                }
            }
            
            // Extract mission zones and merge
            if let Some(mission_zones) = json_val.get("missionZones").and_then(|v| v.as_array()) {
                for mz in mission_zones {
                    if let Some(name) = mz.get("name").and_then(|n| n.as_str()) {
                        if let Some(fh_z) = foothold_map.get(name) {
                            let mut merged = mz.clone();
                            if let Some(merged_obj) = merged.as_object_mut() {
                                if let Some(side) = fh_z.get("side") {
                                    merged_obj.insert("side".to_string(), side.clone());
                                }
                                if let Some(level) = fh_z.get("level") {
                                    merged_obj.insert("level".to_string(), level.clone());
                                }
                            }
                            final_zones.push(merged);
                        } else {
                            // Fallback if not found in foothold map (e.g. net.dostring_in failed)
                            final_zones.push(mz.clone());
                        }
                    }
                }
            }
            
            Json(json!({ "zones": final_zones })).into_response()
        }
        Err(e) => err_detail("Failed to fetch foothold zones", e),
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
    id: u32,
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
pub async fn kick_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let id = payload["id"].as_u64().unwrap_or(0) as u32;
    let reason = payload["reason"].as_str().unwrap_or("Kicked").to_string();
    match grpc::kick_player(state.grpc.clone(), id, reason).await {
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
pub async fn ban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let id = payload["id"].as_u64().unwrap_or(0) as u32;
    let period = payload["period"].as_u64().unwrap_or(0) as u32;
    let reason = payload["reason"].as_str().unwrap_or("Banned").to_string();
    match grpc::ban_player(state.grpc.clone(), id, period, reason).await {
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
pub async fn unban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let ucid = payload["ucid"].as_str().unwrap_or("").to_string();
    match grpc::unban_player(state.grpc.clone(), ucid).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to unban player", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AnnouncementBody {
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
pub async fn announcements(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let text = payload.get("message").or_else(|| payload.get("text")).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let display_time = payload.get("display_time").and_then(|v| v.as_u64()).unwrap_or(10) as u32;
    
    let coalition = if let Some(coalition_str) = payload.get("coalition").and_then(|v| v.as_str()) {
        match coalition_str {
            "COALITION_RED" => 1,
            "COALITION_BLUE" => 2,
            "COALITION_NEUTRAL" => 0,
            _ => -1,
        }
    } else {
        payload.get("coalition").and_then(|v| v.as_i64()).unwrap_or(-1) as i32
    };
    
    let result = if coalition >= 0 {
        grpc::out_text_for_coalition(state.grpc.clone(), coalition, text, display_time, false).await
    } else {
        grpc::out_text(state.grpc.clone(), text, display_time, false).await
    };
    
    match result {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to send announcement", e),
    }
}

#[utoipa::path(
    get,
    path = "/api/units/{name}",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    responses((status = 200, description = "Unit details"))
)]
pub async fn get_unit_details(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    let (life_res, fuel_res, ammo_res, radar_res, sensors_res) = tokio::join!(
        grpc::get_unit_life(state.grpc.clone(), name.clone()),
        grpc::get_unit_fuel(state.grpc.clone(), name.clone()),
        grpc::get_unit_ammo(state.grpc.clone(), name.clone()),
        grpc::get_unit_radar(state.grpc.clone(), name.clone()),
        grpc::get_unit_sensors(state.grpc.clone(), name.clone())
    );

    let mut details = json!({});

    if let Ok(l) = life_res {
        details["life"] = json!(l.life);
        details["life0"] = json!(l.life0);
    }
    if let Ok(f) = fuel_res {
        details["fuel"] = json!(f.fuel);
    }
    if let Ok(a) = ammo_res {
        let weapons: Vec<_> = a.ammo.into_iter().map(|item| {
            let name = if item.display_name.is_empty() { item.type_name } else { item.display_name };
            json!({
                "count": item.count,
                "name": name
            })
        }).collect();
        details["weapons"] = json!(weapons);
    }
    if let Ok(r) = radar_res {
        details["radar_active"] = json!(r.active);
    }
    if let Ok(s) = sensors_res {
        // Map raw sensor data
        let mut sensors_list = Vec::new();
        for category in s.sensors {
            for sensor in category.sensors {
                let mut s_data = json!({
                    "type_name": sensor.type_name
                });
                
                if let Some(crate::pb::dcs::unit::v0::sensor::Sensor::Radar(radar)) = sensor.sensor {
                    if let Some(dist) = radar.detection_distance_air {
                        if let Some(upper) = dist.upper_hemisphere {
                            s_data["radar_head_on"] = json!(upper.head_on);
                            s_data["radar_tail_on"] = json!(upper.tail_on);
                        }
                    }
                }
                
                if let Some(crate::pb::dcs::unit::v0::sensor::Sensor::Irst(irst)) = sensor.sensor {
                    s_data["irst_distance_maximal"] = json!(irst.detection_distance_maximal);
                }
                
                sensors_list.push(s_data);
            }
        }
        details["sensors"] = json!(sensors_list);
    }

    Json(details).into_response()
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct EmissionPayload {
    pub emitting: bool,
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/emission",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    request_body = EmissionPayload,
    responses((status = 200, description = "Emission set"))
)]
pub async fn set_unit_emission(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>, Json(payload): Json<EmissionPayload>) -> Response {
    match grpc::set_unit_emission(state.grpc.clone(), name, payload.emitting).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to set emission", e),
    }
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/destroy",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    responses((status = 200, description = "Unit destroyed"))
)]
pub async fn destroy_unit_group(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    let lua = format!(
        "local u = Unit.getByName('{}'); if u then return u:getGroup():getName() else return nil end",
        name.replace("'", "\\'")
    );
    let group_name = match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            if resp.json == "null" || resp.json.is_empty() {
                return bad_request("Unit not found");
            }
            resp.json.trim_matches('"').to_string()
        },
        Err(e) => return err_detail("Failed to fetch unit's group", e),
    };
    
        match grpc::destroy_group(state.grpc.clone(), group_name).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to destroy group", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct ROEPayload {
    pub roe: i32,
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/roe",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    request_body = ROEPayload,
    responses((status = 200, description = "ROE set"))
)]
pub async fn set_group_roe(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>, Json(payload): Json<ROEPayload>) -> Response {
    let group_resp = match grpc::get_unit_group(state.grpc.clone(), name).await {
        Ok(r) => r,
        Err(e) => return err_detail("Failed to find unit group", e),
    };
    let group = match group_resp.group {
        Some(g) => g,
        None => return bad_request("Unit has no group"),
    };
    
    match grpc::set_group_roe(state.grpc.clone(), group.name, payload.roe).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to set ROE", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AlarmStatePayload {
    pub alarm_state: i32,
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/alarm-state",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    request_body = AlarmStatePayload,
    responses((status = 200, description = "Alarm state set"))
)]
pub async fn set_group_alarm_state(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>, Json(payload): Json<AlarmStatePayload>) -> Response {
    let group_resp = match grpc::get_unit_group(state.grpc.clone(), name).await {
        Ok(r) => r,
        Err(e) => return err_detail("Failed to find unit group", e),
    };
    let group = match group_resp.group {
        Some(g) => g,
        None => return bad_request("Unit has no group"),
    };
    
    match grpc::set_group_alarm_state(state.grpc.clone(), group.name, payload.alarm_state).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to set alarm state", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LasePayload {
    pub target_x: f64,
    pub target_z: f64,
    pub code: u32,
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/lase",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    request_body = LasePayload,
    responses((status = 200, description = "Lase target"))
)]
pub async fn lase(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>, Json(payload): Json<LasePayload>) -> Response {
    let lua = format!(
        "local src = Unit.getByName('{}')
        if not src then return 'UNIT_NOT_FOUND' end
        local srcPos = src:getPosition().p
        local targetLO = coord.LLtoLO({}, {})
        targetLO.y = land.getHeight({{x = targetLO.x, y = targetLO.z}})
        local dx = targetLO.x - srcPos.x
        local dy = targetLO.y - srcPos.y
        local dz = targetLO.z - srcPos.z
        local dist = math.sqrt(dx*dx + dy*dy + dz*dz)
        if dist == 0 then return '0,0,0' end
        return string.format('%f,%f,%f', dx/dist, dy/dist, dz/dist)",
        name.replace("'", "\\'"), payload.target_x, payload.target_z
    );

    let eval_resp = match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(r) => r,
        Err(e) => return err_detail("Failed to evaluate vector in lua", e),
    };
    let json = eval_resp.json.trim_matches('"');
    if json == "UNIT_NOT_FOUND" || json.is_empty() {
        return bad_request("Source unit not found");
    }

    let parts: Vec<&str> = json.split(',').collect();
    if parts.len() != 3 {
        return bad_request("Invalid vector calculation");
    }
    let dir_x: f64 = parts[0].parse().unwrap_or(0.0);
    let dir_y: f64 = parts[1].parse().unwrap_or(0.0);
    let dir_z: f64 = parts[2].parse().unwrap_or(0.0);

    match grpc::create_laser(state.grpc.clone(), name, dir_x, dir_y, dir_z, payload.code).await {
        Ok(spot_id) => Json(json!({ "success": true, "spot_id": spot_id })).into_response(),
        Err(e) => err_detail("Failed to create laser", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct IrPointerPayload {
    pub target_x: f64,
    pub target_z: f64,
}

#[utoipa::path(
    post,
    path = "/api/units/{name}/ir-point",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Unit name")),
    request_body = IrPointerPayload,
    responses((status = 200, description = "Point IR"))
)]
pub async fn ir_pointer(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>, Json(payload): Json<IrPointerPayload>) -> Response {
    let lua = format!(
        "local src = Unit.getByName('{}')
        if not src then return 'UNIT_NOT_FOUND' end
        local srcPos = src:getPosition().p
        local targetLO = coord.LLtoLO({}, {})
        targetLO.y = land.getHeight({{x = targetLO.x, y = targetLO.z}})
        local dx = targetLO.x - srcPos.x
        local dy = targetLO.y - srcPos.y
        local dz = targetLO.z - srcPos.z
        local dist = math.sqrt(dx*dx + dy*dy + dz*dz)
        if dist == 0 then return '0,0,0' end
        return string.format('%f,%f,%f', dx/dist, dy/dist, dz/dist)",
        name.replace("'", "\\'"), payload.target_x, payload.target_z
    );

    let eval_resp = match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(r) => r,
        Err(e) => return err_detail("Failed to evaluate vector in lua", e),
    };
    let json = eval_resp.json.trim_matches('"');
    if json == "UNIT_NOT_FOUND" || json.is_empty() {
        return bad_request("Source unit not found");
    }

    let parts: Vec<&str> = json.split(',').collect();
    if parts.len() != 3 {
        return bad_request("Invalid vector calculation");
    }
    let dir_x: f64 = parts[0].parse().unwrap_or(0.0);
    let dir_y: f64 = parts[1].parse().unwrap_or(0.0);
    let dir_z: f64 = parts[2].parse().unwrap_or(0.0);

    match grpc::create_ir_pointer(state.grpc.clone(), name, dir_x, dir_y, dir_z).await {
        Ok(spot_id) => Json(json!({ "success": true, "spot_id": spot_id })).into_response(),
        Err(e) => err_detail("Failed to create IR pointer", e),
    }
}

#[utoipa::path(
    delete,
    path = "/api/spots/{id}",
    tags = ["dcs"],
    security(("jwt" = [])),
    params(("id" = u32, Path, description = "Spot ID")),
    responses((status = 200, description = "Spot destroyed"))
)]
pub async fn destroy_spot(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(id): axum::extract::Path<u32>) -> Response {
    match grpc::destroy_spot(state.grpc.clone(), id).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to destroy spot", e),
    }
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct AirbossDataResponse {
    pub brc: f64,
    pub ship_spd: f64,
    pub tw_dir: f64,
    pub tw_spd: f64,
    pub target_wod: f64,
}

#[utoipa::path(
    get,
    path = "/api/airboss",
    tags = ["dcs"],
    security(("jwt" = [])),
    responses((status = 200, description = "Current Airboss data from DCS", body = AirbossDataResponse))
)]
pub async fn airboss_data(State(state): State<AppState>) -> Response {
    let lua = r#"
        local group = Group.getByName("CVN-72")
        if not group or not group:isExist() or group:getSize() == 0 then return { error = "CVN-72 not found" } end
        local lead = group:getUnit(1)
        if not lead or not lead:isExist() then return { error = "Lead unit not found" } end
        local point = lead:getPoint()
        local pos = lead:getPosition()
        local vel = lead:getVelocity()

        local wind = atmosphere.getWind({ x = point.x, y = (point.y or 0) + 18, z = point.z }) or { x = 0, y = 0, z = 0 }
        
        local windDir = math.deg(math.atan2(-wind.z, -wind.x))
        if windDir < 0 then windDir = windDir + 360 end
        local windSpeedKt = math.sqrt(wind.x^2 + wind.z^2) * 1.94384449

        local headingDeg = math.deg(math.atan2(pos.x.z, pos.x.x))
        if headingDeg < 0 then headingDeg = headingDeg + 360 end
        local speedKt = math.sqrt(vel.x^2 + vel.z^2) * 1.94384449

        local targetWod = CarrierRecoveryTargetWodKt or 25.0

        return net.json2lua(net.lua2json({
            brc = headingDeg,
            ship_spd = speedKt,
            tw_dir = windDir,
            tw_spd = windSpeedKt,
            target_wod = targetWod
        }))
    "#;

    match grpc::custom_eval(state.grpc.clone(), lua.into()).await {
        Ok(res) => {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&res.json) {
                if let Some(err) = json.get("error").and_then(|v| v.as_str()) {
                    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": err }))).into_response()
                } else {
                    Json(json).into_response()
                }
            } else {
                (axum::http::StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": "Invalid json from airboss script" }))).into_response()
            }
        },
        Err(e) => err_detail("Failed to evaluate airboss script", e),
    }
}
