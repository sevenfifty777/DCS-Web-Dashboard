//! Authentication HTTP handlers: password login, logout, token verification,
//! and the Discord OAuth login + callback (with guild role gating).
//!
//! Behaviour mirrors the legacy Next.js routes (`web-dashboard/src/app/api/auth/*`)
//! but issues HS256 JWTs instead of session cookies so the same model serves
//! both the web UI and the Android app.

use axum::{
    extract::{Query, State},
    response::Redirect,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::{constant_time_eq, issue_token, AuditLog, AuthError, AuthUser};
use crate::config::SESSION_TTL_SECONDS;
use crate::state::AppState;

const DISCORD_TOKEN_URL: &str = "https://discord.com/api/oauth2/token";
const DISCORD_USER_URL: &str = "https://discord.com/api/users/@me";
const DISCORD_OAUTH_SCOPE: &str = "identify guilds.members.read";

#[derive(Deserialize, utoipa::ToSchema)]
pub struct LoginRequest {
    password: String,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct TokenResponse {
    token: String,
    token_type: &'static str,
    expires_in: i64,
}

/// `POST /api/auth` — exchange the admin password for a session JWT.
#[utoipa::path(
    post,
    path = "/api/auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = TokenResponse),
        (status = 401, description = "Bad credentials"),
    )
)]
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<TokenResponse>, AuthError> {
    let Some(expected) = state.config.admin_password.as_deref() else {
        return Err(AuthError::NotConfigured);
    };

    if !constant_time_eq(body.password.as_bytes(), expected.as_bytes()) {
        return Err(AuthError::BadCredentials);
    }

    let token = issue_token(&state.config.jwt_secret, "admin", "password", SESSION_TTL_SECONDS)
        .map_err(|_| AuthError::Internal)?;

    Ok(Json(TokenResponse {
        token,
        token_type: "Bearer",
        expires_in: SESSION_TTL_SECONDS,
    }))
}

/// `DELETE /api/auth` — logout. JWTs are stateless, so this is a client cue.
#[utoipa::path(
    delete,
    path = "/api/auth",
    tags = ["auth"],
    responses(
        (status = 200, description = "Logout successful"),
    )
)]
pub async fn logout() -> Json<Value> {
    Json(json!({ "success": true }))
}

/// `GET /api/auth/verify` — confirm a bearer token is valid.
#[utoipa::path(
    get,
    path = "/api/auth/verify",
    tags = ["auth"],
    security(("jwt" = [])),
    responses(
        (status = 200, description = "Token is valid"),
        (status = 401, description = "Token is invalid or missing"),
    )
)]
pub async fn verify(user: AuthUser) -> Json<Value> {
    Json(json!({
        "authenticated": true,
        "subject": user.subject,
        "kind": user.kind,
    }))
}

/// `GET /api/auth/discord` — redirect the browser to Discord's OAuth consent.
#[utoipa::path(
    get,
    path = "/api/auth/discord",
    tags = ["auth"],
    responses(
        (status = 307, description = "Redirect to Discord"),
        (status = 500, description = "Discord OAuth not configured"),
    )
)]
pub async fn discord_login(State(state): State<AppState>) -> Result<Redirect, AuthError> {
    let Some(discord) = state.config.discord.as_ref() else {
        return Err(AuthError::NotConfigured);
    };

    let redirect_uri = format!("{}/api/auth/callback", state.config.app_url);
    let url = format!(
        "https://discord.com/oauth2/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}",
        encode_component(&discord.client_id),
        encode_component(&redirect_uri),
        encode_component(DISCORD_OAUTH_SCOPE),
    );

    Ok(Redirect::temporary(&url))
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct CallbackQuery {
    code: Option<String>,
}

/// `GET /api/auth/callback` — complete the OAuth flow and redirect to the UI
/// with a session token in the URL fragment, or an error query on failure.
#[utoipa::path(
    get,
    path = "/api/auth/callback",
    tags = ["auth"],
    params(CallbackQuery),
    responses(
        (status = 303, description = "Redirect to UI with token or error"),
    )
)]
pub async fn discord_callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
) -> Redirect {
    let base = state.config.app_url.clone();
    match exchange_and_verify(&state, query.code).await {
        Ok(token) => Redirect::to(&format!("{base}/login#token={token}")),
        Err(message) => Redirect::to(&format!("{base}/login?error={}", encode_component(&message))),
    }
}

