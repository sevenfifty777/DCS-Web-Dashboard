# Radar Map Accuracy — Investigation Findings

Status: **investigation closed. No code change made** (a projection layer was built, then
reverted — see "The wrong turn" below).
Scope: `web-dashboard/src/components/Map.tsx` (radar page).

---

## Conclusion

**DCS's `coord.LOtoLL` is accurate, and the dashboard's coordinate handling is correct.**
Markers appear offset from runways on the satellite basemap because **DCS terrain does not
match the real world**, not because of any coordinate error.

No transform can fix this. The DCS Caucasus is a stylised approximation of the real
Caucasus; its runways are physically in different places than their real-world
counterparts. Reprojecting coordinates cannot reconcile two different worlds.

---

## Evidence (measured against a live server, Caucasus, DCS-gRPC 0.9.2)

`coord.LOtoLL` sampled directly via `/api/console`:

| DCS x (north) | DCS z (east) | `LOtoLL` result |
|---|---|---|
| 0 | 0 | 45.129497060329, 34.265515188456 |
| 100000 | 0 | 46.029374621754, 34.285897144590 |
| 0 | 100000 | 45.108338765466, 35.536236363599 |
| -5412.409668 | 243128.820313 | 45.004948080856, 37.347824981898 |

Compared against a Transverse Mercator projection built from pydcs's Caucasus parameters
(`lon_0=33`, `k0=0.9996`, `x_0=-99516.9999999732`, `y_0=-4998114.999999984`, WGS84):

**Maximum disagreement across all sampled points: 5 millimetres.**

`LOtoLL` *is* that projection. There is nothing to correct.

---

## The wrong turn (recorded so it isn't repeated)

The original diagnosis claimed `LOtoLL` was 0.6–1.7 km inaccurate. That was wrong, and the
error is instructive.

It came from comparing **pydcs's airfield coordinate table** against real-world airfield
positions and attributing the gap to `LOtoLL`. In fact:

| Source | Anapa-Vityazevo DCS coords |
|---|---|
| Live DCS (`Airbase.getByName(...):getPoint()`) | `x = -4447.79, z = 244021.98` |
| pydcs `caucasus/airports.py` | `x = -5412.41, z = 243128.82` |

**pydcs's table is stale** — ED moved the airfield in a Caucasus terrain update. The ~1.3 km
"projection error" was really the difference between two vintages of DCS terrain data.

The corroborating source used at the time (`sneaker`'s `data/airbases/caucasus.json`)
agreed with pydcs, which looked like confirmation but was not: both were harvested from a
similarly-aged DCS install. Two stale sources agreeing is not evidence.

**Lesson:** validate coordinate assumptions against the *running* DCS instance, not against
third-party tables. A single `/api/console` call with `coord.LOtoLL` would have settled it
before any code was written.

---

## What was built and reverted

A full per-theatre Transverse Mercator layer (`projection.rs`, theatre polling via
`World.GetTheatre`, outbound reprojection of units/marks/airbases/zones, and inbound
conversion for map clicks). It was correct code — 13 tests, matching pydcs to 1e-9° — but
it computed a transformation identical to what DCS already performs, making it a no-op that
added a background poller, a `CustomService.Eval` dependency on the click path, and extra
failure surface. Reverted in full.

---

## Implications for the original concerns

- **Ground unit placement** — already correct in DCS's own frame. Never misplaced.
- **Smoke / marks / spawns** — already correct. A click at a given lat/lon has always
  resolved to the right DCS point; `trigger.lua` applies `coord.LLtoLO`, the exact inverse
  of what the map displays.
- **Visual offset against satellite imagery** — real, and caused by DCS terrain differing
  from the real world. Only addressable by changing the basemap (below).

---

## The only real fix, if map alignment matters

Replace the real-world basemap (OSM / ArcGIS / Carto) with **tiles rendered from DCS
terrain itself**. Then map imagery and unit positions come from the same world and agree by
construction.

This is a substantial piece of work — per-theatre tile generation, hosting, and a tile
pipeline — and should only be undertaken if visual alignment against imagery is genuinely
required. For a tactical picture (relative positions, bearings, ranges between units) the
current map is already correct, because every object is drawn in the same consistent frame.

Note that DCS Liberation and sneaker both live with this same offset: they plot DCS
coordinates on real-world basemaps and accept that the terrain does not line up.

---

## Ideas not pursued (independent of the above)

These were identified during the investigation and remain open; none relate to accuracy.

- **Latency.** `grpc.rs` polls at `poll_rate: 1` (1 s); a 500 kt jet is up to ~260 m stale.
  The fork supports `poll_rate_ms` (sub-second, 50 ms floor), but the dashboard's proto copy
  predates the field and would need re-syncing. Note each poll is a per-unit mission
  round-trip, so faster rates cost DCS server FPS. Cosmetic only — stationary ground units
  are unaffected.
- **Icon rotation.** `getIcon` hardcodes `rotate(0deg)` (`Map.tsx:112`), so aircraft always
  point north. `Orientation.yaw` is the correct field to use: the server computes it as
  `heading - projection_error` where `projection_error` is derived from a point one degree
  due true north, making `yaw` already a true-north heading (see
  `rust-server/stubs/src/common.rs:41-53`). Do **not** add a further convergence correction
  on top of `yaw`.
- **Interpolation.** Markers step once per poll rather than gliding. `velocity` is already
  streamed and unused by the map.
