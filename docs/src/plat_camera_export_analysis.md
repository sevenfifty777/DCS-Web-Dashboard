# PLAT Camera in the Dashboard: Analysis

Status: analysis written 2026-09-07 on branch `PLAT`. No code changed. Inputs were the copy of the
Supercarrier module in `Features/PLAT/Supercarrier` (gitignored, identical to
`C:\Program Files\Eagle Dynamics\DCS World\Mods\tech\Supercarrier` of DCS 2.9.29.27468, same DLL
size and timestamp), the DCS install itself, the DCS-gRPC fork checkout (`../rust-server`) and the
LSO client checkout (`../DCS-gRPC-lso`). The reference picture is `Features/PLAT/image.png`, a
photo of the LSO console on CVN-72 showing the PLAT screen with an F-14 in the groove.

## 1. Question

Can the dashboard show the PLAT (Pilot Landing Aid Television) camera picture during a recovery,
the way the LSO station shows it in DCS?

## 2. Short answer

| Part of the PLAT screen | Exportable from the dedicated server? | How |
| --- | --- | --- |
| The camera **picture** (the grey video with the aircraft, deck and horizon) | **No.** It is a GPU render target that only exists inside a rendering DCS client. There is no Lua, file, export or gRPC path to its pixels, and the dedicated server never renders it. | Only by streaming video from a separate DCS client (Option B). |
| The **overlay** (date, time, hull number, C/F deck status, wind over deck, airspeed, distance, descent rate, crosshair and 1° gate) | **Yes.** Every value is a function of ship and aircraft state that the gRPC fork already exposes, plus constants read from the Lua. | Synthetic PLAT drawn by the dashboard (Option A). |
| The **LSO station frame** around it (SH heading, list, trim, hook-to-ramp scale, hook touchdown scale, wire markers, H/E and B/A, crosswind) | **Yes**, same data, plus a small per-aircraft table. | Same as above. |
| The **IFLOLS state** (meatball, wave-off and cut lights) | **Yes**, through the carrier's draw arguments. | `Unit.getDrawArgumentValue` on the ship, already used by the fork for the aircraft hook. |

The recommended path is a synthetic PLAT panel: the dashboard reproduces the DCS overlay pixel
for pixel from live data and draws a schematic camera view (deck centreline, horizon and an
aircraft symbol at its true projected position) where the video would be. A first version can be
built and validated offline against the passes the LSO client already records, with zero DCS-gRPC
cost, before any live polling is added.

## 3. What was analysed

| Source | Role in the PLAT feature |
| --- | --- |
| `PLATCameraUI/PLATCameraUI.lua` (596 lines) | The only PLAT logic in Lua. Builds three dxgui windows and exposes the `set*` functions the DLL calls every frame. Contains every formatting rule and scale constant. |
| `PLATCameraUI/PLATCameraUI.dlg` | 1274 x 928 `OffscreenWindow`: the overlay drawn on top of the camera frame (DATE, LOCAL_TIME, CARRIER_STATUS, CARRIER_ID, DECK_WIND, ARCFT_SPEED, DISTANCE, VERTICAL_SPEED, W, four crosshair bars, a REFERENCE photo used only in the unit test). |
| `PLATCameraUI/LSOStation.dlg` | 1024 x 768 offscreen window: the LSO main screen. Its `PLATCamera` static (640 x 480 at 192,150) shows the texture `LSOFRAME`; the rest is the green frame (heading, list, trim, hook scales, wires, aircraft reference, crosswind, CASE III stack, OVERTEMP, FOUL/CLEAR). |
| `PLATCameraUI/LSOStationScreen2.dlg` | 1152 x 768 cue panel (landing queue grid and a 2 NM plan-view of CASE III traffic). |
| `PLATCameraUI/FLOLS.lua` + `FLOLS.dlg` | The optional FLOLS overlay for the pilot (meatball, datum, wave-off, cut lights), driven by `update(meatball, datum, cutlights)`. |
| `PLATCameraUI/*.tga`, `LSO-grids.dds`, `PLATCameraTemplate.png`, `LSOREFERENCE.png` | Artwork: grid, markers, aircraft glyphs, and two reference photos of a real PLAT and LSO screen used as layout templates. |
| `Liveries/*/description.lua` | Bind 3D screen materials to render-target textures: `LSOFINALTARGET` on the LSO HQ console, three or four Air Boss monitors and the briefing room TV; `LSOSCREEN2` on the second LSO screen. |
| `BriefingRoomScreensUI/PLAT_ScreenUI.dlg` | A bare 1024 x 768 window with one `PLATCameraPicture` static: the TV in the briefing room re-uses the same texture. |
| `AirBossScreensUI/AirBoss_TV.lua` | Air Boss TV; its `bindPictureAndScreen("TVFRAME", ...)` call is commented out, so today the Air Boss monitors get the picture through the livery binding, not through Lua. |
| `ClickableData/LSO_clickable_data.lua`, `SupercarrierActions.lua` | Three clickable buttons on the LSO console (cut lights, wave-off lights, deck lights) mapped to actions `LSO_CUT_LIGHTS = 2`, `LSO_WAVEOFF_LIGHTS = 3`, `LSO_DECK_LIGHTS = 4`. |
| `bin/edSupercarrier.dll` (9.4 MB) | Closed source, protected: an ASCII string scan finds only 11 168 strings and none of the Lua entry-point names, so the body is packed or encrypted. The import table is readable and is what tells us where the camera lives (section 4.4). |
| `CoreMods/tech/USS_Nimitz/Database/db_ships.lua` (DCS install, also copied in `Features/Carrier info`) | Defines `CVN_7X_LSOView`, the PLAT camera pose, and `GT.Stations.LSO` (the LSO platform station). |
| `Doc/DCS Supercarrier Operations Guide EN.pdf` pages 88 to 93 | ED's description of the LSO station, the LSO main screen and the PLAT camera view. |

