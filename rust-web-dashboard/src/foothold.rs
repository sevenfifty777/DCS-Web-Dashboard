use std::path::Path;
use mlua::{Lua, Table};
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FootholdPlayer {
    pub name: String,
    pub credits: f64,
    pub points: f64,
    pub points_spent: f64,
    pub kills_air: i64,
    pub kills_helo: i64,
    pub kills_sam: i64,
    pub kills_ground: i64,
    pub kills_infantry: i64,
    pub deaths: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdMission {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub is_running: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdEjectedPilot {
    pub id: i64,
    pub coalition: i64,
    pub player_name: String,
    pub lat: f64,
    pub lon: f64,
    pub alt: f64,
    pub timestamp: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdZone {
    pub name: String,
    pub side: i64,
    pub level: i64,
    pub lat: f64,
    pub lon: f64,
    pub units: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdData {
    pub players: Vec<FootholdPlayer>,
    pub missions: Vec<FootholdMission>,
    pub ejected_pilots: Vec<FootholdEjectedPilot>,
    pub zones: Vec<FootholdZone>,
}

fn parse_foothold_ranks(lua: &Lua, path: &Path) -> Result<std::collections::HashMap<String, FootholdPlayer>> {
    let script = std::fs::read_to_string(path)?;
    lua.load(&script).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    let globals = lua.globals();
    let rank_save: Table = globals.get("RankSave").map_err(|e| anyhow::anyhow!("{}", e))?;
    let players: Table = rank_save.get("players").map_err(|e| anyhow::anyhow!("{}", e))?;

    let mut map = std::collections::HashMap::new();

    for (name, p_table) in players.pairs::<String, Table>().flatten() {
        // Strip out slashes and extra quotes from the raw names
        let clean_name = name.replace("\\", "").replace("\"", "");
        let credits: f64 = p_table.get("credits").unwrap_or(0.0);

        map.insert(clean_name.clone(), FootholdPlayer {
            name: clean_name,
            credits,
            ..Default::default()
        });
    }
    
    Ok(map)
}

fn parse_foothold_ca(lua: &Lua, path: &Path, player_map: &mut std::collections::HashMap<String, FootholdPlayer>) -> Result<FootholdData> {
    let script = std::fs::read_to_string(path)?;
    lua.load(&script).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    
    let globals = lua.globals();
    let zone_persistance: Table = globals.get("zonePersistance").map_err(|e| anyhow::anyhow!("{}", e))?;

    // Parse Player Stats
    if let Ok(player_stats) = zone_persistance.get::<Table>("playerStats") {
        for (name, stats) in player_stats.pairs::<String, Table>().flatten() {
            let clean_name = name.replace("\\", "").replace("\"", "");
            let entry = player_map.entry(clean_name.clone()).or_insert(FootholdPlayer {
                name: clean_name,
                ..Default::default()
            });

            entry.points = stats.get("Points").unwrap_or(0.0);
            entry.points_spent = stats.get("Points spent").unwrap_or(0.0);
            entry.kills_air = stats.get("Air").unwrap_or(0);
            entry.kills_helo = stats.get("Helo").unwrap_or(0);
            entry.kills_sam = stats.get("SAM").unwrap_or(0);
            entry.kills_ground = stats.get("Ground Units").unwrap_or(0);
            entry.kills_infantry = stats.get("Infantry").unwrap_or(0);
            entry.deaths = stats.get("Deaths").unwrap_or(0);
        }
    }

    // Parse Missions
    let mut missions = Vec::new();
    if let Ok(missions_table) = zone_persistance.get::<Table>("missions") {
        for (id, mission) in missions_table.pairs::<i64, Table>().flatten() {
            missions.push(FootholdMission {
                id,
                title: mission.get("title").unwrap_or_default(),
                description: mission.get("description").unwrap_or_default(),
                is_running: mission.get("isRunning").unwrap_or(false),
            });
        }
    }

    // Parse Ejected Pilots
    let mut ejected_pilots = Vec::new();
    if let Ok(pilots_table) = zone_persistance.get::<Table>("ejectedPilots") {
        for (id, pilot) in pilots_table.pairs::<i64, Table>().flatten() {
            ejected_pilots.push(FootholdEjectedPilot {
                id,
                coalition: pilot.get("coalition").unwrap_or(0),
                player_name: pilot.get("playerName").unwrap_or_default(),
                lat: pilot.get("latitude").unwrap_or(0.0),
                lon: pilot.get("longitude").unwrap_or(0.0),
                alt: pilot.get("altitude").unwrap_or(0.0),
                timestamp: pilot.get("timestamp").unwrap_or(0.0),
            });
        }
    }

    // Parse Zones
    let mut zones = Vec::new();
    if let Ok(zones_table) = zone_persistance.get::<Table>("zones") {
        for (name, zone) in zones_table.pairs::<String, Table>().flatten() {
            let side = zone.get("side").unwrap_or(0);
            let level = zone.get("level").unwrap_or(0);
            let (lat, lon) = if let Ok(lat_long) = zone.get::<Table>("lat_long") {
                (lat_long.get("latitude").unwrap_or(0.0), lat_long.get("longitude").unwrap_or(0.0))
            } else {
                (0.0, 0.0)
            };

            let mut units = Vec::new();
            if let Ok(remaining_units) = zone.get::<Table>("remainingUnits") {
                for (_, group_table) in remaining_units.pairs::<i64, Table>().flatten() {
                    for (_, unit_name) in group_table.pairs::<i64, String>().flatten() {
                        units.push(unit_name);
                    }
                }
            }

            zones.push(FootholdZone {
                name,
                side,
                level,
                lat,
                lon,
                units,
            });
        }
    }

    let mut players_vec: Vec<FootholdPlayer> = player_map.values().cloned().collect();
    // Sort by credits
    players_vec.sort_by(|a, b| b.credits.partial_cmp(&a.credits).unwrap_or(std::cmp::Ordering::Equal));

    Ok(FootholdData {
        players: players_vec,
        missions,
        ejected_pilots,
        zones,
    })
}

pub fn get_foothold_data(saves_dir: &Path) -> Result<FootholdData> {
    let lua = Lua::new();

    let ranks_file = saves_dir.join("Foothold_Ranks.lua");
    let mut player_map = if ranks_file.exists() {
        parse_foothold_ranks(&lua, &ranks_file).unwrap_or_default()
    } else {
        tracing::warn!("Foothold_Ranks.lua not found at {:?}", ranks_file);
        std::collections::HashMap::new()
    };

    // CA map parsing
    // Read the active mission file from foothold.status
    let status_file = saves_dir.join("foothold.status");
    let mut ca_filename = String::from("FootHold_CA_v0.2.lua"); // fallback

    if status_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&status_file) {
            let line = content.lines().next().unwrap_or("").trim();
            if !line.is_empty() {
                // Extract just the filename from the path in the status file
                let path = std::path::Path::new(line);
                if let Some(file_name) = path.file_name() {
                    if let Some(file_name_str) = file_name.to_str() {
                        ca_filename = file_name_str.to_string();
                    }
                }
            }
        }
    }

    let ca_file = saves_dir.join(&ca_filename);
    if ca_file.exists() {
        parse_foothold_ca(&lua, &ca_file, &mut player_map)
    } else {
        tracing::warn!("{} not found at {:?}", ca_filename, ca_file);
        Ok(FootholdData {
            players: player_map.into_values().collect(),
            missions: vec![],
            ejected_pilots: vec![],
            zones: vec![],
        })
    }
}

fn flatten_lua_value(
    prefix: &str,
    val: mlua::Value,
    config: &mut std::collections::HashMap<String, serde_json::Value>,
) {
    match val {
        mlua::Value::String(s) => {
            if let Ok(s_str) = s.to_str() {
                config.insert(prefix.to_string(), serde_json::Value::String(s_str.to_string()));
            }
        }
        mlua::Value::Boolean(b) => {
            config.insert(prefix.to_string(), serde_json::Value::Bool(b));
        }
        mlua::Value::Integer(i) => {
            config.insert(prefix.to_string(), serde_json::json!(i));
        }
        mlua::Value::Number(n) => {
            config.insert(prefix.to_string(), serde_json::json!(n));
        }
        mlua::Value::Table(t) => {
            for (key, value) in t.pairs::<mlua::Value, mlua::Value>().flatten() {
                let key_str = match key {
                    mlua::Value::String(s) => {
                        if let Ok(s_str) = s.to_str() {
                            s_str.to_string()
                        } else {
                            "".to_string()
                        }
                    },
                    mlua::Value::Integer(i) => i.to_string(),
                    _ => continue,
                };
                if key_str.is_empty() {
                    continue;
                }
                let new_prefix = if prefix.is_empty() {
                    key_str
                } else {
                    format!("{}.{}", prefix, key_str)
                };
                flatten_lua_value(&new_prefix, value, config);
            }
        }
        _ => {}
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdConfigResponse {
    pub values: std::collections::HashMap<String, serde_json::Value>,
    pub metadata: std::collections::HashMap<String, FootholdMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdMetadata {
    pub help: Option<String>,
    pub choices: Vec<String>,
}

pub fn get_foothold_config(saves_dir: &Path) -> Result<FootholdConfigResponse> {
    let config_file = saves_dir.join("Foothold Config.lua");
    if !config_file.exists() {
        return Err(anyhow::anyhow!("Foothold Config.lua not found at {:?}", config_file));
    }
    let content = std::fs::read_to_string(&config_file)?;
    
    let lua = Lua::new();
    lua.load(&content).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    let globals = lua.globals();
    
    let mut config = std::collections::HashMap::new();
    for (key, value) in globals.pairs::<String, mlua::Value>().flatten() {
        if key == "_G" || key == "_VERSION" || key == "package" || key == "string" || key == "table" || key == "math" || key == "io" || key == "os" || key == "coroutine" || key == "debug" || key == "utf8" {
            continue;
        }
        flatten_lua_value(&key, value, &mut config);
    }
    
    let mut metadata = std::collections::HashMap::new();
    let mut current_block_comment = Vec::new();
    
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("--") {
            if !trimmed.starts_with("---") && !trimmed.starts_with("-- =") {
                let text = trimmed.trim_start_matches("--").trim();
                if !text.is_empty() {
                    current_block_comment.push(text.to_string());
                }
            }
        } else if trimmed.is_empty() {
            // Keep comments across empty lines
        } else if let Some(eq_idx) = trimmed.find('=') {
            let lhs = trimmed[..eq_idx].trim();
            // Validate LHS looks like a config key (e.g. StartNormal, GlobalSettings.difficultyScaling)
            if lhs.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.') && !lhs.is_empty() {
                let mut trailing_comment = None;
                if let Some(comment_idx) = trimmed.find("--") {
                    if comment_idx > eq_idx {
                        trailing_comment = Some(trimmed[comment_idx + 2..].trim().to_string());
                    }
                }
                
                let mut help = String::new();
                if !current_block_comment.is_empty() {
                    help.push_str(&current_block_comment.join("\n"));
                }
                if let Some(tc) = trailing_comment {
                    if !help.is_empty() { help.push('\n'); }
                    help.push_str(&tc);
                }
                
                let mut choices = Vec::new();
                let lower_help = help.to_lowercase();
                if let Some(idx) = lower_help.find("valid values:") {
                    // Extract choices from `Valid values: "X" | "Y"` or similar
                    // Splitting by \n first to isolate the line
                    if let Some(line_end) = help[idx..].find('\n') {
                        let remaining = &help[idx + "valid values:".len()..idx + line_end];
                        let parts: Vec<&str> = remaining.split(['|', ',']).collect();
                        for part in parts {
                            let p = part.trim();
                            if let Some(start) = p.find('"') {
                                if let Some(end) = p[start+1..].find('"') {
                                    choices.push(p[start+1..start+1+end].to_string());
                                }
                            } else if let Some(start) = p.find('\'') {
                                if let Some(end) = p[start+1..].find('\'') {
                                    choices.push(p[start+1..start+1+end].to_string());
                                }
                            }
                        }
                    } else {
                        let remaining = &help[idx + "valid values:".len()..];
                        let parts: Vec<&str> = remaining.split(['|', ',']).collect();
                        for part in parts {
                            let p = part.trim();
                            if let Some(start) = p.find('"') {
                                if let Some(end) = p[start+1..].find('"') {
                                    choices.push(p[start+1..start+1+end].to_string());
                                }
                            } else if let Some(start) = p.find('\'') {
                                if let Some(end) = p[start+1..].find('\'') {
                                    choices.push(p[start+1..start+1+end].to_string());
                                }
                            }
                        }
                    }
                }
                
                // Ensure boolean inputs like StartNormal get a boolean dropdown
                let is_bool = trimmed[eq_idx+1..].trim().starts_with("true") || trimmed[eq_idx+1..].trim().starts_with("false");
                if is_bool {
                    choices = vec!["true".to_string(), "false".to_string()];
                }
                
                if !help.is_empty() || !choices.is_empty() {
                    metadata.insert(lhs.to_string(), FootholdMetadata {
                        help: if help.is_empty() { None } else { Some(help) },
                        choices,
                    });
                }
            }
            current_block_comment.clear();
        } else {
            current_block_comment.clear();
        }
    }
    
    Ok(FootholdConfigResponse {
        values: config,
        metadata,
    })
}

pub fn update_foothold_config(saves_dir: &Path, updates: std::collections::HashMap<String, serde_json::Value>) -> Result<()> {
    let config_file = saves_dir.join("Foothold Config.lua");
    if !config_file.exists() {
        return Err(anyhow::anyhow!("Foothold Config.lua not found at {:?}", config_file));
    }
    let content = std::fs::read_to_string(&config_file)?;
    
    // Convert JSON values to Lua strings
    let mut str_updates = std::collections::HashMap::new();
    for (key, val) in updates {
        let val_str = match val {
            serde_json::Value::Null => "__DELETE__".to_string(),
            serde_json::Value::String(s) => {
                // Determine if it's already a literal like "{1400, 1500}" from the UI or if it's a normal string
                if s.starts_with('{') && s.ends_with('}') {
                    s
                } else {
                    format!("\"{}\"", s.replace("\"", "\\\""))
                }
            },
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => continue,
        };
        str_updates.insert(key, val_str);
    }
    
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let mut current_path: Vec<String> = Vec::new();
    
    let re_table_start = regex::Regex::new(r#"^\s*(?:(?:\["([^"]+)"\])|([a-zA-Z_]\w*))\s*=\s*\{\s*(?:--.*)?$"#).unwrap();
    let re_assignment = regex::Regex::new(r#"^\s*(?:(?:\["([^"]+)"\])|([a-zA-Z_]\w*))\s*=\s*(.*)$"#).unwrap();
    let re_table_end = regex::Regex::new(r#"^\s*\}\,?\s*(?:--.*)?$"#).unwrap();

    for current_line in &mut lines {
        let line = current_line.clone();
        
        if re_table_end.is_match(&line) {
            // Check if there are any unprocessed new keys for this path to insert
            if !current_path.is_empty() {
                let current_prefix = format!("{}.", current_path.join("."));
                let mut to_insert = Vec::new();
                for (k, v) in &str_updates {
                    if k.starts_with(&current_prefix) && v != "__DELETE__" {
                        let local_key = &k[current_prefix.len()..];
                        if !local_key.contains('.') {
                            // Determine indentation from the closing brace line
                            let indent = line.chars().take_while(|c| c.is_whitespace()).collect::<String>();
                            // Prefer bracket notation for table keys if they have spaces or special chars
                            let safe_key = if local_key.chars().all(|c| c.is_alphanumeric() || c == '_') {
                                local_key.to_string()
                            } else {
                                format!("[\"{}\"]", local_key)
                            };
                            to_insert.push(format!("{}    {} = {},", indent, safe_key, v));
                        }
                    }
                }
                if !to_insert.is_empty() {
                    *current_line = format!("{}\n{}", to_insert.join("\n"), line);
                }
            }
            current_path.pop();
            continue;
        }

        if let Some(caps) = re_table_start.captures(&line) {
            let key = caps.get(1).or(caps.get(2)).unwrap().as_str();
            current_path.push(key.to_string());
            continue;
        }

        if let Some(caps) = re_assignment.captures(&line) {
            let key = caps.get(1).or(caps.get(2)).unwrap().as_str();
            let mut full_path = current_path.clone();
            full_path.push(key.to_string());
            let path_str = full_path.join(".");
            
            if let Some(new_val) = str_updates.get(&path_str) {
                if new_val == "__DELETE__" {
                    *current_line = String::new(); // Mark line for deletion
                } else {
                    let rest = caps.get(3).unwrap().as_str();
                    let comment = rest.find("--").map(|idx| &rest[idx..]).unwrap_or("");
                    let comma = if rest.trim_end().ends_with(',') && !new_val.ends_with(',') { "," } else { "" };
                    
                    let prefix_end = caps.get(3).unwrap().start();
                    let prefix = &line[..prefix_end];
                    let new_line = format!("{}{}{} {}", prefix, new_val, comma, comment);
                    *current_line = new_line.trim_end().to_string();
                }
                // We've processed this update
                str_updates.remove(&path_str);
            }
        }
    }
    
    // Filter out deleted lines
    let final_lines: Vec<String> = lines.into_iter().filter(|l| !l.is_empty() || content.lines().any(|orig| orig.is_empty() && orig == l)).collect();
    
    std::fs::write(&config_file, final_lines.join("\n") + "\n")?;
    Ok(())
}
