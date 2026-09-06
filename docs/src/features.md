# Features & Admin Manual

The DCS Web Dashboard is a powerful web interface for managing your DCS Dedicated Server remotely. Here is a breakdown of all the features available across the dashboard.

## 💻 Server Dashboard (Top Panel)

- **RDP Available**: Displays a live indicator showing if there are any active Windows Remote Desktop (RDP) or interactive user sessions on the server host machine.
- **Mission Environment**: Quickly see the current Theatre (e.g., Caucasus, Syria) and the in-game Time of the active mission.

### Customising the left panel

The page list in the left panel is yours to arrange:

- **Right-click a page** (or press `Shift+F10` on a focused one) for a menu with **Move up**, **Move down**, **Hide**, **Show hidden pages…** and **Reset to default**.
- **Drag to reorder**: press and hold a page, or grab the `⋮⋮` grip that appears at its right edge, and drop it where you want it. On a phone or tablet use the grip; swiping elsewhere still scrolls the list.
- **Hidden pages** are listed in a `+ N hidden pages` row above **Logout**. Expand it and press **Show** to bring a page back. A hidden page is still reachable by its URL. **Server Status** cannot be hidden, so the list is never empty.
- After hiding or resetting, an **Undo** line appears for a few seconds.

The layout is saved in the browser (per device); clearing site data or using another browser gives the default order again. Pages added in a future release appear at the end of the list.

## 🟢 Server Status

The homepage gives you a quick, beautiful overview of the server's health, current active mission, uptime, and player count.

## 🗺️ Mission

Completely control the server's mission queue.

- **Active Mission**: Queries the live DCS Engine via gRPC to actively highlight the true running mission in the queue.
- **Mission Queue**: Displays all `.miz` files queued up in the `serverSettings.lua`.
- **Run Now**: Immediately loads and runs any mission file, bypassing the queue entirely.
- **Upload**: Upload a local `.miz` file from your PC directly to the server.
- **Browse Server**: Browse the server's hard drive to add existing `.miz` files into the queue.
- **Download**: Pull any `.miz` back to your PC from the server-files browser or the uploads panel. Downloads are restricted to `.miz` files inside the DCS `Missions/` tree.

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

- **Carrier detection**: Every carrier-type ship group in the running mission is detected automatically from its DCS attributes (CVN and CV classes, LHA-1 Tarawa, Kuznetsov, and modded hulls such as the HMS Invincible or Essex) and classified as CATOBAR, STOBAR, VSTOL or unclassified. Detection costs one mission Eval per page load or Refresh; between refreshes the radar stream keeps the list live for free, and a carrier that spawns mid-mission triggers one automatic refresh (at most once every 30 s). Hulls that detection misses can be added by name.
- **One panel per carrier**: Each detected carrier gets its own panel with a header (group, type, coalition, deck class, controller backend, recovery phase), a **Sync** checkbox, its Carrier Actions, a **Target WOD** control, the wind wheel drawn from that ship's telemetry and its deck view. Tick a carrier in the sidebar to show it; hidden and unsynced carriers cost no data flow. Sync polls the wind and the controller's plan for every synced ship in **one** batched request every 2 s (`GET /api/airboss?names=CVN-72,CVN-74`), so N synced carriers cost one Eval per interval. Headings, positions and deck views always come from the radar stream, so an unsynced panel still shows its deck live and the wheel keeps its last known wind greyed with a "not synced" tag. A ship that leaves the stream greys its panel and shows when it was lost. Shown carriers, Sync flags and targets are remembered per mission in the browser.
- **Target WOD per carrier**: A numeric input, slider (15 to 40 kt) and two presets ("CATOBAR 24", "VSTOL 20") set the wind over deck the in-game controller aims for on that ship only, via `POST /api/airboss/config`. The panel's wheel, the controller plan and the status table all show the target in use; on the Foothold-managed ship the value is also written to `CarrierRecoveryTargetWodKt` so Foothold's own solver follows it.
- **Deck profiles**: Nimitz-class hulls (CVN-71/72/73/75, Stennis), the Forrestal, the Kuznetsov, the Essex 1944, the HMS Invincible, the ARA Veinticinco de Mayo and the LHA-1 Tarawa draw their full deck with the parking spots, helicopter terminals and taxi-to-launch routes taken from their DCS `RunwaysAndRoutes.lua` tables (catapults, STOVL runs and deck-run ramps). Any other hull draws a generic outline sized by class until a profile is added to `deckProfiles.ts`.
- **Manual planner**: The reverse WOD calculation with sliders and wheel stays available as a separate panel without a ship.
- **Carrier Actions**: Remotely command any carrier group to turn into the wind for a timed recovery window, resume its normal circuit, or report its recovery status. The controller is a dashboard-owned Lua script injected into the running mission on first use, so it works in any mission. In Foothold missions it hands over to Foothold's own carrier navigation so the ship returns to its lane; elsewhere it resumes the ship's Mission Editor route, or steams back to where the recovery started when the ship has no route. The land-clearance check, the 60 s warning, the alignment phase and the 30-minute window match the Foothold behaviour, and the page's solver is pinned to the in-game one by a shared test fixture. Missions can also load `rust-web-dashboard/lua/carrier_recovery.lua` with a DO SCRIPT FILE trigger and call `CarrierRecovery.installMenus("CVN-72")` to get the same three commands in the F10 menu; the `CarrierRecovery*` variables from `Foothold Config.lua` are honoured when present.
- **Live Deck Views**: Track aircraft assigned to the Carrier and Tarawa decks with dedicated silhouettes for the F-14, F/A-18, Su-33, F4U-1D Corsair (both DCS variants), AV-8B, A-4E-C, A-6E, E-2 Hawkeye, S-3B Viking, T-45C, AH-64D, CH-47F, Ka-50 III, OH-58D, SA342, and UH-1H families. Aircraft parked on a catapult, ramp or STOVL start use the launch-configuration icon where one exists. Stationary fixed-wing aircraft face inward toward the deck centerline according to their port or starboard parking side, while helicopters face ship-forward and use `H1`–`H8` terminals on both ships. High-contrast cyan, magenta, and amber markers distinguish fixed-wing parking, helicopter parking, and launch positions; a white dashed ring identifies spots with no assigned taxi route by default. Click any parking marker to add the larger selection halo. Click a route-capable parking marker or aircraft to highlight its route to launch; a soft one-shot shimmer travels through the route line from parking to launch to show traffic flow. Click an amber catapult or STOVL launch marker to display every DCS-defined route connecting that launch point to its possible parking spots. Aircraft without a dedicated asset use the generic fallback marker.