## 4. How PLAT works inside DCS

### 4.1 The camera

The camera pose is not in the Supercarrier module at all. It is a property of the ship type in
the core Nimitz database:

```lua
-- CoreMods/tech/USS_Nimitz/Database/db_ships.lua
local function runway_centerline(x)
    local p1 = {-43.836  ,-9.9819}
    local p2 = {-159.6597, 8.999}
    local dz  = p2[2] - p1[2]
    local dx  = p2[1] - p1[1]
    local rw  = -math.deg(math.atan2(dz,dx))
    return  {x,20.5,(dz/dx) * (x - p1[1]) + p1[2],rw,3.6}
end
CVN_7X_LSOView  = {cockpit = "empty", position = { offset = runway_centerline(-14.0) }}
```

Evaluated, the PLAT camera on every CVN-71 to CVN-75 sits at, in ship model coordinates (x forward,
y up, z starboard):

| Quantity | Value | Note |
| --- | --- | --- |
| Position | x = -14.0 m, y = 20.5 m, z = -14.87 m | On the angled-deck centreline, 0.35 m above the 20.15 m deck plane the LSO client uses. A flush deck camera, as the guide says: "mounted on the deck and angled up at 3 degrees along the aircraft landing glideslope". |
| Yaw | -170.69° from the bow | Looks aft, straight down the angled deck. The centreline points give a deck angle of 9.31°; the LSO client's `NIMITZ.deck_angle` is 9.1359° from the runway definition. Use one consistently. |
| Pitch | +3.6° | Slightly above the 3.5° basic angle; the crosshair is then moved onto the true glideslope by `adjustGate` (below). |
| Field of view | Set by the DLL, not visible in Lua | Estimated at roughly 10° from the 1° gate width in the real-PLAT template photo (gap of about 125 px in 1274 px gives `tan(fov/2) = tan(0.5°) / 0.098`). Must be calibrated in a client before any projection is trusted. |

Other carriers define the same view differently: Forrestal and Vinson-class mods with an explicit
`cameraPos`, the Kuznetsov through the `POINT_LSO_CAMERA` connector, Essex through
`LSO_PLATFORM_REAR`. Any synthetic PLAT needs a per-type pose table, the same way the LSO client
keeps a per-type `CarrierInfo`.

The renderer owns this camera: the DLL imports `woShip::getLSOCameraGlobalPosition(double)` from
the core, so the ship object computes the world pose every frame from the pose above and the ship's
current position, heading, pitch and roll.

### 4.2 The picture pipeline

