//! Thin async wrappers around the DCS-gRPC unary RPCs.
//!
//! This mirrors `web-dashboard/src/lib/grpc.ts`. Each function takes a cheap
//! [`Grpc`] handle (the lazily-connecting client transport plus optional API
//! key held in [`crate::state::AppState`]), builds the generated tonic client,
//! issues one unary call, and returns the decoded response message — or a [`tonic::Status`]
//! that the HTTP layer maps to a JSON error.
//!
//! Unary endpoints return plain scalars/strings, so no serde derives on the
//! generated proto types are required. The server-streaming RPCs
//! (`Mission.StreamEvents` / `Mission.StreamUnits`) at the bottom of this file
//! hand their typed messages to [`crate::proto_json`], which renders
//! proto-loader-compatible JSON at runtime via reflection.

use anyhow::Context;
use tonic::metadata::{Ascii, MetadataValue};
use tonic::service::interceptor::InterceptedService;
use tonic::service::Interceptor;
use tonic::{transport::Channel, Request, Status, Streaming};

use crate::pb::dcs;

use dcs::custom::v0::custom_service_client::CustomServiceClient;
use dcs::hook::v0::hook_service_client::HookServiceClient;
use dcs::metadata::v0::metadata_service_client::MetadataServiceClient;
use dcs::mission::v0::mission_service_client::MissionServiceClient;
use dcs::net::v0::net_service_client::NetServiceClient;
use dcs::trigger::v0::trigger_service_client::TriggerServiceClient;
use dcs::srs::v0::srs_service_client::SrsServiceClient;

// --- Connection handle -----------------------------------------------------

/// Metadata key the DCS-gRPC `AuthInterceptor` reads. tonic requires lowercase
/// metadata names; gRPC metadata is case-insensitive on the wire.
const API_KEY_HEADER: &str = "x-api-key";

/// Cheap-to-clone handle to the DCS-gRPC server: the lazily-connecting
/// [`Channel`] plus the optional API key stamped on every outgoing request.
///
/// When the server runs with `auth.enabled = true` every RPC (unary calls,
/// health checks and long-lived streams alike) must carry an `X-API-Key`
/// header, otherwise it fails with `UNAUTHENTICATED`. Held in
/// [`crate::state::AppState`] and threaded into every wrapper below.
#[derive(Clone)]
pub struct Grpc {
    channel: Channel,
    interceptor: ApiKeyInterceptor,
}

impl Grpc {
    /// Wrap `channel`, attaching `api_key` (the `GRPC_API_KEY` setting) to each
    /// request when present. Fails if the key contains non-ASCII characters.
    pub fn new(channel: Channel, api_key: Option<&str>) -> anyhow::Result<Self> {
        let key = match api_key.map(str::trim).filter(|k| !k.is_empty()) {
            Some(k) => {
                // `MetadataValue<Ascii>` tolerates obs-text bytes, but the server
                // rejects anything non-ASCII with UNAUTHENTICATED; fail early.
                anyhow::ensure!(k.is_ascii(), "GRPC_API_KEY must be a visible-ASCII string");
                let mut value: MetadataValue<Ascii> = k
                    .parse()
                    .context("GRPC_API_KEY must be a visible-ASCII string")?;
                // Keep the secret out of debug output / traces.
                value.set_sensitive(true);
                Some(value)
            }
            None => None,
        };
        Ok(Self {
            channel,
            interceptor: ApiKeyInterceptor { key },
        })
    }

    /// Whether an API key will be attached to outgoing requests.
    pub fn has_api_key(&self) -> bool {
        self.interceptor.key.is_some()
    }

    /// Transport for a generated client: the channel behind the API-key
    /// interceptor.
    fn service(&self) -> InterceptedService<Channel, ApiKeyInterceptor> {
        InterceptedService::new(self.channel.clone(), self.interceptor.clone())
    }
}

/// tonic [`Interceptor`] that inserts the configured `x-api-key` metadata.
#[derive(Clone)]
struct ApiKeyInterceptor {
    key: Option<MetadataValue<Ascii>>,
}

impl Interceptor for ApiKeyInterceptor {
    fn call(&mut self, mut req: Request<()>) -> Result<Request<()>, Status> {
        if let Some(key) = &self.key {
            req.metadata_mut().insert(API_KEY_HEADER, key.clone());
        }
        Ok(req)
    }
}

