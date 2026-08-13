# Features & Admin Manual

The DCS Web Dashboard is a powerful web interface for managing your DCS Dedicated Server remotely. Here is a breakdown of all the features available across the dashboard.

## 💻 Server Dashboard (Top Panel)

- **RDP Available**: Displays a live indicator showing if there are any active Windows Remote Desktop (RDP) or interactive user sessions on the server host machine.
- **Mission Environment**: Quickly see the current Theatre (e.g., Caucasus, Syria) and the in-game Time of the active mission.

## 🟢 Server Status

The homepage gives you a quick, beautiful overview of the server's health, current active mission, uptime, and player count.

## 🗺️ Mission

Completely control the server's mission queue.

- **Active Mission**: Queries the live DCS Engine via gRPC to actively highlight the true running mission in the queue.
- **Mission Queue**: Displays all `.miz` files queued up in the `serverSettings.lua`.
- **Run Now**: Immediately loads and runs any mission file, bypassing the queue entirely.
- **Upload**: Upload a local `.miz` file from your PC directly to the server.
- **Browse Server**: Browse the server's hard drive to add existing `.miz` files into the queue.

## 🌤️ Weather

A fully integrated GUI for the `DCS-Dynamic-Weather` python script.

- **Current Weather**: Cross-references the running mission with the Python script's output to show you the currently injected weather state.
- **Presets List**: Displays all available weather presets (CAVOK, Stormy, etc.) including temperature, QNH, and wind speed.
- **Apply & Restart**: Seamlessly injects a new weather preset and restarts the mission, safely handling A/B mission swapping.

## 📡 Radar & ORBAT

- **Radar**: A live, dynamic radar plot of all active units in the server. Airplanes, helicopters, ships, and ground units have distinct shapes. Human players are highlighted with glowing borders.
- **ORBAT (Order of Battle)**: View the hierarchical structure of all spawned groups and units on both coalitions.

## 📅 Events, Triggers & Console

- **Events**: Streams live kill-feeds, takeoffs, landings, and crashes.
- **Triggers**: Read and write DCS mission flags live (e.g., to manually trigger in-game events or scripts).
- **Console**: Execute raw Lua scripts directly into the DCS mission environment for advanced debugging and administration.

## 📻 SRS (SimpleRadio Standalone)

A dedicated tab for managing SRS.

- **Server Process**: View if the SRS process is running and cleanly Start/Stop/Restart it.
- **Connected Clients**: See a live table of connected players, their coalition, and the radio frequencies they are currently tuned to.
- **Configuration**: A complete, categorized visual editor for your SRS `server.cfg`.

## 🌬️ Atmosphere

Live weather conditions, wind, and atmospheric data straight from the running mission.

## 👥 Players & Chat

- **Players**: See exactly who is online, their ping, coalition, and what aircraft they are flying.
- **Chat**: View the live in-game multiplayer chat and send messages directly to players from your web browser!

## 🏆 Foothold Campaign (Leaderboard & Status)

Specific integrations for servers running the dynamic "Foothold" campaign.

- **Leaderboard**: A persistent leaderboard tracking live player statistics from the Foothold save file.
- **Foothold**: Track the status of the campaign including active zones, ongoing attacks, side ownership, and ejected pilots.

## 📦 Warehouse (WIP)

View and manage the inventory of airbases across the map. You can dynamically add items or liquids to airbase warehouses mid-mission.

## ⚙️ Settings

A visual UI to edit the underlying `serverSettings.lua` file safely.

- Change the server name, password, description, max players, and advanced DCS behavior.
- _Note: DCS requires you to restart the current mission for changes to apply._

## 🛡️ Logs & Tasks

- **Access Logs**: A security audit trail. Every dashboard login attempt is secretly logged (SUCCESS/REJECTED).
- **DCS Logs**: A live, streaming tail of the `dcs.log` file straight from the server's hard drive to help you debug crashes or script errors.
- **Tasks**: A remote control for your Windows Server's Task Scheduler and Processes. Fetch live status of background bots and cleanly Start/Stop/Restart them with safety guardrails.