Three texture names appear in the module, all of them render targets managed by the engine's
texture manager (the DLL imports `RenderAPI::pTexMan`, an `ITextureManager`), none of them files:

| Texture | Producer | Consumers |
| --- | --- | --- |
| `LSOFRAME` | The engine's LSO camera render pass | `LSOStation.dlg` `PLATCamera` static, bound in Lua by `bindPLATCameraPicture("LSOFRAME")` through `SkinUtils.setStaticPicture`, which simply writes the name into `skin.states.released[1].picture.file`. |
| `LSOFINALTARGET` | The GUI surface the DLL draws the LSO main screen into (`gui::GUI::createSurface`, `drawToSurface`, `invalidateSurface`) | Livery bindings: `LSO_HQ` Screen_Material_1, `AirBoss_71-72-CPT` screens 4, 8, 13 and Pre-Fly_L, `AirBoss_73-75-CPT` screens 5, 8 and Pre-Fly_L, `Nimitz_Briefing_Room` Screen_TV. |
| `LSOSCREEN2` | Second GUI surface (the cue panel) | `LSO_HQ` Screen_Material_2. |

So the chain is: engine renders the LSO camera into `LSOFRAME`; dxgui composes the 1274 x 928
overlay window and the 1024 x 768 LSO station window that embeds the frame; the DLL draws those
windows into GUI surfaces that become `LSOFINALTARGET` and `LSOSCREEN2`; the 3D models of the LSO
console, the Air Boss tower and the briefing room map those textures onto their screen materials,
and the same window is shown to the player as the floating "LSO Main Screen Window". At no point
does a bitmap exist outside GPU memory, and dxgui has no call that reads pixels back.

### 4.3 The overlay contract (what the DLL feeds the Lua)

These global functions in `PLATCameraUI.lua` are called from C++. Their bodies are the complete
specification of the overlay; a synthetic PLAT should implement exactly these rules.

| Function | Input units | What it draws |
| --- | --- | --- |
| `setDate(Y, M, D)` | numbers | `MM-DD-YY` top left. |
| `setTime(H, M, S)` | numbers | `HH:MM:SS` under the date. |
| `setCarrierID(unitType)` | type name | Digits extracted from the type name (`CVN_72` gives `72`); `Stennis` is special-cased to `74`; anything without digits shows `XX`. |
| `setFoulDeck(val)` | 0 clear, 1 foul, 2 foul flashing | `C` when clear. `F` when foul, visible only while `val > 1` (this is how the DLL makes it flash). Also toggles the CLEAR / FOUL signs on the station frame. |
| `setDeckWind(deckwind, crosswind)` | m/s | Wind over deck as `%02d` knots on both windows. Crosswind shown on the station frame as `NN P` or `NN S` when its magnitude exceeds 1 kt. |
| `setAircraftData(distance, speed, Vy, waveoff)` | m, m/s, m/s, bool | Airspeed `%03d` kt; distance floored to 100 ft and printed `%05d`; descent rate `%02d` ft/s from `-Vy`, clamped at 0; the `W` wave-off letter visible while `waveoff` is true. Per the guide, airspeed, distance and descent rate stay at zero unless the aircraft is ACLS-equipped. |
| `adjustGate(fov, distance, optimal_glissade_delta_h)` | deg, m, m | Rebuilds the four crosshair bars. Gate width is exactly 1° of the camera's horizontal FOV: `w_gate = w * tan(0.5°) / tan(fov/2)`. The crosshair centre is shifted up by `h * (delta_h / distance) / (2 * tan(vfov/2))` pixels so it marks the optimal glideslope at the aircraft's current range (`distance` is clamped to 35 m or more). |
| `setNightMode(night)` | bool | Switches every overlay widget between its `released` state (black text, day) and `disabled` state (white text, night). |
| `setShipYawPitchRoll(heading, pitch, roll)` | deg, magnetic heading | `SH %03d DEG`; list as `x.x STBD DOWN` for positive roll and `x.x STBD UP` otherwise; trim as `x.x BOW UP` or `x.x BOW DOWN`. |
| `setHook(touchdown, ramp)` | m, m | Moves the two carets: hook touchdown on the horizontal scale, hook-to-ramp on the vertical one. |
| `setHookToRampDesired(ft)`, `setHookTouchdownDesired(ft)`, `setDesiredRope(idx)` | ft, ft, 1 to 4 | Desired markers. Defaults on creation: 14.1 ft hook-to-ramp, 230 ft touchdown, wire 3. |
| `setAircraftReference(type, HE_ft, BA_deg)` | string, ft, deg | Aircraft type label, `H/E = xx.xx ft` (hook to eye), `B/A = x.xx deg` (basic angle). The photo shows `F-14A/B/D`, `H/E = 19.70 ft`, `B/A = 3.50 deg`; the guide shows `F/A-18C/D`, `16.35 ft`. |
| `setCuePanelInfo(...)`, `setCaseIIIStack(...)`, `cleanCuePanel()` | mixed | Landing queue rows (board number, pilot, fuel state as `x.x/00`) and up to three CASE III aircraft plotted on a plan view where 66 px equals 2 NM. |

