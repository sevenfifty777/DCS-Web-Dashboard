//! LSO greenie board routes.
//!
//! File-backed only: these handlers read the DCS-gRPC-lso client's `lso.db`
//! and trap-sheet PNGs from `LSO_DIR` (see [`crate::lso`]). They make **no
//! DCS-gRPC calls** and never touch `AppState.grpc`; the board must add zero
//! load on the DCS server. All routes require a valid session.

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use utoipa::IntoParams;

use crate::auth::AuthUser;
use crate::lso::{self, ChartKind, LsoError, LsoPassesResponse, LsoPilotsResponse, LsoStatus};
use crate::state::AppState;

/// Query string for `/api/lso/passes`.
#[derive(Debug, Deserialize, IntoParams)]
pub struct PassesQuery {
    /// Maximum rows to return (default 200, max 2000).
    pub limit: Option<usize>,
    /// Only return passes with an id greater than this (incremental polling).
    pub since_id: Option<i64>,
}

/// Query string for `/api/lso/pilots`.
#[derive(Debug, Deserialize, IntoParams)]
pub struct PilotsQuery {
    /// Passes to keep per pilot, newest first (default 5, max 2000).
    pub limit: Option<usize>,
    /// `true` returns every pass for every pilot and ignores `limit`.
    pub all: Option<bool>,
}

/// Default per-pilot cap for `/api/lso/pilots`.
pub const DEFAULT_PER_PILOT: usize = 5;

fn error_response(err: LsoError) -> Response {
    let status = match &err {
        LsoError::NotConfigured
        | LsoError::DbMissing(_)
        | LsoError::PassNotFound(_)
        | LsoError::ChartMissing => StatusCode::NOT_FOUND,
        LsoError::Sqlite(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    if status.is_server_error() {
        tracing::error!(error = %err, "LSO route failed");
    } else {
        tracing::debug!(error = %err, "LSO route returned not found");
    }
    (status, Json(json!({ "error": err.to_string() }))).into_response()
}

fn join_error(err: tokio::task::JoinError) -> Response {
    tracing::error!(?err, "LSO blocking task panicked");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "LSO database task failed" })),
    )
        .into_response()
}

#[utoipa::path(
    get,
    path = "/api/lso/status",
    tags = ["lso"],
    security(("jwt" = [])),
    responses((status = 200, description = "Board availability and pass count", body = LsoStatus))
)]
pub async fn status(_user: AuthUser, State(state): State<AppState>) -> Response {
    let dir = state.config.lso_dir.clone();
    match tokio::task::spawn_blocking(move || lso::status(dir.as_deref())).await {
        Ok(Ok(status)) => Json(status).into_response(),
        Ok(Err(err)) => error_response(err),
        Err(err) => join_error(err),
    }
}

#[utoipa::path(
    get,
    path = "/api/lso/passes",
    tags = ["lso"],
    params(PassesQuery),
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Recorded passes, newest first", body = LsoPassesResponse),
        (status = 404, description = "LSO_DIR not configured or lso.db not created yet")
    )
)]
pub async fn passes(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<PassesQuery>,
) -> Response {
    let Some(dir) = state.config.lso_dir.clone() else {
        return error_response(LsoError::NotConfigured);
    };
    let limit = query.limit.unwrap_or(lso::DEFAULT_LIMIT);
    let since_id = query.since_id;
    let result = tokio::task::spawn_blocking(move || {
        let conn = lso::open_read_only(&dir)?;
        lso::list_passes(&conn, limit, since_id)
    })
    .await;
    match result {
        Ok(Ok(page)) => Json(page).into_response(),
        Ok(Err(err)) => error_response(err),
        Err(err) => join_error(err),
    }
}

#[utoipa::path(
    get,
    path = "/api/lso/pilots",
    tags = ["lso"],
    params(PilotsQuery),
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Passes grouped by pilot, newest pilot first", body = LsoPilotsResponse),
        (status = 404, description = "LSO_DIR not configured or lso.db not created yet")
    )
)]
pub async fn pilots(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<PilotsQuery>,
) -> Response {
    let Some(dir) = state.config.lso_dir.clone() else {
        return error_response(LsoError::NotConfigured);
    };
    let per_pilot = if query.all.unwrap_or(false) {
        None
    } else {
        Some(query.limit.unwrap_or(DEFAULT_PER_PILOT).clamp(1, lso::MAX_LIMIT))
    };
    let result = tokio::task::spawn_blocking(move || {
        let conn = lso::open_read_only(&dir)?;
        lso::list_by_pilot(&conn, per_pilot)
    })
    .await;
    match result {
        Ok(Ok(page)) => Json(page).into_response(),
        Ok(Err(err)) => error_response(err),
        Err(err) => join_error(err),
    }
}

#[utoipa::path(
    get,
    path = "/api/lso/passes/{id}/chart",
    tags = ["lso"],
    params(("id" = i64, Path, description = "Pass row id from /api/lso/passes")),
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Final-approach trap sheet PNG", content_type = "image/png"),
        (status = 404, description = "Pass or PNG not found")
    )
)]
pub async fn chart(
    _user: AuthUser,
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    serve_png(state, id, ChartKind::Approach).await
}

#[utoipa::path(
    get,
    path = "/api/lso/passes/{id}/pattern",
    tags = ["lso"],
    params(("id" = i64, Path, description = "Pass row id from /api/lso/passes")),
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Overhead pattern chart PNG", content_type = "image/png"),
        (status = 404, description = "Pass or PNG not found")
    )
)]
pub async fn pattern(
    _user: AuthUser,
    State(state): State<AppState>,
    AxumPath(id): AxumPath<i64>,
) -> Response {
    serve_png(state, id, ChartKind::Pattern).await
}

async fn serve_png(state: AppState, id: i64, kind: ChartKind) -> Response {
    let Some(dir) = state.config.lso_dir.clone() else {
        return error_response(LsoError::NotConfigured);
    };
    match tokio::task::spawn_blocking(move || lso::chart_bytes(&dir, id, kind)).await {
        Ok(Ok(bytes)) => ([(header::CONTENT_TYPE, "image/png")], bytes).into_response(),
        Ok(Err(err)) => error_response(err),
        Err(err) => join_error(err),
    }
}
