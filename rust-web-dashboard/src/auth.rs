//! Authentication primitives: JWT issuing/verification, the `AuthUser`
//! extractor that guards protected routes, and the auth audit log.
//!
//! The dashboard uses a single bearer-token model for both the web UI and the
//! Android app (`docs/PLAN.md` §10). Tokens are HS256 JWTs signed with
//! `JWT_SECRET`. A legacy static `MOBILE_API_KEY` bearer is also accepted to
//! keep the existing mobile client working during the migration.

use axum::{
    extract::{FromRequestParts, Query},
    http::{header, request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::state::AppState;

/// Newest-first cap on retained audit entries.
const MAX_AUDIT_LOGS: usize = 1000;

/// Claims embedded in every session JWT.
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    /// Subject: `"admin"` for password login or `"discord_<id>"` for OAuth.
    pub sub: String,
    /// How the token was obtained: `"password"`, `"discord"`, or `"mobile"`.
    pub kind: String,
    /// Issued-at (Unix seconds).
    pub iat: i64,
    /// Expiry (Unix seconds).
    pub exp: i64,
}

/// Authenticated principal produced by the [`AuthUser`] extractor.
pub struct AuthUser {
    pub subject: String,
    pub kind: String,
}

/// Rejection returned by auth handlers and the [`AuthUser`] extractor.
#[derive(Debug)]
pub enum AuthError {
    /// No bearer token was supplied.
    Missing,
    /// The bearer token was malformed, expired, or had a bad signature.
    Invalid,
    /// Password login failed.
    BadCredentials,
    /// A required feature (password or Discord login) is not configured.
    NotConfigured,
    /// An unexpected server-side error occurred.
    Internal,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            AuthError::Missing | AuthError::Invalid => (StatusCode::UNAUTHORIZED, "Unauthorized"),
            AuthError::BadCredentials => (StatusCode::UNAUTHORIZED, "Invalid password"),
            AuthError::NotConfigured => (StatusCode::SERVICE_UNAVAILABLE, "Not configured"),
            AuthError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "Internal error"),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let mut token_opt = None;

        // 1. Try Authorization header
        if let Some(auth_val) = parts.headers.get(header::AUTHORIZATION) {
            if let Ok(auth_str) = auth_val.to_str() {
                if let Some(token) = auth_str.strip_prefix("Bearer ") {
                    let t = token.trim();
                    if !t.is_empty() {
                        token_opt = Some(t.to_string());
                    }
                }
            }
        }

        // 2. Try auth_token cookie
        if token_opt.is_none() {
            if let Some(cookie_val) = parts.headers.get(header::COOKIE) {
                if let Ok(cookie_str) = cookie_val.to_str() {
                    for cookie in cookie_str.split(';') {
                        let cookie = cookie.trim();
                        if let Some(t) = cookie.strip_prefix("auth_token=") {
                            if !t.is_empty() {
                                token_opt = Some(t.to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }

        let token = token_opt.ok_or_else(|| {
            tracing::warn!("Auth token missing from request");
            AuthError::Missing
        })?;

        // Legacy static mobile key (constant-time compare).
        if let Some(key) = state.config.mobile_api_key.as_deref() {
            if constant_time_eq(token.as_bytes(), key.as_bytes()) {
                return Ok(AuthUser {
                    subject: "mobile".to_string(),
                    kind: "mobile".to_string(),
                });
            }
        }

        let claims = verify_token(&state.config.jwt_secret, &token).map_err(|err| {
            tracing::error!(error = %err, "JWT verification failed in AuthUser");
            AuthError::Invalid
        })?;
        Ok(AuthUser {
            subject: claims.sub,
            kind: claims.kind,
        })
    }
}

/// Authenticated principal produced by the [`AuthQueryUser`] extractor,
/// for endpoints that cannot send Authorization headers (like SSE `EventSource`).
#[allow(dead_code)]
pub struct AuthQueryUser {
    pub subject: String,
    pub kind: String,
}

#[derive(Deserialize)]
struct AuthQuery {
    token: String,
}

impl FromRequestParts<AppState> for AuthQueryUser {
    type Rejection = AuthError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Query(query) = Query::<AuthQuery>::from_request_parts(parts, state)
            .await
            .map_err(|_| AuthError::Missing)?;

        // Legacy static mobile key (constant-time compare).
        if let Some(key) = state.config.mobile_api_key.as_deref() {
            if constant_time_eq(query.token.as_bytes(), key.as_bytes()) {
                return Ok(AuthQueryUser {
                    subject: "mobile".to_string(),
                    kind: "mobile".to_string(),
                });
            }
        }

        let claims = verify_token(&state.config.jwt_secret, &query.token)
            .map_err(|_| AuthError::Invalid)?;
        
        Ok(AuthQueryUser {
            subject: claims.sub,
            kind: claims.kind,
        })
    }
}

/// Sign a new session JWT for `subject`.
pub fn issue_token(
    secret: &[u8],
    subject: &str,
    kind: &str,
    ttl_secs: i64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let issued_at = now_unix_secs();
    let claims = Claims {
        sub: subject.to_string(),
        kind: kind.to_string(),
        iat: issued_at,
        exp: issued_at + ttl_secs,
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
}

/// Verify a session JWT and return its claims.
pub fn verify_token(secret: &[u8], token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let validation = Validation::new(Algorithm::HS256);
    let data = decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)?;
    Ok(data.claims)
}

/// Length-checked constant-time byte comparison (avoids content timing leaks).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// A single authentication audit record (newest-first in the log file).
#[derive(Debug, Serialize, Deserialize)]
pub struct AuditLog {
    /// Event time in Unix milliseconds.
    pub timestamp_ms: i64,
    pub username: String,
    pub user_id: String,
    /// `"SUCCESS"` or `"REJECTED"`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl AuditLog {
    pub fn new(username: &str, user_id: &str, status: &str, reason: Option<&str>) -> Self {
        Self {
            timestamp_ms: now_unix_millis(),
            username: username.to_string(),
            user_id: user_id.to_string(),
            status: status.to_string(),
            reason: reason.map(str::to_string),
        }
    }
}

/// Append an audit entry, logging (but not propagating) any I/O failure.
pub async fn record_audit(path: &str, entry: AuditLog) {
    if let Err(err) = append_audit(path, entry).await {
        tracing::error!(error = %err, "failed to write auth audit log");
    }
}

async fn append_audit(path: &str, entry: AuditLog) -> std::io::Result<()> {
    let mut logs: Vec<AuditLog> = match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(err) => return Err(err),
    };

    logs.insert(0, entry);
    logs.truncate(MAX_AUDIT_LOGS);

    let data = serde_json::to_vec_pretty(&logs)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))?;
    tokio::fs::write(path, data).await
}

/// Read all audit entries (newest-first). A missing or unparseable log file
/// yields an empty list rather than an error.
pub async fn read_audit_logs(path: &str) -> Vec<AuditLog> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn now_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_unix_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
