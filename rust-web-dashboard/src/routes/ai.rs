//! AI Commander routes: a thin proxy to the dcs-ai-commander service.
//!
//! The Python service binds to loopback and trusts one shared secret. These
//! handlers add that secret, enforce the dashboard session, and pass requests
//! through unchanged. `/api/ai/stream` relays the service's server-sent events;
//! because an `EventSource` cannot send headers, it verifies the JWT from the
//! `token` query parameter (or the session cookie) instead of `AuthUser`.

use axum::{
    body::{to_bytes, Body},
    extract::{Path as AxumPath, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

use crate::auth::{verify_token, AuthUser};
use crate::state::AppState;

/// Upper bound on a proxied request body (orders, settings, the mission brief).
const MAX_BODY_BYTES: usize = 256 * 1024;
/// Deadline for a proxied unary call; the service answers quickly or not at all.
const PROXY_TIMEOUT: Duration = Duration::from_secs(30);
const SECRET_HEADER: &str = "x-commander-key";

fn not_configured() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "AI Commander is not configured (set AI_COMMANDER_URL and AI_COMMANDER_SECRET)" })),
    )
        .into_response()
}

fn upstream_failed(err: reqwest::Error) -> Response {
    tracing::warn!(error = %err, "dcs-ai-commander request failed");
    (
        StatusCode::BAD_GATEWAY,
        Json(json!({ "error": format!("AI Commander unreachable: {err}") })),
    )
        .into_response()
}

fn target(state: &AppState) -> Option<(&str, &str)> {
    let cfg = &state.config;
    Some((cfg.ai_commander_url.as_deref()?, cfg.ai_commander_secret.as_deref()?))
}

/// Forward any `/api/ai/{path}` call (method, query and JSON body preserved).
pub async fn proxy(
    State(state): State<AppState>,
    _user: AuthUser,
    AxumPath(path): AxumPath<String>,
    req: Request,
) -> Response {
    let Some((base, secret)) = target(&state) else {
        return not_configured();
    };
    if path == "stream" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "use /api/ai/stream" }))).into_response();
    }
    let method = req.method().clone();
    let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let url = format!("{base}/{path}{query}");
    let content_type = req
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("application/json"));
    let body = match to_bytes(req.into_body(), MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(err) => {
            return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({ "error": err.to_string() }))).into_response();
        }
    };

    let upstream = state
        .http
        .request(method, &url)
        .header(SECRET_HEADER, secret)
        .header(header::CONTENT_TYPE, content_type)
        .timeout(PROXY_TIMEOUT)
        .body(body)
        .send()
        .await;
    let resp = match upstream {
        Ok(resp) => resp,
        Err(err) => return upstream_failed(err),
    };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let ctype = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("application/json"));
    match resp.bytes().await {
        Ok(bytes) => {
            let mut headers = HeaderMap::new();
            headers.insert(header::CONTENT_TYPE, ctype);
            (status, headers, bytes).into_response()
        }
        Err(err) => upstream_failed(err),
    }
}

/// Query string for `/api/ai/stream`.
#[derive(Debug, Deserialize)]
pub struct StreamQuery {
    /// Session JWT (EventSource cannot send an Authorization header).
    pub token: Option<String>,
    /// Replay notifications with an id greater than this before going live.
    pub since: Option<u64>,
}

fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .map(str::trim)
        .find_map(|c| c.strip_prefix("auth_token="))
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

/// Relay the service's SSE stream to the browser.
pub async fn stream(
    State(state): State<AppState>,
    Query(q): Query<StreamQuery>,
    headers: HeaderMap,
) -> Response {
    let token = q.token.filter(|t| !t.is_empty()).or_else(|| cookie_token(&headers));
    let Some(token) = token else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "missing token", "reason": "token_missing" }))).into_response();
    };
    if verify_token(&state.config.jwt_secret, &token).is_err() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "invalid token", "reason": "token_invalid" }))).into_response();
    }
    let Some((base, secret)) = target(&state) else {
        return not_configured();
    };
    let since = q.since.unwrap_or(0);
    let mut request = state
        .http
        .get(format!("{base}/stream?since={since}"))
        .header(SECRET_HEADER, secret)
        .header(header::ACCEPT, "text/event-stream");
    if let Some(last) = headers.get("last-event-id") {
        request = request.header("last-event-id", last.clone());
    }
    // No timeout: this is a long-lived stream. The client reconnects on error.
    let resp = match request.send().await {
        Ok(resp) => resp,
        Err(err) => return upstream_failed(err),
    };
    if !resp.status().is_success() {
        let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        return (status, Json(json!({ "error": "AI Commander rejected the stream request" }))).into_response();
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(resp.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
