# DCS Web Dashboard — Feature Gap Analysis & Improvement Plan

## Current State Summary

The dashboard is a **Rust (axum/tonic) backend** + **Next.js frontend** that connects to a DCS-gRPC server. It currently exposes:

### Currently Implemented (Backend → Frontend)

| Area | gRPC Services Used | Dashboard Pages |
|---|---|---|
| **Server Health** | `MetadataService` (GetHealth, GetVersion) | Server Status |
| **Players** | `NetService` (GetPlayers, KickPlayer, SendChat) | Players, Chat |
| **Mission Control** | `HookService` (Get/SetPaused, StopMission, ReloadMission, LoadMission, BanPlayer, UnbanPlayer) | Mission |
| **Lua Console** | `CustomService` (Eval) | Console |
| **Triggers** | `TriggerService` (Get/SetUserFlag, OutText, OutTextForCoalition) | Triggers |
| **Atmosphere** | `AtmosphereService` (GetWind, GetTemperatureAndPressure) | Atmosphere, Weather |
| **Map/Radar** | `MissionService` (StreamUnits, StreamEvents) | Radar (live map) |
| **Marks** | `WorldService` (GetMarkPanels) | Radar (map overlay) |
| **Airbases** | `WorldService` (GetAirbases) | Radar (map overlay) |
| **Zones** | `CustomService.Eval` (Lua) | Radar (zones overlay) |
| **Graveyard** | Event stream (Dead/Kill) → local JSON | Radar (graveyard heatmap) |
| **Foothold** | Lua save file parsing | Foothold, Leaderboard |
| **Unit Details** | `CustomService.Eval` (getFuel, getLife, getAmmo) | Radar (unit popup) |
| **Unit Destroy** | `GroupService` (Destroy) | Radar (unit popup) |
| **SRS** | File-based (cfg parse, client-list.json) | SRS |
| **System** | Windows API (quser, schtasks, processes) | Settings, Tasks, DCS Logs, Access Logs |

---

## Unused DCS gRPC Capabilities

