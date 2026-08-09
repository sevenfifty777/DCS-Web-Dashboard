# DCS Web Dashboard (Rust) — Installation & Admin Guide

A complete, start-to-finish guide for deploying the **single-binary Rust web dashboard** on a
brand-new Windows server, and for administering it day to day.

This is the Rust port of the original Next.js dashboard. Unlike the Node version, it ships as
**one self-contained executable** with the web UI embedded inside it — there is **no Node.js,
no `npm`, and no `.env.local`** at runtime. You configure it with ordinary environment variables.

> **Audience:** server admins setting this up for the first time. No Rust or web-dev experience
> required to _run_ it. Building from source needs the Rust toolchain (covered below).

---

## Table of Contents

- [DCS Web Dashboard (Rust) — Installation \& Admin Guide](#dcs-web-dashboard-rust--installation--admin-guide)
  - [Table of Contents](#table-of-contents)
  - [1. What you get](#1-what-you-get)
  - [2. Requirements](#2-requirements)
  - [3. Get the binary](#3-get-the-binary)
    - [Option A — Use a prebuilt binary](#option-a--use-a-prebuilt-binary)
    - [Option B — Build from source](#option-b--build-from-source)
  - [4. Configuration (environment variables)](#4-configuration-environment-variables)
    - [How to set the variables](#how-to-set-the-variables)
  - [5. Discord OAuth setup](#5-discord-oauth-setup)
  - [6. Quick start (foreground test)](#6-quick-start-foreground-test)
  - [7. Install as a Windows service (NSSM)](#7-install-as-a-windows-service-nssm)
  - [8. Firewall \& HTTPS](#8-firewall--https)
  - [9. First login](#9-first-login)
  - [10. Admin guide — features](#10-admin-guide--features)
    - [🔐 Authentication model](#-authentication-model)
    - [🟢 Server Status](#-server-status)
    - [🗺️ Mission Management](#️-mission-management)
    - [🌤️ Weather _(requires `DCS_DYNAMIC_WEATHER_DIR`)_](#️-weather-requires-dcs_dynamic_weather_dir)
    - [📡 Radar \& Atmosphere (live gRPC streams)](#-radar--atmosphere-live-grpc-streams)
    - [📅 Events \& 💬 Chat](#-events---chat)
    - [👥 Players](#-players)
    - [🖥️ Tasks (Windows Task Scheduler remote control)](#️-tasks-windows-task-scheduler-remote-control)
    - [⚙️ Server Settings](#️-server-settings)
    - [🛡️ Access Logs](#️-access-logs)
  - [11. Updating the dashboard](#11-updating-the-dashboard)
  - [12. Troubleshooting](#12-troubleshooting)

---

## 1. What you get

- A single executable: `rust-web-dashboard.exe`.
- The full web UI (the Next.js static export) is **embedded** in the binary and served over HTTP,
  including deep links (e.g. `/weather`) and all hashed `/_next/...` assets.
- An HTTP API that is a **gRPC client** of your running [DCS-gRPC](https://github.com/DCS-gRPC/rust-server)
  server, plus filesystem/OS integration for missions, settings, weather, logs, and tasks.
- JWT bearer authentication (password and/or Discord), with a **7-day** session lifetime.

---

## 2. Requirements

**On the server that runs the dashboard:**

| Component                              | Required?           | Notes                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Server / Windows 10+           | Yes                 | The OS-integration features (Task Scheduler, `serverSettings.lua`, missions) target Windows.                                                                                                                                    |
| **DCS-gRPC mod**                       | Yes (for live data) | Installed in `Saved Games\...\Scripts` and running. The dashboard connects to it (default `http://localhost:50051`). Without it, the UI loads but live tabs show no data and you'll see harmless reconnect warnings in the log. |
| **NSSM** (Non-Sucking Service Manager) | Recommended         | To run the binary as a resilient Windows service. Download from [nssm.cc](https://nssm.cc/).                                                                                                                                    |
| **DCS-Dynamic-Weather** + **Python**   | Optional            | Only needed for the Weather tab. Python must be reachable (on PATH or via `PYTHON_EXE`).                                                                                                                                        |
| Node.js + Rust toolchain               | Only to **build**   | Not needed if you have a prebuilt `rust-web-dashboard.exe`. See [§3](#3-get-the-binary).                                                                                                                                        |

**To build the binary yourself you additionally need:**

- **Rust 1.85+** ([rustup.rs](https://rustup.rs/)). No system `protoc` or Lua needed — protobuf is
  compiled with a bundled `protoc`, and Lua is vendored.
- **Node.js 18+** _only_ if you need to rebuild the embedded frontend from `web-dashboard`.

---

## 3. Get the binary

You can either use a prebuilt binary or build from source.

### Option A — Use a prebuilt binary

Copy `rust-web-dashboard.exe` to a permanent folder on the server, e.g.:

```
C:\DCS-Dashboard\rust-web-dashboard.exe
```

That single file contains the whole web UI. Nothing else needs to be deployed alongside it.

### Option B — Build from source

The frontend snapshot is already embedded in the crate's `static/` folder, so a normal release
build is all you need.

> **cwd caveat (Windows):** this crate is **not** part of a cargo workspace, and terminals often
> open at the repo root. Always pass `--manifest-path` so cargo finds the right manifest.

```powershell
cargo build --release --manifest-path "C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\Cargo.toml"
```

The optimized binary is produced at:

```
rust-web-dashboard\target\release\rust-web-dashboard.exe
```

(To refresh the embedded UI after frontend changes, see [§11](#11-updating-the-dashboard).)

---

## 4. Configuration (environment variables)

The dashboard reads **environment variables** at startup. There is **no `.env.local` file** —
empty/whitespace values are treated as unset.

The only **required** variable is `JWT_SECRET`. The binary refuses to start without a secret of
at least **16 characters**.

| Variable                  | Required | Default                         | Purpose                                                                                                                                                                                                                                                                                                             |
| ------------------------- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`              | **Yes**  | —                               | Signing secret for login tokens (HS256). **Must be ≥ 16 characters.** Use a long random string and keep it private. Changing it logs everyone out.                                                                                                                                                                  |
| `DASHBOARD_ADDR`          | No       | `0.0.0.0:3001`                  | Address/port the dashboard listens on. Use `127.0.0.1:3001` if a reverse proxy is in front.                                                                                                                                                                                                                         |
| `GRPC_ENDPOINT`           | No       | `http://localhost:50051`        | Where your DCS-gRPC server is listening.                                                                                                                                                                                                                                                                            |
| `APP_URL`                 | No       | `http://localhost:3001`         | Public base URL of the dashboard. **Must match the real public IP/host** for Discord login redirects to work.                                                                                                                                                                                                       |
| `ADMIN_PASSWORD`          | No       | —                               | Enables master-password login when set.                                                                                                                                                                                                                                                                             |
| `MOBILE_API_KEY`          | No       | —                               | Static bearer key accepted by the native mobile app. Generate a random string.                                                                                                                                                                                                                                      |
| `DISCORD_CLIENT_ID`       | No       | —                               | Discord OAuth — enables Discord login when all four Discord vars are set.                                                                                                                                                                                                                                           |
| `DISCORD_CLIENT_SECRET`   | No       | —                               | Discord OAuth app secret.                                                                                                                                                                                                                                                                                           |
| `DISCORD_GUILD_ID`        | No       | —                               | Your Discord server (guild) ID. Users must be a member.                                                                                                                                                                                                                                                             |
| `DISCORD_ADMIN_ROLE_ID`   | No       | —                               | Comma-separated list of role IDs allowed to log in.                                                                                                                                                                                                                                                                 |
| `DCS_SAVED_GAMES_DIR`     | No       | derived                         | Absolute path to your DCS _Saved Games_ folder. Drives `serverSettings.lua`, `Missions/`, and uploads. Set this explicitly unless the binary lives under `Saved Games\...\Scripts`.                                                                                                                                 |
| `DCS_TASK_WHITELIST`      | No       | —                               | Comma-separated, case-insensitive allow-list of Windows scheduled-task names the **Tasks** tab may show/control. If unset, **all** root tasks are shown.                                                                                                                                                            |
| `DCS_DYNAMIC_WEATHER_DIR` | No       | —                               | Path to the DCS-Dynamic-Weather generator folder. Required for the Weather tab.                                                                                                                                                                                                                                     |
| `PYTHON_EXE`              | No       | `python`                        | Python interpreter used by the weather generator.                                                                                                                                                                                                                                                                   |
| `AUDIT_LOG_PATH`          | No       | `audit_logs.json`               | File where login attempts are recorded (Access Logs tab).                                                                                                                                                                                                                                                           |
| `RUST_LOG`                | No       | `info,rust_web_dashboard=debug` | Log verbosity (e.g. `info`, `warn`, `debug`).                                                                                                                                                                                                                                                                       |
| `DCS_START_CMD`           | No       | —                               | The command used to launch your DCS Server directly via PowerShell. Example: `'"C:\...\DCS_server.exe" --server --norender'`. Notice the **single quotes** surrounding the double quotes—this ensures Windows parses paths with spaces correctly. Recommended over Task Scheduler for immediate Start/Stop control. |
| `DCS_SCHEDULED_TASK_NAME` | No       | —                               | Legacy fallback. The name of a Windows Scheduled Task to run when starting DCS. (Used if `DCS_START_CMD` is not set).                                                                                                                                                                                               |
| `SRS_START_CMD`           | No       | —                               | The command used to launch SimpleRadio Standalone (SRS). Example: `'Start-Process -FilePath "C:\...\SRS-Server.exe" -ArgumentList "-cfg=\"C:\...\server.cfg\"" -WindowStyle Hidden'`. Required for SRS Start/Stop buttons.                                                                                          |
| `SRS_SCHEDULED_TASK_NAME` | No       | —                               | Legacy fallback. The name of a Windows Scheduled Task to start SRS. (Used if `SRS_START_CMD` is not set).                                                                                                                                                                                                           |
| `SRS_CFG_PATH`            | No       | derived                         | Absolute path to your SRS `server.cfg`. If omitted, the dashboard attempts to parse it from `SRS_START_CMD`. Needed for the SRS settings editor and connected clients list.                                                                                                                                         |

### How to set the variables

Because there is no `.env` file, set them in the **process environment**. Two common ways:

**(a) A launch script** (good for testing; PowerShell `.ps1`):

```powershell
# start-dashboard.ps1
$env:JWT_SECRET            = "change-me-to-a-long-random-secret"   # >= 16 chars
$env:APP_URL              = "http://YOUR_PUBLIC_IP:3001"
$env:DASHBOARD_ADDR       = "0.0.0.0:3001"
$env:GRPC_ENDPOINT        = "http://localhost:50051"
$env:ADMIN_PASSWORD       = "your_master_password"
$env:DCS_SAVED_GAMES_DIR  = "C:\Users\admin\Saved Games\DCS.openbeta_server"
$env:DCS_TASK_WHITELIST   = "DCS Web Server Console, DCSAdminBot, gRPC-LSO"
# Discord (optional):
$env:DISCORD_CLIENT_ID     = "..."
$env:DISCORD_CLIENT_SECRET = "..."
$env:DISCORD_GUILD_ID      = "..."
$env:DISCORD_ADMIN_ROLE_ID = "role_id_1,role_id_2"
# Weather (optional):
$env:DCS_DYNAMIC_WEATHER_DIR = "C:\Users\admin\Saved Games\DCS.openbeta_server\Missions\Dynamic_Weather_mission"
# DCS Server Process Control (optional):
$env:DCS_START_CMD = '"C:\Program Files\Eagle Dynamics\DCS World Server\bin\DCS_server.exe" --server --norender'
# SRS Process Control & Settings (optional):
$env:SRS_START_CMD = 'Start-Process -FilePath "C:\Program Files\DCS-SimpleRadio-Standalone\Server\SRS-Server.exe" -ArgumentList "-cfg=`"C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg`"" -WindowStyle Hidden'
$env:SRS_CFG_PATH = 'C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg'

& "C:\DCS-Dashboard\rust-web-dashboard.exe"
```

**(b) The NSSM "Environment" tab** (recommended for production) — see [§7](#7-install-as-a-windows-service-nssm).
This keeps secrets out of scripts and survives reboots.

> ⚠️ **Never commit `JWT_SECRET`, `ADMIN_PASSWORD`, the Discord client secret, or `MOBILE_API_KEY`
> to source control or paste them in chat.** Treat them like passwords.

---

## 5. Discord OAuth setup

Skip this section if you only use the master password.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create
   (or select) an **Application**.
2. Open the **OAuth2** tab.
3. Under **Redirects**, add your callback URL — it must match `APP_URL`:
   ```
   http://YOUR_PUBLIC_IP:3001/api/auth/callback
   ```
   (Use `https://your.domain/api/auth/callback` if you run behind an HTTPS reverse proxy.)
4. Copy the **Client ID** and **Client Secret** into `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.
5. Set `DISCORD_GUILD_ID` to your server ID and `DISCORD_ADMIN_ROLE_ID` to the role(s) allowed in
   (comma-separated for multiple).
6. Make sure `APP_URL` exactly matches the public address users hit — otherwise Discord will bounce
   logins back to `localhost`.

A successful login mints a **7-day** session token. If a user loses their role, they are rejected
the next time their session expires or they log in from a new device.

---

## 6. Quick start (foreground test)

Before installing a service, confirm it boots and serves the UI.

```powershell
$env:JWT_SECRET     = "change-me-to-a-long-random-secret"
$env:DASHBOARD_ADDR = "127.0.0.1:3099"
& "C:\DCS-Dashboard\rust-web-dashboard.exe"
```

Then open `http://127.0.0.1:3099/` in a browser. You should see the dashboard UI, and deep links
like `/weather` should load directly.

- If DCS-gRPC isn't running yet, you'll see repeating warnings like
  _"failed to open StreamUnits/StreamEvents; retrying"_ — **this is expected** and harmless; live
  tabs simply have no data until the gRPC server is up.
- Stop with `Ctrl-C` (graceful shutdown).

---

## 7. Install as a Windows service (NSSM)

Running the binary as a service makes it start on boot and restart on failure. NSSM works the same
as it did for the Node version, except the **Path** points directly at the `.exe` and there is no
`npm`/working-directory fragility.

1. Open an **Administrator** PowerShell/Command Prompt and go to your extracted NSSM folder:
   ```cmd
   cd C:\nssm\win64
   nssm install "DCS Web Dashboard"
   ```
2. In the GUI:

   **Application tab**
   - **Path:** `C:\DCS-Dashboard\rust-web-dashboard.exe`
   - **Startup directory:** `C:\DCS-Dashboard`
   - **Arguments:** _(leave blank)_

   **Details tab**
   - **Display name:** `DCS Web Dashboard`
   - **Startup type:** `Automatic`

   **Log on tab**
   - Default **Local System** is usually fine. If you later get _Access Denied_ reading DCS files,
     change it to the Windows account DCS runs under.

   **I/O tab** _(optional but handy)_
   - **Output (stdout):** `C:\DCS-Dashboard\logs\dashboard-out.log`
   - **Error (stderr):** `C:\DCS-Dashboard\logs\dashboard-error.log`

   **Environment tab** _(recommended — this is where your config lives)_
   Enter each variable on its own line, `KEY=value`:

   ```
   JWT_SECRET=change-me-to-a-long-random-secret
   APP_URL=http://YOUR_PUBLIC_IP
   DASHBOARD_ADDR=127.0.0.1:3001
   GRPC_ENDPOINT=http://127.0.0.1:50051
   ADMIN_PASSWORD=your_master_password
   DCS_SAVED_GAMES_DIR=C:\Users\admin\Saved Games\DCS.openbeta_server
   DCS_TASK_WHITELIST=DCS Web Server Console, DCSAdminBot, gRPC-LSO
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   DISCORD_GUILD_ID=...
   DISCORD_ADMIN_ROLE_ID=role_id_1,role_id_2
   DCS_START_CMD="C:\Program Files\Eagle Dynamics\DCS World Server\bin\DCS_server.exe" --server --norender
   SRS_START_CMD=Start-Process -FilePath "C:\Program Files\DCS-SimpleRadio-Standalone\Server\SRS-Server.exe" -ArgumentList "-cfg=\"C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg\"" -WindowStyle Hidden
   SRS_CFG_PATH=C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg
   ```

3. Click **Install service**.
4. Open `services.msc`, find **DCS Web Dashboard**, right-click → **Start**.

To change config later: edit the service (`nssm edit "DCS Web Dashboard"`) and restart it.

---

## 8. Firewall & HTTPS

1. Open **Windows Defender Firewall with Advanced Security → Inbound Rules → New Rule**.
2. **Port → TCP → Specific local port:** `3001` → **Allow** → name it `DCS Web Dashboard (3001)`.

> ⚠️ **HTTP vs HTTPS:** the dashboard serves plain **HTTP**. Over the public internet, login tokens
> and passwords would travel unencrypted. For public access, put a reverse proxy (nginx, Caddy, or
> Cloudflare Tunnel) in front to terminate **HTTPS**. In that setup:
>
> - Bind the dashboard to `127.0.0.1:3001` (`DASHBOARD_ADDR=127.0.0.1:3001`) and **do not** open
>   port 3001 to the internet — only the proxy reaches it.
> - Set `APP_URL=https://your.domain` and use the matching `https://.../api/auth/callback` in
>   Discord.
>
> TLS termination and websockets are intentionally out of scope for the binary (the proxy handles
> TLS; the UI uses Server-Sent Events, not websockets).

---

## 9. First login

1. Browse to `http://YOUR_PUBLIC_IP:3001` (or your HTTPS domain).
2. Log in with the **master password** (`ADMIN_PASSWORD`) or **Sign in with Discord**.
3. On success you get a 7-day session and land on the **Server Status** page.

---

## 10. Admin guide — features

### 🔐 Authentication model

Two methods, both optional but you want at least one:

- **Master password** — set `ADMIN_PASSWORD`; type it on the login page. Good as a fallback.
- **Discord OAuth** — members of your guild who hold an allowed role can sign in. Sessions last
  7 days.

Every API call (except login, health, and the public telemetry streams) requires a valid bearer
token, so the dashboard is closed to the public by default.

### 🟢 Server Status

Home page: server health, current active mission, uptime, and player count at a glance.

### 🗺️ Mission Management

Control the server's mission queue:

- **Active mission** is read live from the DCS engine via gRPC and badged in the queue.
- **Queue** lists the `.miz` files from `serverSettings.lua`.
- **Run Now** loads any mission immediately, bypassing the queue.
- **Upload** pushes a local `.miz` from your PC to the server (stored under `Missions\Uploads`).
- **Browse Server** adds existing server-side `.miz` files to the queue.
- **Remove** drops a mission from rotation.
- **Process Controls** allows you to seamlessly Start, Stop, and Restart the DCS and SRS background processes directly.

### 📻 SRS Management

A dedicated tab for managing SimpleRadio Standalone (SRS):

- **Server Process**: View if the SRS process is running and cleanly Start/Stop/Restart it.
- **Connected Clients**: See a live table of connected players, their coalition (spectator, red, blue), and the radio frequencies they are currently tuned to.
- **Configuration (server.cfg)**: A complete, categorized visual editor for your SRS `server.cfg`. It safely preserves your file's comments and structure while hiding sensitive API keys and passwords from the UI.

### 🌤️ Weather _(requires `DCS_DYNAMIC_WEATHER_DIR`)_

GUI for the DCS-Dynamic-Weather Python script:

- **Current weather** cross-references the live mission with the script's output.
- **Presets** lists available profiles (temperature, QNH, wind, etc.).
- **Apply & Restart** injects a preset and cycles the mission, handling the **A/B mission swap** so
  Python can edit the inactive `.miz` without a Windows file-lock conflict.

### 📡 Radar & Atmosphere (live gRPC streams)

- **Radar** — live plot of all units with distinct shapes (planes, helos, ships, ground) and
  highlighted human players. Streamed via SSE.
- **Atmosphere** — live wind/weather/atmospheric data from the running mission.

### 📅 Events & 💬 Chat

- **Events** — live kill-feed, takeoffs, landings, crashes.
- **Chat** — read in-game multiplayer chat and send messages from the browser.

### 👥 Players

Who's online, ping, coalition, and aircraft.

### 🖥️ Tasks (Windows Task Scheduler remote control)

- Shows live status (`Ready`, `Running`, `Disabled`) of background tasks/bots.
- **Start / Stop / Restart** them from the browser.
- **Whitelist:** set `DCS_TASK_WHITELIST` so only named DCS tasks appear; anything else is hidden.
- **Guardrails:** actions require confirmation; tasks that would reboot the host are flagged loudly.

### ⚙️ Server Settings

Visual editor for `serverSettings.lua` (name, password, description, max players, and advanced DCS
flags). Changes are written to disk immediately, but **DCS only reloads them on the next mission
cycle/restart**.

### 🛡️ Access Logs

Security audit trail of every login attempt (written to `AUDIT_LOG_PATH`):

- **SUCCESS** — user logged in and got a session.
- **REJECTED** — user lacked the required role or wasn't in the guild.
  Capped at the most recent ~1,000 attempts.

---

## 11. Updating the dashboard

**Updating the binary:** stop the service, replace `rust-web-dashboard.exe`, start the service.

**Re-embedding an updated frontend** (only if the UI changed): the embedded UI is a snapshot of
`web-dashboard/out/` copied into the crate's `static/` folder.

1. In `web-dashboard`, build the static export (`next.config.ts` already sets `output: 'export'`):
   ```powershell
   npm install
   npm run build
   ```
2. Replace the contents of `rust-web-dashboard\static\` with the new `web-dashboard\out\` tree.
3. Rebuild the binary (see [§3 Option B](#option-b--build-from-source)) so the new assets are baked in.

After any dependency change, run `cargo audit` (and `cargo deny check` if configured) — the
current build reports **0 vulnerabilities**.

---

## 12. Troubleshooting

**Binary exits immediately with a `JWT_SECRET` error**
`JWT_SECRET` is unset or shorter than 16 characters. Set a long random secret and restart.

**`could not find Cargo.toml` when building**
Your terminal opened at the repo root. Always pass
`--manifest-path "C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\Cargo.toml"`.

**Repeating "failed to open StreamUnits/StreamEvents; retrying" / "tcp connect error"**
No DCS-gRPC server reachable at `GRPC_ENDPOINT`. Start the DCS-gRPC mod (or fix the endpoint). The
UI still loads; live tabs populate once gRPC is up.

**Discord login redirects to `localhost`**
`APP_URL` doesn't match your public address, or the Discord redirect URI is wrong. Set `APP_URL`
to the real IP/host and add the exact `/api/auth/callback` URL in the Discord OAuth2 settings, then
restart.

**Settings changes don't show in-game**
`serverSettings.lua` is updated immediately, but DCS only re-reads it on mission cycle/restart.

**"Access Denied" reading DCS files / applying weather**
Run the service under the Windows account that owns the DCS Saved Games folder (NSSM → _Log on_
tab). For weather, ensure your queue's missions end in `_A.miz` / `_B.miz` so the A/B swap can edit
the inactive file.

**Tasks tab is empty or shows too much**
Check `DCS_TASK_WHITELIST` — when set, only matching task names appear; when unset, all root tasks
are shown.

**DCS process launches but refuses to load a mission**
When DCS starts as a dedicated server in the background, it MUST find its `serverSettings.lua` in order to automatically load a mission. If it launches but idles, it is failing to locate this file or access the mission file.

- **Why this happens**: DCS relies on the Windows user's `Saved Games` folder. If you launch the dashboard via NSSM as a background service, it runs as the `SYSTEM` account. The `SYSTEM` account's `Saved Games` folder is located at `C:\Windows\System32\config\systemprofile\Saved Games\`. If you use a symbolic link (e.g. `dcs_server.release` pointing to a shared data drive) but only set it up in your normal user profile, DCS running as `SYSTEM` won't see it, will create an empty folder, and will idle.
- **Important Note on the `-w` Argument**: Do **NOT** try to pass an absolute path like `-w "C:\DCS_Server_Data"` to DCS. DCS does not support absolute paths for this argument; it will interpret it as a folder name and instantly crash because Windows folder names cannot contain a colon (`:`).
- **How to Fix It**:
  1.  (**Recommended**) Set up a Scheduled Task named `Start-DCS` that runs DCS explicitly as your normal user account (with "Run whether user is logged on or not"), and use `DCS_SCHEDULED_TASK_NAME` in your `.env` instead of `DCS_START_CMD`. This completely bypasses all Session 0 and SYSTEM profile quirks.
  2.  Edit your NSSM service settings (Log on tab) to run the dashboard itself explicitly under your normal user account.
  3.  Create the symbolic link inside the hidden `SYSTEM` profile's `Saved Games` folder.
