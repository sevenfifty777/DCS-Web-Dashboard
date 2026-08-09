use std::collections::HashMap;
use std::path::Path;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use mlua::{Lua, Table};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct PlayerStats {
    pub kills: u32,
    pub deaths: u32,
    pub score: i32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Leaderboard {
    #[serde(default)]
    pub players: HashMap<String, PlayerStats>,
    #[serde(default)]
    pub last_processed_t: f64,
    #[serde(default)]
    pub last_processed_file_time: u64,
}

impl Leaderboard {
    pub fn load_or_default(path: &Path) -> Self {
        if let Ok(data) = std::fs::read_to_string(path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(path, data)?;
        Ok(())
    }
}

pub fn process_debrief_log(debrief_path: &Path, leaderboard_path: &Path) -> Result<Leaderboard> {
    let mut board = Leaderboard::load_or_default(leaderboard_path);
    
    // Safety check: Prevent processing the exact same file twice
    let modified_secs = std::fs::metadata(debrief_path)
        .and_then(|m| m.modified())
        .map(|m| m.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
        .unwrap_or(0);

    if modified_secs > 0 && board.last_processed_file_time == modified_secs {
        tracing::info!("Debrief log already processed. Skipping to avoid duplicate stats.");
        return Ok(board);
    }

    let lua_script = std::fs::read_to_string(debrief_path)
        .map_err(|e| anyhow::anyhow!("Failed to read debrief.log: {}", e))?;

    let lua = Lua::new();
    lua.load(&lua_script).exec().map_err(|e| anyhow::anyhow!("Failed to evaluate debrief.log: {}", e))?;

    let globals = lua.globals();
    let events: Table = globals.get("events").map_err(|e| anyhow::anyhow!("Missing 'events' table in debrief.log: {}", e))?;

    let mut current_max_t = 0.0_f64;

    // First pass: identify AI names (where PilotName == unit_type)
    let mut ai_names = std::collections::HashSet::new();
    for pair in events.clone().pairs::<i64, Table>() {
        if let Ok((_, event)) = pair {
            if let Ok(pilot_name) = event.get::<String>("initiatorPilotName") {
                if let Ok(unit_type) = event.get::<String>("initiator_unit_type") {
                    if !pilot_name.is_empty() && pilot_name == unit_type {
                        ai_names.insert(pilot_name);
                    }
                }
            }
            if let Ok(pilot_name) = event.get::<String>("targetPilotName") {
                if let Ok(unit_type) = event.get::<String>("target_unit_type") {
                    if !pilot_name.is_empty() && pilot_name == unit_type {
                        ai_names.insert(pilot_name);
                    }
                }
            }
        }
    }

    for pair in events.pairs::<i64, Table>() {
        let (_, event) = match pair {
            Ok(p) => p,
            Err(_) => continue, // Ignore invalid rows
        };
        
        let event_type: String = event.get("type").unwrap_or_default();
        let t: f64 = event.get("t").unwrap_or(0.0);

        if t > current_max_t {
            current_max_t = t;
        }

        match event_type.as_str() {
            "kill" => {
                if let Ok(initiator) = event.get::<String>("initiatorPilotName") {
                    if !initiator.is_empty() && !ai_names.contains(&initiator) {
                        let stats = board.players.entry(initiator).or_default();
                        stats.kills += 1;
                    }
                }
            }
            "pilot dead" | "crash" => {
                if let Ok(initiator) = event.get::<String>("initiatorPilotName") {
                    if !initiator.is_empty() && !ai_names.contains(&initiator) {
                        let stats = board.players.entry(initiator).or_default();
                        stats.deaths += 1;
                    }
                }
            }
            "score" => {
                if let Ok(initiator) = event.get::<String>("initiatorPilotName") {
                    if !initiator.is_empty() && !ai_names.contains(&initiator) {
                        let amount: i32 = event.get("amount").unwrap_or(0);
                        let stats = board.players.entry(initiator).or_default();
                        stats.score += amount;
                    }
                }
            }
            _ => {}
        }
    }

    // Update last processed timestamp for debugging/info
    board.last_processed_t = current_max_t;
    if let Ok(metadata) = std::fs::metadata(debrief_path) {
        if let Ok(modified) = metadata.modified() {
            board.last_processed_file_time = modified.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
        }
    }
    board.save(leaderboard_path)?;

    Ok(board)
}

pub async fn start_auto_processor(config: std::sync::Arc<crate::config::Config>) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
    let debrief_path = config.debrief_log_path();
    let leaderboard_path = config.dcs_saved_games_dir.join("Logs").join("leaderboard.json");

    loop {
        interval.tick().await;

        if let Ok(metadata) = std::fs::metadata(&debrief_path) {
            if let Ok(modified) = metadata.modified() {
                let modified_secs = modified.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
                let now_secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();

                // Wait at least 2 minutes after modification to ensure DCS is completely done writing it.
                if now_secs.saturating_sub(modified_secs) > 120 {
                    let board = Leaderboard::load_or_default(&leaderboard_path);
                    
                    if board.last_processed_file_time != modified_secs {
                        tracing::info!("Auto-processor detected new debrief.log (modified {}), starting parse...", modified_secs);
                        match process_debrief_log(&debrief_path, &leaderboard_path) {
                            Ok(_) => tracing::info!("Auto-processed debrief.log successfully."),
                            Err(e) => tracing::error!("Failed to auto-process debrief.log: {:#}", e),
                        }
                    }
                }
            }
        }
    }
}
