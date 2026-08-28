//! Thin async wrappers around the DCS-gRPC unary RPCs.
//!
//! This mirrors `web-dashboard/src/lib/grpc.ts`. Each function clones a cheap
//! [`Channel`] handle (the lazily-connecting client transport held in
//! [`crate::state::AppState`]), builds the generated tonic client, issues one
//! unary call, and returns the decoded response message — or a [`tonic::Status`]
//! that the HTTP layer maps to a JSON error.
//!
//! Unary endpoints return plain scalars/strings, so no serde derives on the
//! generated proto types are required. The server-streaming RPCs
//! (`Mission.StreamEvents` / `Mission.StreamUnits`) at the bottom of this file
//! hand their typed messages to [`crate::proto_json`], which renders
//! proto-loader-compatible JSON at runtime via reflection.

use tonic::{transport::Channel, Request, Status, Streaming};

use crate::pb::dcs;

use dcs::atmosphere::v0::atmosphere_service_client::AtmosphereServiceClient;
use dcs::custom::v0::custom_service_client::CustomServiceClient;
use dcs::controller::v0::controller_service_client::ControllerServiceClient;
use dcs::hook::v0::hook_service_client::HookServiceClient;
use dcs::metadata::v0::metadata_service_client::MetadataServiceClient;
use dcs::mission::v0::mission_service_client::MissionServiceClient;
use dcs::net::v0::net_service_client::NetServiceClient;
use dcs::spot::v0::spot_service_client::SpotServiceClient;
use dcs::trigger::v0::trigger_service_client::TriggerServiceClient;
use dcs::world::v0::world_service_client::WorldServiceClient;
use dcs::group::v0::group_service_client::GroupServiceClient;
use dcs::srs::v0::srs_service_client::SrsServiceClient;
use dcs::warehouse::v0::{warehouse_service_client::WarehouseServiceClient, get_inventory_request, add_item_request, add_liquid_request};
use dcs::coalition::v0::coalition_service_client::CoalitionServiceClient;
use dcs::unit::v0::unit_service_client::UnitServiceClient;

// --- MetadataService -------------------------------------------------------

