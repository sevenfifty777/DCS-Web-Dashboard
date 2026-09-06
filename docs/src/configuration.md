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

Enter these variables in the NSSM Environment tab, one per line (e.g., `JWT_SECRET=my-secret-key`).

### Required
| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | Signing secret for login tokens (HS256). **Must be ≥ 16 characters.** The binary refuses to start otherwise. |

### Core Settings
| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARD_ADDR` | `0.0.0.0:3001` | Address/port the dashboard listens on. Use `127.0.0.1:3001` if a proxy is in front. |
| `GRPC_ENDPOINT` | `http://localhost:50051` | Where your DCS-gRPC server is listening. |
| `GRPC_API_KEY` | — | Token sent as `X-API-Key` on every DCS-gRPC call. Required when the server's `dcs-grpc.lua` has `auth.enabled = true`; add a dedicated entry for the dashboard to its `auth.tokens` list (e.g. `{ client = "web-dashboard", token = "..." }`) and paste that token here. Leave unset when authentication is off. |
| `APP_URL` | `http://localhost:3001` | Public base URL of the dashboard. **Must match the real public IP/host** for Discord redirects to work. |
| `ADMIN_PASSWORD` | — | Enables master-password login when set. |

### DCS & SRS Control Integration
| Variable | Purpose |
| --- | --- |
| `DCS_SAVED_GAMES_DIR` | Absolute path to your DCS _Saved Games_ folder (e.g., `C:\Users\admin\Saved Games\DCS.openbeta_server`). Drives `serverSettings.lua` and mission uploads. |
| `DCS_TASK_WHITELIST` | Comma-separated allow-list of Windows scheduled tasks the **Tasks** tab can control. If unset, all root tasks are shown. |
| `DCS_SCHEDULED_TASK_NAME` | Name of the Windows scheduled task the **Start**/**Restart** buttons run to launch DCS, e.g. `DCS Server Start`. **Recommended.** This is the only way to get a visible DCS window when the dashboard runs as a service. Full procedure: [DCS & SRS Process Control Setup](./process_control_setup.md). Takes priority over `DCS_START_CMD`. |
| `SRS_SCHEDULED_TASK_NAME` | Same for SRS, e.g. `SRS Server Start`. Takes priority over `SRS_START_CMD`. |
| `DCS_START_CMD` | Fallback when no task name is set: executable and arguments the dashboard launches itself. Example: `"C:\Program Files\Eagle Dynamics\DCS World Server\bin\DCS_server.exe" --server --norender`. Launched from the service session, so the window is hidden; only suitable for headless `--norender` use. |
| `SRS_START_CMD` | Fallback when no task name is set: executable and arguments, e.g. `"C:\Program Files\DCS-SimpleRadio-Standalone\Server\SRS-Server.exe" -cfg="C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg"`. Same hidden-window limitation. |
| `SRS_CFG_PATH` | Absolute path to your SRS `server.cfg`. Needed for the SRS settings editor and connected clients list. Example: `C:\Program Files\DCS-SimpleRadio-Standalone\Server\server.cfg` |

### Dynamic Weather Integration
| Variable | Purpose |
| --- | --- |
| `DCS_DYNAMIC_WEATHER_DIR` | Path to the DCS-Dynamic-Weather generator folder. Required for the Weather tab. Example: `C:\Users\admin\Saved Games\DCS.openbeta_server\Missions\Dynamic_Weather_mission` |
| `PYTHON_EXE` | Python interpreter used by the weather generator. Example: `C:\Users\admin\AppData\Local\Programs\Python\Python312\python.exe` |

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
| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID. |
| `DISCORD_CLIENT_SECRET` | Discord OAuth app secret. |
| `DISCORD_GUILD_ID` | Your Discord server (guild) ID. Users must be a member. |
| `DISCORD_ADMIN_ROLE_ID` | Comma-separated list of role IDs allowed to log in. |
