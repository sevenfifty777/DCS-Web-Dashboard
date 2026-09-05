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

## 📅 Triggers & Console

- **Triggers**: Read and write DCS mission flags live (e.g., to manually trigger in-game events or scripts).
- **Console**: Execute raw Lua scripts directly into the DCS mission environment for advanced debugging and administration.

## 📻 SRS (SimpleRadio Standalone)

A dedicated tab for managing SRS.

- **Server Process**: View if the SRS process is running and cleanly Start/Stop/Restart it.
- **Connected Clients**: See a live table of connected players, their coalition, and the radio frequencies they are currently tuned to. The table refreshes every five seconds, preserves the last successful result during a temporary DCS-gRPC outage, and clears its warning automatically after recovery.
- **Configuration**: A complete, categorized visual editor for your SRS `server.cfg`.

## 👥 Players & Chat

- **Players**: See exactly who is online, their ping, coalition, and what aircraft they are flying.
- **Chat**: View the live in-game multiplayer chat and send messages directly to players from your web browser!

## 🏆 Foothold Campaign (Leaderboard & Status)

Specific integrations for servers running the dynamic "Foothold" campaign.

- **Leaderboard**: A persistent leaderboard tracking live player statistics from the Foothold save file.
- **Foothold**: Track the status of the campaign: zone ownership counts, active missions, ejected-pilot count, and the player economy.
- **Config**: View and modify Foothold gameplay variables and configuration directly from the browser.

## ⚓ Airboss Planner

A dynamic toolkit for managing carrier operations on the server.

- **Auto-Sync**: Automatically calculates the required Wind Over Deck (WOD) and Base Recovery Course (BRC) using live weather data and carrier speeds.
- **Carrier Actions**: Remotely command any carrier group (name it in the panel) to turn into the wind for a timed recovery window, resume its normal circuit, or report its recovery status. The controller is a dashboard-owned Lua script injected into the running mission on first use, so it works in any mission. In Foothold missions it hands over to Foothold's own carrier navigation so the ship returns to its lane; elsewhere it resumes the ship's Mission Editor route, or steams back to where the recovery started when the ship has no route. The land-clearance check, the 60 s warning, the alignment phase and the 30-minute window match the Foothold behaviour, and the page's solver is pinned to the in-game one by a shared test fixture. Missions can also load `rust-web-dashboard/lua/carrier_recovery.lua` with a DO SCRIPT FILE trigger and call `CarrierRecovery.installMenus("CVN-72")` to get the same three commands in the F10 menu; the `CarrierRecovery*` variables from `Foothold Config.lua` are honoured when present.
- **Live Deck Views**: Track aircraft assigned to the Carrier and Tarawa decks with dedicated silhouettes for the F-14, F/A-18, AV-8B, A-4E-C, A-6E, E-2 Hawkeye, S-3B Viking, T-45C, AH-64D, CH-47F, Ka-50 III, OH-58D, SA342, and UH-1H families. Stationary fixed-wing aircraft face inward toward the deck centerline according to their port or starboard parking side, while helicopters face ship-forward and use `H1`–`H8` terminals on both ships. High-contrast cyan, magenta, and amber markers distinguish fixed-wing parking, helicopter parking, and launch positions; a white dashed ring identifies spots with no assigned taxi route by default. Click any parking marker to add the larger selection halo. Click a route-capable parking marker or aircraft to highlight its route to launch; a soft one-shot shimmer travels through the route line from parking to launch to show traffic flow. Click an amber catapult or STOVL launch marker to display every DCS-defined route connecting that launch point to its possible parking spots. Aircraft without a dedicated asset use the generic fallback marker.

## 🛬 LSO Greenie Board
Carrier recoveries graded by the [DCS-gRPC-lso](https://github.com/sevenfifty777/DCS-gRPC-lso) client, in the same 14-column layout as the client's former web page (timestamp, grade date, mission time, pilot, aircraft, map, grade, points, wire or spot, outcome, technical status, DCS grade, LSO notes).
- Refreshes every 10 seconds from the client's `lso.db`, read directly from `LSO_DIR`. This tab never calls DCS-gRPC.
- Grade colours follow greenie-board convention: `_OK_` gold, `OK` green, `(OK)` light green, `--` amber, `C` red, `B`/`WO` grey.
- Filter the table by pilot name. Click a row to open the final-approach trap sheet and the overhead pattern chart the client saved for that pass.
- Pilot UCIDs are never shown. The score is a project-derived training grade, not an official certification.
- **By pilot** (`/lso/pilots`): one section per pilot with passes, average points, last pass, a greenie strip of recent grades, and a table of their last 5 passes (switch to All for the full history). Pilots are grouped by UCID on the server, so a renamed pilot keeps one history and earlier names are listed as aliases; the UCID itself is never sent to the browser.

## ⚙️ Settings

A visual UI to edit the underlying `serverSettings.lua` file safely.

- Change the server name, password, description, max players, and advanced DCS behavior.
- _Note: DCS requires you to restart the current mission for changes to apply._

## 🛡️ Logs & Tasks

- **Access Logs**: A security audit trail. Every dashboard login attempt is secretly logged (SUCCESS/REJECTED).
- **Tasks**: A remote control for your Windows Server's Task Scheduler and Processes. Fetch live status of background bots and cleanly Start/Stop/Restart them with safety guardrails.
