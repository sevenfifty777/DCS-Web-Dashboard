//! `serverSettings.lua` parsing, serialization, and mission-queue mutation.
//!
//! Ports the filesystem half of the Next.js `/api/settings` and `/api/mission`
//! routes (`web-dashboard/src/app/api/settings/route.ts` and `.../mission/
//! route.ts`). The original used regular expressions; here the **read** path
//! evaluates the Lua file with `mlua` and reads the resulting global `cfg`
//! table (more robust than regex), while the **write** path reproduces the
//! original's exact CRLF/tab byte layout so the file stays diff-stable and
//! DCS-compatible.
//!
//! `mlua`'s `Lua` is not `Send`, so every parse runs inside a single
//! `spawn_blocking` closure that returns an owned `serde_json::Value`.

use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use mlua::Lua;
use serde_json::{json, Map, Value};
use tokio::sync::OnceCell;

/// Top-level keys coerced to strings when serialized (mirrors the source).
const STRING_KEYS: &[&str] = &["name", "description", "password", "bind_address"];
/// Top-level keys coerced to numbers when serialized.
const NUMBER_KEYS: &[&str] = &["port", "mode", "listStartIndex", "maxPlayers"];
/// Top-level keys coerced to booleans when serialized.
const BOOL_KEYS: &[&str] = &[
    "require_pure_textures",
    "require_pure_scripts",
    "require_pure_clients",
    "require_pure_models",
    "listShuffle",
    "listLoop",
    "isPublic",
];

/// Cached public IP (fetched once via api.ipify.org), matching the source's
/// module-level `cachedIp`. The "Unknown IP" fallback is cached too.
static PUBLIC_IP: OnceCell<String> = OnceCell::const_new();

/// A mission-queue mutation requested by `POST /api/mission`.
#[derive(Clone, Copy)]
pub enum QueueAction {
    Add,
    Remove,
}

/// Convert a non-`Send` `mlua::Error` into an `anyhow::Error` by stringifying.
/// In this mlua config (`lua51`, no `send` feature) `LuaError` is neither
/// `Send` nor `Sync`, so it cannot be `?`-converted into `anyhow::Error`
/// directly; this bridges the two at each Lua boundary.
fn to_anyhow(err: mlua::Error) -> anyhow::Error {
    anyhow::anyhow!(err.to_string())
}

// --- read path -------------------------------------------------------------

/// Read and parse `serverSettings.lua` into a JSON object with `advanced`
/// (object) and `missionList` (array of strings) plus top-level scalars.
pub async fn read_settings(path: &Path) -> Result<Value> {
    let content = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("failed to read {}", path.display()))?;
    parse_settings(content).await
}

/// Parse already-loaded `serverSettings.lua` text into JSON, off the async
/// runtime (Lua is not `Send`).
pub async fn parse_settings(content: String) -> Result<Value> {
    tokio::task::spawn_blocking(move || parse_blocking(content))
        .await
        .context("settings parse task panicked")?
}

fn parse_blocking(content: String) -> Result<Value> {
    let lua = Lua::new();
    lua.load(content.as_str())
        .exec()
        .map_err(to_anyhow)
        .context("failed to evaluate serverSettings.lua")?;

    let cfg: mlua::Table = lua
        .globals()
        .get("cfg")
        .map_err(to_anyhow)
        .context("serverSettings.lua did not define a `cfg` table")?;

    let mut map = Map::new();
    for pair in cfg.pairs::<mlua::Value, mlua::Value>() {
        let (key, value) = pair.map_err(to_anyhow)?;
        let Some(name) = key_name(&key) else { continue };
        match name.as_str() {
            "missionList" => {
                map.insert(name, Value::Array(mission_list_from_lua(&value)?));
            }
            "advanced" => {
                map.insert(name, advanced_from_lua(&value)?);
            }
            _ => {
                if let Some(scalar) = scalar_to_json(&value) {
                    map.insert(name, scalar);
                }
            }
        }
    }

    Ok(Value::Object(map))
}

fn key_name(value: &mlua::Value) -> Option<String> {
    match value {
        mlua::Value::String(s) => s.to_str().ok().map(|cs| cs.to_string()),
        mlua::Value::Integer(i) => Some(i.to_string()),
        _ => None,
    }
}

fn scalar_to_json(value: &mlua::Value) -> Option<Value> {
    match value {
        mlua::Value::Boolean(b) => Some(Value::Bool(*b)),
        mlua::Value::Integer(i) => Some(Value::Number((*i).into())),
        mlua::Value::Number(n) => serde_json::Number::from_f64(*n).map(Value::Number),
        mlua::Value::String(s) => s.to_str().ok().map(|cs| Value::String(cs.to_string())),
        _ => None,
    }
}

