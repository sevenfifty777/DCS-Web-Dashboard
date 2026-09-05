# Airboss Multi-Carrier Plan

Status: proposed 2026-09-05 and implemented the same day on branch `carrier-recovery` (Phases A to
D). Phase E (VSTOL doctrine, per-type geometry) and the live validation checklist remain open.
Builds on the stand-alone carrier recovery controller (see
[Carrier Recovery Without Foothold Plan](./carrier_recovery_standalone_plan.md)), which already
accepts any group name and was confirmed working on CVN-72 and CVN-74 in a Foothold mission.

Where things landed:

| Item | Location |
| --- | --- |
| Lua: `classifyDeck`, `listCarriers`, `windReports`, `groupOverrides` / `setGroupOverrides`, `config(groupName)`, `phase` | `rust-web-dashboard/lua/carrier_recovery.lua`, version `1.1.0` |
| Rust routes | `GET /api/airboss/carriers`, `GET /api/airboss?names=`, `POST /api/airboss/config` in `rust-web-dashboard/src/routes/dcs.rs`; script builders and 9 new Lua tests in `src/carrier_recovery.rs` (`cargo test carrier_recovery`, 27 tests) |
| Deck profiles | `web-dashboard/src/app/airboss/deckProfiles.ts` (`nimitz`, `tarawa`, `generic-catobar`, `generic-vstol`) |
| Renderers | `deckRenderer.ts` (`drawDeckView`, `drawDeckRouteFlow`) and `wheelRenderer.ts` (`drawWindWheel`), smoke-tested against a stub 2D context in `deckRenderer.test.ts` |
| Panels | `CarrierPanel.tsx` (per ship), `PlannerPanel.tsx` (manual planner), `useCarrierList.ts` (detection + radar-triggered refresh), `carrierDetection.ts`, `carrierPersistence.ts`, `airbossApi.ts`; `page.tsx` is the coordinator (radar stream, batched poll, layout persistence) |
| Tests | `node --test "src/app/airboss/*.test.ts"` (48 tests) |

Deviations from the plan text below:

- **Attribute strings verified on the live server** (Phase A step 1, done after the first
  deployment) and the D1 table corrected. What DCS actually reports on `getDesc().attributes`:

  | Hull | Relevant attributes |
  | --- | --- |
  | CVN-72 `CVN_72`, CVN-74 `Stennis` | `Aircraft Carriers`, `AircraftCarrier`, `AircraftCarrier With Catapult`, `AircraftCarrier With Arresting Gear`, `catapult`, `Arresting Gear`, `ACLS`, `Link4` |
  | LHA-1 Tarawa `LHA_Tarawa` | `Aircraft Carriers`, `AircraftCarrier`, `AircraftCarrier With Tramplin`, `ski_jump` (no helicopter attribute at all) |
  | HMS Invincible mod `hms_invincible` | identical to the Tarawa set (the mod copied it), so it classifies `vstol` on attributes alone |
  | Moskva `MOSCOW`, Neustrashimy `NEUSTRASH`, Arleigh Burke `USS_Arleigh_Burke_IIa`, Perry `PERRY`, HMS Ariadne `leander-gun-ariadne` | `HelicopterCarrier` (a helipad flag), `Cruisers` / `Frigates` |
  | Rezky, Molniya, Grisha, La Combattante, Type 021, speedboats | nothing carrier-related |

  Confirmed on a second mission (Foothold Syria, 2026-09-05) after deploying module 1.1.1: exactly
  the two CVNs, the Tarawa and the HMS Invincible were listed, with the right classes, and every
  helipad-only warship was excluded. That mission names the Invincible group "Tarawa", which the
  old hard-coded page would have drawn with the Tarawa deck; the profile now follows the type name.
