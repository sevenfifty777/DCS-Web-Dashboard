use axum::{extract::State, response::IntoResponse, Json};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::json;
use crate::{auth::AuthUser, grpc, state::AppState};

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SpawnGroundPayload {
    pub country: i32,
    pub name: String,
    pub unit_type: String,
    pub lat: f64,
    pub lon: f64,
    pub heading: u32,
    pub count: u32,
}

fn err_detail(msg: &str, err: impl std::fmt::Display) -> axum::response::Response {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": msg, "details": err.to_string() }))).into_response()
}

#[utoipa::path(
    post,
    path = "/api/spawn/ground",
    tags = ["spawner"],
    security(("jwt" = [])),
    request_body = SpawnGroundPayload,
    responses((status = 200, description = "Ground group spawned"))
)]
pub async fn spawn_ground(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<SpawnGroundPayload>,
) -> axum::response::Response {
    let count = if payload.count < 1 { 1 } else if payload.count > 10 { 10 } else { payload.count };

    match grpc::add_ground_group(
        state.grpc.clone(),
        payload.country,
        payload.name,
        payload.unit_type,
        payload.lat,
        payload.lon,
        payload.heading,
        count,
    )
    .await
    {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to spawn ground group", e),
    }
}