Scale geometry from the same file, in pixels of the 780 x 512 `STATIC_GRID` image:

| Scale | Range shown | Pixel mapping | Fixed marks |
| --- | --- | --- | --- |
| Hook-to-ramp (vertical) | -10 ft to 45 ft | 0 ft at y = 464, 30 ft at y = 104 (12 px per foot) | Desired 14.1 ft |
| Hook touchdown (horizontal) | 0 ft to 350 ft from the ramp | 0 ft at x = 728, 350 ft at x = 14 (2.04 px per foot) | Wires 1 to 4 at 170, 210, 250 and 290 ft; desired 230 ft |

### 4.4 What the DLL does (from its import table)

The body of `edSupercarrier.dll` is protected, but its imports are enough to place the pieces:

| Import | Meaning |
| --- | --- |
| `woShip::getLSOCameraGlobalPosition` | The ship object, in the core engine, provides the PLAT camera world pose; the module does not compute it. |
| `gui::GUI::createSurface`, `drawToSurface`, `invalidateSurface`, `setSurfaceMouseFunc` | The module rasterises dxgui windows into GUI surfaces (the `LSOFINALTARGET` and `LSOSCREEN2` textures) and routes clicks on the 3D screen back into the window. |
| `RenderAPI::pTexMan` (`ITextureManager`) | Named textures such as `LSOFRAME` are looked up in the engine texture manager. |
| `Graphics::ModelLight::GetTexture` / `SetTexture` | Light textures for the deck and IFLOLS lights. |

No import touches files, sockets or encoders. There is nothing in the module that could be
configured or patched to write the picture anywhere, and modifying the DLL is off the table anyway
(licence, DCS integrity check in multiplayer, `integrityCheckDisabled = false` in the live
`dcs-grpc.lua`).

### 4.5 The overlay fields in the reference photo

Reading `Features/PLAT/image.png` against the code: `CLEAR` and `C` mean `setFoulDeck(0)`;
`SH 044 DEG` is the magnetic ship heading; `72` is CVN-72 Abraham Lincoln; `23` is the wind over
deck in knots, repeated in the ship symbol at top left; `06-15-24 16:15:54` are mission date and
local time; `000`, `00000` and `00` mean the F-14 is not ACLS-equipped so speed, distance and
descent rate are blanked, which is also why the crosshair centre is not shifted. The list and trim
read `0.0 STBD UP` and `0.0 BOW DOWN` (both formatted from values at or below zero). The hook
carets sit at the creation defaults. The lower left screen is the cue panel with the landing queue
(`301 Justice`), the lower right is the physical LSO console.

## 5. Why the picture cannot leave the server

1. **The dashboard's DCS is a dedicated server started without a renderer.** `Start-DCS.ps1`
   and the `DCS_START_CMD` example in `configuration.md` launch `DCS_server.exe --server
   --norender`. Without the renderer there is no LSO camera pass, no `LSOFRAME` texture and no GUI
   surface; the Supercarrier Lua for these screens is client-side UI and is never even loaded into
   a headless server. This could not be exercised on this machine (no dedicated server is
   installed here, only the full client), but it follows from what `--norender` means and from
   the import table above.
2. **No API reads a texture back.** dxgui statics accept a texture name as a picture; there is no
   `getPixels`, no save-to-file, and `SkinUtils` only edits the skin table.
