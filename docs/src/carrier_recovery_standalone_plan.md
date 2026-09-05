# Carrier Recovery Without Foothold Plan

Status: proposed 2026-09-05 and implemented the same day on branch `carrier-recovery` (Phases 0 to 3).
Phase 4 (Foothold uses the shared module) and the live validation checklist remain open.

Where things landed:

| Item | Location |
| --- | --- |
| Solver fixture | `docs/src/fixtures/wind_solver_cases.json` (18 cases, all five regimes, two tunable sets) |
| Lua controller | `rust-web-dashboard/lua/carrier_recovery.lua` (`CarrierRecovery`, version `1.0.0`) |
| Rust embedding, injection scripts, Lua tests | `rust-web-dashboard/src/carrier_recovery.rs` (`cargo test carrier_recovery`, 18 tests on a fake DCS world) |
| Routes | `rust-web-dashboard/src/routes/dcs.rs` `airboss_data` and `airboss_action` (both now require a session, validate the group name, and return structured JSON) |
| Page solver | `web-dashboard/src/app/airboss/windSolver.ts` with `windSolver.test.ts` replaying the fixture |
| Page | `web-dashboard/src/app/airboss/page.tsx` sends the carrier name, shows the controller's plan and a status table |

Deviations from the plan text below: the fixture regeneration helper is an ignored cargo test
(`print_wind_solver_fixture`) rather than a script, and the status table is rendered inside the
Carrier Actions panel with a Close button rather than replacing the message line.

## Goal

Make the three **Carrier Actions** on the Airboss page (Turn into Wind, Resume Circuit, Check
Recovery Status) work in **any** mission, whether or not it runs the Foothold `zoneCommander.lua`
script. The turn-into-wind solution (heading and speed for a target wind over the angled deck) must
stay numerically identical to today's Foothold implementation, and that must be proven by tests
rather than by eye.

## Current state

| Layer | Today |
| --- | --- |
| Page | `web-dashboard/src/app/airboss/page.tsx` posts `{ action }` to `/api/airboss/action`. The Nimitz name input is **not** sent; it only drives the `/api/airboss` telemetry poll. The page carries its own copy of the solver (`getHeadingIntoWind`) for the sliders, with Vmin 4 kt, Vmax 33 kt and a 0.1 kt no-wind threshold. |
| Backend | `rust-web-dashboard/src/routes/dcs.rs` `airboss_action` matches the action string to one of three inline Lua snippets and runs it through DCS-gRPC `CustomService.Eval`. Every snippet needs the Foothold global `bc` and hard-codes the group `CVN-72`. Status is obtained by monkey-patching `trigger.action.outTextForGroup` to capture the message text. `airboss_data` interpolates the carrier name into Lua without escaping. |
| Mission | `BattleCommander:_carrierRecoveryStart / Restore / Status / Monitor / WindData / BuildRoute / StraightCourseIsSafe` in `zoneCommander.lua` (around lines 8683 to 8992). The solver itself is self-contained apart from four tiny local helpers and two MOOSE unit conversions. The Foothold coupling is elsewhere: **Resume** rebuilds the Foothold navigation lane (`_carrierNavigationReapplyGroupRouteSpeed` needs `self.carrierNavigation`, areas and stations), plus menu refresh, turn warnings and persistence. |
| Config | Nine `CarrierRecovery*` globals from `Foothold Config.lua`, with defaults applied in `zoneCommander.lua` at line 7273 onward. |

The copy in `Features/Carrier management/zoneCommander.lua` is newer than `airboss_planner/zoneCommander.lua`: it adds `CarrierRecoveryAngledDeckMinWindKt` (default 3 kt), keeps the current course in weak wind and compensates with speed only, and clamps the result to min and max speed. That copy is the reference for the solver.

## Candidates reviewed in `Features/Carrier management`

| Candidate | What it does | Verdict for the dashboard actions |
| --- | --- | --- |
| Foothold `zoneCommander.lua` (updated copy) | Angled-deck solver, timed state machine (pending, aligning, active), land-clearance sampling along the whole leg, safe abort and restore. | **Keep as the source of the solver and the state machine.** Only the restore step and the messaging are Foothold-specific. |
| Wrench's Carrier Script 2.0 (MIST) | Continuous 10 s loop: heading = reciprocal of wind, speed = 25 kt minus wind speed, fixed 10 degree offset, single look-ahead point 10 NM for shore, LARC cycle with return to start position. | Reject as the engine. No angled-deck geometry, no min/max handling, one-point land check, needs MIST, takes the ship over permanently. Its "return to the start position" idea is reused for the standalone Resume fallback. |
| DCS-CRT (MOOSE AIRBOSS) | Weather CASE detection, recovery windows, MOOSE `NAVYGROUP` steering with collision-warning detours. | Reject for these actions. It needs MOOSE (275k lines), owns the carrier and its waypoints, and would fight the Foothold navigation lanes. Could be offered later as a separate opt-in feature, not as the Turn-into-Wind engine. |

## Design decision: one dashboard-owned Lua module, injected on demand