/// `MetadataService.GetHealth` — server liveness reported by DCS itself.
pub async fn get_health(channel: Channel) -> Result<dcs::metadata::v0::GetHealthResponse, Status> {
    let mut client = MetadataServiceClient::new(channel);
    let resp = client
        .get_health(Request::new(dcs::metadata::v0::GetHealthRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `MetadataService.GetVersion` — DCS-gRPC server version string.
pub async fn get_version(
    channel: Channel,
) -> Result<dcs::metadata::v0::GetVersionResponse, Status> {
    let mut client = MetadataServiceClient::new(channel);
    let resp = client
        .get_version(Request::new(dcs::metadata::v0::GetVersionRequest {}))
        .await?;
    Ok(resp.into_inner())
}

// --- NetService ------------------------------------------------------------

/// `NetService.GetPlayers` — list of connected players.
pub async fn get_players(
    channel: Channel,
) -> Result<dcs::net::v0::GetPlayersResponse, Status> {
    let mut client = NetServiceClient::new(channel);
    let resp = client
        .get_players(Request::new(dcs::net::v0::GetPlayersRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `NetService.KickPlayer` — kick a connected player.
pub async fn kick_player(channel: Channel, id: u32, message: String) -> Result<(), Status> {
    let mut client = NetServiceClient::new(channel);
    client
        .kick_player(Request::new(dcs::net::v0::KickPlayerRequest {
            id,
            message,
        }))
        .await?;
    Ok(())
}

/// `NetService.SendChat` — broadcast a chat message. `coalition` is a
/// `dcs.common.v0.Coalition` discriminant (DCS only honours ALL or NEUTRAL).
pub async fn send_chat(channel: Channel, message: String, coalition: i32) -> Result<(), Status> {
    let mut client = NetServiceClient::new(channel);
    client
        .send_chat(Request::new(dcs::net::v0::SendChatRequest {
            message,
            coalition,
        }))
        .await?;
    Ok(())
}

// --- HookService -----------------------------------------------------------

/// `HookService.GetMissionName` — currently running mission name.
pub async fn get_mission_name(
    channel: Channel,
) -> Result<dcs::hook::v0::GetMissionNameResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client
        .get_mission_name(Request::new(dcs::hook::v0::GetMissionNameRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `HookService.GetPaused` — whether the mission is paused.
pub async fn get_paused(channel: Channel) -> Result<dcs::hook::v0::GetPausedResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client
        .get_paused(Request::new(dcs::hook::v0::GetPausedRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `HookService.SetPaused` — pause/unpause the running mission.
pub async fn set_paused(channel: Channel, paused: bool) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .set_paused(Request::new(dcs::hook::v0::SetPausedRequest { paused }))
        .await?;
    Ok(())
}

/// `HookService.StopMission` — stop the running mission.
pub async fn stop_mission(channel: Channel) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .stop_mission(Request::new(dcs::hook::v0::StopMissionRequest {}))
        .await?;
    Ok(())
}

/// `HookService.ReloadCurrentMission` — reload the active mission.
pub async fn reload_current_mission(channel: Channel) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .reload_current_mission(Request::new(
            dcs::hook::v0::ReloadCurrentMissionRequest {},
        ))
        .await?;
    Ok(())
}

/// `HookService.LoadMission` — load a specific `.miz` by full path.
pub async fn load_mission(channel: Channel, file_name: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .load_mission(Request::new(dcs::hook::v0::LoadMissionRequest { file_name }))
        .await?;
    Ok(())
}

/// `HookService.BanPlayer` — ban a player by ID.
pub async fn ban_player(channel: Channel, id: u32, period: u32, reason: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .ban_player(Request::new(dcs::hook::v0::BanPlayerRequest {
            id,
            period,
            reason,
        }))
        .await?;
    Ok(())
}

/// `HookService.UnbanPlayer` — unban a player by UCID.
pub async fn unban_player(channel: Channel, ucid: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(channel);
    client
        .unban_player(Request::new(dcs::hook::v0::UnbanPlayerRequest { ucid }))
        .await?;
    Ok(())
}

/// `HookService.GetBannedPlayers` — get list of banned players.
pub async fn get_banned_players(channel: Channel) -> Result<dcs::hook::v0::GetBannedPlayersResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client
        .get_banned_players(Request::new(dcs::hook::v0::GetBannedPlayersRequest {}))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_ballistics_count(channel: Channel) -> Result<dcs::hook::v0::GetBallisticsCountResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client.get_ballistics_count(Request::new(dcs::hook::v0::GetBallisticsCountRequest {})).await?;
    Ok(resp.into_inner())
}

pub async fn get_real_time(channel: Channel) -> Result<dcs::hook::v0::GetRealTimeResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client.get_real_time(Request::new(dcs::hook::v0::GetRealTimeRequest {})).await?;
    Ok(resp.into_inner())
}

pub async fn get_model_time(channel: Channel) -> Result<dcs::hook::v0::GetModelTimeResponse, Status> {
    let mut client = HookServiceClient::new(channel);
    let resp = client.get_model_time(Request::new(dcs::hook::v0::GetModelTimeRequest {})).await?;
    Ok(resp.into_inner())
}

// --- CustomService ---------------------------------------------------------

/// `CustomService.Eval` — evaluate Lua in the mission environment; the result
/// is returned as a JSON string. Disabled by default on the DCS-gRPC server.
pub async fn custom_eval(
    channel: Channel,
    lua: String,
) -> Result<dcs::custom::v0::EvalResponse, Status> {
    let mut client = CustomServiceClient::new(channel);
    let resp = client
        .eval(Request::new(dcs::custom::v0::EvalRequest { lua }))
        .await?;
    Ok(resp.into_inner())
}

// --- TriggerService --------------------------------------------------------

/// `TriggerService.GetUserFlag` — read a mission user flag value.
pub async fn get_user_flag(
    channel: Channel,
    flag: String,
) -> Result<dcs::trigger::v0::GetUserFlagResponse, Status> {
    let mut client = TriggerServiceClient::new(channel);
    let resp = client
        .get_user_flag(Request::new(dcs::trigger::v0::GetUserFlagRequest { flag }))
        .await?;
    Ok(resp.into_inner())
}

/// `TriggerService.SetUserFlag` — set a mission user flag value.
pub async fn set_user_flag(channel: Channel, flag: String, value: u32) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(channel);
    client
        .set_user_flag(Request::new(dcs::trigger::v0::SetUserFlagRequest {
            flag,
            value,
        }))
        .await?;
    Ok(())
}

/// `TriggerService.OutText` — display text on everyone's screen.
pub async fn out_text(channel: Channel, text: String, display_time: u32, clear_view: bool) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(channel);
    client
        .out_text(Request::new(dcs::trigger::v0::OutTextRequest {
            text,
            display_time: display_time as i32,
            clear_view,
        }))
        .await?;
    Ok(())
}

/// `TriggerService.OutTextForCoalition` — display text for a specific coalition.
pub async fn out_text_for_coalition(channel: Channel, coalition: i32, text: String, display_time: u32, clear_view: bool) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(channel);
    client
        .out_text_for_coalition(Request::new(dcs::trigger::v0::OutTextForCoalitionRequest {
            coalition,
            text,
            display_time: display_time as i32,
            clear_view,
        }))
        .await?;
    Ok(())
}

pub async fn mark_to_all(
    channel: Channel,
    text: String,
    lat: f64,
    lon: f64,
    read_only: bool,
    message: String,
) -> Result<u32, Status> {
    let mut client = TriggerServiceClient::new(channel);
    let resp = client
        .mark_to_all(Request::new(dcs::trigger::v0::MarkToAllRequest {
            text,
            position: Some(dcs::common::v0::InputPosition { lat, lon, alt: 0.0 }),
            read_only,
            message,
        }))
        .await?;
    Ok(resp.into_inner().id)
}

pub async fn remove_mark(
    channel: Channel,
    id: u32,
) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(channel);
    client
        .remove_mark(Request::new(dcs::trigger::v0::RemoveMarkRequest { id }))
        .await?;
    Ok(())
}

pub async fn circle_to_all(
    channel: Channel,
    lat: f64,
    lon: f64,
    radius: f64,
    border_color: dcs::trigger::v0::Color,
    fill_color: dcs::trigger::v0::Color,
) -> Result<u32, Status> {
    let mut client = TriggerServiceClient::new(channel);
    let resp = client
        .circle_to_all(Request::new(dcs::trigger::v0::CircleToAllRequest {
            coalition: 0,
            center: Some(dcs::common::v0::InputPosition { lat, lon, alt: 0.0 }),
            radius,
            border_color: Some(border_color),
            fill_color: Some(fill_color),
            line_type: 1, // Solid
            read_only: false,
            message: "".into(),
        }))
        .await?;
    Ok(resp.into_inner().id)
}

pub async fn line_to_all(
    channel: Channel,
    lat1: f64,
    lon1: f64,
    lat2: f64,
    lon2: f64,
    color: dcs::trigger::v0::Color,
) -> Result<u32, Status> {
    let mut client = TriggerServiceClient::new(channel);
    let resp = client
        .line_to_all(Request::new(dcs::trigger::v0::LineToAllRequest {
            coalition: 0,
            start_point: Some(dcs::common::v0::InputPosition { lat: lat1, lon: lon1, alt: 0.0 }),
            end_point: Some(dcs::common::v0::InputPosition { lat: lat2, lon: lon2, alt: 0.0 }),
            color: Some(color),
            line_type: 1,
            read_only: false,
            message: "".into(),
        }))
        .await?;
    Ok(resp.into_inner().id)
}

pub async fn rect_to_all(
    channel: Channel,
    lat1: f64,
    lon1: f64,
    lat2: f64,
    lon2: f64,
    border_color: dcs::trigger::v0::Color,
    fill_color: dcs::trigger::v0::Color,
) -> Result<u32, Status> {
    let mut client = TriggerServiceClient::new(channel);
    let resp = client
        .rect_to_all(Request::new(dcs::trigger::v0::RectToAllRequest {
            coalition: 0,
            start_point: Some(dcs::common::v0::InputPosition { lat: lat1, lon: lon1, alt: 0.0 }),
            end_point: Some(dcs::common::v0::InputPosition { lat: lat2, lon: lon2, alt: 0.0 }),
            border_color: Some(border_color),
            fill_color: Some(fill_color),
            line_type: 1,
            read_only: false,
            message: "".into(),
        }))
        .await?;
    Ok(resp.into_inner().id)
}

pub async fn smoke(
    channel: Channel,
    lat: f64,
    lon: f64,
    color: i32,
) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(channel);
    client
        .smoke(Request::new(dcs::trigger::v0::SmokeRequest {
            position: Some(dcs::common::v0::InputPosition { lat, lon, alt: 0.0 }),
            color,
        }))
        .await?;
    Ok(())
}