3. **`Sim.makeScreenShot(name)`** exists in the hook API (`API/Sim_ControlAPI.md`), and the fork's
   `HookService.Eval` could call it, but it captures the main window of a rendering process. On a
   `--norender` server there is nothing to capture, and on a client it would capture the player's
   view, not the offscreen render target. The live config also keeps `evalEnabled = false`.
4. **`Export.lua`** offers `LoGetCameraPosition` and `LoSetCameraPosition`, which move the local
   player's view camera in a client. There is no frame grab in the export API either, and on the
   server there is no view camera.
5. **The DCS-gRPC fork** has no camera, screenshot, texture or render RPC (checked every
   `protos/dcs/**/*.proto`). Its `RecoveryService` is a pure state observation service.

## 6. Options

### Option A: synthetic PLAT panel in the dashboard (recommended)

Reproduce the LSO main screen from data. The video area shows a schematic camera view: horizon
line from ship pitch and roll, the angled-deck centreline and ramp edge projected through the PLAT
camera pose, the 1° gate and crosshair exactly as `adjustGate` computes them, and an aircraft glyph
placed at the aircraft's projected pixel position and rotated with its relative yaw and roll. The
overlay text and the station frame follow section 4.3 verbatim, so an LSO who knows the DCS screen
reads it without retraining.

**Data needed per sample and where it comes from**