fn mission_list_from_lua(value: &mlua::Value) -> Result<Vec<Value>> {
    let mut out = Vec::new();
    if let mlua::Value::Table(table) = value {
        for item in table.clone().sequence_values::<mlua::Value>() {
            if let mlua::Value::String(s) = item.map_err(to_anyhow)? {
                out.push(Value::String(s.to_str().map_err(to_anyhow)?.to_string()));
            }
        }
    }
    Ok(out)
}

fn advanced_from_lua(value: &mlua::Value) -> Result<Value> {
    let mut map = Map::new();
    if let mlua::Value::Table(table) = value {
        for pair in table.clone().pairs::<mlua::Value, mlua::Value>() {
            let (key, val) = pair.map_err(to_anyhow)?;
            if let Some(name) = key_name(&key) {
                if let Some(scalar) = scalar_to_json(&val) {
                    map.insert(name, scalar);
                }
            }
        }
    }
    Ok(Value::Object(map))
}

// --- derived views (for /api/mission) --------------------------------------

/// Build the `serverInfo` object from parsed settings, applying the source's
/// fallback defaults.
pub fn server_info(settings: &Value, ip: &str) -> Value {
    let name = settings
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Unknown Server");
    let port = settings.get("port").and_then(json_to_i64).unwrap_or(10308);
    let max_players = settings.get("maxPlayers").and_then(json_to_i64).unwrap_or(0);
    let password = settings
        .get("password")
        .and_then(Value::as_str)
        .unwrap_or("");

    json!({
        "name": name,
        "port": port,
        "maxPlayers": max_players,
        "password": password,
        "ip": ip,
    })
}

