use axum::{
    extract::{Query, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use crate::{
    auth::AuthUser,
    grpc,
    routes::dcs::err_detail,
    state::AppState,
};

#[derive(Deserialize, utoipa::IntoParams)]
pub struct InventoryQuery {
    airbase_name: String,
}

/// `GET /api/warehouse/inventory`
#[utoipa::path(
    get,
    path = "/api/warehouse/inventory",
    tags = ["warehouse"],
    security(("jwt" = [])),
    params(InventoryQuery),
    responses((status = 200, description = "Airbase inventory"))
)]
pub async fn get_inventory(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(q): Query<InventoryQuery>,
) -> Response {
    match grpc::get_inventory(state.grpc.clone(), q.airbase_name).await {
        Ok(resp) => {
            let inventory_json: serde_json::Value = match serde_json::from_str(&resp.inventory_json) {
                Ok(v) => v,
                Err(_) => json!({}),
            };
            Json(json!({ "inventory": inventory_json })).into_response()
        }
        Err(e) => err_detail("Failed to fetch inventory", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AddItemBody {
    airbase_name: String,
    item_name: String,
    count: i32,
}

/// `POST /api/warehouse/item/add`
#[utoipa::path(
    post,
    path = "/api/warehouse/item/add",
    tags = ["warehouse"],
    security(("jwt" = [])),
    request_body = AddItemBody,
    responses((status = 200, description = "Item added to inventory"))
)]
pub async fn add_item(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<AddItemBody>,
) -> Response {
    match grpc::add_item(state.grpc.clone(), body.airbase_name, body.item_name, body.count).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to add item", e),
    }
}

#[derive(Deserialize, utoipa::ToSchema)]
pub struct AddLiquidBody {
    airbase_name: String,
    liquid_type: i32,
    amount: f64,
}

/// `POST /api/warehouse/liquid/add`
#[utoipa::path(
    post,
    path = "/api/warehouse/liquid/add",
    tags = ["warehouse"],
    security(("jwt" = [])),
    request_body = AddLiquidBody,
    responses((status = 200, description = "Liquid added to inventory"))
)]
pub async fn add_liquid(
    _user: AuthUser,
    State(state): State<AppState>,
    Json(body): Json<AddLiquidBody>,
) -> Response {
    match grpc::add_liquid(state.grpc.clone(), body.airbase_name, body.liquid_type, body.amount).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to add liquid", e),
    }
}
