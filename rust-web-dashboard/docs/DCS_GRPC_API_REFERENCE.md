# DCS-gRPC API Capabilities & Feature Roadmap

This document provides a comprehensive review of all the Remote Procedure Calls (RPCs) exposed by the DCS-gRPC plugin. It maps out the available services, lists their functions, and proposes high-impact new features that can be built into the web dashboard based on these capabilities.

---

## 1. Complete API Reference by Service

The DCS-gRPC server exposes various Protocol Buffer (`.proto`) services. Below is a breakdown of all available capabilities.

### 🌐 `hook` & `metadata` (Server & Lifecycle Control)
Direct interaction with the DCS server runtime and mission states.
- **Mission Lifecycle**: 
  - `LoadMission`, `LoadNextMission`, `ReloadCurrentMission`, `StopMission`
- **Simulation Control**: 
  - `SetPaused`, `GetPaused`
- **Information Queries**: 
  - `GetMissionName`, `GetMissionFilename`, `GetMissionDescription`
  - `GetHealth`, `GetVersion`, `IsMultiplayer`, `IsServer`, `GetRealTime`
- **Execution & Admin**: 
  - `Eval` (Executes raw Lua script directly inside the DCS environment).
  - `ExitProcess` (Shuts down the server).
  - `BanPlayer`, `UnbanPlayer`, `GetBannedPlayers`

### 👥 `net` (Player Management)
Managing connected players and server communication.
- **Player Lists**: `GetPlayers`
- **Moderation & Control**: `KickPlayer`, `ForcePlayerSlot`
- **Communication**: `SendChat`, `SendChatTo`

### 🗺️ `world` & `coalition` (Environment & Static Map Data)
Reading and interacting with static elements in the DCS environment.
- **Airbases & Theaters**: `GetAirbases`, `GetTheatre`
- **F10 Map Marks**: `GetMarkPanels`
- **Static Objects (Buildings/FARP/Cargo)**: 
  - `GetStaticObjects`, `AddStaticObject`, `AddLinkedStatic`
- **Groups & Units**: `GetGroups`, `GetPlayerUnits`, `SearchObjects`
- **Navigation**: `GetBullseye`

### 📡 `mission` (Telemetry & F10 Menus)
Streaming live telemetry and dynamically injecting F10 radio menu commands.
- **Live Streams**: 
  - `StreamUnits` (Live coordinates/telemetry for Airplanes, Helos, Ships, Ground).
  - `StreamEvents` (Kills, Hits, Takeoffs, Spawns, Chat, SRS connects, etc.).
- **In-Game Time**: `GetScenarioStartTime`, `GetScenarioCurrentTime`
- **F10 Radio Commands** (Allows players to interact with the dashboard via the F10 menu):
  - `AddMissionCommand`, `AddCoalitionCommand`, `AddGroupCommand`
  - Includes commands to add sub-menus and remove items dynamically.

### 🎮 `trigger` (Visual FX, Text & Flags)
Triggering visual and logical events in the mission.
- **In-Game Text**: `OutText`, `OutTextForCoalition`, `OutTextForGroup`, `OutTextForUnit`
- **Logic Flags**: `GetUserFlag`, `SetUserFlag`
- **F10 Map Drawing**: `MarkToAll`, `MarkToCoalition`, `MarkToGroup`, `RemoveMark`
- **Visual FX**: 
  - `Smoke`, `SignalFlare`, `IlluminationBomb`, `Explosion`

### ✈️ `unit`, `group`, & `controller` (AI and Entity Control)
Controlling specific units and AI behavior.
- **Unit Telemetry**: `GetPosition`, `GetRadar`, `GetSensors`, `GetTransform`, `GetDrawArgumentValue`
- **Combat & States**: 
  - `SetEmission` (Turn unit radar on/off).
  - `SetAlarmState` (Green/Red state for AI).
  - `GetDetectedTargets` (Find out exactly what an AI radar is tracking).
  - `Destroy` (Instantly kill a unit or group).
- **Group Management**: `GetUnits`, `Activate` (Spawn late-activation groups).

### ⏱️ `timer` & `srs` (Time & Audio)
- **Time Utilities**: `GetTime`, `GetAbsoluteTime`, `GetTimeZero`
- **SRS Integration**: `Transmit` (Send TTS audio to a frequency), `GetClients`

---

## 2. Potential New Dashboard Features

By combining the APIs listed above, we can implement several major new features in the dashboard.

### Feature 1: Advanced Server Admin & Mission Control
Currently, server admins have to use external tools (like WebGUI) to restart or pause missions.
*   **Pause/Unpause Button:** Instantly pause the DCS server from the dashboard (`hook.SetPaused`).
*   **Mission Loader:** Browse and load new `.miz` files, or restart the current mission instantly (`hook.LoadMission`, `hook.ReloadCurrentMission`).
*   **Player Moderation:** Add "Kick", "Ban", and "Force Spectator" buttons next to player names in the Players tab (`net.KickPlayer`, `hook.BanPlayer`, `net.ForcePlayerSlot`).

### Feature 2: Interactive Map Tools ("God Mode")
Turn the Radar map into a live interactive Zeus / Game Master tool.
*   **Visual FX Clicker:** Right-click anywhere on the map to instantly spawn Smoke, Signal Flares, or Illumination Bombs to help pilots find targets (`trigger.Smoke`, `trigger.SignalFlare`).
*   **Dynamic Spawning:** Click to spawn static objects, FARP tents, or cargo dynamically (`coalition.AddStaticObject`).
*   **Target Painter (Explosions):** Right click to trigger an `Explosion` of a specific size at a specific coordinate (`trigger.Explosion`).
*   **Smite/Destroy:** Select an enemy unit on the map and click "Destroy" to instantly eliminate it (`unit.Destroy`).

### Feature 3: Live Lua Developer Console
Provide a terminal window in the dashboard that takes raw Lua code, sends it to `hook.Eval`, and prints the output. 
*   **Use Case:** This allows developers and server admins to live-debug mission scripts, check internal DCS tables, or hot-patch scripts without ever restarting the server.

### Feature 4: Dynamic F10 Menu Automations
Use `AddMissionCommand` to push interactive radio menus to players dynamically.
*   **Use Case:** A pilot requests a CSAR helicopter via their in-game F10 menu. The DCS-gRPC server sends the event to the dashboard, and the dashboard acknowledges it (via `trigger.OutTextForUnit`) and tracks the request on the web UI.

### Feature 5: AI Intel / Fog of War Viewer
*   Using `GetDetectedTargets`, add a toggle to the map to show "What the AI sees". 
*   This would draw lines from SAM sites to the targets they currently have locked on radar, allowing game masters to see exactly why an AI unit is behaving a certain way.

---

*Generated by DCS-gRPC Dashboard Analysis*
