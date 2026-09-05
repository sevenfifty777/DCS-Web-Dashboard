//! Standalone Rust web dashboard for a DCS-gRPC server.
//!
//! Bootstraps configuration, shared state, the axum router (auth API + embedded
//! SPA fallback), CORS, tracing, and graceful shutdown. Feature endpoints are
//! added in later phases per `docs/PLAN.md`.

mod auth;
mod carrier_recovery;
mod config;
mod embed;
mod grpc;
mod pb;
mod proto_json;
mod routes;
mod settings_lua;
mod state;
mod telemetry;
mod win_session;

mod foothold;
mod lso;
mod lso_notation;

use std::{net::SocketAddr, path::PathBuf};

use axum::http::{header, Method};
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;
use utoipa::OpenApi;

/// Default address the dashboard listens on (overridable via `DASHBOARD_ADDR`).
const DEFAULT_ADDR: &str = "0.0.0.0:3001";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    if std::env::var("EXPORT_OPENAPI").is_ok() {
        let openapi = routes::ApiDoc::openapi();
        println!("{}", openapi.to_pretty_json().unwrap());
        return Ok(());
    }

    let config = config::Config::from_env()?;
    let app_state = state::AppState::new(config)?;
    let asset_root = executable_directory()?;

    // Long-lived upstream gRPC telemetry streams, fanned out to SSE clients.
    telemetry::spawn(
        app_state.grpc.clone(),
        app_state.events_tx.clone(),
        app_state.units_tx.clone(),
    );

    let addr: SocketAddr = std::env::var("DASHBOARD_ADDR")
        .unwrap_or_else(|_| DEFAULT_ADDR.to_string())
        .parse()?;

    let cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .allow_origin(Any);

    let app = routes::router()
        .route(
            "/img/background.png",
            axum::routing::get_service(ServeFile::new(
                asset_root.join("images").join("background.png"),
            )),
        )
        .nest_service("/icon", ServeDir::new(asset_root.join("icon")))
        .fallback(embed::static_handler)
        .layer(TraceLayer::new_for_http())
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store, no-cache, must-revalidate"),
        ))
        .layer(cors)
        .with_state(app_state);

    tracing::info!(%addr, "starting rust-web-dashboard");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn executable_directory() -> anyhow::Result<PathBuf> {
    let executable_path = std::env::current_exe()?;
    executable_path
        .parent()
        .map(|parent| parent.to_path_buf())
        .ok_or_else(|| anyhow::anyhow!("dashboard executable has no parent directory"))
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,rust_web_dashboard=debug"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

/// Resolve once either Ctrl-C or (on Unix) SIGTERM is received.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl-C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
