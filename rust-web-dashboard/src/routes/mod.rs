//! HTTP route definitions. Mounted onto the application router in `main`.

use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::json;

use crate::state::AppState;

mod auth;
mod dcs;
mod lso;
mod stream;
mod system;
pub mod srs;

use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[derive(OpenApi)]
#[openapi(
    paths(
        auth::login,
        auth::logout,
        auth::verify,
        auth::discord_login,
        auth::discord_callback,
        dcs::health,
        dcs::players,
        dcs::chat,
        dcs::banned_players,
        dcs::console,
        dcs::get_flag,
        dcs::set_flag,
        dcs::mission_status,
        dcs::mission_action,
        dcs::airboss_data,
        dcs::airboss_action,
        dcs::airboss_carriers,
        dcs::airboss_config,
        dcs::kick_player,
        dcs::ban_player,
        dcs::unban_player,
        dcs::announcements,
        system::settings_get,
        system::settings_post,
        system::mission_upload,
        system::mission_browse,
        system::logs_access,
        system::rdp_status,
        system::tasks_get,
        system::tasks_post,
        system::weather_get,
        system::weather_apply,
        system::dcs_process_get,
        system::dcs_process_post,
        system::srs_process_get,
        system::srs_process_post,
        system::windows_services_get,
        system::windows_services_post,
        system::foothold_get,
        system::foothold_config_get,
        system::foothold_config_post,
        srs::get_settings,
        srs::post_settings,
        srs::get_clients,
        stream::events_stream,
        stream::radar_stream,
        lso::status,
        lso::passes,
        lso::pilots,
        lso::chart,
        lso::pattern
    ),
    components(
        schemas(
            auth::LoginRequest, auth::TokenResponse, dcs::ChatBody,
            dcs::ConsoleBody, dcs::SetFlagBody, dcs::MissionBody, dcs::MissionPayload,
            dcs::PlayerActionBody, dcs::AnnouncementBody,
            dcs::AirbossDataResponse, dcs::AirbossActionPayload, dcs::AirbossActionResponse,
            dcs::AirbossReportsResponse, dcs::AirbossCarrier, dcs::AirbossCarriersResponse,
            dcs::AirbossConfigPayload, dcs::AirbossConfigResponse,
            system::TaskActionBody, system::WeatherApplyBody, system::DcsProcessAction, system::SrsProcessAction,
            system::WindowsServiceStatus, system::WindowsServiceAction,
            crate::lso::LsoPass, crate::lso::LsoPassesResponse, crate::lso::LsoStatus,
            crate::lso::LsoPilot, crate::lso::LsoPilotsResponse
        )
    ),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "dcs", description = "DCS-gRPC endpoints"),
        (name = "system", description = "OS and filesystem endpoints"),
        (name = "srs", description = "SRS server endpoints"),
        (name = "stream", description = "SSE streaming endpoints"),
        (name = "lso", description = "DCS-gRPC-lso greenie board (file-backed, no DCS-gRPC calls)")
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

#[cfg(test)]
mod tests {
    use super::*;

    /// Regenerates `docs/src/openapi.json`. Run with
    /// `cargo test dump_openapi -- --ignored --nocapture > ../docs/src/openapi.json`
    /// (strip cargo's own lines from the top and bottom of the output).
    #[test]
    #[ignore]
    fn dump_openapi() {
        println!("{}", ApiDoc::openapi().to_pretty_json().expect("openapi serialises"));
    }
}

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "jwt",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            )
        }
    }
}

/// Build the `/api` router with the dashboard's HTTP endpoints. Feature routes
/// are added here as later phases land (see `docs/PLAN.md` §8).
pub fn router() -> Router<AppState> {
    Router::new()
        .merge(
            SwaggerUi::new("/swagger-ui")
                .url("/api-docs/openapi.json", ApiDoc::openapi())
                .config(utoipa_swagger_ui::Config::from("/api-docs/openapi.json").with_credentials(true))
        )
        // Process liveness (the dashboard binary itself).
        .route("/healthz", get(liveness))
        // DCS-gRPC server status — public so the login screen can show it.
        .route("/api/health", get(dcs::health))
        // Authentication.
        .route("/api/auth", post(auth::login).delete(auth::logout))
        .route("/api/auth/verify", get(auth::verify))
        .route("/api/auth/discord", get(auth::discord_login))
        .route("/api/auth/callback", get(auth::discord_callback))
        // DCS data + control (session-protected).
        .route("/api/players", get(dcs::players))
        .route("/api/players/kick", post(dcs::kick_player))
        .route("/api/players/ban", post(dcs::ban_player))
        .route("/api/players/unban", post(dcs::unban_player))
        .route("/api/players/banned", get(dcs::banned_players))
                .route("/api/chat", post(dcs::chat))
        .route("/api/announcements", post(dcs::announcements))
        .route("/api/console", post(dcs::console))
        .route("/api/triggers", get(dcs::get_flag).post(dcs::set_flag))
        .route(
            "/api/mission",
            get(dcs::mission_status).post(dcs::mission_action),
        )
        .route("/api/airboss", get(dcs::airboss_data))
        .route("/api/airboss/action", post(dcs::airboss_action))
        .route("/api/airboss/carriers", get(dcs::airboss_carriers))
        .route("/api/airboss/config", post(dcs::airboss_config))
        // Filesystem- and OS-backed endpoints (session-protected).
        .route(
            "/api/settings",
            get(system::settings_get).post(system::settings_post),
        )
        .route("/api/mission/upload", post(system::mission_upload))
        .route("/api/mission/browse", get(system::mission_browse))
        .route("/api/logs/access", get(system::logs_access))
        .route("/api/foothold", get(system::foothold_get))
        .route("/api/foothold/config", get(system::foothold_config_get).post(system::foothold_config_post))
        .route("/api/rdp-status", get(system::rdp_status))
        .route(
            "/api/server/tasks",
            get(system::tasks_get).post(system::tasks_post),
        )
        .route(
            "/api/server/dcs-process",
            get(system::dcs_process_get).post(system::dcs_process_post),
        )
        .route(
            "/api/server/srs-process",
            get(system::srs_process_get).post(system::srs_process_post),
        )
        .route(
            "/api/server/services",
            get(system::windows_services_get).post(system::windows_services_post),
        )
        .nest(
            "/api/srs",
            Router::new()
                .route("/settings", get(srs::get_settings).post(srs::post_settings))
                .route("/clients", get(srs::get_clients))
        )
        // LSO greenie board, read from the LSO client's lso.db (session-protected,
        // no DCS-gRPC traffic).
        .route("/api/lso/status", get(lso::status))
        .route("/api/lso/passes", get(lso::passes))
        .route("/api/lso/pilots", get(lso::pilots))
        .route("/api/lso/passes/{id}/chart", get(lso::chart))
        .route("/api/lso/passes/{id}/pattern", get(lso::pattern))
        .route("/api/weather", get(system::weather_get))
        .route("/api/weather/apply", post(system::weather_apply))
        // Telemetry streams (public; an EventSource cannot send auth headers).
        .route("/api/events/stream", get(stream::events_stream))
        .route("/api/radar/stream", get(stream::radar_stream))
}

/// Liveness probe for the dashboard process itself (not the DCS-gRPC server).
async fn liveness() -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "service": "rust-web-dashboard",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