/// Extract the mission queue (already unescaped by Lua) from parsed settings.
pub fn mission_list(settings: &Value) -> Vec<String> {
    settings
        .get("missionList")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn json_to_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

// --- public IP -------------------------------------------------------------

/// Resolve the server's public IP (cached for the process lifetime). Falls
/// back to `"Unknown IP"` on any failure, matching the source.
pub async fn public_ip(client: &reqwest::Client) -> String {
    PUBLIC_IP
        .get_or_init(|| async {
            fetch_ip(client)
                .await
                .unwrap_or_else(|| "Unknown IP".to_string())
        })
        .await
        .clone()
}

async fn fetch_ip(client: &reqwest::Client) -> Option<String> {
    let resp = client
        .get("https://api.ipify.org?format=json")
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?;
    let body: Value = resp.json().await.ok()?;
    body.get("ip").and_then(Value::as_str).map(str::to_string)
}

// --- write path ------------------------------------------------------------

/// Serialize the full settings payload and overwrite `serverSettings.lua`.
pub async fn write_settings(path: &Path, payload: &Value) -> Result<()> {
    let data = serialize_settings(payload);
    tokio::fs::write(path, data)
        .await
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Rebuild the entire `serverSettings.lua` body from a JSON payload, byte-for-
/// byte compatible with the original Next.js serializer (CRLF + tabs).
pub fn serialize_settings(payload: &Value) -> String {
    let mut out = String::from("cfg = \r\n{\r\n");

    if let Some(map) = payload.as_object() {
        for (key, value) in map {
            if key == "advanced" || key == "missionList" {
                continue;
            }
            out.push_str(&serialize_top_level(key, value));
        }

        if let Some(advanced) = map.get("advanced").and_then(Value::as_object) {
            out.push_str("\t[\"advanced\"] = \r\n\t{\r\n");
            for (key, value) in advanced {
                out.push_str(&format!("\t\t[\"{}\"] = {},\r\n", key, advanced_token(value)));
            }
            out.push_str("\t}, -- end of [\"advanced\"]\r\n");
        }

        if let Some(list) = map.get("missionList").and_then(Value::as_array) {
            out.push_str("\t[\"missionList\"] = \r\n\t{\r\n");
            for (index, item) in list.iter().enumerate() {
                if let Some(name) = item.as_str() {
                    let escaped = name.replace('\\', "\\\\");
                    out.push_str(&format!("\t\t[{}] = \"{}\",\r\n", index + 1, escaped));
                }
            }
            out.push_str("\t}, -- end of [\"missionList\"]\r\n");
        }
    }

    out.push_str("} -- end of cfg\r\n");
    out
}

fn serialize_top_level(key: &str, value: &Value) -> String {
    if STRING_KEYS.contains(&key) {
        format!(
            "\t[\"{}\"] = \"{}\",\r\n",
            key,
            escape_lua_string(&js_string(value))
        )
    } else if NUMBER_KEYS.contains(&key) {
        format!("\t[\"{}\"] = {},\r\n", key, number_token(value))
    } else if BOOL_KEYS.contains(&key) {
        format!("\t[\"{}\"] = {},\r\n", key, bool_token(value))
    } else {
        match value {
            Value::String(s) => format!("\t[\"{}\"] = \"{}\",\r\n", key, escape_lua_string(s)),
            Value::Bool(b) => format!("\t[\"{}\"] = {},\r\n", key, b),
            Value::Number(n) => format!("\t[\"{}\"] = {},\r\n", key, n),
            other => format!(
                "\t[\"{}\"] = \"{}\",\r\n",
                key,
                escape_lua_string(&js_string(other))
            ),
        }
    }
}

/// Reproduce the source's advanced-value coercion: booleans/numbers are emitted
/// raw; numeric/boolean strings are converted; any other string is emitted
/// unquoted (faithful to the original `${advVal}` interpolation).
fn advanced_token(value: &Value) -> String {
    match value {
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => {
            if s == "true" {
                "true".to_string()
            } else if s == "false" {
                "false".to_string()
            } else if !s.trim().is_empty() {
                match s.trim().parse::<f64>() {
                    Ok(n) => js_number_format(n),
                    Err(_) => s.clone(),
                }
            } else {
                s.clone()
            }
        }
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// Escape a string for a Lua double-quoted literal: backslash, quote, then
/// newline → DCS line-continuation (`\` + CRLF). Mirrors the source regexes
/// `\\`, `"`, `\r?\n`.
fn escape_lua_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    let normalized = escaped.replace("\r\n", "\n");
    normalized.replace('\n', "\\\r\n")
}

/// JS `String(value)` for the scalar payload values we expect.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// JS `${Number(value)}` for a numeric-coerced top-level key.
fn number_token(value: &Value) -> String {
    let n = match value {
        Value::Number(num) => num.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                f64::NAN
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    };
    js_number_format(n)
}

/// Format a float the way `${number}` would (integers without a decimal point).
fn js_number_format(n: f64) -> String {
    if n.is_nan() {
        "NaN".to_string()
    } else if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// JS `(v === 'true' || v === true)` for a boolean-coerced top-level key.
fn bool_token(value: &Value) -> bool {
    match value {
        Value::Bool(b) => *b,
        Value::String(s) => s == "true",
        _ => false,
    }
}

// --- mission queue mutation ------------------------------------------------

/// Add or remove a mission path in the `missionList` block of
/// `serverSettings.lua`, rewriting only that block (CRLF + tabs preserved).
pub async fn mutate_queue(path: &Path, action: QueueAction, file: &str) -> Result<()> {
    let content = tokio::fs::read_to_string(path)
        .await
        .with_context(|| format!("failed to read {}", path.display()))?;

    let settings = parse_settings(content.clone()).await?;
    let mut queue = mission_list(&settings);

    match action {
        QueueAction::Add => {
            if queue.iter().any(|m| m == file) {
                return Ok(());
            }
            queue.push(file.to_string());
        }
        QueueAction::Remove => {
            if let Some(idx) = queue.iter().position(|m| m == file) {
                queue.remove(idx);
            }
        }
    }

    // Replacement starts at `["missionList"]` (the preceding tab in the file is
    // left in place), with a trailing comma — matching the original `},?` → +','.
    let mut block = String::from("[\"missionList\"] = \r\n\t{\r\n");
    for (index, mission) in queue.iter().enumerate() {
        let escaped = mission.replace('\\', "\\\\");
        block.push_str(&format!("\t\t[{}] = \"{}\",\r\n", index + 1, escaped));
    }
    block.push_str("\t},");

    let new_content = replace_mission_list_block(&content, &block)
        .context("missionList block not found in serverSettings.lua")?;

    tokio::fs::write(path, new_content)
        .await
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(())
}

/// Replace the first `["missionList"] = { ... }` (plus an optional trailing
/// comma) with `replacement`, mirroring the source's non-greedy regex.
fn replace_mission_list_block(content: &str, replacement: &str) -> Option<String> {
    let key_idx = content.find("[\"missionList\"]")?;
    let brace_start = content[key_idx..].find('{')? + key_idx;
    let brace_end = content[brace_start..].find('}')? + brace_start;
    let mut end = brace_end + 1;
    if content[end..].starts_with(',') {
        end += 1;
    }

    let mut out = String::with_capacity(content.len() + replacement.len());
    out.push_str(&content[..key_idx]);
    out.push_str(replacement);
    out.push_str(&content[end..]);
    Some(out)
}