| Value | Source | Cost |
| --- | --- | --- |
| Ship position, heading, pitch, roll, velocity | `RecoveryService` transforms (`GetRecoverySnapshot` or the telemetry ring), or one `CustomService.Eval` into the already injected `carrier_recovery.lua` | See budget below |
| Aircraft position, orientation, velocity | Same RPC | Same |
| Wind over deck, crosswind | Ship velocity plus `atmosphere.getWind` at the ship; `carrier_recovery.lua` already computes `wod`, `headwind`, `brc` for the Airboss page | Already paid by the Airboss poll |
| Magnetic heading | `CustomService.GetMagneticDeclination`, once per mission | Negligible |
| Date, local time | `env.mission.date` plus `timer.getAbsTime`, one Eval at panel open, then extrapolated client-side | Negligible |
| Hull number | Type name, same rule as `setCarrierID` | None |
| Distance, closure, descent rate | Geometry between the aircraft hook point and the ramp; closure from consecutive samples or the velocity vectors | None |
| Hook-to-ramp, hook touchdown | Hook point (per-type offset, already in the LSO client's `AirplaneInfo.hook`) crossing the ramp plane, then extrapolated along the flight path to the deck plane; wire positions from the LSO client's `CarrierInfo.cable1..4` or the 170/210/250/290 ft constants | None |
| H/E and B/A, glideslope | Small per-type table (the LSO client already carries `glide_slope`) | None |
| IFLOLS meatball, wave-off, cut lights | `Unit.getDrawArgumentValue` on the carrier: `MeatBallArg = 151`, `DatumAndWaveOffLightsArg = 405`, `CutLightsArg = 404` (from `GT.OLS` in `USS_CVN_7x.lua`); thresholds as in `FLOLS.lua` | One extra call per sample in the same Eval |
| Foul deck | Not readable directly. Approximate as "any unit inside the landing area polygon" using the deck geometry the Airboss deck tracking already has | None |
| Which aircraft to show | Nearest aircraft inside 3 NM astern, within ±20° of the final bearing, below 1 500 ft and descending; hysteresis so the lock does not flip in the groove | Computed inside the Eval from `world.searchObjects` in a sphere around the ship |

**Load budget, against the project goal of minimal DCS-gRPC load**

| Variant | Server-side cost | Comment |
| --- | --- | --- |
| A1: one `Eval` per 500 ms into `carrier_recovery.lua`, only while a PLAT panel is open and the carrier is in a recovery phase | 2 mission-queue calls per second, same shape as today's 2 s Airboss poll | Enough for the station frame and the overlay numbers. The video area interpolates between samples with the velocity vectors, which looks smooth at 2 Hz because approach dynamics are slow. |
| A2: `StartRecoveryTelemetry` / `ReadRecoveryTelemetry` once the aircraft is inside 1 NM | Capture at 20 Hz runs on the server's own timer, outside the RPC FIFO; the dashboard reads one batch per second (up to 100 snapshots) | The ring is enabled in the live `dcs-grpc.lua` and nobody uses it yet (the LSO client polls `GetRecoverySnapshot`). Gives real 20 Hz motion for the groove. |
| Not this: `GetRecoverySnapshot` at 10 Hz from the dashboard | Doubles the LSO client's traffic on the same FIFO queue | Exactly the contention the load goal exists to prevent. |

**Where it lives**

- Backend: a `platReport(groupName)` function added to `rust-web-dashboard/lua/carrier_recovery.lua`
  (bump `M.VERSION` and `MODULE_VERSION` together, the existing test enforces it), a
  `GET /api/airboss/plat?name=` route in `routes/dcs.rs` returning the compact sample, and later an
  SSE stream for A2. All projection maths stays in the browser so the Lua stays small.
- Frontend: a `PlatPanel` in `web-dashboard/src/app/airboss/` opened from each `CarrierPanel`
  (the per-carrier panels, target WOD and recovery phase are already there), drawn on a 4:3 canvas
  with the green-phosphor look of `LSOStation.dlg`. The pure functions (projection, hook geometry,
  overlay formatting) go in a `platMath.ts` with `node --test` cases, and the same cases replay in
  Rust through a shared fixture, following the `wind_solver_cases.json` pattern.
- A `PLAT replay` mode in the LSO page's trap sheet modal: the LSO client already stores about
  1 100 datums per pass (`x`, `y`, `alt`, `aoa` at 10 Hz, carrier-relative) in
  `<timestamp>.json`, and the dashboard already opens `LSO_DIR` read-only. Replaying those through
  the same renderer costs zero DCS calls and is the cheapest way to validate the projection before
  going live. Pattern datums are absent in the sample checked, and there is no aircraft attitude
  in the JSON, so the replay glyph stays upright.

**What it cannot do**

No real photograph: no deck crew, no sea state, no true aircraft silhouette (the glyph is
schematic, rotated by the real relative yaw and roll). FOV must be calibrated once in a client
(place an aircraft at a known range and match the gate) or the projection will be off by a
constant factor. ACLS blanking of speed, distance and descent rate is a DCS presentation rule the
dashboard can choose to ignore, which is arguably better for an LSO.

### Option B: real PLAT video from a spectator client

A Windows machine with a GPU, a DCS client licence that owns Supercarrier, connected to the
server as a spectator or in a carrier slot, in the LSO station (`LAlt+F9`, guide page 89). OBS
captures the LSO Main Screen Window and streams it (RTMP to an HLS packager, or WebRTC through a
WHIP-capable relay such as MediaMTX). The dashboard adds a "Live PLAT" panel that embeds the stream
(`hls.js` is available on the allowed CDN; WebRTC needs no library). Configuration is one variable,
for example `PLAT_STREAM_URL`; the backend is untouched and DCS-gRPC load is zero.

Constraints: the client must own Supercarrier to enter the LSO station; `LAlt+F9` is an external
view and depends on the server's view settings for spectators; the client has to stay connected
through mission rotations (scriptable with the client's `Export.lua` and a restart task); latency of
a few seconds with HLS, under a second with WebRTC; one more machine to keep alive. If the LSO view
is not permitted, `Export.lua` on that client can pin the free camera at the PLAT pose every frame
with `LoSetCameraPosition` computed from `LoGetObjectById(carrierId)`, but then the DCS overlay is
absent (it only draws in the LSO station window) and Option A's overlay would be composited on top
in the browser.

This is the only way to get the real picture. It is an operations decision, not a coding one.

### Option C: server-requested client screenshots (not recommended)

The hook environment has `net.screenshot_request(playerId)` (the dedicated server WebGUI's
`makeScreenshot` action). It asks a connected client that has "Allow servers to take my
screenshots" enabled to upload one screenshot, which the WebGUI then lists per player. Driven from
the dashboard through `HookService.Eval` this yields a still image every few seconds of whatever
the spectator client shows. It needs `evalEnabled = true` in `dcs-grpc.lua` (deliberately false
today), it depends on the same spectator client as Option B, and the delivery path is undocumented
and JPEG-only. Useful at most as a "last frame" tile; it never becomes video.

### Option D: post-pass PLAT replay only

Ship only the replay mode described under Option A, in the LSO page. Zero live cost, immediately
useful for debriefs, and it is the natural Phase 0 of Option A rather than a separate product.

### Ruled out

| Idea | Why not |
| --- | --- |
| `Sim.makeScreenShot` on the server | No renderer on `--norender`; on a client it captures the main window, not the render target. |
| Reading `LSOFRAME` / `LSOFINALTARGET` | No pixel read-back anywhere in dxgui, the hook API or the export API. |
| Patching or hooking `edSupercarrier.dll` | Protected binary, licence, integrity check. |
| `LoGetCameraPosition` on the server | There is no view camera without a renderer. |
| Polling `GetRecoverySnapshot` at 10 Hz from the dashboard | Competes with the LSO client on the mission FIFO queue. |

## 7. Recommendation

Build Option A in phases, and treat Option B as an independent operations add-on if the real
picture is wanted later.

| Phase | Scope | DCS load | Validates |
| --- | --- | --- | --- |
| 0 | `platMath.ts` (camera pose table, projection, gate, hook geometry, overlay formatting) with tests; PLAT replay in the LSO trap sheet modal from the stored pass JSON | None | Projection and layout against real recorded passes |
| 1 | `platReport` in `carrier_recovery.lua`, `GET /api/airboss/plat`, `PlatPanel` in the Airboss page polling every 500 ms while open and a recovery is active | 2 Evals per second, on demand only | Live overlay, aircraft lock, IFLOLS readout |
| 2 | Telemetry ring (`StartRecoveryTelemetry` on lock inside 1 NM, one `ReadRecoveryTelemetry` per second, `Stop` on trap or bolter) streamed to the panel over SSE | 20 Hz capture on the server timer, 1 RPC per second | Smooth groove motion, hook-to-ramp at the ramp crossing |
| 3 (optional) | `PLAT_STREAM_URL` embed for a spectator-client video feed (Option B) | None | The real picture |

Open decisions before Phase 1: the camera FOV (calibrate in a client, then pin it in the pose
table), whether the panel lives in the Airboss page or gets its own `/plat` page, and whether the
aircraft lock is automatic or chosen from the landing queue.

## 8. Reference data

**PLAT camera pose (CVN-71 to CVN-75, ship model coordinates)**: position (-14.0, 20.5, -14.87) m,
yaw -170.69°, pitch +3.6°, FOV to be calibrated (about 10°). Deck plane 20.15 m. Angled deck
9.31° from the centreline points (LSO client uses 9.1359°).

**Overlay layout in the 1274 x 928 window** (from `setPLATCameraBounds`): date and time at
column `w/2 - 440`, rows 10 and 80 px from the top of the picture; status, hull number and wind in
the right column starting at `w/2 + 171` px; speed, distance and descent rate on one row 136 px
above the bottom; glyph cell 57 px; font `AnonymousPro-Regular.ttf` at 90 px with a 2 px black
blur; frame text `DejaVuLGCSansCondensed.ttf` in `0xc3ff00` green.

**Verification status of the statements above**

| Statement | How verified |
| --- | --- |
| Overlay rules, scales, texture names, livery bindings | Read from the Lua, `.dlg` and `description.lua` files in `Features/PLAT/Supercarrier`. |
| Camera pose | Read from `CoreMods/tech/USS_Nimitz/Database/db_ships.lua` in the DCS install and computed by hand. |
| DLL behaviour | Import table only; body is protected. |
| Hook API, export API, WebGUI screenshot | Read from `API/Sim_ControlAPI.md`, `Scripts/Export.lua`, `Scripts/Hooks/webGUI.lua` in the DCS install. |
| gRPC fork capabilities, telemetry ring defaults, live config | Read from `../rust-server/protos`, `lua/DCS-gRPC/methods/recovery.lua` and `Features/authentication/dcs-grpc.lua`. |
| LSO client behaviour and stored data | Read from `../DCS-gRPC-lso/src` and one pass JSON in `trap sample/`. |
| No render on `--norender` | Inferred from the launch flag and the import table; not tested here (no dedicated server installed on this machine). |
| FOV about 10° | Estimated from a template photo; must be calibrated. |