Create a single dependency-free Lua 5.1 module, `CarrierRecovery`, that contains the solver, the
land-clearance check and the state machine, ported verbatim from the updated Foothold code. The
Rust backend embeds the file with `include_str!` and injects it into the running mission through
the same `CustomService.Eval` call it already uses. The mission maker does not have to edit the
mission. The same file can also be loaded with a DO SCRIPT FILE trigger by missions that want the
in-game F10 menus.

Why this and not a mission-side script only:

- The requirement is "any other mission". A file the mission must include is a dependency again.
- The monitor loop keeps running inside DCS via `timer.scheduleFunction`, so the dashboard does not
  poll and adds no DCS-gRPC load beyond the button clicks. This respects the goal of keeping the
  dashboard light next to the LSO client.
- One copy of the solver serves the ship controller, the telemetry endpoint and the tests.

Resume in a non-Foothold mission needs a definition of "normal circuit". The module captures it at
start: the group's mission-editor route read from `env.mission` (the same walk MIST's
`getGroupRoute` does, about forty lines, no MIST needed) and the current point, heading and speed.
Resume then re-tasks the ship from its current point to the nearest remaining editor waypoint and
onward. If the editor route has a single point, Resume steams back to the recovery start point and
stops there.

Foothold coexistence: when `bc` with `_carrierRecoveryStart` exists, the module delegates all three
actions to it, so Foothold missions keep today's lane-restore behaviour and Foothold's own speed
check keeps respecting the active recovery. Nothing changes for Foothold users in the first release.

Known limitation carried over: the land check samples `land.getSurfaceType` and cannot see the map
boundary. The CRT readme documents the same limit.

## Phase 0: pin the math before touching anything

Purpose: make "the calculation remains correct" a test failure instead of a review comment.

1. Add `docs/src/fixtures/wind_solver_cases.json`, a list of cases with inputs `windFromDeg`,
   `windSpeedKt`, `targetWodKt`, `deckOffsetDeg`, `minSpeedKt`, `maxSpeedKt`,
   `angledDeckMinWindKt` and expected `headingDeg`, `speedKt`, `regime`. Cover every branch:
   optimal, Vmax limited, Vmin limited, low wind (`target * sin(alpha) > wind`), weak wind under
   the 3 kt threshold, zero wind, wind from dead astern, and headings that wrap through 000/360.
   Generate the expected values by running the current Lua solver once (Console page or a
   standalone Lua 5.1 run) and freezing the output, so the fixture is the Foothold behaviour, not
   a re-derivation.
2. Add a forward-verification oracle used by both test suites: from the solved heading and speed,
   compute the relative wind vector and assert that in the optimal regime it is aligned with the
   angled deck axis and its magnitude equals the target WOD within 0.2 kt. The page already does
   this check at runtime (the "FORWARD CALCULATION TO VERIFY" block); move it to a function so the
   tests reuse it.
3. Frontend: extract `getHeadingIntoWind`, `toRad`, `toDeg`, `compassStr` from `page.tsx` into
   `src/app/airboss/windSolver.ts` and add `windSolver.test.ts` (node:test, like the existing
   `deckTracking.test.ts`) that replays the fixture.
4. Record the current TS versus Lua differences as fixture cases that are **expected to differ**
   until Phase 3 aligns them: Vmin 4 versus 10, Vmax 33 versus 30, no-wind threshold 0.1 versus 3 kt.

## Phase 1: the standalone Lua module

File: `rust-web-dashboard/lua/carrier_recovery.lua`. No MOOSE, no MIST, no Foothold.

1. `CarrierRecovery.VERSION` string, bumped on every change; the backend uses it to decide
   whether to re-inject.
2. `CarrierRecovery.config` with the nine Foothold tunables under the same names and defaults
   (`targetWodKt` 24, `durationSec` 1800, `turnDelaySec` 60, `safetyReserveSec` 300,
   `landClearanceNm` 2, `minSpeedKt` 10, `maxSpeedKt` 30, `headingToleranceDeg` 5,
   `alignmentTimeoutSec` 300, `alignmentStableSec` 15, `angledDeckMinWindKt` 3). On load, read the
   Foothold globals (`CarrierRecoveryTargetWodKt` and friends) if they exist so a Foothold config
   file still applies. Deck offset by unit type: 9.14 degrees for angled-deck carriers, 0 for
   `Tarawa` and other LHA types, overridable per group.
3. `CarrierRecovery.solve(windFromDeg, windSpeedKt, targetWodKt, offsetDeg, minKt, maxKt, minWindKt)`
   is the pure solver, ported line for line from `_carrierRecoveryWindData` in the updated copy.
   Pure means no DCS API inside, so it is testable.
4. `CarrierRecovery.windData(groupName)` reads the ship and the wind 18 m above it exactly as
   today (`atmosphere.getWind`, `atan2(-z, -x)` for the from-direction, heading from
   `pos.x`) and calls `solve`. Returns the same table shape as the Foothold function plus
   `recoveryHeadingDeg` and `recoverySpeedKt`.
