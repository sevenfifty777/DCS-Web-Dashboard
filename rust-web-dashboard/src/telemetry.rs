//! Background telemetry producers: persistent gRPC streams fanned out to SSE.
//!
//! A single upstream `Mission.StreamEvents` stream and four `Mission.StreamUnits`
//! streams (one per group category) run for the life of the process. Each
//! decoded message is rendered to proto-loader-compatible JSON (see
//! [`crate::proto_json`]) and published on a [`tokio::sync::broadcast`] channel.
//! SSE handlers subscribe to those channels, so N dashboard clients share one
//! upstream stream each — minimizing load on the DCS-gRPC server.
//!
//! The tasks reconnect with capped exponential backoff because the DCS-gRPC
//! server restarts whenever the DCS mission/world reloads.

use std::time::Duration;

use tokio::sync::broadcast;
use tokio_stream::StreamExt;
use tonic::transport::Channel;

use crate::grpc;
use crate::pb::dcs;
use crate::proto_json;

/// Fully-qualified protobuf type names used for reflection-based JSON.
const EVENTS_TYPE: &str = "dcs.mission.v0.StreamEventsResponse";
const UNITS_TYPE: &str = "dcs.mission.v0.StreamUnitsResponse";

/// Reconnect backoff bounds.
const BACKOFF_START: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);

/// Spawn all long-lived telemetry producer tasks.
///
/// One task drives `StreamEvents`; four tasks drive `StreamUnits` (one per
/// [`GroupCategory`](dcs::common::v0::GroupCategory)), all publishing to the
/// shared `units_tx` channel — mirroring the four explicit subscriptions the
/// original Next.js radar route opened.
pub fn spawn(
    channel: Channel,
    events_tx: broadcast::Sender<String>,
    units_tx: broadcast::Sender<String>,
    config: std::sync::Arc<crate::config::Config>,
) {
    tokio::spawn(run_events(channel.clone(), events_tx, config));

    use dcs::common::v0::GroupCategory::{Airplane, Ground, Helicopter, Ship};
    for category in [Airplane, Helicopter, Ground, Ship] {
        tokio::spawn(run_units(channel.clone(), units_tx.clone(), category as i32));
    }
}

/// Hold `Mission.StreamEvents`, publishing each event as JSON. Reconnects with
/// backoff when the stream ends or errors.
async fn run_events(channel: Channel, tx: broadcast::Sender<String>, config: std::sync::Arc<crate::config::Config>) {
    let mut backoff = BACKOFF_START;
    let graveyard_path = config.dcs_saved_games_dir.join("Logs").join("graveyard.json");

    loop {
        match grpc::stream_events(channel.clone()).await {
            Ok(mut stream) => {
                backoff = BACKOFF_START;
                loop {
                    match stream.next().await {
                        Some(Ok(msg)) => {
                            use crate::pb::dcs::mission::v0::stream_events_response::Event;
                            use crate::pb::dcs::common::v0::{Target, Initiator};
                            
                            if let Some(event) = &msg.event {
                                match event {
                                    Event::Dead(dead_event) => {
                                        if let Some(Initiator { initiator: Some(crate::pb::dcs::common::v0::initiator::Initiator::Unit(unit)) }) = &dead_event.initiator {
                                            if let Some(pos) = &unit.position {
                                                let wreck = crate::graveyard::Wreck {
                                                    id: unit.id,
                                                    lat: pos.lat,
                                                    lon: pos.lon,
                                                    alt: pos.alt,
                                                    coalition: unit.coalition,
                                                    unit_type: unit.r#type.clone().unwrap_or_default(),
                                                    time: msg.time,
                                                };
                                                let mut graveyard = crate::graveyard::Graveyard::load_or_default(&graveyard_path);
                                                let _ = graveyard.add_wreck(&graveyard_path, wreck);
                                            }
                                        }
                                    },
                                    Event::Kill(kill_event) => {
                                        if let Some(Target { target: Some(crate::pb::dcs::common::v0::target::Target::Unit(unit)) }) = &kill_event.target {
                                            if let Some(pos) = &unit.position {
                                                let wreck = crate::graveyard::Wreck {
                                                    id: unit.id,
                                                    lat: pos.lat,
                                                    lon: pos.lon,
                                                    alt: pos.alt,
                                                    coalition: unit.coalition,
                                                    unit_type: unit.r#type.clone().unwrap_or_default(),
                                                    time: msg.time,
                                                };
                                                let mut graveyard = crate::graveyard::Graveyard::load_or_default(&graveyard_path);
                                                let _ = graveyard.add_wreck(&graveyard_path, wreck);
                                            }
                                        }
                                    },
                                    _ => {}
                                }
                            }

                            match proto_json::to_sse_json(&msg, EVENTS_TYPE) {
                                Ok(json) => {
                                    // Err == no subscribers; dropping is intentional.
                                    let _ = tx.send(json);
                                }
                                Err(err) => {
                                    tracing::warn!(%err, "failed to encode StreamEvents message");
                                }
                            }
                        }
                        Some(Err(status)) => {
                            tracing::warn!(%status, "StreamEvents stream error; reconnecting");
                            break;
                        }
                        None => {
                            tracing::info!("StreamEvents stream ended; reconnecting");
                            break;
                        }
                    }
                }
            }
            Err(status) => {
                tracing::warn!(%status, "failed to open StreamEvents; retrying");
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}

/// Hold one `Mission.StreamUnits` category subscription, publishing each unit
/// update as JSON. Reconnects with backoff.
async fn run_units(channel: Channel, tx: broadcast::Sender<String>, category: i32) {
    let mut backoff = BACKOFF_START;
    loop {
        match grpc::stream_units(channel.clone(), category).await {
            Ok(mut stream) => {
                backoff = BACKOFF_START;
                loop {
                    match stream.next().await {
                        Some(Ok(msg)) => match proto_json::to_sse_json(&msg, UNITS_TYPE) {
                            Ok(json) => {
                                let _ = tx.send(json);
                            }
                            Err(err) => {
                                tracing::warn!(
                                    %err,
                                    category,
                                    "failed to encode StreamUnits message"
                                );
                            }
                        },
                        Some(Err(status)) => {
                            tracing::warn!(
                                %status,
                                category,
                                "StreamUnits stream error; reconnecting"
                            );
                            break;
                        }
                        None => {
                            tracing::info!(category, "StreamUnits stream ended; reconnecting");
                            break;
                        }
                    }
                }
            }
            Err(status) => {
                tracing::warn!(%status, category, "failed to open StreamUnits; retrying");
            }
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(BACKOFF_MAX);
    }
}
