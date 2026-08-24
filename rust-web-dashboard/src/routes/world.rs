use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::grpc;
use crate::state::AppState;

fn err_resp(msg: &str) -> Response {
    tracing::warn!(error = msg, "DCS-gRPC world request failed");
    (StatusCode::BAD_GATEWAY, Json(json!({ "error": msg }))).into_response()
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct ParkingQuery {
    available: Option<bool>,
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct SetCoalitionPayload {
    coalition: i32,
}

#[utoipa::path(
    get,
    path = "/api/airbases/{name}/parking",
    tags = ["world"],
    security(("jwt" = [])),
    params(
        ("name" = String, Path, description = "Airbase name"),
        ParkingQuery
    ),
    responses(
        (status = 200, description = "Airbase parking spots"),
        (status = 502, description = "DCS-gRPC request failed")
    )
)]
pub async fn parking(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(q): Query<ParkingQuery>,
) -> Response {
    match grpc::get_airbase_parking(state.grpc.clone(), name, q.available).await {
        Ok(resp) => {
            let parking_json: Vec<_> = resp.parking.into_iter().map(|p| {
                json!({
                    "term_index": p.term_index,
                    "term_type": p.term_type,
                    "distance_to_runway": p.distance_to_runway,
                    "to_ac": p.to_ac,
                    "position": p.position.map(|pos| json!({ "lat": pos.lat, "lon": pos.lon, "alt": pos.alt, "u": pos.u, "v": pos.v })).unwrap_or(json!(null))
                })
            }).collect();
            Json(json!({ "parking": parking_json })).into_response()
        }
        Err(e) => err_resp(e.message()),
    }
}

#[utoipa::path(
    get,
    path = "/api/airbases/{name}/runways",
    tags = ["world"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Airbase name")),
    responses(
        (status = 200, description = "Airbase runways"),
        (status = 502, description = "DCS-gRPC request failed")
    )
)]
pub async fn runways(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Response {
    match grpc::get_airbase_runways(state.grpc.clone(), name).await {
        Ok(resp) => {
            let runways_json: Vec<_> = resp.runways.into_iter().map(|r| {
                json!({
                    "name": r.name,
                    "course": r.course,
                    "length": r.length,
                    "width": r.width,
                    "position": r.position.map(|pos| json!({ "lat": pos.lat, "lon": pos.lon, "alt": pos.alt })).unwrap_or(json!(null))
                })
            }).collect();
            Json(json!({ "runways": runways_json })).into_response()
        }
        Err(e) => err_resp(e.message()),
    }
}

#[utoipa::path(
    post,
    path = "/api/airbases/{name}/coalition",
    tags = ["world"],
    security(("jwt" = [])),
    params(("name" = String, Path, description = "Airbase name")),
    request_body = SetCoalitionPayload,
    responses(
        (status = 200, description = "Airbase coalition set"),
        (status = 502, description = "DCS-gRPC request failed")
    )
)]
pub async fn set_coalition(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(payload): Json<SetCoalitionPayload>,
) -> Response {
    match grpc::set_airbase_coalition(state.grpc.clone(), name, payload.coalition).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_resp(e.message()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grpc_error_returns_bad_gateway() {
        let response = err_resp("test failure");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    }
}
