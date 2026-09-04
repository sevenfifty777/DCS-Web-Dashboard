//! Runtime configuration, loaded once from the process environment.
//!
//! All secrets and deployment-specific values come from environment variables
//! so nothing sensitive is ever compiled into the binary (see `docs/PLAN.md`
//! §10). Missing-but-required values fail fast at startup.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Context, Result};

/// Lifetime of an issued session token (1 week), matching the legacy Next.js
/// cookie `maxAge`.
pub const SESSION_TTL_SECONDS: i64 = 60 * 60 * 24 * 7;

/// Minimum acceptable length for the HMAC signing secret.
const MIN_JWT_SECRET_LEN: usize = 16;

const DEFAULT_APP_URL: &str = "http://localhost:3001";
const DEFAULT_GRPC_ENDPOINT: &str = "http://localhost:50051";
const DEFAULT_AUDIT_LOG_PATH: &str = "audit_logs.json";
const DEFAULT_PYTHON_EXE: &str = "python";

/// Discord OAuth settings. Present only when every required Discord variable is
/// configured; otherwise the Discord login routes report "not configured".
#[derive(Clone)]
pub struct DiscordConfig {
    pub client_id: String,
    pub client_secret: String,
    /// One or more guild IDs (comma-separated in env).
    pub guild_ids: Vec<String>,
    /// One or more role IDs that grant admin access (comma-separated in env).
    pub admin_role_ids: Vec<String>,
}

impl DiscordConfig {
    fn from_env() -> Option<Self> {
        let client_id = optional("DISCORD_CLIENT_ID")?;
        let client_secret = optional("DISCORD_CLIENT_SECRET")?;
        let guilds_raw = optional("DISCORD_GUILD_ID")?;
        let roles_raw = optional("DISCORD_ADMIN_ROLE_ID")?;

        let guild_ids: Vec<String> = guilds_raw
            .split(',')
            .map(|guild| guild.trim().to_string())
            .filter(|guild| !guild.is_empty())
            .collect();

        let admin_role_ids: Vec<String> = roles_raw
            .split(',')
            .map(|role| role.trim().to_string())
            .filter(|role| !role.is_empty())
            .collect();

        if admin_role_ids.is_empty() || guild_ids.is_empty() {
            return None;
        }

        Some(Self {
            client_id,
            client_secret,
            guild_ids,
            admin_role_ids,
        })
    }
}

/// Fully-resolved application configuration shared via [`crate::state::AppState`].
pub struct Config {
    /// HMAC secret used to sign/verify session JWTs.
    pub jwt_secret: Vec<u8>,
    /// Shared admin password for the password login flow (optional).
    pub admin_password: Option<String>,
    /// Path to the directory where Foohold saves are stored.
    pub foothold_saves_dir: PathBuf,
    /// Static bearer token accepted from the mobile app (legacy, optional).
    pub mobile_api_key: Option<String>,
    /// Public base URL used for OAuth redirect URIs and post-login redirects.
    pub app_url: String,
    /// DCS-gRPC server endpoint (normalised to include an `http(s)://` scheme).
    pub grpc_endpoint: String,
    /// Path to the JSON auth audit log.
    pub audit_log_path: String,
    /// DCS "Saved Games" directory whose `Config/serverSettings.lua` and
    /// `Missions/` subtree drive the settings and mission-management routes.
    pub dcs_saved_games_dir: PathBuf,
    /// Optional DCS-Dynamic-Weather working directory (`weather_presets.json`,
    /// `data/dto.json`, `weather_generator.py`). When unset, the weather routes
    /// report "not configured".
    pub dcs_dynamic_weather_dir: Option<PathBuf>,
    /// Python interpreter used to invoke the weather generator.
    pub python_exe: String,
    /// Optional allow-list of Windows scheduled-task names (lower-cased) that
    /// the `/api/server/tasks` route may inspect or control.
    pub task_whitelist: Vec<String>,
    /// Optional allow-list of Windows services that the `/api/server/services`
    /// route may inspect or control.
    pub windows_services: Vec<String>,
    /// Discord OAuth settings, when configured.
    pub discord: Option<DiscordConfig>,
    /// Optional command to start the DCS process.
    pub dcs_start_cmd: Option<String>,
    /// Optional scheduled task name to run to start the DCS process instead of spawning it directly.
    pub dcs_scheduled_task: Option<String>,
    /// Optional command to start the SRS process.
    pub srs_start_cmd: Option<String>,
    /// Optional scheduled task name to run to start the SRS process instead of spawning it directly.
    pub srs_scheduled_task: Option<String>,
    /// Optional path to the SRS server.cfg file.
    pub srs_cfg_path: Option<PathBuf>,
}

