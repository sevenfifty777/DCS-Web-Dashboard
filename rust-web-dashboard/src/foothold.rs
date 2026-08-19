use std::path::PathBuf;
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
pub struct FootholdAttack {
    pub group_name: String,
    pub origin_zone: String,
    pub target_zone: String,
    pub side: i64,
    pub mission_type: String,
    pub alive_count: i64,
    pub unit_types: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FootholdData {
    pub players: Vec<FootholdPlayer>,
    pub missions: Vec<FootholdMission>,
    pub ejected_pilots: Vec<FootholdEjectedPilot>,
    pub zones: Vec<FootholdZone>,
    pub attacks: Vec<FootholdAttack>,
}

fn parse_foothold_ranks(lua: &Lua, path: &PathBuf) -> Result<std::collections::HashMap<String, FootholdPlayer>> {
    let script = std::fs::read_to_string(path)?;
    lua.load(&script).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    let globals = lua.globals();
    let rank_save: Table = globals.get("RankSave").map_err(|e| anyhow::anyhow!("{}", e))?;
    let players: Table = rank_save.get("players").map_err(|e| anyhow::anyhow!("{}", e))?;

    let mut map = std::collections::HashMap::new();

    for pair in players.pairs::<String, Table>() {
        if let Ok((name, p_table)) = pair {
            // Strip out slashes and extra quotes from the raw names
            let clean_name = name.replace("\\", "").replace("\"", "");
            let credits: f64 = p_table.get("credits").unwrap_or(0.0);
            
            map.insert(clean_name.clone(), FootholdPlayer {
                name: clean_name,
                credits,
                ..Default::default()
            });
        }
    }
    
    Ok(map)
}

fn parse_foothold_ca(lua: &Lua, path: &PathBuf, player_map: &mut std::collections::HashMap<String, FootholdPlayer>) -> Result<FootholdData> {
    let script = std::fs::read_to_string(path)?;
    lua.load(&script).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    
    let globals = lua.globals();
    let zone_persistance: Table = globals.get("zonePersistance").map_err(|e| anyhow::anyhow!("{}", e))?;

    // Parse Player Stats
    if let Ok(player_stats) = zone_persistance.get::<Table>("playerStats") {
        for pair in player_stats.pairs::<String, Table>() {
            if let Ok((name, stats)) = pair {
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
    }

    // Parse Missions
    let mut missions = Vec::new();
    if let Ok(missions_table) = zone_persistance.get::<Table>("missions") {
        for pair in missions_table.pairs::<i64, Table>() {
            if let Ok((id, m)) = pair {
                missions.push(FootholdMission {
                    id,
                    title: m.get("title").unwrap_or_default(),
                    description: m.get("description").unwrap_or_default(),
                    is_running: m.get("isRunning").unwrap_or(false),
                });
            }
        }
    }

    // Parse Ejected Pilots
    let mut ejected_pilots = Vec::new();
    if let Ok(pilots_table) = zone_persistance.get::<Table>("ejectedPilots") {
        for pair in pilots_table.pairs::<i64, Table>() {
            if let Ok((id, p)) = pair {
                ejected_pilots.push(FootholdEjectedPilot {
                    id,
                    coalition: p.get("coalition").unwrap_or(0),
                    player_name: p.get("playerName").unwrap_or_default(),
                    lat: p.get("latitude").unwrap_or(0.0),
                    lon: p.get("longitude").unwrap_or(0.0),
                    alt: p.get("altitude").unwrap_or(0.0),
                    timestamp: p.get("timestamp").unwrap_or(0.0),
                });
            }
        }
    }

    // Parse Zones
    let mut zones = Vec::new();
    if let Ok(zones_table) = zone_persistance.get::<Table>("zones") {
        for pair in zones_table.pairs::<String, Table>() {
            if let Ok((name, z)) = pair {
                let side = z.get("side").unwrap_or(0);
                let level = z.get("level").unwrap_or(0);
                let (lat, lon) = if let Ok(lat_long) = z.get::<Table>("lat_long") {
                    (lat_long.get("latitude").unwrap_or(0.0), lat_long.get("longitude").unwrap_or(0.0))
                } else {
                    (0.0, 0.0)
                };

                let mut units = Vec::new();
                if let Ok(remaining_units) = z.get::<Table>("remainingUnits") {
                    for group_pair in remaining_units.pairs::<i64, Table>() {
                        if let Ok((_, group_table)) = group_pair {
                            for unit_pair in group_table.pairs::<i64, String>() {
                                if let Ok((_, unit_name)) = unit_pair {
                                    units.push(unit_name);
                                }
                            }
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
    }

    // Parse Attacks
    let mut attacks = Vec::new();
    let parse_attacks = |attacks_vec: &mut Vec<FootholdAttack>, parent_table: &Table| {
        if let Ok(active) = parent_table.get::<Table>("active") {
            for pair in active.pairs::<String, Table>() {
                if let Ok((_, atk)) = pair {
                    let mut unit_types = Vec::new();
                    if let Ok(alive_types) = atk.get::<Table>("aliveUnitTypes") {
                        for unit_pair in alive_types.pairs::<i64, String>() {
                            if let Ok((_, unit_name)) = unit_pair {
                                unit_types.push(unit_name);
                            }
                        }
                    } else if let Ok(template_name) = atk.get::<String>("templateName") {
                        unit_types.push(template_name);
                    }
                    attacks_vec.push(FootholdAttack {
                        group_name: atk.get("groupName").unwrap_or_default(),
                        origin_zone: atk.get::<String>("originZone").unwrap_or_else(|_| atk.get::<String>("zoneName").unwrap_or_default()),
                        target_zone: atk.get::<String>("targetZone").unwrap_or_else(|_| atk.get::<String>("dynamicTargetZone").unwrap_or_default()),
                        side: atk.get("side").unwrap_or(0),
                        mission_type: atk.get::<String>("missionType").unwrap_or_else(|_| atk.get::<String>("mission").unwrap_or_default()),
                        alive_count: atk.get("aliveCount").unwrap_or(0),
                        unit_types,
                    });
                }
            }
        }
        
        if let Ok(inair) = parent_table.get::<Table>("inair") {
            for pair in inair.pairs::<String, Table>() {
                if let Ok((_, atk)) = pair {
                    let mut unit_types = Vec::new();
                    if let Ok(alive_types) = atk.get::<Table>("aliveUnitTypes") {
                        for unit_pair in alive_types.pairs::<i64, String>() {
                            if let Ok((_, unit_name)) = unit_pair {
                                unit_types.push(unit_name);
                            }
                        }
                    } else if let Ok(template_name) = atk.get::<String>("templateName") {
                        unit_types.push(template_name);
                    }
                    attacks_vec.push(FootholdAttack {
                        group_name: atk.get("groupName").unwrap_or_default(),
                        origin_zone: atk.get::<String>("originZone").unwrap_or_else(|_| atk.get::<String>("zoneName").unwrap_or_default()),
                        target_zone: atk.get::<String>("targetZone").unwrap_or_else(|_| atk.get::<String>("dynamicTargetZone").unwrap_or_default()),
                        side: atk.get("side").unwrap_or(0),
                        mission_type: atk.get::<String>("missionType").unwrap_or_else(|_| atk.get::<String>("mission").unwrap_or_default()),
                        alive_count: atk.get("aliveCount").unwrap_or(0),
                        unit_types,
                    });
                }
            }
        }
        if let Ok(spawn_now) = parent_table.get::<Table>("spawnNowTakeoff") {
            for pair in spawn_now.pairs::<String, Table>() {
                if let Ok((_, atk)) = pair {
                    let mut unit_types = Vec::new();
                    if let Ok(alive_types) = atk.get::<Table>("aliveUnitTypes") {
                        for unit_pair in alive_types.pairs::<i64, String>() {
                            if let Ok((_, unit_name)) = unit_pair {
                                unit_types.push(unit_name);
                            }
                        }
                    } else if let Ok(template_name) = atk.get::<String>("templateName") {
                        unit_types.push(template_name);
                    }
                    attacks_vec.push(FootholdAttack {
                        group_name: atk.get("groupName").unwrap_or_default(),
                        origin_zone: atk.get::<String>("originZone").unwrap_or_else(|_| atk.get::<String>("zoneName").unwrap_or_default()),
                        target_zone: atk.get::<String>("targetZone").unwrap_or_else(|_| atk.get::<String>("dynamicTargetZone").unwrap_or_default()),
                        side: atk.get("side").unwrap_or(0),
                        mission_type: atk.get::<String>("missionType").unwrap_or_else(|_| atk.get::<String>("mission").unwrap_or_default()),
                        alive_count: atk.get("aliveCount").unwrap_or(0),
                        unit_types,
                    });
                }
            }
        }
    };

    if let Ok(surface_ai) = zone_persistance.get::<Table>("surfaceAiPersistence") {
        parse_attacks(&mut attacks, &surface_ai);
    }
    if let Ok(air_ai) = zone_persistance.get::<Table>("airAiPersistence") {
        parse_attacks(&mut attacks, &air_ai);
    }

    let mut players_vec: Vec<FootholdPlayer> = player_map.values().cloned().collect();
    // Sort by credits
    players_vec.sort_by(|a, b| b.credits.partial_cmp(&a.credits).unwrap_or(std::cmp::Ordering::Equal));

    Ok(FootholdData {
        players: players_vec,
        missions,
        ejected_pilots,
        zones,
        attacks,
    })
}

pub fn get_foothold_data(saves_dir: &PathBuf) -> Result<FootholdData> {
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
            attacks: vec![],
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
            for pair in t.pairs::<mlua::Value, mlua::Value>() {
                if let Ok((k, v)) = pair {
                    let key_str = match k {
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
                    flatten_lua_value(&new_prefix, v, config);
                }
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

pub fn get_foothold_config(saves_dir: &PathBuf) -> Result<FootholdConfigResponse> {
    let config_file = saves_dir.join("Foothold Config.lua");
    if !config_file.exists() {
        return Err(anyhow::anyhow!("Foothold Config.lua not found at {:?}", config_file));
    }
    let content = std::fs::read_to_string(&config_file)?;
    
    let lua = Lua::new();
    lua.load(&content).exec().map_err(|e| anyhow::anyhow!("{}", e))?;
    let globals = lua.globals();
    
    let mut config = std::collections::HashMap::new();
    for pair in globals.pairs::<String, mlua::Value>() {
        if let Ok((key, val)) = pair {
            if key == "_G" || key == "_VERSION" || key == "package" || key == "string" || key == "table" || key == "math" || key == "io" || key == "os" || key == "coroutine" || key == "debug" || key == "utf8" {
                continue;
            }
            flatten_lua_value(&key, val, &mut config);
        }
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
                    if !help.is_empty() { help.push_str("\n"); }
                    help.push_str(&tc);
                }
                
                let mut choices = Vec::new();
                let lower_help = help.to_lowercase();
                if let Some(idx) = lower_help.find("valid values:") {
                    // Extract choices from `Valid values: "X" | "Y"` or similar
                    // Splitting by \n first to isolate the line
                    if let Some(line_end) = help[idx..].find('\n') {
                        let remaining = &help[idx + "valid values:".len()..idx + line_end];
                        let parts: Vec<&str> = remaining.split(|c| c == '|' || c == ',').collect();
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
                        let parts: Vec<&str> = remaining.split(|c| c == '|' || c == ',').collect();
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

pub fn update_foothold_config(saves_dir: &PathBuf, updates: std::collections::HashMap<String, serde_json::Value>) -> Result<()> {
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

    for i in 0..lines.len() {
        let line = lines[i].clone();
        
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
                    lines[i] = format!("{}\n{}", to_insert.join("\n"), line);
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
                    lines[i] = String::new(); // Mark line for deletion
                } else {
                    let rest = caps.get(3).unwrap().as_str();
                    let comment = rest.find("--").map(|idx| &rest[idx..]).unwrap_or("");
                    let comma = if rest.trim_end().ends_with(',') && !new_val.ends_with(',') { "," } else { "" };
                    
                    let prefix_end = caps.get(3).unwrap().start();
                    let prefix = &line[..prefix_end];
                    let new_line = format!("{}{}{} {}", prefix, new_val, comma, comment);
                    lines[i] = new_line.trim_end().to_string();
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
