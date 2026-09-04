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

use dcs::custom::v0::custom_service_client::CustomServiceClient;
use dcs::hook::v0::hook_service_client::HookServiceClient;
use dcs::metadata::v0::metadata_service_client::MetadataServiceClient;
use dcs::mission::v0::mission_service_client::MissionServiceClient;
use dcs::net::v0::net_service_client::NetServiceClient;
use dcs::trigger::v0::trigger_service_client::TriggerServiceClient;
use dcs::srs::v0::srs_service_client::SrsServiceClient;

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
