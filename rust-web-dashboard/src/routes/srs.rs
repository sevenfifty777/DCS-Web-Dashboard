use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::state::AppState;
use crate::auth::AuthUser;

fn err_500(msg: &str) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": msg }))).into_response()
}

pub async fn get_settings(_user: AuthUser, State(state): State<AppState>) -> Result<Json<Value>, Response> {
    let cfg_path = state.config.srs_cfg_path.clone()
        .ok_or_else(|| err_500("SRS_CFG_PATH not configured. Please set it in your .env or configure SRS_START_CMD correctly."))?;
    
    let content = std::fs::read_to_string(&cfg_path).map_err(|e| err_500(&e.to_string()))?;
    let mut map = serde_json::Map::new();
    let mut current_section = "General Settings".to_string();
    
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line[1..line.len()-1].trim().to_string();
            if !map.contains_key(&current_section) {
                map.insert(current_section.clone(), Value::Object(serde_json::Map::new()));
            }
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            let value = v.trim();
            
            let parsed_val = if value.eq_ignore_ascii_case("true") {
                json!(true)
            } else if value.eq_ignore_ascii_case("false") {
                json!(false)
            } else if let Ok(n) = value.parse::<f64>() {
                json!(n)
            } else {
                json!(value)
            };
            
            if !map.contains_key(&current_section) {
                map.insert(current_section.clone(), Value::Object(serde_json::Map::new()));
            }
            
            if let Some(section_map) = map.get_mut(&current_section).and_then(|m| m.as_object_mut()) {
                section_map.insert(key.to_string(), parsed_val);
            }
        }
    }
    
    Ok(Json(Value::Object(map)))
}

pub async fn post_settings(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Result<Json<Value>, Response> {
    let cfg_path = state.config.srs_cfg_path.clone()
        .ok_or_else(|| err_500("SRS_CFG_PATH not configured."))?;
    
    let content = std::fs::read_to_string(&cfg_path).map_err(|e| err_500(&e.to_string()))?;
    let mut new_lines = Vec::new();
    let mut current_section = "General Settings".to_string();
    
    let updates = payload.as_object().ok_or_else(|| err_500("Payload must be an object"))?;
    
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = trimmed[1..trimmed.len()-1].trim().to_string();
            new_lines.push(line.to_string());
            continue;
        }
        
        if trimmed.is_empty() || trimmed.starts_with(';') || trimmed.starts_with('#') {
            new_lines.push(line.to_string());
            continue;
        }
        
        if let Some((k, _)) = trimmed.split_once('=') {
            let key = k.trim();
            let mut matched = false;
            
            if let Some(section_updates) = updates.get(&current_section).and_then(|v| v.as_object()) {
                if let Some(new_val) = section_updates.get(key) {
                    let val_str = match new_val {
                        Value::String(s) => s.to_string(),
                        Value::Bool(b) => b.to_string(),
                        Value::Number(n) => n.to_string(),
                        _ => new_val.to_string(),
                    };
                    new_lines.push(format!("{}={}", key, val_str));
                    matched = true;
                }
            }
            
            if !matched {
                new_lines.push(line.to_string());
            }
        } else {
            new_lines.push(line.to_string());
        }
    }
    
    std::fs::write(&cfg_path, new_lines.join("\r\n")).map_err(|e| err_500(&e.to_string()))?;
    
    Ok(Json(json!({ "success": true })))
}

pub async fn get_clients(_user: AuthUser, State(state): State<AppState>) -> Result<Json<Value>, Response> {
    match crate::grpc::get_srs_clients(state.grpc.clone()).await {
        Ok(resp) => {
            let clients: Vec<_> = resp.clients.into_iter().filter_map(|c| {
                let unit = c.unit?;
                let coalition = match unit.coalition {
                    2 => 1, // Red
                    3 => 2, // Blue
                    _ => 0, // Spectator/Neutral
                };
                let radios: Vec<_> = c.frequencies.into_iter().map(|f| json!({ "freq": f })).collect();
                
                let display_name = match unit.player_name {
                    Some(ref p) if !p.is_empty() => p.clone(),
                    _ => unit.name.clone(),
                };

                Some(json!({
                    "Name": display_name,
                    "Coalition": coalition,
                    "RadioInfo": {
                        "radios": radios
                    }
                }))
            }).collect();
            
            Ok(Json(json!({ "Clients": clients })))
        }
        Err(e) => {
            Ok(Json(json!({ "error": format!("gRPC Error: {}", e.message()), "Clients": [] })))
        }
    }
}
