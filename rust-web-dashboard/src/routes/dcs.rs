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

#[derive(Deserialize)]
pub struct ChatBody {
    message: Option<String>,
    coalition: Option<String>,
}

/// `POST /api/chat` → broadcast chat (NetService.SendChat).
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

#[derive(Deserialize)]
pub struct ConsoleBody {
    lua: Option<String>,
}

/// `POST /api/console` → evaluate Lua in the mission (CustomService.Eval).
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

#[derive(Deserialize)]
pub struct FlagQuery {
    flag: Option<String>,
}

/// `GET /api/triggers?flag=...` → read user flag (TriggerService.GetUserFlag).
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

#[derive(Deserialize)]
pub struct SetFlagBody {
    flag: Option<serde_json::Value>,
    value: Option<serde_json::Value>,
}

/// `POST /api/triggers` → set user flag (TriggerService.SetUserFlag). The
/// source coerced `flag` via `.toString()` and `value` via `Number(...)`.
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

#[derive(Deserialize)]
pub struct AtmosphereQuery {
    lat: Option<f64>,
    lon: Option<f64>,
    alt: Option<f64>,
}

/// `GET /api/atmosphere?lat=&lon=&alt=` → wind + temperature/pressure
/// (AtmosphereService). `alt` defaults to 0, matching the source.
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

#[derive(Deserialize)]
pub struct MissionBody {
    action: Option<String>,
    payload: Option<MissionPayload>,
}

#[derive(Deserialize)]
pub struct MissionPayload {
    file_name: Option<String>,
}

/// `POST /api/mission` → mission control actions (HookService). Queue
/// mutation (`add_to_queue` / `remove_from_queue`) is filesystem-backed and
/// returns `501` until Phase 5.
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

pub async fn kick_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let id = payload["id"].as_u64().unwrap_or(0) as u32;
    let reason = payload["reason"].as_str().unwrap_or("Kicked").to_string();
    match grpc::kick_player(state.grpc.clone(), id, reason).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to kick player", e),
    }
}

pub async fn ban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let id = payload["id"].as_u64().unwrap_or(0) as u32;
    let period = payload["period"].as_u64().unwrap_or(0) as u32;
    let reason = payload["reason"].as_str().unwrap_or("Banned").to_string();
    match grpc::ban_player(state.grpc.clone(), id, period, reason).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to ban player", e),
    }
}

pub async fn unban_player(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let ucid = payload["ucid"].as_str().unwrap_or("").to_string();
    match grpc::unban_player(state.grpc.clone(), ucid).await {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to unban player", e),
    }
}

pub async fn announcements(_user: AuthUser, State(state): State<AppState>, Json(payload): Json<serde_json::Value>) -> Response {
    let text = payload["text"].as_str().unwrap_or("").to_string();
    let display_time = payload["display_time"].as_u64().unwrap_or(10) as u32;
    let coalition = payload["coalition"].as_i64().unwrap_or(-1) as i32;
    
    let result = if coalition >= 0 {
        grpc::out_text_for_coalition(state.grpc.clone(), coalition, text, display_time, true).await
    } else {
        grpc::out_text(state.grpc.clone(), text, display_time, true).await
    };
    
    match result {
        Ok(()) => Json(json!({"success":true})).into_response(),
        Err(e) => err_detail("Failed to send announcement", e),
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct Weapon {
    pub name: String,
    pub count: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct UnitDetails {
    pub fuel: Option<f32>,
    pub life: Option<f32>,
    pub life0: Option<f32>,
    pub weapons: Option<Vec<Weapon>>,
}

pub async fn get_unit_details(_user: AuthUser, State(state): State<AppState>, axum::extract::Path(name): axum::extract::Path<String>) -> Response {
    let lua = format!(
        "local u = Unit.getByName('{}'); if u then local ammo = u:getAmmo(); local weapons = {{}}; if ammo then for i, a in ipairs(ammo) do local n = 'Unknown'; if a.desc then n = a.desc.displayName or a.desc.typeName or 'Unknown' end; table.insert(weapons, {{ count = a.count, name = n }}) end end; return {{ fuel = u:getFuel(), life = u:getLife(), life0 = u:getLife0(), weapons = weapons }} else return nil end",
        name.replace("'", "\\'")
    );
    match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            if resp.json == "null" || resp.json.is_empty() {
                return bad_request("Unit not found");
            }
            match serde_json::from_str::<UnitDetails>(&resp.json) {
                Ok(details) => Json(json!({ 
                    "fuel": details.fuel.unwrap_or(0.0), 
                    "life": details.life.unwrap_or(0.0), 
                    "life0": details.life0.unwrap_or(1.0),
                    "weapons": details.weapons.unwrap_or_default()
                })).into_response(),
                Err(e) => bad_request(&format!("Failed to parse unit details: {}", e)),
            }
        },
        Err(e) => err_detail("Failed to fetch unit details", e),
    }
}

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