- **Late-activated placeholders** (module 1.1.2): the Foothold Syria mission carries an LHA-1
  Tarawa group named "FOB ALPHA" that Foothold may spawn later. For the scripting engine it
  exists (`isExist()` true, it has a position and a life value) but `Unit.isActive()` is false and
  it is on nobody's F10 map. `listCarriers` skips inactive lead units and `windData` treats them as
  unavailable, so the panel list only shows ships that are in the world; when the mission activates
  one, it appears in the radar stream and triggers the automatic list refresh.

  The first rule (helipad means VSTOL) therefore listed three warships and put the Tarawa in
  `stobar`. The rule now is: catapult means `catobar`; arresting gear without catapult means
  `stobar` (the Kuznetsov's expected `AircraftCarrier With Tramplin` plus wires); any other
  fixed-wing deck attribute (`Aircraft Carriers`, `AircraftCarrier`, `AircraftCarrier With
  Tramplin`, `ski_jump`) means `vstol`; `HelicopterCarrier` or `Landing Ships` counts only when the
  type name also hints at a carrier (modded LHDs), otherwise the ship is not listed; a type-name
  hint alone means `unknown`. The Kuznetsov set is still an expectation, not a measurement: check it
  with `return Unit.getByName("<unit>"):getDesc().attributes` on the Console page the first time
  one is in a mission and correct `CarrierRecovery.deckAttributes` if needed.
- Validation checklist items 1 (detection and one batched request), 5 (one Eval for several
  synced ships) and the target-isolation part of 7 were confirmed on the live Foothold mission
  on 2026-09-05: CVN-72 (Foothold), CVN-74 and Tarawa detected; `GET /api/airboss?names=` returned
  all of them plus a clean error for an unknown name; setting CVN-74 to 26 kt left CVN-72 at 24 kt
  and did not touch `CarrierRecoveryTargetWodKt`; out-of-range values are rejected with 400.
- The Sync checkbox drives the batched poll only; the deck view and the wheel's actual heading
  always come from the radar stream, as designed. The wheel's "not synced" state keeps the last
  wind received while the panel was synced.
- The lost state: while a panel is synced the controller poll is the authority, so the ship is
  lost only when the poll answers "not available"; unsynced, it is lost when the stream carried
  the ship before and dropped it. The tag shows the time the ship disappeared. This matters
  because the radar stream only broadcasts unit **changes** from the moment the browser connects
  (the backend does not replay a snapshot), so a stationary ship such as the Foothold "FOB ALPHA"
  Tarawa never appears in it; its panel then draws the deck from the controller's position and
  heading, tagged "STATIC · HEADING FROM CONTROLLER", and cannot show parked aircraft. Replaying
  the last known frame per unit to new SSE subscribers would lift that limit for the radar page
  too and is left as a follow-up.
- The Target WOD value is persisted only once the user changes it; until then the panel shows the
  controller's reported target so a reload does not pin the mission default as an override.
- `docs/src/openapi.json` was regenerated; `docs/book/` (the built book) was left as is.

## Goal

1. Detect every carrier-type group in the running mission automatically: CVN and CV classes, LHA-1
   Tarawa, Kuznetsov, and modded hulls such as the HMS Invincible or Essex, without hard-coded
   names or a text box.
2. Give each carrier its own panel: the wind "wheel" on top and the corresponding deck view under it.
3. Let the user choose which carriers to monitor and control. Each panel has its own **Sync**
   checkbox and its own Carrier Actions, so an unwatched carrier costs no data flow at all.
4. Keep VSTOL carriers (straight deck) working with today's solver at a 0 degree offset. Their
   specific recovery doctrine and deck geometry are a later phase.

## Current state

| Area | Today |
| --- | --- |
| Carrier identity | Two hard-coded slots in `page.tsx`: `carrierNameInput` (default `CVN-72`) and `tarawaNameInput` (default `Tarawa`). Every piece of per-ship state exists twice (`carrierPos`/`tarawaPos`, `carrierUnitId`/`tarawaUnitId`, refs, smoothed positions). `DeckId` in `deckRoutes.ts` is the union `'carrier' \| 'tarawa'`. |
| Deck geometry | `drawDeckView` is already parameterised (image, length in metres, image rotation, spots, routes) but is called twice with literals: Nimitz 332 m with `NIMITZ_*` tables, Tarawa 254 m with `TARAWA_*` tables. |
| Wind wheel | One 660 px canvas fed by the global sliders, or by the CVN telemetry when Auto-Sync is on. The Tarawa has no wheel. |
| Data flow | `GET /api/airboss?name=` polled every 2 s per named ship while Auto-Sync is on (one DCS-gRPC Eval each). The radar SSE stream is opened once and already carries **every ship** with `type`, `name`, `group.name`, `group.category`, position, heading and velocity, at no extra DCS cost (the backend holds one `StreamUnits` subscription per category for the life of the process). |
| Controller | `CarrierRecovery` (Lua) is per group name. Deck offset is chosen by a type-name pattern list (`straightDeckTypes`). `POST /api/airboss/action` takes `carrier`. |

Two facts drive the design: the radar stream is free, and the ship's own position, heading and
speed are already in it. The 2 s poll is only needed for the wind at the ship and the controller's
plan.

## Design decisions

### D1. Detection: DCS attributes in Lua once, radar stream for liveness

Add `CarrierRecovery.listCarriers()` to the Lua module. It walks `coalition.getGroups(side,
Group.Category.SHIP)` for both coalitions, reads the lead unit's `getDesc().attributes` and type
name, and classifies:

| `deck_class` | Rule (attributes from `Unit.getDesc`, as verified live, see the deviations above) | Examples |
| --- | --- | --- |
| `catobar` | `AircraftCarrier With Catapult` | CVN-71/72/73/75, Stennis, Forrestal |
| `stobar` | `AircraftCarrier With Arresting Gear` without catapult | Kuznetsov (expected) |
| `vstol` | `Aircraft Carriers`, `AircraftCarrier`, `AircraftCarrier With Tramplin` or `ski_jump` with neither catapult nor wires; or `HelicopterCarrier` / `Landing Ships` on a hull whose type name hints at a carrier | LHA-1 Tarawa, HMS Invincible, Juan Carlos, Type 071 |
| `unknown` | Type-name hint matched (`CV`, `CVN`, `LHA`, `Carrier`, `Invincible`, `Essex`, `Ark`, ...) but no attribute matched | modded hulls with unusual attributes |

Ships with none of the above are not returned; in particular a bare `HelicopterCarrier` (the DCS
helipad flag carried by the Moskva, Neustrashimy and Arleigh Burke) is not a carrier. Mod authors
are inconsistent, so the classification table lives in one Lua function and is cheap to correct.

The page calls this once on load and on a **Refresh** button. Between refreshes the radar stream
keeps the list live: a carrier that dies disappears from the stream and its panel greys out; a ship
whose group is not in the list and whose type name matches a carrier hint triggers one automatic
refresh (rate-limited to once per 30 s). This keeps DCS-gRPC cost at one Eval per page load.

### D2. One deck profile registry instead of two code paths

New `deckProfiles.ts` maps a DCS type name (with a fallback on `deck_class`) to everything the
renderer needs: image file, length in metres, image rotation, canvas width, parking spots, launch
routes, and the deck offset shown in the wheel. Existing data moves in unchanged:

| Profile | Types | Data |
| --- | --- | --- |
| `nimitz` | `CVN_71`, `CVN_72`, `CVN_73`, `CVN_75`, `Stennis` | today's Nimitz image, 332 m, `NIMITZ_*` spots and routes, 9.14 degrees |
| `tarawa` | `LHA_Tarawa` | today's Tarawa image, 254 m, `TARAWA_*`, 0 degrees |
| `generic-catobar` | any other `catobar`/`stobar` | outline rectangle, 300 m, no spots or routes, 9.14 degrees |
| `generic-vstol` | any other `vstol`/`unknown` | outline rectangle, 210 m, no spots or routes, 0 degrees |

`DeckId` becomes the profile key string. Per-type images, spots and routes for Forrestal, Kuznetsov
or the mods are added later by filling a row, not by touching the page.

### D3. A `CarrierPanel` component per selected carrier

The page becomes: a sidebar with the carrier list and the manual planner, and a scrollable row of
`CarrierPanel`s. Each panel owns its state (sync flag, last telemetry, locked unit id, smoothed
positions, selected routes, status table) and renders, top to bottom:

1. Header: group name, type, coalition, deck class, backend (`foothold`/`standalone`).
2. **Sync** checkbox and Carrier Actions (Turn into Wind, Resume Circuit, Check Status) for this
   ship only, with the status table from the existing implementation.
3. The wind wheel (480 px so three panels fit side by side) drawn from this ship's telemetry:
   actual heading from the radar stream, wind and controller plan from the poll when Sync is on.
4. The deck view for its profile, fed by the shared radar snapshot.

The manual planner (today's sliders and wheel) stays as a separate panel without a ship, so the
planning workflow does not change.

### D4. Data flow rules

- The radar stream is shared by all panels and always on while the page is open, as today.
- Deck views never poll; they use the stream, so an unsynced panel still shows the deck live.
- Sync on = this ship is in the wind poll. The poll becomes one batched request,
  `GET /api/airboss?names=CVN-72,CVN-74`, backed by `CarrierRecovery.windReports(names)` in Lua,
  so N synced carriers cost one Eval per interval instead of N. The single-name form stays for
  compatibility.
- Sync off = nothing is requested for this ship; the wheel shows the last known wind greyed with a
  "not synced" tag, and the heading needle keeps moving from the stream.
- Actions are on-demand and independent of Sync.

### D5. Persistence

Selected carriers, their Sync flags and their WOD targets are stored in `localStorage` keyed by the
mission name from `GET /api/mission`, so reopening the page on the same mission restores the layout
without a click.

### D6. User-selectable WOD target per carrier

Today the target wind over deck is a mission-wide value: the Lua default of 24 kt, or
`CarrierRecoveryTargetWodKt` from `Foothold Config.lua`. The page slider only affects the manual
planner, never the ship. Each panel gets a **Target WOD** control whose value is what the
controller actually uses for that ship.

- Control: a numeric input with a slider, range 15 to 40 kt in 0.5 kt steps, default taken from the
  controller's reported `target_wod` on first sync. Two presets next to it, "CATOBAR 24" and
  "VSTOL 20", so the common cases are one click; the numbers are placeholders until Phase E fixes
  the VSTOL doctrine.
- Where it is stored in the mission: a new per-group override table in the Lua module,
  `CarrierRecovery.groupOverrides[groupName].targetWodKt`, read by `config(groupName)` ahead of the
  mission-wide globals. The override survives mission restarts only through the page's persisted
  value, which is re-sent on the first sync.
- How it reaches the mission: a new `POST /api/airboss/config` with `{ carrier, target_wod }`
  calling `CarrierRecovery.setGroupOverrides(name, { targetWodKt })`. The page sends it when the
  user changes the value (debounced) and once after a page load restores a persisted value. Start
  does not carry the target itself, so a recovery always uses the value visible in the panel.
- Effect while a recovery is active: the monitor re-solves every tick and retargets during the
  `aligning` phase only, as today, so a change made during `active` applies to the next recovery.
  The status table shows the target in use.
- Foothold-delegated ship (CVN-72 with `bc` present): Foothold's own solver reads the global
  `CarrierRecoveryTargetWodKt`, so for that ship the module writes the override into that global as
  well. This is mission-wide for Foothold's ship only, which is the one ship Foothold manages, so
  there is no collision.
- Telemetry: `windReports` returns each ship's effective `target_wod`, so the wheel and the
  controller plan in the panel reflect the chosen value immediately.
- Validation: the backend rejects values outside 10 to 45 kt; the Lua clamps as well.

## Phase A: detection backend

1. Verify attribute strings on the live server through the Console page:
   `return Unit.getByName("<unit>"):getDesc().attributes` for a CVN, the Tarawa, the Kuznetsov and
   each mod hull in use. Record the results in this document.
2. Lua: `CarrierRecovery.classifyDeck(desc)` (pure, testable) and `CarrierRecovery.listCarriers()`
   returning `{ carriers = { { group, unit, type, coalition, deck_class, attributes }, ... } }`.
   Use the classification to choose the deck offset in `deckOffsetForType`, keeping the name pattern
   list as a fallback. Bump `MODULE_VERSION`.
3. Lua: `CarrierRecovery.windReports(names)` returning a table keyed by group name.
4. Lua: per-group overrides (D6): `CarrierRecovery.groupOverrides`, `setGroupOverrides(name,
   table)`, and `config(groupName)` resolving group override, then mission globals, then defaults.
   `windData`, `start` and `monitor` pass the group name to `config`. For a Foothold-delegated
   group, `setGroupOverrides` also writes `CarrierRecoveryTargetWodKt`.
5. Rust: `GET /api/airboss/carriers` (session required) using the probe/install pair;
   `GET /api/airboss` accepts `names` (comma-separated, each validated) and returns
   `{ reports: { <name>: AirbossDataResponse } }`; `POST /api/airboss/config` with
   `{ carrier, target_wod }` validated to 10 to 45 kt. Update utoipa and regenerate `openapi.json`.
6. Tests in the mlua harness: a fake `coalition.getGroups` with a CVN, a Tarawa, a destroyer and a
   mod hull with odd attributes; batched reports with one missing ship; name validation for the
   list form; a group override changing one ship's solution and `target_wod` while another ship
   keeps the default; the Foothold global written only for the delegated group. Add fixture cases
   for target 20 kt on a straight deck.

## Phase B: renderer extraction (no behaviour change)

1. Move `drawDeckView` and the wheel drawing out of the page effect into `deckRenderer.ts` and
   `wheelRenderer.ts` as pure functions taking a profile and a snapshot. Both are large closures
   today; extracting them is the precondition for reuse per panel.
2. Create `deckProfiles.ts` (D2) and change the two existing calls to read from it.
3. Add tests: profile lookup by type and by class fallback, and a smoke test that both renderers run
   against a stub 2D context without throwing.
4. Confirm the page renders exactly as before (screenshots of CVN and Tarawa decks).

## Phase C: per-carrier panels

1. `CarrierPanel.tsx` (D3) with its own hooks: `useShipFromRadar(groupName)` for position, heading
   and speed from the shared snapshot; `useWindReport(groupName, enabled)` for the poll subscription.
2. `useCarrierList()` hook: initial fetch, refresh button, and the radar-triggered refresh (D1).
3. Sidebar: detected carriers with a **Show** checkbox each, coalition badge, and a "Manual
   planner" toggle. Hidden carriers cost nothing. An "Add by name" field remains for the case where
   detection misses a hull, and feeds the same panel code.
4. Batched poll coordinator in the page: collects the synced names, one interval, one request,
   fans results out to panels. Poll interval 2 s as today, configurable constant.
5. Carrier Actions move into the panel unchanged, using the panel's group name.
6. Target WOD control in the panel (D6): input plus slider plus the two presets, debounced
   `POST /api/airboss/config`, initial value from the first report, re-sent after a reload when a
   persisted value exists. The wheel uses the panel's target, and the status table shows
   "Target WOD" so the user sees what the ship is aiming for.
7. Layout: `ab-panels` horizontal flex with scroll; each panel a fixed-width column. Keep the
   existing CSS variables and button styles.
8. Remove `carrierNameInput`, `tarawaNameInput` and the duplicated state from `page.tsx`.

## Phase D: polish

1. Persistence (D5).
2. Wheel and deck for a carrier that has left the stream: grey the panel, keep the last frame, show
   "lost" with the last-seen time.
3. Sidebar summary line: number of carriers detected, synced, and in recovery (from the batched
   report's `backend` and the status phase).
4. Docs: features page and README.

## Phase E (later): VSTOL doctrine and per-type geometry

Out of scope now, listed so the interfaces above leave room for it:

- VSTOL recovery is axial, so the solver's 0 degree offset is right, but the doctrine differs: a
  lower target wind over deck and a preference for wind slightly off the port bow for the Harrier
  pattern. Proposed shape: a per-`deck_class` solver profile in the Lua module
  (`targetWodKt`, `offsetDeg`, `minSpeedKt`) with a fixture section per class.
- Deck images, spots and launch routes for Forrestal, Kuznetsov, Invincible and Essex as new rows
  in `deckProfiles.ts` and `deckSpots.ts`.

## Validation checklist

1. Foothold mission: CVN-72, CVN-74 and Tarawa all detected with the right class; showing only
   CVN-74 with Sync produces one `/api/airboss?names=CVN-74` request per 2 s and nothing for the
   others (check the browser network tab and the backend log).
2. Non-Foothold mission with a Kuznetsov and a modded HMS Invincible: both detected, classes
   `stobar` and `vstol`, generic deck outlines drawn, wheel correct, Turn into Wind works on each.
3. Kill a carrier mid-session: its panel greys out within one stream cycle, the others continue.
4. Spawn a carrier mid-session: the list refreshes once, a new panel appears.
5. Two synced carriers: exactly one Eval per interval in the backend log.
6. Reload the page: the same panels, Sync flags and WOD targets come back for the same mission.
7. Set CVN-74 to 28 kt and CVN-72 to 24 kt, start both: the in-game "turning into wind" messages
   report different speeds, the status tables show the two targets, and the wheel of each panel
   matches its own controller plan. On the Foothold ship, confirm the F10 status report shows the
   new target too.

## Effort estimate

| Phase | Size |
| --- | --- |
| A | Small: about 150 lines of Lua, 100 of Rust, plus tests |
| B | Medium: mostly moving code, risk is in preserving pixel-identical rendering |
| C | Large: the page restructure, the bulk of the work |
| D | Small |
