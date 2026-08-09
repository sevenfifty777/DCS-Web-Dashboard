//! Server-Sent Events endpoints bridging the telemetry broadcast channels to
//! the browser/Android `EventSource` clients.
//!
//! These mirror the original `/api/events/stream` and `/api/radar/stream`
//! Next.js routes: public (an `EventSource` cannot send an `Authorization`
//! header) and emitting `data: <json>\n\n` frames. Each client subscribes to a
//! shared broadcast channel, so many clients share one upstream gRPC stream.

use std::convert::Infallible;

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use tokio::sync::broadcast;
use tokio_stream::wrappers::{errors::BroadcastStreamRecvError, BroadcastStream};
use tokio_stream::{Stream, StreamExt};

use crate::state::AppState;

/// `GET /api/events/stream` — mission events as SSE.
pub async fn events_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    Sse::new(broadcast_sse(state.events_tx.subscribe())).keep_alive(KeepAlive::default())
}

/// `GET /api/radar/stream` — unit position updates as SSE.
pub async fn radar_stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    Sse::new(broadcast_sse(state.units_tx.subscribe())).keep_alive(KeepAlive::default())
}

/// Adapt a telemetry broadcast receiver into an SSE event stream, dropping any
/// frames lost to a lagging (slow) client.
fn broadcast_sse(
    rx: broadcast::Receiver<String>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    BroadcastStream::new(rx).filter_map(|frame| match frame {
        Ok(json) => Some(Ok(Event::default().data(json))),
        Err(BroadcastStreamRecvError::Lagged(_)) => None,
    })
}
