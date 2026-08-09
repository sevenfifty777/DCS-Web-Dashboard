# DCS Web Dashboard - Admin Manual

Welcome to the **DCS Web Dashboard**, a powerful, modern web interface for managing your DCS Dedicated Server remotely without ever having to touch the command line or remote desktop.

This manual explains how the dashboard works, what each page does, and how to manage the security/authentication systems.

---

## 🔐 1. Security & Authentication

The dashboard is completely restricted from the public. It features two methods of authentication, both controlled by the `web-dashboard/.env.local` file.

### Master Password (Fallback)
You can define a master password in your `.env.local` file:
```ini
ADMIN_PASSWORD=your_super_secret_password
```
If Discord is ever down, or you just need quick access, you can type this password into the login page.

### Discord OAuth2 Integration
You can allow members of your community to log in using their Discord accounts. The dashboard will automatically check if they are in your server and if they possess the correct Admin or Moderator role.

**How to setup:**
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new Application.
3. Go to the **OAuth2** tab and add your Redirect URIs (e.g., `http://51.75.131.6:3001/api/auth/callback`).
4. Copy the Client ID and Client Secret.

Update your `.env.local` file with the following variables:
```ini
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_GUILD_ID=your_discord_server_id
DISCORD_ADMIN_ROLE_ID=role_id_1,role_id_2 # You can comma-separate multiple roles!
NEXT_PUBLIC_APP_URL=http://51.75.131.6:3001 # Your live server IP
```
*Note: A session pass lasts for 7 days. If a user loses their role on Discord, they will be rejected the next time their session expires or if they try to log in from a new device.*

### Task Manager Whitelist
By default, the **Tasks** tab will display every single root task in your Windows Task Scheduler. For security, you can restrict the dashboard to only display and control specific DCS-related tasks by adding a whitelist to `.env.local`:
```ini
DCS_TASK_WHITELIST="DCS Web Server Console, DCSAdminBot, STACY'S BRAA, gRPC-LSO"
```
If this variable exists, any task not in this list will be completely hidden from the dashboard.

### Dynamic Weather Integration
To enable the Weather tab and allow the dashboard to generate and inject dynamic weather presets, you must point the dashboard to the `DCS-Dynamic-Weather` generator script in `.env.local`:
```ini
DCS_DYNAMIC_WEATHER_DIR="C:\Users\admin\Saved Games\DCS.openbeta_server\Missions\Dynamic_Weather_mission"
PYTHON_EXE="python" # Optional: Path to python executable if not in PATH
```

---

## 🎛️ 2. Dashboard Features

### 🟢 Server Status
The homepage. It gives you a quick, beautiful overview of the server's health, current active mission, uptime, and player count.

### 🗺️ Mission Management
This tab allows you to completely control the server's mission queue.
- **Active Mission Identification:** The dashboard asks the live DCS Engine directly via gRPC exactly which mission is running. It actively highlights the true running mission in the queue with an "Active" badge.
- **Mission Queue:** Displays all `.miz` files queued up in the `serverSettings.lua`.
- **Run Now:** Immediately loads and runs any mission file bypassing the queue entirely.
- **Upload:** You can upload a local `.miz` file from your PC directly to the server.
- **Browse Server:** You can browse the server's hard drive to add existing `.miz` files into the queue without needing to launch them immediately.
- **Remove:** Remove missions from the rotation queue.

### 🌤️ Weather
A fully integrated GUI for the `DCS-Dynamic-Weather` python script.
- **Current Weather:** Queries the DCS engine live via gRPC to see exactly what mission is running, and cross-references it with the Python script's output (`dto.json`) to show you the currently injected weather state.
- **Presets List:** Displays all available weather presets (CAVOK, Stormy, etc.) including temperature, QNH, and wind speed right from the UI.
- **Apply & Restart:** Seamlessly injects a new weather preset and restarts the mission. It automatically handles the **A/B Mission Swap Logic** so the Python script can safely edit the inactive `.miz` file without triggering a Windows file-lock error!

### 📡 Radar & Atmosphere (gRPC Live Streams)
If you have the DCS-gRPC mod installed and configured, these tabs provide live telemetry:
- **Radar:** A live, dynamic radar plot of all active units in the server. 
  - **Custom Shapes:** ✈️ Airplanes, 🚁 Helicopters, 🚢 Ships, and 🚙 Ground Units all have distinct SVG shapes.
  - **Player Identification:** Human players are highlighted with larger icons, glowing gold borders, and prominently display their name in the popup.
- **Atmosphere:** Live weather conditions, wind, and atmospheric data straight from the running mission.

### 📅 Events & Chat
- **Events:** Streams live kill-feeds, takeoffs, landings, and crashes.
- **Chat:** View the live in-game multiplayer chat and send messages directly to players from your web browser!