#[derive(Deserialize)]
struct DiscordToken {
    access_token: String,
}

#[derive(Deserialize)]
struct DiscordUser {
    id: String,
    #[serde(default)]
    username: Option<String>,
}

#[derive(Deserialize)]
struct DiscordMember {
    #[serde(default)]
    roles: Vec<String>,
}

/// Run the Discord OAuth exchange + guild role check. Returns a session JWT on
/// success or a user-facing error message on failure.
async fn exchange_and_verify(state: &AppState, code: Option<String>) -> Result<String, String> {
    let Some(discord) = state.config.discord.as_ref() else {
        return Err("Server Configuration Missing".to_string());
    };
    let Some(code) = code.filter(|code| !code.is_empty()) else {
        return Err("No Code Provided".to_string());
    };
    let redirect_uri = format!("{}/api/auth/callback", state.config.app_url);

    // 1. Exchange the authorization code for an access token.
    let token_res = state
        .http
        .post(DISCORD_TOKEN_URL)
        .form(&[
            ("client_id", discord.client_id.as_str()),
            ("client_secret", discord.client_secret.as_str()),
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ])
        .send()
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "discord token request failed");
            "Authentication Failed".to_string()
        })?;

    if !token_res.status().is_success() {
        let status = token_res.status();
        let body = token_res
            .text()
            .await
            .unwrap_or_else(|_| "<unreadable response body>".to_string());
        tracing::error!(%status, %body, "discord token exchange rejected");
        return Err("Authentication Failed".to_string());
    }

    let token: DiscordToken = token_res.json().await.map_err(|err| {
        tracing::error!(error = %err, "failed to decode discord token response");
        "Authentication Failed".to_string()
    })?;

    // 2. Identify the user.
    let user: DiscordUser = state
        .http
        .get(DISCORD_USER_URL)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "discord user request failed");
            "Authentication Failed".to_string()
        })?
        .json()
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "failed to decode discord user response");
            "Authentication Failed".to_string()
        })?;
    let username = user.username.clone().unwrap_or_else(|| "Unknown User".to_string());

    // 3. Fetch the caller's membership in the required guild.
    let member_res = state
        .http
        .get(format!(
            "https://discord.com/api/users/@me/guilds/{}/member",
            discord.guild_id
        ))
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "discord member request failed");
            "Authentication Failed".to_string()
        })?;

    if member_res.status() == reqwest::StatusCode::NOT_FOUND {
        audit(
            state,
            &username,
            &user.id,
            "REJECTED",
            Some("Not a member of the required Discord server"),
        )
        .await;
        return Err("You are not a member of the required server".to_string());
    }

    if !member_res.status().is_success() {
        tracing::error!(status = %member_res.status(), "discord member fetch failed");
        return Err("Authentication Failed".to_string());
    }

    let member: DiscordMember = member_res.json().await.map_err(|err| {
        tracing::error!(error = %err, "failed to decode discord member response");
        "Authentication Failed".to_string()
    })?;

    // 4. Require at least one whitelisted admin role.
    let has_admin_role = member
        .roles
        .iter()
        .any(|role| discord.admin_role_ids.iter().any(|allowed| allowed == role));

    if !has_admin_role {
        audit(state, &username, &user.id, "REJECTED", Some("Missing Admin Role")).await;
        return Err("Unauthorized: Missing Admin Role".to_string());
    }

    audit(state, &username, &user.id, "SUCCESS", None).await;

    let subject = format!("discord_{}", user.id);
    issue_token(&state.config.jwt_secret, &subject, "discord", SESSION_TTL_SECONDS).map_err(|err| {
        tracing::error!(error = %err, "failed to issue session token");
        "Authentication Failed".to_string()
    })
}

async fn audit(state: &AppState, username: &str, user_id: &str, status: &str, reason: Option<&str>) {
    let entry = AuditLog::new(username, user_id, status, reason);
    crate::auth::record_audit(&state.config.audit_log_path, entry).await;
}

/// Percent-encode a string for safe inclusion in a URL query/fragment value.
fn encode_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}