impl Config {
    /// Load configuration from the environment, returning an error if any
    /// required variable is missing or invalid.
    pub fn from_env() -> Result<Arc<Self>> {
        let jwt_secret = std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?;
        if jwt_secret.len() < MIN_JWT_SECRET_LEN {
            bail!("JWT_SECRET must be at least {MIN_JWT_SECRET_LEN} characters");
        }

        let app_url = std::env::var("APP_URL")
            .ok()
            .map(|url| url.trim_end_matches('/').to_string())
            .filter(|url| !url.is_empty())
            .unwrap_or_else(|| DEFAULT_APP_URL.to_string());

        let grpc_endpoint = normalize_endpoint(
            std::env::var("GRPC_ENDPOINT").unwrap_or_else(|_| DEFAULT_GRPC_ENDPOINT.to_string()),
        );

        let audit_log_path =
            optional("AUDIT_LOG_PATH").unwrap_or_else(|| DEFAULT_AUDIT_LOG_PATH.to_string());

        let dcs_saved_games_dir = optional("DCS_SAVED_GAMES_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_saved_games_dir);

        let dcs_dynamic_weather_dir = optional("DCS_DYNAMIC_WEATHER_DIR").map(PathBuf::from);

        let python_exe =
            optional("PYTHON_EXE").unwrap_or_else(|| DEFAULT_PYTHON_EXE.to_string());

        let task_whitelist: Vec<String> = optional("DCS_TASK_WHITELIST")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        let windows_services: Vec<String> = optional("WINDOWS_SERVICES")
            .unwrap_or_default()
            .split(',')
            .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let srs_start_cmd = optional("SRS_START_CMD");
        
        let mut srs_cfg_path = optional("SRS_CFG_PATH").map(|s| PathBuf::from(s.trim_matches('"').trim_matches('\'')));
        if srs_cfg_path.is_none() {
            if let Some(cmd) = &srs_start_cmd {
                let cmd_str = cmd.trim_matches('\'');
                if let Some(cfg_idx) = cmd_str.find("-cfg=") {
                    let path_part = &cmd_str[cfg_idx + 5..];
                    let cfg_val = if let Some(unquoted) = path_part.strip_prefix('"') {
                        if let Some(end) = unquoted.find('"') {
                            &unquoted[..end]
                        } else {
                            path_part
                        }
                    } else if let Some(space) = path_part.find(' ') {
                        &path_part[..space]
                    } else {
                        path_part
                    };
                    srs_cfg_path = Some(PathBuf::from(cfg_val));
                }
            }
        }
        let foothold_saves_dir = optional("FOOTHOLD_SAVES_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| dcs_saved_games_dir.join("Missions").join("Saves"));

        Ok(Arc::new(Self {
            foothold_saves_dir,
            jwt_secret: jwt_secret.into_bytes(),
            admin_password: optional("ADMIN_PASSWORD"),
            mobile_api_key: optional("MOBILE_API_KEY"),
            app_url,
            grpc_endpoint,
            audit_log_path,
            dcs_saved_games_dir,
            dcs_dynamic_weather_dir,
            python_exe,
            task_whitelist,
            windows_services,
            discord: DiscordConfig::from_env(),
            dcs_start_cmd: optional("DCS_START_CMD"),
            dcs_scheduled_task: optional("DCS_SCHEDULED_TASK_NAME"),
            srs_start_cmd,
            srs_scheduled_task: optional("SRS_SCHEDULED_TASK_NAME"),
            srs_cfg_path,
        }))
    }

    /// Absolute path to `Config/serverSettings.lua` under the DCS saved-games
    /// directory.
    pub fn server_settings_path(&self) -> PathBuf {
        self.dcs_saved_games_dir
            .join("Config")
            .join("serverSettings.lua")
    }

    /// Absolute path to the `Missions/` directory.
    pub fn missions_dir(&self) -> PathBuf {
        self.dcs_saved_games_dir.join("Missions")
    }

    /// Absolute path to the `Missions/Uploads/` directory used for uploaded
    /// `.miz` files.
    pub fn uploads_dir(&self) -> PathBuf {
        self.missions_dir().join("Uploads")
    }

}

/// Read an environment variable, treating empty/whitespace values as absent.
fn optional(key: &str) -> Option<String> {
    match std::env::var(key) {
        Ok(value) if !value.trim().is_empty() => Some(value),
        _ => None,
    }
}

/// Default DCS saved-games directory when `DCS_SAVED_GAMES_DIR` is unset,
/// matching the legacy route default of `process.cwd()/../../..`.
fn default_saved_games_dir() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    cwd.join("..").join("..").join("..")
}

/// Ensure the gRPC endpoint carries a scheme so tonic can parse it as a URI.
fn normalize_endpoint(raw: String) -> String {
    if raw.starts_with("http://") || raw.starts_with("https://") {
        raw
    } else {
        format!("http://{raw}")
    }
}