## 🛬 LSO Greenie Board
Carrier recoveries graded by the [DCS-gRPC-lso](https://github.com/sevenfifty777/DCS-gRPC-lso) client, in the same 14-column layout as the client's former web page (timestamp, grade date, mission time, pilot, aircraft, map, grade, points, wire or spot, outcome, technical status, DCS grade, LSO notes).
- Refreshes every 10 seconds from the client's `lso.db`, read directly from `LSO_DIR`. This tab never calls DCS-gRPC.
- Grade colours follow greenie-board convention: `_OK_` gold, `OK` green, `(OK)` light green, `--` amber, `C` red, `B`/`WO` grey.
- Filter the table by pilot name. Click a row to open the final-approach trap sheet and the overhead pattern chart the client saved for that pass.
- Pilot UCIDs are never shown. The score is a project-derived training grade, not an official certification.
- **By pilot** (`/lso/pilots`): one section per pilot with passes, average points, last pass, a greenie strip of recent grades, and a table of their last 5 passes (switch to All for the full history). Pilots are grouped by UCID on the server, so a renamed pilot keeps one history and earlier names are listed as aliases; the UCID itself is never sent to the browser.

## 🎬 Tacview

Download the server's flight recordings without an RDP session or a file share.

- Lists `.acmi` recordings (including the compressed `.zip.acmi` form) found under `TACVIEW_DIR`, newest first, with file size and recording date.
- Capped at the **200 newest** recordings; the header says how many exist in total when there are more.
- Filter by file name, then download straight to your PC.
- Requires `TACVIEW_DIR` to be set in the service environment (see [Configuration](configuration.md)); until it is, the tab explains what to set. Downloads are restricted to `.acmi` files inside that folder.

## ⚙️ Settings

A visual UI to edit the underlying `serverSettings.lua` file safely.

- Change the server name, password, description, max players, and advanced DCS behavior.
- _Note: DCS requires you to restart the current mission for changes to apply._

## 🛡️ Logs & Tasks

- **Access Logs**: A security audit trail. Every dashboard login attempt is secretly logged (SUCCESS/REJECTED).
- **Tasks**: A remote control for your Windows Server's Task Scheduler and Processes. Fetch live status of background bots and cleanly Start/Stop/Restart them with safety guardrails.