// --- MetadataService -------------------------------------------------------

/// `MetadataService.GetHealth` — server liveness reported by DCS itself.
pub async fn get_health(conn: Grpc) -> Result<dcs::metadata::v0::GetHealthResponse, Status> {
    let mut client = MetadataServiceClient::new(conn.service());
    let resp = client
        .get_health(Request::new(dcs::metadata::v0::GetHealthRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `MetadataService.GetVersion` — DCS-gRPC server version string.
pub async fn get_version(
    conn: Grpc,
) -> Result<dcs::metadata::v0::GetVersionResponse, Status> {
    let mut client = MetadataServiceClient::new(conn.service());
    let resp = client
        .get_version(Request::new(dcs::metadata::v0::GetVersionRequest {}))
        .await?;
    Ok(resp.into_inner())
}

// --- NetService ------------------------------------------------------------

/// `NetService.GetPlayers` — list of connected players.
pub async fn get_players(
    conn: Grpc,
) -> Result<dcs::net::v0::GetPlayersResponse, Status> {
    let mut client = NetServiceClient::new(conn.service());
    let resp = client
        .get_players(Request::new(dcs::net::v0::GetPlayersRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `NetService.KickPlayer` — kick a connected player.
pub async fn kick_player(conn: Grpc, id: u32, message: String) -> Result<(), Status> {
    let mut client = NetServiceClient::new(conn.service());
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
pub async fn send_chat(conn: Grpc, message: String, coalition: i32) -> Result<(), Status> {
    let mut client = NetServiceClient::new(conn.service());
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
    conn: Grpc,
) -> Result<dcs::hook::v0::GetMissionNameResponse, Status> {
    let mut client = HookServiceClient::new(conn.service());
    let resp = client
        .get_mission_name(Request::new(dcs::hook::v0::GetMissionNameRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `HookService.GetPaused` — whether the mission is paused.
pub async fn get_paused(conn: Grpc) -> Result<dcs::hook::v0::GetPausedResponse, Status> {
    let mut client = HookServiceClient::new(conn.service());
    let resp = client
        .get_paused(Request::new(dcs::hook::v0::GetPausedRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `HookService.SetPaused` — pause/unpause the running mission.
pub async fn set_paused(conn: Grpc, paused: bool) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
    client
        .set_paused(Request::new(dcs::hook::v0::SetPausedRequest { paused }))
        .await?;
    Ok(())
}

/// `HookService.StopMission` — stop the running mission.
pub async fn stop_mission(conn: Grpc) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
    client
        .stop_mission(Request::new(dcs::hook::v0::StopMissionRequest {}))
        .await?;
    Ok(())
}

/// `HookService.ReloadCurrentMission` — reload the active mission.
pub async fn reload_current_mission(conn: Grpc) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
    client
        .reload_current_mission(Request::new(
            dcs::hook::v0::ReloadCurrentMissionRequest {},
        ))
        .await?;
    Ok(())
}

/// `HookService.LoadMission` — load a specific `.miz` by full path.
pub async fn load_mission(conn: Grpc, file_name: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
    client
        .load_mission(Request::new(dcs::hook::v0::LoadMissionRequest { file_name }))
        .await?;
    Ok(())
}

/// `HookService.BanPlayer` — ban a player by ID.
pub async fn ban_player(conn: Grpc, id: u32, period: u32, reason: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
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
pub async fn unban_player(conn: Grpc, ucid: String) -> Result<(), Status> {
    let mut client = HookServiceClient::new(conn.service());
    client
        .unban_player(Request::new(dcs::hook::v0::UnbanPlayerRequest { ucid }))
        .await?;
    Ok(())
}

/// `HookService.GetBannedPlayers` — get list of banned players.
pub async fn get_banned_players(conn: Grpc) -> Result<dcs::hook::v0::GetBannedPlayersResponse, Status> {
    let mut client = HookServiceClient::new(conn.service());
    let resp = client
        .get_banned_players(Request::new(dcs::hook::v0::GetBannedPlayersRequest {}))
        .await?;
    Ok(resp.into_inner())
}

// --- CustomService ---------------------------------------------------------

/// `CustomService.Eval` — evaluate Lua in the mission environment; the result
/// is returned as a JSON string. Disabled by default on the DCS-gRPC server.
pub async fn custom_eval(
    conn: Grpc,
    lua: String,
) -> Result<dcs::custom::v0::EvalResponse, Status> {
    let mut client = CustomServiceClient::new(conn.service());
    let resp = client
        .eval(Request::new(dcs::custom::v0::EvalRequest { lua }))
        .await?;
    Ok(resp.into_inner())
}

// --- TriggerService --------------------------------------------------------

/// `TriggerService.GetUserFlag` — read a mission user flag value.
pub async fn get_user_flag(
    conn: Grpc,
    flag: String,
) -> Result<dcs::trigger::v0::GetUserFlagResponse, Status> {
    let mut client = TriggerServiceClient::new(conn.service());
    let resp = client
        .get_user_flag(Request::new(dcs::trigger::v0::GetUserFlagRequest { flag }))
        .await?;
    Ok(resp.into_inner())
}

/// `TriggerService.SetUserFlag` — set a mission user flag value.
pub async fn set_user_flag(conn: Grpc, flag: String, value: u32) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(conn.service());
    client
        .set_user_flag(Request::new(dcs::trigger::v0::SetUserFlagRequest {
            flag,
            value,
        }))
        .await?;
    Ok(())
}

/// `TriggerService.OutText` — display text on everyone's screen.
pub async fn out_text(conn: Grpc, text: String, display_time: u32, clear_view: bool) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(conn.service());
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
pub async fn out_text_for_coalition(conn: Grpc, coalition: i32, text: String, display_time: u32, clear_view: bool) -> Result<(), Status> {
    let mut client = TriggerServiceClient::new(conn.service());
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
    conn: Grpc,
) -> Result<dcs::srs::v0::GetClientsResponse, Status> {
    let mut client = SrsServiceClient::new(conn.service());
    let resp = client
        .get_clients(Request::new(dcs::srs::v0::GetClientsRequest {}))
        .await?;
    Ok(resp.into_inner())
}

// --- MissionService (server-streaming) -------------------------------------

/// `MissionService.StreamEvents` — open a server stream of mission events. The
/// caller holds the returned [`Streaming`] for the life of the subscription.
pub async fn stream_events(
    conn: Grpc,
) -> Result<Streaming<dcs::mission::v0::StreamEventsResponse>, Status> {
    let mut client = MissionServiceClient::new(conn.service());
    let resp = client
        .stream_events(Request::new(dcs::mission::v0::StreamEventsRequest {}))
        .await?;
    Ok(resp.into_inner())
}

/// `MissionService.StreamUnits` — open a server stream of unit updates for a
/// single [`GroupCategory`](dcs::common::v0::GroupCategory). Mirrors the legacy
/// Node backend's `{ poll_rate: 1, max_backoff: 1, category }` request.
pub async fn stream_units(
    conn: Grpc,
    category: i32,
) -> Result<Streaming<dcs::mission::v0::StreamUnitsResponse>, Status> {
    let mut client = MissionServiceClient::new(conn.service());
    let resp = client
        .stream_units(Request::new(dcs::mission::v0::StreamUnitsRequest {
            poll_rate: Some(1),
            max_backoff: Some(1),
            category,
        }))
        .await?;
    Ok(resp.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handle(key: Option<&str>) -> Grpc {
        let channel = Channel::from_static("http://127.0.0.1:1").connect_lazy();
        Grpc::new(channel, key).expect("valid key")
    }

    #[tokio::test]
    async fn interceptor_adds_api_key_header() {
        let grpc = handle(Some("  secret-token  "));
        assert!(grpc.has_api_key());
        let mut interceptor = grpc.interceptor.clone();
        let req = interceptor.call(Request::new(())).unwrap();
        let value = req.metadata().get(API_KEY_HEADER).expect("header present");
        assert_eq!(value.to_str().unwrap(), "secret-token");
        assert!(value.is_sensitive());
    }

    #[tokio::test]
    async fn interceptor_is_noop_without_key() {
        for key in [None, Some(""), Some("   ")] {
            let grpc = handle(key);
            assert!(!grpc.has_api_key());
            let mut interceptor = grpc.interceptor.clone();
            let req = interceptor.call(Request::new(())).unwrap();
            assert!(req.metadata().get(API_KEY_HEADER).is_none());
        }
    }

    #[tokio::test]
    async fn non_ascii_key_is_rejected() {
        let channel = Channel::from_static("http://127.0.0.1:1").connect_lazy();
        assert!(Grpc::new(channel, Some("clé")).is_err());
    }
}