Cross-referencing the [dcs_grpc_api.md](file:///C:/Users/thierry/.gemini/config/skills/dcs_grpc_client/references/dcs_grpc_api.md) with the current codebase reveals **significant untapped API surface**:

### Completely Unused gRPC Services

| Service | Key Endpoints | Potential |
|---|---|---|
| **CoalitionService** | `GetGroups`, `GetPlayerUnits`, `GetStaticObjects`, `GetBullseye`, `AddGroup`, `AddStaticObject` | Coalition OOB, spawning |
| **ControllerService** | `GetDetectedTargets`, `SetTask`, `PushTask`, `SetOption`, `SetAlarmState` | AI control panel |
| **UnitService** | `GetTransform`, `GetRadar`, `GetSensors`, `GetFuel`, `GetAmmo`, `GetDescriptor`, `SetEmission` | Rich unit inspector |
| **WarehouseService** | `GetInventory`, `AddItem`, `RemoveItem`, `GetLiquidAmount`, `SetLiquidAmount` | Airbase logistics |
| **TimerService** | `GetAbsoluteTime`, `GetTime`, `GetTimeZero` | Native time (replacing Eval) |
| **LandService** | `GetTerrainHeight`, `GetSurfaceType`, `FindPathOnRoads`, `IsVisible` | Terrain analysis |
| **SpotService** | `CreateLaser`, `CreateInfraRed`, `GetPoint` | JTAC / laser management |
| **WeaponService** | `GetDesc`, `GetTarget`, `GetVelocity`, `InAir` | Live weapon tracking |
| **SrsService** | `GetClients`, `Transmit` (TTS via AWS/Azure/GCloud/Windows) | Native SRS (not file-based) |

### Partially Used Services (Missing Endpoints)

| Service | Used | Unused |
|---|---|---|
| **WorldService** | GetMarkPanels, GetAirbases | `GetTheatre`, `GetAirbaseParking`, `GetAirbaseRunways`, `SearchObjects`, `SetAirbaseCoalition` |
| **HookService** | Mission name/pause/stop/reload/load/ban | `GetMissionDescription`, `GetMissionFilename`, `GetMissionOptions`, `GetModelTime`, `GetRealTime`, `GetBallisticsCount`, `IsMultiplayer`, `GetBannedPlayers`, `LoadNextMission`, `ExitProcess` |
| **MissionService** | StreamEvents, StreamUnits | `GetScenarioCurrentTime`, `GetScenarioStartTime`, `GetSessionId`, `AddMission/Group/CoalitionCommand` |
| **TriggerService** | GetUserFlag, SetUserFlag, OutText | `GetZone`, `MarkToAll/Coalition/Group`, `Smoke`, `SignalFlare`, `Explosion`, `ActivateGroup`, `DeactivateGroup`, `GroupStopMoving`, `GroupContinueMoving`, `MarkupToAll` |

### Unused Event Types (from StreamEvents)

The telemetry module only handles `Dead` and `Kill` events. Many other rich events are available but not surfaced to the frontend:

- **Player events**: `Connect`, `Disconnect`, `PlayerChangeSlot`, `PlayerEnterUnit`, `PlayerLeaveUnit`, `PlayerSendChat`
- **Flight events**: `Takeoff`, `Land`, `Ejection`, `Crash`, `PilotDead`, `RunwayTakeoff`, `RunwayTouch`, `LandingQualityMark`
- **Combat events**: `Shot`, `Hit`, `ShootingStart/End`, `WeaponAdd`, `Refueling/RefuelingStop`
- **System events**: `MissionStart`, `MissionEnd`, `EngineStartup/Shutdown`, `BaseCapture`, `Score`
- **SRS events**: `SrsConnect`, `SrsDisconnect`
- **Map marks**: `MarkAdd`, `MarkChange`, `MarkRemove`
- **Performance**: `SimulationFps`

---

## Proposed Feature Improvements

### 🔴 Priority 1 — High Value, Low Effort

#### 1. Airbase Logistics Dashboard (WarehouseService)
New page: `/warehouse`
- View inventory (weapons, ammo, fuel) per airbase
- Add/remove items to restock airbases
- Monitor liquid levels (jet fuel, diesel)
- **Backend**: Add `WarehouseServiceClient` + 6 endpoints
- **Frontend**: New page with airbase selector + inventory table

#### 2. Banned Players List (HookService.GetBannedPlayers)
Enhance: `/players` page
- Show currently banned players with their ban details
- Already have `ban/unban` — just missing the list endpoint
- **Backend**: One new gRPC wrapper + route
- **Frontend**: Add "Banned" tab to players page

#### 3. SRS Clients via gRPC (SrsService.GetClients)
Improve: `/srs` page
- Replace file-based `clients-list.json` polling with native gRPC
- Get real-time SRS client data (name, coalition, frequencies)
- **Backend**: Add `SrsServiceClient` wrapper
- **Frontend**: Minor — data shape is similar

#### 4. Richer Event Processing
Improve: `/events` page + map
- Parse and display all event types (currently only Dead/Kill)
- Show player connects/disconnects, takeoffs/landings, shots/hits
- Build a **combat log** with kill/death feeds
- Surface `SimulationFps` as a server performance indicator
- **Backend**: Extend `run_events()` in telemetry.rs
- **Frontend**: Categorized event feed with filters

---

### 🟡 Priority 2 — Medium Value, Medium Effort

#### 5. Coalition Order of Battle (CoalitionService)
New page: `/orbat` (Order of Battle)
- `GetGroups` per coalition → hierarchical unit tree
- `GetPlayerUnits` → player-occupied slots
- `GetStaticObjects` → static object listing
- `GetBullseye` → bullseye position displayed on map
- **Backend**: 4 new gRPC wrappers + routes
- **Frontend**: New page with expandable tree + map integration

#### 6. Airbase Details & Parking (WorldService)
Enhance: Radar map airbase popups
- `GetAirbaseParking` → show parking spots (free/occupied)
- `GetAirbaseRunways` → runway info (heading, length)
- `SetAirbaseCoalition` → allow coalition changes from dashboard
- **Backend**: 3 new gRPC wrappers
- **Frontend**: Enhanced airbase popup with parking diagram

#### 7. Map Drawing & Marks (TriggerService)
New feature on: `/radar` page
- `MarkToAll/Coalition/Group` → place marks from dashboard
- `CircleToAll`, `LineToAll`, `RectToAll`, `ArrowToAll` → draw shapes
- `RemoveMark` → remove marks
- `Smoke`, `SignalFlare`, `IlluminationBomb` → visual effects
- **Backend**: ~10 new trigger endpoints
- **Frontend**: Drawing toolbar on map

#### 8. Unit Deep Inspector (UnitService)
Enhance: Radar unit popup
- Replace `CustomService.Eval` Lua calls with proper gRPC endpoints:
  - `GetFuel`, `GetLife`/`GetLife0`, `GetAmmo` (native, faster)
  - `GetRadar` → radar status + detected target
  - `GetSensors` → sensor loadout
  - `GetTransform` → precise orientation (heading, pitch, roll)
  - `GetDescriptor` → full unit capabilities
- `SetEmission` → toggle radar emission from dashboard
- **Backend**: ~8 new UnitService wrappers
- **Frontend**: Multi-tab unit detail panel

---

### 🟢 Priority 3 — Nice-to-Have, Higher Effort

#### 9. AI Group Control Panel (ControllerService + TriggerService)
New page: `/ai-control`
- `SetTask`, `PushTask`, `ResetTask` → assign AI tasks
- `SetOption` → change ROE, alarm state, formations
- `ActivateGroup`, `DeactivateGroup` → toggle groups
- `GroupStopMoving`, `GroupContinueMoving` → halt/resume movement
- **Backend**: ~12 new endpoints
- **Frontend**: Group selector + task builder UI

#### 10. Coalition Spawner (CoalitionService.AddGroup)
New page: `/spawn`
- Spawn ground/air/sea units via template
- Place static objects
- **Backend**: Complex request builders for GroundGroupTemplate etc.
- **Frontend**: Template picker + map click-to-place

#### 11. Live Weapon Tracking (WeaponService)
Enhance: Radar map
- Track in-flight weapons on the map
- Show weapon trajectories and targets
- **Backend**: WeaponService integration + potential streaming
- **Frontend**: Animated weapon markers

#### 12. JTAC / Laser Management (SpotService)
New panel on map
- Create laser/IR designators
- View and manage active designators
- **Backend**: SpotService integration
- **Frontend**: Designator management panel

#### 13. Server Performance Monitor
New sidebar widget
- `SimulationFps` events → live FPS graph
- `GetBallisticsCount` → active ballistics counter
- `GetModelTime` / `GetRealTime` → time acceleration ratio
- **Backend**: New polling/streaming endpoint
- **Frontend**: Mini sparkline chart in sidebar

---

## Quick Wins (Improvements to Existing Features)

| Improvement | Effort | Details |
|---|---|---|
| Replace `CustomService.Eval` for unit details with native `UnitService` | Low | Faster, no Lua injection risk |
| Replace `CustomService.Eval` for zones with `TriggerService.GetZone` | Low | Per-zone lookup is cleaner |
| Use `MissionService.GetScenarioCurrentTime` instead of `timer.getAbsTime()` eval | Trivial | One gRPC call replaces Lua eval |
| Use `WorldService.GetTheatre` instead of `env.mission.theatre` eval | Trivial | Native endpoint available |
| Use `HookService.GetMissionDescription` for mission page | Trivial | Show mission briefing text |
| Add `HookService.IsMultiplayer` check | Trivial | UI adaptation for SP vs MP |
| Use `HookService.GetBannedPlayers` for ban management | Low | Currently missing from UI |
| Add `LoadNextMission` button | Trivial | One new button + gRPC call |
| Add real-time mark sync via `MarkAdd/Change/Remove` events | Medium | Currently marks are fetched once |

---

## Open Questions

> [!IMPORTANT]
> Which features are most interesting to you? I'd suggest starting with the **Priority 1** items since they deliver the most value with least code changes. The quick wins (replacing Eval with native gRPC calls) can also be batched as a "code quality" pass.

> [!NOTE]
> Some features like the **AI Control Panel** and **Coalition Spawner** are powerful but potentially dangerous in a multiplayer environment. Do you want role-based permissions for destructive actions?

> [!NOTE]
> The current SRS integration is file-based. If the DCS-gRPC SRS plugin is enabled on your server, we can switch to the native `SrsService.GetClients` endpoint for real-time data and even add TTS capabilities via `SrsService.Transmit`.
