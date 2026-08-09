use std::path::Path;
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wreck {
    pub id: u32,
    pub lat: f64,
    pub lon: f64,
    pub alt: f64,
    pub coalition: i32,
    pub unit_type: String,
    pub time: f64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Graveyard {
    pub wrecks: Vec<Wreck>,
}

impl Graveyard {
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

    pub fn add_wreck(&mut self, path: &Path, wreck: Wreck) -> Result<()> {
        // Simple deduplication based on ID and time (within 1 second)
        if self.wrecks.iter().any(|w| w.id == wreck.id && (w.time - wreck.time).abs() < 1.0) {
            return Ok(());
        }
        self.wrecks.push(wreck);
        self.save(path)
    }
}
