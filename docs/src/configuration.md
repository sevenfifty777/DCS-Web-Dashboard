# Configuration (NSSM)

The DCS-Web-Dashboard backend does not rely on a `.env` file. Instead, all environment variables and startup settings are read from the process environment. Empty or whitespace-only values are treated as unset.

The absolute best way to run the dashboard in production is as a native Windows Service using **NSSM (Non-Sucking Service Manager)**. This keeps secrets out of startup scripts and ensures the dashboard survives reboots.

## 1. Installing as a Service (NSSM)

1. Open an **Administrator** PowerShell/Command Prompt and go to your extracted NSSM folder:
   ```cmd
   cd C:\nssm\win64
   nssm install "DCS Web Dashboard"
   ```
2. In the GUI, configure the **Application tab**:
   - **Path:** `<dashboard-folder>\rust-web-dashboard.exe` (Path to your compiled binary)
   - **Startup directory:** `<dashboard-folder>` (The folder may have any name.)
3. In the **Details tab**:
   - **Display name:** `DCS Web Dashboard`
   - **Startup type:** `Automatic`
4. In the **Environment tab**, enter each variable on its own line (see the table below).
5. In the **I/O tab**, configure the service output files:
   - **Output (stdout):** `<dashboard-folder>\logs\dashboard.log`
   - **Error (stderr):** `<dashboard-folder>\logs\dashboard-error.log`
6. Click **Install service**, then open `services.msc` to start it.

The release ZIP contains the empty `logs\` directory. NSSM creates and writes the two log files when the service starts; they are not included in the release archive.

## 2. Environment Variables

Enter these variables in the NSSM Environment tab, **one per line**, in `NAME=value` form. Do not
put quotes around a value and do not put spaces around the `=`. A path with spaces needs no
quoting here, because NSSM passes the whole line through as-is:

```
JWT_SECRET=a-long-random-string-at-least-16-chars
DCS_SAVED_GAMES_DIR=C:\Users\admin\Saved Games\DCS.dcs_serverrelease
```

An empty or whitespace-only value counts as unset, so you can blank a line out instead of
deleting it. The dashboard reads every variable **once at startup**: after any change, restart the
service with `Restart-Service "DCS Web Dashboard"`.

### Minimum working configuration

If you only want the dashboard up and talking to DCS, these four lines are enough:

```
JWT_SECRET=change-me-to-a-long-random-string
ADMIN_PASSWORD=your-dashboard-password
GRPC_ENDPOINT=http://localhost:50051
DCS_SAVED_GAMES_DIR=C:\Users\admin\Saved Games\DCS.dcs_serverrelease
```

Everything else switches on an optional tab, and each tab tells you what it is missing until you
set it.

### Required
| Variable | Purpose | Example |
| --- | --- | --- |
| `JWT_SECRET` | Signing secret for login tokens (HS256). **Must be ≥ 16 characters.** The binary refuses to start otherwise. Use a long random string and keep it secret; changing it logs everybody out. | `7f3a91c2be04d85a6f1e2c9b` |

### Core Settings
| Variable | Default | Purpose | Example |
| --- | --- | --- | --- |
| `DASHBOARD_ADDR` | `0.0.0.0:3001` | Address/port the dashboard listens on. Use `127.0.0.1:3001` if a proxy is in front. | `0.0.0.0:3001` |
| `GRPC_ENDPOINT` | `http://localhost:50051` | Where your DCS-gRPC server is listening. A bare `host:port` is accepted and gets `http://` added. | `http://localhost:50051` |
| `GRPC_API_KEY` | — | Token sent as `X-API-Key` on every DCS-gRPC call. Required when the server's `dcs-grpc.lua` has `auth.enabled = true`; add a dedicated entry for the dashboard to its `auth.tokens` list (e.g. `{ client = "web-dashboard", token = "..." }`) and paste that token here. Leave unset when authentication is off. | `d41d8cd98f00b204e9800998` |
| `APP_URL` | `http://localhost:3001` | Public base URL of the dashboard. **Must match the real public IP/host** for Discord redirects to work. A trailing `/` is stripped. | `https://dcs.example.com` |
| `ADMIN_PASSWORD` | — | Enables master-password login when set. Leave unset to allow Discord login only. | `a-strong-password` |
| `AUDIT_LOG_PATH` | `audit_logs.json` | JSON file behind the **Access Logs** page. Relative paths resolve against the service's startup directory, so set an absolute path if you are unsure. | `C:\DCS-Web-Dashboard\logs\audit_logs.json` |
| `MOBILE_API_KEY` | — | Legacy static bearer token accepted instead of a login, for the mobile app. Anyone holding it has full API access, so leave it unset unless you use that app. | `a-long-random-token` |

### DCS & SRS Control Integration

These variables drive the **Start**, **Stop** and **Restart** buttons on the Mission and SRS
pages, plus the **Tasks** page.

