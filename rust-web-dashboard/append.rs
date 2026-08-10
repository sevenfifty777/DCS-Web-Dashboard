
// --- Recovered Endpoints ---

pub async fn get_marks(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = "return world.getMarkPanels()";
    match grpc::custom_eval(state.grpc.clone(), lua.to_string()).await {
        Ok(resp) => Json(serde_json::from_str::<serde_json::Value>(&resp.json).unwrap_or(json!([]))).into_response(),
        Err(e) => err_detail("Failed to fetch marks", e),
    }
}

pub async fn get_airbases(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = "local ab = {}; for i, a in ipairs(world.getAirbases()) do table.insert(ab, { name = a:getName(), id = a:getID(), pos = a:getPoint() }) end; return ab";
    match grpc::custom_eval(state.grpc.clone(), lua.to_string()).await {
        Ok(resp) => Json(serde_json::from_str::<serde_json::Value>(&resp.json).unwrap_or(json!([]))).into_response(),
        Err(e) => err_detail("Failed to fetch airbases", e),
    }
}

pub async fn get_zones(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = "local z = {}; for name, zone in pairs(env.mission.triggers.zones) do table.insert(z, { name = name, x = zone.x, y = zone.y, radius = zone.radius }) end; return { zones = z }";
    match grpc::custom_eval(state.grpc.clone(), lua.to_string()).await {
        Ok(resp) => Json(serde_json::from_str::<serde_json::Value>(&resp.json).unwrap_or(json!({ "zones": [] }))).into_response(),
        Err(e) => err_detail("Failed to fetch zones", e),
    }
}

pub async fn get_foothold_zones(_user: AuthUser, State(state): State<AppState>) -> Response {
    let lua = "if fh and fh.zones then return { zones = fh.zones } else return { zones = {} } end";
    match grpc::custom_eval(state.grpc.clone(), lua.to_string()).await {
        Ok(resp) => Json(serde_json::from_str::<serde_json::Value>(&resp.json).unwrap_or(json!({ "zones": [] }))).into_response(),
        Err(e) => err_detail("Failed to fetch foothold zones", e),
    }
}

#[derive(Deserialize, Debug)]
pub struct Weapon {
    pub name: String,
    pub count: u32,
}

#[derive(Deserialize, Debug)]
pub struct UnitDetails {
    pub fuel: Option<f32>,
    pub life: Option<f32>,
    pub life0: Option<f32>,
    pub weapons: Option<Vec<Weapon>>,
}

pub async fn get_unit_details(_user: AuthUser, State(state): State<AppState>, AxumPath(name): AxumPath<String>) -> Response {
    let lua = format!(
        "local u = Unit.getByName('{}'); if u then local ammo = u:getAmmo(); local weapons = {{}}; if ammo then for i, a in ipairs(ammo) do local n = 'Unknown'; if a.desc then n = a.desc.displayName or a.desc.typeName or 'Unknown' end; table.insert(weapons, {{ count = a.count, name = n }}) end end; return {{ fuel = u:getFuel(), life = u:getLife(), life0 = u:getLife0(), weapons = weapons }} else return nil end",
        name.replace("'", "\\'")
    );
    match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            if resp.json == "null" || resp.json.is_empty() {
                return bad_request("Unit not found");
            }
            match serde_json::from_str::<UnitDetails>(&resp.json) {
                Ok(details) => Json(json!({ 
                    "fuel": details.fuel.unwrap_or(0.0), 
                    "life": details.life.unwrap_or(0.0), 
                    "life0": details.life0.unwrap_or(1.0),
                    "weapons": details.weapons.unwrap_or_default()
                })).into_response(),
                Err(e) => bad_request(&format!("Failed to parse unit details: {}", e)),
            }
        },
        Err(e) => err_detail("Failed to fetch unit details", e),
    }
}

pub async fn destroy_unit_group(_user: AuthUser, State(state): State<AppState>, AxumPath(name): AxumPath<String>) -> Response {
    let lua = format!(
        "local u = Unit.getByName('{}'); if u then return u:getGroup():getName() else return nil end",
        name.replace("'", "\\'")
    );
    let group_name = match grpc::custom_eval(state.grpc.clone(), lua).await {
        Ok(resp) => {
            if resp.json == "null" || resp.json.is_empty() {
                return bad_request("Unit not found");
            }
            resp.json.trim_matches('"').to_string()
        },
        Err(e) => return err_detail("Failed to fetch unit's group", e),
    };
    
    match grpc::destroy_group(state.grpc.clone(), group_name).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(e) => err_detail("Failed to destroy group", e),
    }
}
