//! Shared, cheaply-cloneable application state.
//!
//! [`AppState`] is the single piece of state threaded through every axum
//! handler. It holds the parsed [`Config`], a lazily-connected gRPC
//! [`Channel`] to the DCS-gRPC server, and a reusable HTTP client (used for the
//! Discord OAuth flow). Cloning an `AppState` clones cheap handles only.

use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::broadcast;
use tonic::transport::Channel;

use crate::config::Config;

/// Per-subscriber broadcast buffer depth for telemetry fan-out. Slow clients
/// that fall this far behind drop the oldest frames (telemetry is latest-wins).
const TELEMETRY_BUFFER: usize = 1024;

/// Application state injected into handlers via `State<AppState>`.
#[derive(Clone)]
pub struct AppState {
    /// Process-wide configuration.
    pub config: Arc<Config>,
    /// Lazily-connecting channel to the DCS-gRPC server. Consumed by the unary
    /// and streaming RPC wrappers in `crate::grpc`.
    pub grpc: Channel,
    /// Shared outbound HTTP client (Discord OAuth, etc.).
    pub http: reqwest::Client,
    /// Broadcast of `Mission.StreamEvents` JSON frames to SSE subscribers.
    pub events_tx: broadcast::Sender<String>,
    /// Broadcast of `Mission.StreamUnits` JSON frames (all group categories) to
    /// SSE subscribers.
    pub units_tx: broadcast::Sender<String>,
}

impl AppState {
    /// Build state from configuration. The gRPC channel connects lazily, so the
    /// dashboard starts even when the DCS-gRPC server is offline.
    pub fn new(config: Arc<Config>) -> Result<Self> {
        let grpc = Channel::from_shared(config.grpc_endpoint.clone())
            .context("invalid GRPC_ENDPOINT")?
            .connect_lazy();

        let http = reqwest::Client::builder()
            .user_agent(concat!(
                env!("CARGO_PKG_NAME"),
                "/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .context("failed to build HTTP client")?;

        // Latest-wins telemetry fan-out; lagging SSE clients drop frames rather
        // than back-pressuring the shared upstream gRPC stream.
        let (events_tx, _) = broadcast::channel(TELEMETRY_BUFFER);
        let (units_tx, _) = broadcast::channel(TELEMETRY_BUFFER);

        Ok(Self {
            config,
            grpc,
            http,
            events_tx,
            units_tx,
        })
    }
}
