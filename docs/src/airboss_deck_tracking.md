# Airboss Deck Tracking Implementation Plan

## Objective

Keep aircraft stable in Carrier and Tarawa deck views while their ships move in
DCS. Ship position, ship heading, and aircraft position must be transformed from
one coherent DCS simulation frame before the canvas is redrawn.

## Evidence baseline

The initial live radar trace on 2026-08-24 showed synchronized carrier and
parked-aircraft timestamps, but a later capture demonstrated that this is not a
stable guarantee: four category streams produced 34 distinct timestamps in ten
seconds. Ship and aircraft positions must therefore be synchronized by time and
velocity in the dashboard rather than grouped only by exact timestamp.

## Phase 1: coherent deck snapshots

Status: corrected locally after live regression testing.

- Retain the `StreamUnitsResponse.time` value with every unit sample.
- Batch each short SSE arrival burst into one React state update.
- Project ship and aircraft positions to the newer of their two simulation times
  using the DCS velocity vectors before calculating deck-relative position.
- Prefer exact ship unit or group names and allow proximity fallback only for
  units in `GROUP_CATEGORY_SHIP`.
- Use the selected ship unit's position and orientation from the same radar
  sample for the deck transform.
- Assign each aircraft to its nearest ship so it can be rendered on only one
  deck view.
- Render owned aircraft inside the physical deck envelope even when no parking
  definition is close enough to snap it to a spot.
- Calculate smoothing response from aircraft velocity relative to ship velocity.
- Share the same tracking implementation between Carrier and Tarawa.
- Return HTTP 502 when a world endpoint cannot complete its DCS-gRPC request.

Acceptance criteria:

- Staggered ship and aircraft samples are projected to one simulation time before
  the deck transform.
- A nearby aircraft cannot be selected as the tracked carrier.
- One aircraft cannot appear in both Carrier and Tarawa deck views.
- An aircraft inheriting the ship's world velocity has zero relative speed.
- Unit tests cover frame commits, departures, ship selection, coordinate
  transforms, and relative velocity.

## Phase 2: render interpolation

Status: planned after Phase 1 live validation.

- Retain the two latest complete radar snapshots.
- Render on `requestAnimationFrame` using a short interpolation delay.
- Interpolate world position and heading before converting to deck coordinates.
- Handle heading wraparound at 0/360 degrees and reset history on mission-time
  rollback or stream reconnect.
- Keep parking snap based on local deck distance and relative speed.

Acceptance criteria:

- Taxiing aircraft move continuously between one-second DCS updates.
- A parked aircraft has no one-frame displacement when the carrier update arrives.
- Reconnects and mission restarts do not interpolate across unrelated snapshots.

## Phase 3: live validation

Status: pending deployment.

- Capture at least 60 seconds each on CVN-72 and Tarawa with a parked aircraft.
- Capture a taxi or launch sequence on each available deck type.
- Record DCS timestamp, ship ID, relative forward/right position, and rendered
  position without recording player names or authentication data.
- Compare raw relative-position variation with rendered variation.

Acceptance criteria:

- No visible alternating displacement caused by partial radar frames.
- Parked-aircraft movement stays below one rendered pixel during steady sailing.
- Ship identity remains stable for the complete capture.

## Out of scope

- Increasing the DCS-gRPC `poll_rate` before the synchronized-frame fix is
  validated.
- Changing DCS mission scripts or `.miz` files.
- Replacing hardcoded ship-local parking definitions in this iteration.