// --- AtmosphereService -----------------------------------------------------

/// `AtmosphereService.GetWind` — wind heading/strength at a map position.
pub async fn get_wind(
    channel: Channel,
    lat: f64,
    lon: f64,
    alt: f64,
) -> Result<dcs::atmosphere::v0::GetWindResponse, Status> {
    let mut client = AtmosphereServiceClient::new(channel);
    let resp = client
        .get_wind(Request::new(dcs::atmosphere::v0::GetWindRequest {
            position: Some(dcs::common::v0::InputPosition { lat, lon, alt }),
        }))
        .await?;
    Ok(resp.into_inner())
}

/// `AtmosphereService.GetTemperatureAndPressure` — temperature (K) and
/// pressure (Pa) at a map position.
pub async fn get_temperature_and_pressure(
    channel: Channel,
    lat: f64,
    lon: f64,
    alt: f64,
) -> Result<dcs::atmosphere::v0::GetTemperatureAndPressureResponse, Status> {
    let mut client = AtmosphereServiceClient::new(channel);
    let resp = client
        .get_temperature_and_pressure(Request::new(
            dcs::atmosphere::v0::GetTemperatureAndPressureRequest {
                position: Some(dcs::common::v0::InputPosition { lat, lon, alt }),
            },
        ))
        .await?;
    Ok(resp.into_inner())
}