**Read this first.** There are two ways to start DCS and SRS, and they are not equivalent:

- **Scheduled task** (`DCS_SCHEDULED_TASK_NAME` / `SRS_SCHEDULED_TASK_NAME`) — **recommended.**
  The dashboard asks Windows Task Scheduler to start the program inside a logged-on user's
  session, so **the DCS window is visible** and DCS gets a real desktop.
- **Direct command** (`DCS_START_CMD` / `SRS_START_CMD`) — fallback. The service starts the
  program itself, inside the hidden Session 0. **No window will ever appear**, and DCS misbehaves
  without a desktop. Only usable for headless `--norender`.

When a task name is set it wins and the matching `_START_CMD` is ignored entirely. Setting up the
tasks takes about ten minutes and is written out click by click in
[DCS & SRS Process Control Setup](./process_control_setup.md). Do that page, then come back and
set the two task-name variables here.

| Variable | Purpose | Example |
| --- | --- | --- |
| `DCS_SAVED_GAMES_DIR` | Absolute path to your DCS _Saved Games_ folder. Drives `serverSettings.lua`, the mission queue and mission uploads. The folder name differs per install: `DCS.dcs_serverrelease` for the release dedicated server, `DCS.openbeta_server` for the old open beta. | `C:\Users\admin\Saved Games\DCS.dcs_serverrelease` |
| `DCS_SCHEDULED_TASK_NAME` | Name of the scheduled task the **Start**/**Restart** buttons run to launch DCS. Must match the task name exactly as Task Scheduler shows it. Created for you by `Register-DcsSrsTasks.ps1`. Takes priority over `DCS_START_CMD`. | `DCS Server Start` |
| `SRS_SCHEDULED_TASK_NAME` | Same for SRS. Takes priority over `SRS_START_CMD`. | `SRS Server Start` |
| `SRS_CFG_PATH` | Absolute path to your SRS `server.cfg`. Needed for the SRS settings editor and the connected-clients list. If unset, the dashboard tries to read it out of a `-cfg=` argument in `SRS_START_CMD`. | `C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg` |
| `DCS_START_CMD` | Fallback only, when no DCS task name is set: executable and arguments the dashboard launches itself. Runs hidden in Session 0. | `"C:\Program Files\Eagle Dynamics\DCS World Server\bin\DCS_server.exe" --server --norender` |
| `SRS_START_CMD` | Fallback only, when no SRS task name is set. Same hidden-window limitation. | `"C:\Program Files\DCS-SimpleRadio-Standalone\Server\SRS-Server.exe" -cfg="C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg"` |
| `DCS_TASK_WHITELIST` | Comma-separated allow-list of scheduled tasks the **Tasks** page may show and control. **If unset, every root task on the machine is listed.** Set it to keep the page to your own tasks. Names are matched case-insensitively. | `DCS Server Start,SRS Server Start,DCS SRS Watchdog` |
| `WINDOWS_SERVICES` | Comma-separated allow-list of Windows **services** the Tasks page may show and start/stop. Unset means the services panel stays empty. Use the short service name, not the display name. | `DCSServerBot,MySQL80` |

A complete DCS/SRS control block, matching the scripts as registered in the process-control guide:

```
DCS_SAVED_GAMES_DIR=C:\Users\admin\Saved Games\DCS.dcs_serverrelease
DCS_SCHEDULED_TASK_NAME=DCS Server Start
SRS_SCHEDULED_TASK_NAME=SRS Server Start
SRS_CFG_PATH=C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg
DCS_TASK_WHITELIST=DCS Server Start,SRS Server Start,DCS SRS Watchdog
```

### Foothold Campaign
| Variable | Default | Purpose | Example |
| --- | --- | --- | --- |
| `FOOTHOLD_SAVES_DIR` | `<DCS_SAVED_GAMES_DIR>\Missions\Saves` | Folder holding the Foothold campaign save files that feed the Leaderboard, Foothold and Config pages. The default suits a standard Foothold install, so set this only if your saves live somewhere else. | `C:\Users\admin\Saved Games\DCS.dcs_serverrelease\Missions\Saves` |

### Dynamic Weather Integration
| Variable | Default | Purpose | Example |
| --- | --- | --- | --- |
| `DCS_DYNAMIC_WEATHER_DIR` | — | Path to the DCS-Dynamic-Weather generator folder (the one holding `weather_presets.json` and `weather_generator.py`). Required for the Weather tab; unset, the tab reports "not configured". | `C:\Users\admin\Saved Games\DCS.dcs_serverrelease\Missions\Dynamic_Weather_mission` |
| `PYTHON_EXE` | `python` | Python interpreter used by the weather generator. The default only works if `python` is on the service account's PATH, so an absolute path is safer. | `C:\Users\admin\AppData\Local\Programs\Python\Python312\python.exe` |

### LSO Greenie Board
| Variable | Purpose |
| --- | --- |
| `LSO_DIR` | Output directory of the [DCS-gRPC-lso](https://github.com/sevenfifty777/DCS-gRPC-lso) client (its `--out-dir`, the folder holding `lso.db` and the trap-sheet PNGs). Required for the **LSO** tab. The dashboard opens `lso.db` read-only and never calls DCS-gRPC for it. Run an LSO client build that enables WAL journaling (0.4.0 or later) so both processes can use the file at the same time. Example: `C:\LSO\recordings` |

### Tacview Downloads
| Variable | Purpose |
| --- | --- |
| `TACVIEW_DIR` | Folder holding the server's Tacview `.acmi` recordings. Required for the **Tacview** tab; when unset, the tab shows a "not configured" note and the `/api/tacview/*` routes return no data. There is deliberately **no** automatic `%USERPROFILE%\Documents\Tacview` fallback: under NSSM the service usually runs as a different account, so a guessed path would silently list nothing. Example: `C:\Users\admin\Documents\Tacview` |

> **Service account permissions.** The account the dashboard service runs as must have **read** access to `TACVIEW_DIR`. A `LocalSystem` service reading another user's `Documents` folder needs the folder ACL to allow it — otherwise the Tacview tab reports the OS error instead of listing files. Either grant the service account read access, or point Tacview at a shared folder (Tacview → Options → Recorder → recordings path).

### Discord OAuth Integration

Discord login is **all or nothing**: unless all four variables below are set, the Discord routes
report "not configured" and only `ADMIN_PASSWORD` login works. Getting the IDs is covered in
[Setup & Installation](./setup.md#3-discord-oauth2-setup-optional). To copy an ID out of Discord,
turn on Settings → Advanced → Developer Mode, then right-click a server or role and "Copy ID".

| Variable | Purpose | Example |
| --- | --- | --- |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID, from your app's OAuth2 tab. | `1198273645098273645` |
| `DISCORD_CLIENT_SECRET` | Discord OAuth app secret, from the same tab. Treat it like a password. | `x9Kd2mQ...` |
| `DISCORD_GUILD_ID` | Your Discord server (guild) ID. Users must be a member. Several may be given, comma-separated. | `987654321098765432` |
| `DISCORD_ADMIN_ROLE_ID` | Comma-separated list of role IDs allowed to log in. A user needs at least one of them. | `112233445566778899,223344556677889900` |

## 3. A complete example

A filled-in Environment tab for a server running DCS, SRS, Foothold, the LSO client and Tacview:

```
JWT_SECRET=7f3a91c2be04d85a6f1e2c9b5d8a3f60
ADMIN_PASSWORD=a-strong-password
DASHBOARD_ADDR=0.0.0.0:3001
APP_URL=http://203.0.113.10:3001
GRPC_ENDPOINT=http://localhost:50051
DCS_SAVED_GAMES_DIR=C:\Users\admin\Saved Games\DCS.dcs_serverrelease
DCS_SCHEDULED_TASK_NAME=DCS Server Start
SRS_SCHEDULED_TASK_NAME=SRS Server Start
SRS_CFG_PATH=C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg
DCS_TASK_WHITELIST=DCS Server Start,SRS Server Start,DCS SRS Watchdog
LSO_DIR=C:\LSO\recordings
TACVIEW_DIR=C:\Users\admin\Documents\Tacview
DCS_DYNAMIC_WEATHER_DIR=C:\Users\admin\Saved Games\DCS.dcs_serverrelease\Missions\Dynamic_Weather_mission
PYTHON_EXE=C:\Users\admin\AppData\Local\Programs\Python\Python312\python.exe
```

## 4. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Service starts then stops immediately | `JWT_SECRET` is unset or shorter than 16 characters. The binary refuses to start. | Set a longer secret. The reason is written to `logs\dashboard-error.log`. |
| Every page says the server is offline | `GRPC_ENDPOINT` is wrong, DCS is not running, or the DCS-gRPC mod did not load. | Check DCS is up and its log mentions gRPC. A "tcp connect error" means nothing is listening on that port. |
| Server offline, and DCS-gRPC has `auth.enabled = true` | `GRPC_API_KEY` is missing or does not match a token in `auth.tokens`. | Copy the dashboard's token from `dcs-grpc.lua` exactly. |
| Discord button does nothing, or "not configured" | One of the four `DISCORD_*` variables is missing. | Set all four, then restart the service. |
| Discord login ends on an "invalid redirect URI" error | `APP_URL` does not match the redirect URI registered in the Discord app. | Make them identical, including scheme and port. |
| A tab says "not configured" | Its optional variable is unset. | Set the one named in the tab's message from the tables above. |
| Tacview or LSO tab shows an access-denied error | The service account cannot read that folder. | Grant the account read access, or run the service as a user who has it. |
| A change to a variable had no effect | The dashboard reads the environment only at startup. | `Restart-Service "DCS Web Dashboard"`. |
