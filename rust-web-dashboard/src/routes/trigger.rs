use axum::{
    extract::{Path, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::AuthUser;
use crate::grpc;
use crate::state::AppState;
use crate::pb::dcs::trigger::v0::Color;

fn err_resp(msg: &str) -> Response {
    Json(json!({ "error": msg })).into_response()
}

#[derive(Deserialize)]
pub struct MarkPayload {
    pub shape: String, // "mark", "circle", "line", "rect"
    pub lat1: f64,
    pub lon1: f64,
    pub lat2: Option<f64>,
    pub lon2: Option<f64>,
    pub text: Option<String>,
    pub radius: Option<f64>,
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[derive(Deserialize)]
pub struct EffectPayload {
    pub effect: String, // "smoke"
    pub lat: f64,
    pub lon: f64,
    pub color: i32, // 1=Green, 2=Red, 3=White, 4=Orange, 5=Blue
}

pub async fn create_mark(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<MarkPayload>,
) -> Response {
    let color = Color { red: payload.r, green: payload.g, blue: payload.b, alpha: payload.a };
    let border = Color { red: payload.r, green: payload.g, blue: payload.b, alpha: 1.0 };
    let fill = Color { red: payload.r, green: payload.g, blue: payload.b, alpha: 0.2 };
    
    let res = match payload.shape.as_str() {
        "mark" => grpc::mark_to_all(state.grpc.clone(), payload.text.unwrap_or_default(), payload.lat1, payload.lon1, false, "".into()).await,
        "circle" => grpc::circle_to_all(state.grpc.clone(), payload.lat1, payload.lon1, payload.radius.unwrap_or(1000.0), border, fill).await,
        "line" => grpc::line_to_all(state.grpc.clone(), payload.lat1, payload.lon1, payload.lat2.unwrap_or(payload.lat1), payload.lon2.unwrap_or(payload.lon1), color).await,
        "rect" => grpc::rect_to_all(state.grpc.clone(), payload.lat1, payload.lon1, payload.lat2.unwrap_or(payload.lat1), payload.lon2.unwrap_or(payload.lon1), border, fill).await,
        _ => return err_resp("invalid shape")
    };

    match res {
        Ok(id) => Json(json!({ "id": id })).into_response(),
        Err(e) => err_resp(e.message()),
    }
}

pub async fn remove_mark(
    _user: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<u32>,
) -> Response {
    match grpc::remove_mark(state.grpc.clone(), id).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_resp(e.message()),
    }
}

pub async fn trigger_effect(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<EffectPayload>,
) -> Response {
    if payload.effect == "smoke" {
        match grpc::smoke(state.grpc.clone(), payload.lat, payload.lon, payload.color).await {
            Ok(_) => Json(json!({ "success": true })).into_response(),
            Err(e) => err_resp(e.message()),
        }
    } else {
        err_resp("unsupported effect")
    }
}
