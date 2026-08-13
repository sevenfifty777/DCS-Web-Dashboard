use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::grpc;
use crate::state::AppState;

#[derive(Deserialize, utoipa::IntoParams)]
pub struct CoalitionQuery {
    coalition: i32,
}

#[derive(Deserialize, utoipa::IntoParams)]
pub struct GroupsQuery {
    coalition: i32,
    category: i32,
}

fn err_resp(msg: &str) -> Response {
    Json(json!({ "error": msg })).into_response()
}

#[utoipa::path(
    get,
    path = "/api/coalition/groups",
    tags = ["coalition"],
    security(("jwt" = [])),
    params(GroupsQuery),
    responses((status = 200, description = "Coalition groups"))
)]
pub async fn groups(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<GroupsQuery>,
) -> Response {
    match grpc::get_groups(state.grpc.clone(), q.coalition, q.category).await {
        Ok(resp) => {
            let groups_json: Vec<_> = resp.groups.into_iter().map(|g| {
                json!({
                    "id": g.id,
                    "name": g.name,
                    "category": g.category,
                    "coalition": g.coalition,
                })
            }).collect();
            Json(json!({ "groups": groups_json })).into_response()
        }
        Err(e) => err_resp(e.message()),
    }
}

#[utoipa::path(
    get,
    path = "/api/coalition/players",
    tags = ["coalition"],
    security(("jwt" = [])),
    params(CoalitionQuery),
    responses((status = 200, description = "Player units"))
)]
pub async fn player_units(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<CoalitionQuery>,
) -> Response {
    match grpc::get_player_units(state.grpc.clone(), q.coalition).await {
        Ok(resp) => {
            let units_json: Vec<_> = resp.units.into_iter().map(|u| {
                json!({
                    "id": u.id,
                    "name": u.name,
                    "type": u.r#type,
                    "player_name": u.player_name,
                    "coalition": u.coalition,
                })
            }).collect();
            Json(json!({ "units": units_json })).into_response()
        }
        Err(e) => err_resp(e.message()),
    }
}

#[utoipa::path(
    get,
    path = "/api/coalition/statics",
    tags = ["coalition"],
    security(("jwt" = [])),
    params(CoalitionQuery),
    responses((status = 200, description = "Static objects"))
)]
pub async fn statics(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<CoalitionQuery>,
) -> Response {
    match grpc::get_static_objects(state.grpc.clone(), q.coalition).await {
        Ok(resp) => {
            let statics_json: Vec<_> = resp.statics.into_iter().map(|s| {
                json!({
                    "id": s.id,
                    "name": s.name,
                    "type": s.r#type,
                    "coalition": s.coalition,
                    "position": s.position.map(|p| json!({"lat": p.lat, "lon": p.lon, "alt": p.alt})).unwrap_or(json!(null)),
                })
            }).collect();
            Json(json!({ "statics": statics_json })).into_response()
        }
        Err(e) => err_resp(e.message()),
    }
}

#[utoipa::path(
    get,
    path = "/api/coalition/bullseye",
    tags = ["coalition"],
    security(("jwt" = [])),
    params(CoalitionQuery),
    responses((status = 200, description = "Coalition bullseye"))
)]
pub async fn bullseye(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<CoalitionQuery>,
) -> Response {
    match grpc::get_bullseye(state.grpc.clone(), q.coalition).await {
        Ok(resp) => {
            if let Some(pos) = resp.position {
                Json(json!({ "bullseye": { "lat": pos.lat, "lon": pos.lon, "alt": pos.alt } })).into_response()
            } else {
                Json(json!({ "bullseye": null })).into_response()
            }
        }
        Err(e) => err_resp(e.message()),
    }
}