5. `straightCourseIsSafe`, `buildRoute`, `setRoute` ported with `UTILS.KnotsToMps` replaced by
   `* 0.514444` and `UTILS.NMToMeters` by `* 1852`.
6. State machine `start(groupName)`, `restore(reason, groupName)`, `status(groupName)`, `monitor`
   with the same phases, timings and generation counter. State is kept per group name in
   `CarrierRecovery.active[groupName]`, so a second carrier can be driven later without changes.
7. Restore strategies, chosen at `start`: `foothold` when `bc._carrierRecoveryRestore` exists,
   otherwise `editorRoute` (route captured from `env.mission`), otherwise `returnToStart`.
8. Messages: keep the English strings from `Foothold_Localization.lua` as module defaults and
   broadcast with `outTextForCoalition` for the ship's coalition, read from the group, not
   hard-coded blue. `status` **returns** a table (state, headings, speeds, remaining seconds) and
   also prints it; no more monkey-patching in the backend.
9. Optional `CarrierRecovery.installMenus(groupName)` that adds the three F10 commands for
   missions that load the file themselves.
10. Tests in `rust-web-dashboard/src/carrier_recovery.rs` under `#[cfg(test)]`, using the `mlua`
    Lua 5.1 VM the crate already links for `serverSettings.lua`. Load the module with stubbed
    `Group`, `Unit`, `atmosphere`, `land`, `timer`, `trigger`, `env` tables and assert: the fixture
    cases from Phase 0, the from-direction conversion for known wind vectors, the land sampler
    rejecting a leg that crosses a stubbed land cell, the state machine going pending, aligning,
    active, complete with a fake clock, and restore choosing the right strategy. Lua 5.1 in mlua is
    the same dialect DCS runs, so integer and `math.atan2` behaviour matches.

## Phase 2: backend

1. `src/carrier_recovery.rs`: `const MODULE: &str = include_str!("../lua/carrier_recovery.lua")`,
   `const VERSION`, and `fn action_script(action, group) -> String` that builds one Eval payload:
   `if not CarrierRecovery or CarrierRecovery.VERSION ~= "<v>" then <module> end` followed by the
   call. One round trip per click, no separate probe.
2. `AirbossActionPayload` gains `carrier: Option<String>` (default `CVN-72`). Validate it against
   `^[A-Za-z0-9 _.\-]{1,64}$` and reject otherwise. Apply the same validation to `airboss_data`,
   which today formats the name straight into Lua.
3. Responses become structured: `start` and `resume` return `{ success, message }` with a 409 when
   the module reports "already active" or "not active", 422 when the leg is unsafe, 500 only for
   gRPC failures. `status` returns the table from the module as JSON.
4. `airboss_data` calls `CarrierRecovery.windData(name)` and returns, in addition to today's
   fields, `recovery_heading`, `recovery_speed`, `regime`, and the effective tunables
   (`min_speed`, `max_speed`, `deck_offset`, `angled_deck_min_wind`). The page then shows what the
   ship will actually do and can stop guessing tunables.
5. Update the utoipa schemas and regenerate `docs/src/openapi.json`.

## Phase 3: frontend

1. Send `carrier: carrierNameInput` in the action body.
2. Replace the inline solver with the `windSolver.ts` import and feed it the tunables returned by
   `/api/airboss` when auto-sync is on, so the page prediction and the ship controller agree. Keep
   the slider defaults for manual planning but read them from the same constants file the
   fixture uses.
3. Render the structured status as a small table (state, course, wind, headwind, WOD, ship speed,
   remaining) instead of a preformatted string. Show the 409 and 422 messages as warnings, not
   errors.
4. Add "Turn into Wind" and "Resume" confirmation only if the group name differs from the last
   telemetry name, to avoid steering the wrong ship after a rename.

## Phase 4: Foothold follow-up (optional, separate PR)

Replace the Foothold internal solver with `require`-style use of the shared module (Foothold
already loads several scripts), so the calculation lives in one file. Until then the fixture in
Phase 0 is the contract between the two copies, and a CI job should run the Lua fixture against
both `carrier_recovery.lua` and the solver block extracted from `zoneCommander.lua`.

## Live validation checklist

1. Non-Foothold test mission with a CVN, fixed wind 030 at 8 kt: start, confirm the coalition
   messages, compare the reported course and speed with the page prediction, wait for the active
   window, confirm resume returns to the editor route.
2. Same mission with wind under 3 kt: confirm the ship keeps course and only changes speed.
3. Coast within 2 NM of the leg: confirm the 422 "unsafe" response and no route change.
4. Foothold mission: confirm delegation, identical messages to today, and that the 1800 s Foothold
   speed check does not cancel the recovery.
5. Rename the carrier in the page and confirm the action targets the renamed group.

## Housekeeping

`Features/` is reference material only. Nothing under it should be loaded by the dashboard or the
build. The `DCS-CRT-Carrier-Recovery-Tool` folder contains its own `.git` directory and a 275k-line
MOOSE copy; keep them out of this repository's history.
