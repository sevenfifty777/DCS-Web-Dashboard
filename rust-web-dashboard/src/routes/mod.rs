//! HTTP route definitions. Mounted onto the application router in `main`.

use axum::{
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;

use crate::state::AppState;

mod auth;
mod dcs;
mod stream;
mod system;
pub mod srs;
mod warehouse;
mod coalition;
mod world;
mod trigger;
mod spawner;

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
        dcs::atmosphere,
        dcs::get_marks,
        dcs::get_airbases,
        dcs::get_zones,
        dcs::get_foothold_zones,
        dcs::mission_status,
        dcs::mission_action,
        dcs::airboss_data,
        dcs::kick_player,
        dcs::ban_player,
        dcs::unban_player,
        dcs::announcements,
        dcs::get_unit_details,
        dcs::destroy_unit_group,
        dcs::set_unit_emission,
        dcs::set_group_roe,
        dcs::set_group_alarm_state,
        dcs::lase,
        dcs::ir_pointer,
        dcs::destroy_spot,
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
        system::dcs_log_stream,
        system::graveyard_get,
        system::foothold_get,
        system::foothold_config_get,
        system::foothold_config_post,
        srs::get_settings,
        srs::post_settings,
        srs::get_clients,
        warehouse::get_inventory,
        warehouse::add_item,
        warehouse::add_liquid,
        coalition::groups,
        coalition::player_units,
        coalition::statics,
        coalition::bullseye,
        world::parking,
        world::runways,
        world::set_coalition,
        trigger::create_mark,
        trigger::remove_mark,
        trigger::trigger_effect,
        stream::events_stream,
        stream::radar_stream,
        spawner::spawn_ground
    ),
    components(
        schemas(
            auth::LoginRequest, auth::TokenResponse, dcs::ChatBody,
            dcs::ConsoleBody, dcs::SetFlagBody, dcs::MissionBody, dcs::MissionPayload,
            dcs::PlayerActionBody, dcs::AnnouncementBody, dcs::EmissionPayload,
            dcs::ROEPayload, dcs::AlarmStatePayload, dcs::LasePayload, dcs::IrPointerPayload,
            dcs::AirbossDataResponse,
            system::TaskActionBody, system::WeatherApplyBody, system::DcsProcessAction, system::SrsProcessAction,
            warehouse::AddItemBody, warehouse::AddLiquidBody,
            world::SetCoalitionPayload,
            trigger::MarkPayload, trigger::EffectPayload,
            spawner::SpawnGroundPayload
        )
    ),
    tags(
        (name = "auth", description = "Authentication endpoints"),
        (name = "dcs", description = "DCS-gRPC endpoints"),
        (name = "system", description = "OS and filesystem endpoints"),
        (name = "srs", description = "SRS server endpoints"),
        (name = "warehouse", description = "Airbase inventory endpoints"),
        (name = "coalition", description = "Coalition object endpoints"),
        (name = "world", description = "World and environment endpoints"),
        (name = "trigger", description = "Trigger marks and effects endpoints"),
        (name = "stream", description = "SSE streaming endpoints"),
        (name = "spawner", description = "Unit spawning endpoints")
    ),
    modifiers(&SecurityAddon)
)]
pub struct ApiDoc;

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
        
        // Spawner
        .route("/api/spawn/ground", post(spawner::spawn_ground))
        .route("/api/chat", post(dcs::chat))
        .route("/api/announcements", post(dcs::announcements))
        .route("/api/console", post(dcs::console))
        .route("/api/triggers", get(dcs::get_flag).post(dcs::set_flag))
        .route("/api/atmosphere", get(dcs::atmosphere))
        .route("/api/performance", get(dcs::performance))
        .route(
            "/api/mission",
            get(dcs::mission_status).post(dcs::mission_action),
        )
        .route("/api/marks", get(dcs::get_marks))
        .route("/api/airbases", get(dcs::get_airbases))
        .route("/api/zones", get(dcs::get_zones))
        .route("/api/zones/foothold", get(dcs::get_foothold_zones))
        .route("/api/airboss", get(dcs::airboss_data))
        .route("/api/units/{name}", get(dcs::get_unit_details))
        .route("/api/units/{name}/destroy", post(dcs::destroy_unit_group))
        .route("/api/units/{name}/emission", post(dcs::set_unit_emission))
        .route("/api/units/{name}/roe", post(dcs::set_group_roe))
        .route("/api/units/{name}/alarm-state", post(dcs::set_group_alarm_state))
        .route("/api/units/{name}/lase", post(dcs::lase))
        .route("/api/units/{name}/ir-point", post(dcs::ir_pointer))
        .route("/api/spots/{id}", delete(dcs::destroy_spot))
        // Filesystem- and OS-backed endpoints (session-protected).
        .route(
            "/api/settings",
            get(system::settings_get).post(system::settings_post),
        )
        .route("/api/mission/upload", post(system::mission_upload))
        .route("/api/mission/browse", get(system::mission_browse))
        .route("/api/logs/access", get(system::logs_access))
        .route("/api/logs/dcs/stream", get(system::dcs_log_stream))
        .route("/api/graveyard", get(system::graveyard_get))
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
        .nest(
            "/api/srs",
            Router::new()
                .route("/settings", get(srs::get_settings).post(srs::post_settings))
                .route("/clients", get(srs::get_clients))
        )
        .route("/api/weather", get(system::weather_get))
        .route("/api/weather/apply", post(system::weather_apply))
        .nest(
            "/api/warehouse",
            Router::new()
                .route("/inventory", get(warehouse::get_inventory))
                .route("/item/add", post(warehouse::add_item))
                .route("/liquid/add", post(warehouse::add_liquid))
        )
        .nest(
            "/api/coalition",
            Router::new()
                .route("/groups", get(coalition::groups))
                .route("/players", get(coalition::player_units))
                .route("/statics", get(coalition::statics))
                .route("/bullseye", get(coalition::bullseye))
        )
        .nest(
            "/api/world",
            Router::new()
                .route("/airbases/{name}/parking", get(world::parking))
                .route("/airbases/{name}/runways", get(world::runways))
                .route("/airbases/{name}/coalition", post(world::set_coalition))
        )
        .nest(
            "/api/trigger",
            Router::new()
                .route("/marks", post(trigger::create_mark))
                .route("/marks/{id}", delete(trigger::remove_mark))
                .route("/effects", post(trigger::trigger_effect))
        )
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