### 👥 Players
See exactly who is online, their ping, coalition, and what aircraft they are flying.

### 🖥️ Task Manager
This page acts as a remote control for your Windows Server's Task Scheduler using native PowerShell integrations.
- It fetches the live status (`Ready`, `Running`, `Disabled`) of your background tasks.
- You can remotely **Start**, **Stop**, and **Restart** server bots and scripts directly from the browser.
- **Guardrails:** Every action prompts for confirmation (in French) to prevent accidental clicks. Tasks containing the word "RestartServer" trigger a massive red warning to ensure you don't accidentally reboot the entire physical machine.

### ⚙️ Server Settings
This page provides a visual UI to edit the underlying `serverSettings.lua` file safely.
- You can change the server name, password, description, and max players.
- You can modify advanced DCS behavior (Allow pure textures, force tail numbers, enable sensor exports, etc).
- **Important:** Any changes made here are saved directly to the file, but DCS requires you to restart the current mission for the changes to apply.

### 🛡️ Access Logs
A security audit trail. Every time a user attempts to log in via Discord, the backend secretly logs it.
- **Green (SUCCESS):** A user successfully logged in and was granted a 7-day session.
- **Red (REJECTED):** A user tried to log in but did not have the required Discord role or wasn't in the server.
- This allows you to monitor exactly who is trying to access the dashboard. The log is capped at the 1,000 most recent attempts.

---

## 🛠️ 3. Troubleshooting

**"Hydration Failed" Error in Browser Console**
If you ever see a "Hydration Failed" React error, it usually happens if you edited code while the browser tab was open. Just do a hard refresh (`Ctrl + F5`) and it will resolve itself.

**Discord Redirects to Localhost**
If logging in with Discord drops you onto `http://localhost:3001` instead of your live IP, double check that `NEXT_PUBLIC_APP_URL` is set to your actual IP in `.env.local` and restart the dashboard.

**Changes in Settings Tab Not Applying**
The dashboard edits the `serverSettings.lua` file flawlessly. However, DCS reads this file only when starting a new mission or rebooting. You must cycle the mission for changes to take effect in-game.

**WinError 5 (Access Denied) applying Weather**
This is typically caused by the dashboard's A/B mission swap logic losing sync with the `.miz` files on the hard drive. Ensure your mission queue ends with `_A.miz` or `_B.miz` so the Python script can swap them without fighting DCS for file access.

---

## 🚀 4. Deployment & Background Execution

### Why Windows Task Scheduler is NOT recommended
If you schedule the dashboard using Windows Task Scheduler to run on startup, you might find it randomly hangs or becomes completely inaccessible. This happens because:
1. **Working Directory Issues:** Task Scheduler defaults the working directory to `C:\Windows\System32`, breaking Next.js paths unless explicitly defined.
2. **Buffer Blocking:** Node.js continuously generates console logs. If run headlessly in Task Scheduler without piping output to a file, the output buffer fills up and permanently freezes the application.
3. **QuickEdit Mode:** If run interactively, a simple mouse click inside the hidden console window pauses the entire Node process.

### The Best Option: NSSM (Non-Sucking Service Manager)
The absolute best, industry-standard way to run a Node.js application like this dashboard on a Windows Server is to install it as a native Windows Service using **NSSM**.

**How to setup NSSM:**
1. Download NSSM from [nssm.cc](https://nssm.cc/) and extract it.
2. Open an Administrator Command Prompt or PowerShell and navigate to the extracted `win64` folder.
3. Run the installer UI:
   ```cmd
   nssm install "DCS Web Dashboard"
   ```
4. In the GUI that pops up, configure the following:
   - **Path:** `C:\Program Files\nodejs\npm.cmd` (or wherever your `npm.cmd` is located).
   - **Directory:** `C:\path\to\your\DCS-gRPC\web-dashboard` (CRITICAL: It must point to your dashboard folder!)
   - **Arguments:** `start`
   - **Details tab -> Display name:** `DCS Web Dashboard`
   - **Details tab -> Startup type:** `Automatic`
   - **Log on tab:** You can usually leave this as the default **Local System account**. If you experience permission errors reading DCS files later, you can change it to the `admin` user.
5. **CRITICAL STEP:** Go to the **I/O tab**. You MUST define log files here otherwise the app will crash when the buffer fills:
   - **Output (stdout):** `C:\path\to\web-dashboard\logs\dashboard-out.log`
   - **Error (stderr):** `C:\path\to\web-dashboard\logs\dashboard-error.log`
6. Click **Install service**.

You can now start, stop, or restart the dashboard cleanly using the native Windows `services.msc` panel, and it will boot completely headless and crash-proof alongside Windows!