// --- WorldService ----------------------------------------------------------

/// `WorldService.GetMarkPanels` — retrieve all active mark panels on the map.
pub async fn get_mark_panels(
    channel: Channel,
) -> Result<dcs::world::v0::GetMarkPanelsResponse, Status> {
    let mut client = WorldServiceClient::new(channel);
    let resp = client
        .get_mark_panels(Request::new(dcs::world::v0::GetMarkPanelsRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `WorldService.GetAirbases` — retrieve all active airbases (airdromes, farps, ships).
pub async fn get_airbases(
    channel: Channel,
) -> Result<dcs::world::v0::GetAirbasesResponse, Status> {
    let mut client = WorldServiceClient::new(channel);
    let resp = client
        .get_airbases(Request::new(dcs::world::v0::GetAirbasesRequest {
            coalition: dcs::common::v0::Coalition::All.into(),
        }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_airbase_parking(
    channel: Channel,
    name: String,
    available: Option<bool>,
) -> Result<dcs::world::v0::GetAirbaseParkingResponse, Status> {
    let mut client = WorldServiceClient::new(channel);
    let resp = client
        .get_airbase_parking(Request::new(dcs::world::v0::GetAirbaseParkingRequest {
            name,
            available,
        }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_airbase_runways(
    channel: Channel,
    name: String,
) -> Result<dcs::world::v0::GetAirbaseRunwaysResponse, Status> {
    let mut client = WorldServiceClient::new(channel);
    let resp = client
        .get_airbase_runways(Request::new(dcs::world::v0::GetAirbaseRunwaysRequest { name }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn set_airbase_coalition(
    channel: Channel,
    name: String,
    coalition: i32,
) -> Result<(), Status> {
    let mut client = WorldServiceClient::new(channel);
    client
        .set_airbase_coalition(Request::new(dcs::world::v0::SetAirbaseCoalitionRequest {
            name,
            coalition,
        }))
        .await?;
    Ok(())
}

// --- SrsService ------------------------------------------------------------

/// `SrsService.GetClients` — list of connected SRS clients.
pub async fn get_srs_clients(
    channel: Channel,
) -> Result<dcs::srs::v0::GetClientsResponse, Status> {
    let mut client = SrsServiceClient::new(channel);
    let resp = client
        .get_clients(Request::new(dcs::srs::v0::GetClientsRequest {}))
        .await?;
    Ok(resp.into_inner())
}

// --- WarehouseService --------------------------------------------------------

/// `WarehouseService.GetInventory` — get the full inventory of an airbase or static object.
pub async fn get_inventory(
    channel: Channel,
    airbase_name: String,
) -> Result<dcs::warehouse::v0::GetInventoryResponse, Status> {
    let mut client = WarehouseServiceClient::new(channel);
    let resp = client
        .get_inventory(Request::new(dcs::warehouse::v0::GetInventoryRequest {
            name: Some(get_inventory_request::Name::AirbaseName(airbase_name)),
        }))
        .await?;
    Ok(resp.into_inner())
}

/// `WarehouseService.AddItem` — add an item to an airbase inventory.
pub async fn add_item(
    channel: Channel,
    airbase_name: String,
    item_name: String,
    count: i32,
) -> Result<(), Status> {
    let mut client = WarehouseServiceClient::new(channel);
    client
        .add_item(Request::new(dcs::warehouse::v0::AddItemRequest {
            name: Some(add_item_request::Name::AirbaseName(airbase_name)),
            item_name,
            count,
        }))
        .await?;
    Ok(())
}

/// `WarehouseService.AddLiquid` — add a liquid to an airbase inventory.
pub async fn add_liquid(
    channel: Channel,
    airbase_name: String,
    liquid_type: i32,
    amount: f64,
) -> Result<(), Status> {
    let mut client = WarehouseServiceClient::new(channel);
    client
        .add_liquid(Request::new(dcs::warehouse::v0::AddLiquidRequest {
            name: Some(add_liquid_request::Name::AirbaseName(airbase_name)),
            liquid_type,
            amount,
        }))
        .await?;
    Ok(())
}

// --- UnitService -----------------------------------------------------------

pub async fn get_unit_life(channel: Channel, name: String) -> Result<dcs::unit::v0::GetLifeResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_life(Request::new(dcs::unit::v0::GetLifeRequest { name })).await?;
    Ok(resp.into_inner())
}

pub async fn get_unit_fuel(channel: Channel, name: String) -> Result<dcs::unit::v0::GetFuelResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_fuel(Request::new(dcs::unit::v0::GetFuelRequest { name })).await?;
    Ok(resp.into_inner())
}

pub async fn get_unit_ammo(channel: Channel, name: String) -> Result<dcs::unit::v0::GetAmmoResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_ammo(Request::new(dcs::unit::v0::GetAmmoRequest { name })).await?;
    Ok(resp.into_inner())
}

pub async fn get_unit_radar(channel: Channel, name: String) -> Result<dcs::unit::v0::GetRadarResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_radar(Request::new(dcs::unit::v0::GetRadarRequest { name })).await?;
    Ok(resp.into_inner())
}

pub async fn set_unit_emission(channel: Channel, name: String, emitting: bool) -> Result<(), Status> {
    let mut client = UnitServiceClient::new(channel);
    client.set_emission(Request::new(dcs::unit::v0::SetEmissionRequest { name, emitting })).await?;
    Ok(())
}

pub async fn get_unit_sensors(channel: Channel, name: String) -> Result<dcs::unit::v0::GetSensorsResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_sensors(Request::new(dcs::unit::v0::GetSensorsRequest { name })).await?;
    Ok(resp.into_inner())
}

pub async fn get_unit_group(channel: Channel, name: String) -> Result<dcs::unit::v0::GetGroupResponse, Status> {
    let mut client = UnitServiceClient::new(channel);
    let resp = client.get_group(Request::new(dcs::unit::v0::GetGroupRequest { name })).await?;
    Ok(resp.into_inner())
}

// --- ControllerService -----------------------------------------------------

pub async fn set_group_roe(channel: Channel, group_name: String, roe_value: i32) -> Result<(), Status> {
    let mut client = ControllerServiceClient::new(channel);
    // Option ID 0 is ROE
    client.set_option(Request::new(dcs::controller::v0::SetOptionRequest {
        name: Some(dcs::controller::v0::set_option_request::Name::GroupName(group_name)),
        option_id: 0,
        value: Some(dcs::controller::v0::set_option_request::Value::IntValue(roe_value)),
    })).await?;
    Ok(())
}

pub async fn set_group_alarm_state(channel: Channel, group_name: String, alarm_state: i32) -> Result<(), Status> {
    let mut client = ControllerServiceClient::new(channel);
    client.set_alarm_state(Request::new(dcs::controller::v0::SetAlarmStateRequest {
        name: Some(dcs::controller::v0::set_alarm_state_request::Name::GroupName(group_name)),
        alarm_state,
    })).await?;
    Ok(())
}

// --- SpotService -----------------------------------------------------------

pub async fn create_laser(channel: Channel, source_unit_name: String, dir_x: f64, dir_y: f64, dir_z: f64, code: u32) -> Result<u32, Status> {
    let mut client = SpotServiceClient::new(channel);
    let resp = client.create_laser(Request::new(dcs::spot::v0::CreateLaserRequest {
        source_unit_name,
        offset: Some(dcs::common::v0::Vector { x: 0.0, y: 0.0, z: 0.0 }), // from unit center
        direction: Some(dcs::common::v0::Vector { x: dir_x, y: dir_y, z: dir_z }),
        code,
    })).await?;
    Ok(resp.into_inner().spot_id)
}

pub async fn create_ir_pointer(channel: Channel, source_unit_name: String, dir_x: f64, dir_y: f64, dir_z: f64) -> Result<u32, Status> {
    let mut client = SpotServiceClient::new(channel);
    let resp = client.create_infra_red(Request::new(dcs::spot::v0::CreateInfraRedRequest {
        source_unit_name,
        offset: Some(dcs::common::v0::Vector { x: 0.0, y: 0.0, z: 0.0 }),
        direction: Some(dcs::common::v0::Vector { x: dir_x, y: dir_y, z: dir_z }),
    })).await?;
    Ok(resp.into_inner().spot_id)
}

pub async fn destroy_spot(channel: Channel, spot_id: u32) -> Result<(), Status> {
    let mut client = SpotServiceClient::new(channel);
    client.destroy(Request::new(dcs::spot::v0::DestroyRequest { spot_id })).await?;
    Ok(())
}

// --- GroupService ----------------------------------------------------------

/// `GroupService.Destroy` — destroy a group.
pub async fn destroy_group(channel: Channel, name: String) -> Result<(), Status> {
    let mut client = GroupServiceClient::new(channel);
    client.destroy(Request::new(dcs::group::v0::DestroyRequest { group_name: name })).await?;
    Ok(())
}

// --- CoalitionService ------------------------------------------------------

pub async fn get_groups(
    channel: Channel,
    coalition: i32,
    category: i32,
) -> Result<dcs::coalition::v0::GetGroupsResponse, Status> {
    let mut client = CoalitionServiceClient::new(channel);
    let resp = client
        .get_groups(Request::new(dcs::coalition::v0::GetGroupsRequest {
            coalition,
            category,
        }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_player_units(
    channel: Channel,
    coalition: i32,
) -> Result<dcs::coalition::v0::GetPlayerUnitsResponse, Status> {
    let mut client = CoalitionServiceClient::new(channel);
    let resp = client
        .get_player_units(Request::new(dcs::coalition::v0::GetPlayerUnitsRequest {
            coalition,
        }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_static_objects(
    channel: Channel,
    coalition: i32,
) -> Result<dcs::coalition::v0::GetStaticObjectsResponse, Status> {
    let mut client = CoalitionServiceClient::new(channel);
    let resp = client
        .get_static_objects(Request::new(dcs::coalition::v0::GetStaticObjectsRequest {
            coalition,
        }))
        .await?;
    Ok(resp.into_inner())
}

pub async fn get_bullseye(
    channel: Channel,
    coalition: i32,
) -> Result<dcs::coalition::v0::GetBullseyeResponse, Status> {
    let mut client = CoalitionServiceClient::new(channel);
    let resp = client
        .get_bullseye(Request::new(dcs::coalition::v0::GetBullseyeRequest {
            coalition,
        }))
        .await?;
    Ok(resp.into_inner())
}

// --- MissionService (server-streaming) -------------------------------------

/// `MissionService.StreamEvents` — open a server stream of mission events. The
/// caller holds the returned [`Streaming`] for the life of the subscription.
pub async fn stream_events(
    channel: Channel,
) -> Result<Streaming<dcs::mission::v0::StreamEventsResponse>, Status> {
    let mut client = MissionServiceClient::new(channel);
    let resp = client
        .stream_events(Request::new(dcs::mission::v0::StreamEventsRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `MissionService.StreamUnits` — open a server stream of unit updates for a
/// single [`GroupCategory`](dcs::common::v0::GroupCategory). Mirrors the legacy
/// Node backend's `{ poll_rate: 1, max_backoff: 1, category }` request.
pub async fn stream_units(
    channel: Channel,
    category: i32,
) -> Result<Streaming<dcs::mission::v0::StreamUnitsResponse>, Status> {
    let mut client = MissionServiceClient::new(channel);
    let resp = client
        .stream_units(Request::new(dcs::mission::v0::StreamUnitsRequest {
            poll_rate: Some(1),
            max_backoff: Some(1),
            category,
        }))
        .await?;
    Ok(resp.into_inner())
}

pub struct GroundGroupSpawn {
    pub country: i32,
    pub name: String,
    pub unit_type: String,
    pub lat: f64,
    pub lon: f64,
    pub heading: u32,
    pub count: u32,
}

pub async fn add_ground_group(channel: Channel, spawn: GroundGroupSpawn) -> Result<(), Status> {
    // Generate a unique suffix using timestamp
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    let unique_name = format!("{}_{}", spawn.name, ts);
    
    // Construct the Lua script
    let mut lua = String::new();
    lua.push_str(&format!("local country_id = {}\n", spawn.country));
    lua.push_str("local cat = Group.Category.GROUND\n");
    lua.push_str(&format!("local group_name = '{}'\n", unique_name.replace("'", "\\'")));
    lua.push_str(&format!("local pos = coord.LLtoLO({}, {})\n", spawn.lat, spawn.lon));
    lua.push_str("local groupData = {\n");
    lua.push_str("  name = group_name,\n");
    lua.push_str("  task = 'Ground Nothing',\n");
    lua.push_str("  route = { points = { [1] = { x = pos.x, y = pos.z, type = 'Turning Point', action = 'Off Road' } } },\n");
    lua.push_str("  units = {\n");
    
    for i in 1..=spawn.count {
        let offset = (i as f64 - 1.0) * 10.0;
        lua.push_str(&format!("    [{}] = {{\n", i));
        lua.push_str(&format!("      name = group_name .. '-unit-{}',\n", i));
        lua.push_str(&format!("      type = '{}',\n", spawn.unit_type.replace("'", "\\'")));
        lua.push_str(&format!("      x = pos.x + {},\n", offset));
        lua.push_str(&format!("      y = pos.z + {},\n", offset));
        lua.push_str(&format!("      heading = {},\n", spawn.heading));
        lua.push_str("      skill = 'High',\n");
        lua.push_str("    },\n");
    }
    lua.push_str("  }\n");
    lua.push_str("}\n");
    lua.push_str("local status, err = pcall(function() coalition.addGroup(country_id, cat, groupData) end)\n");
    lua.push_str("if not status then return 'ERROR: ' .. tostring(err) end\n");
    lua.push_str("local spawned = Group.getByName(group_name)\n");
    lua.push_str("if spawned then return 'OK' else return 'FAILED_TO_SPAWN' end\n");

    let resp = crate::grpc::custom_eval(channel, lua).await?;
    tracing::info!("Spawn result: {}", resp.json);
    if resp.json != "\"OK\"" && resp.json != "OK" {
        return Err(Status::internal(format!("Lua failed: {}", resp.json)));
    }
    Ok(())
}
