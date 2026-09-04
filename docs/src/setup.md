# Setup and Installation

This guide covers deploying the single-binary Rust web dashboard on a Windows server.

## 1. Prerequisites

**On the server that runs the dashboard:**
- **Windows Server / Windows 10+**: The OS-integration features (Task Scheduler, file parsing) target Windows.
- **DCS-gRPC mod**: Installed in your DCS `Saved Games\...\Scripts` folder and running. The dashboard connects to it (default `http://localhost:50051`) for live data.
- **NSSM (Non-Sucking Service Manager)**: Recommended to run the binary as a resilient Windows service. Download from [nssm.cc](https://nssm.cc/).

**To build from source (optional):**
- **Rust 1.85+**: Required to compile the backend.
- **Node.js 18+**: Required to build the Next.js frontend export.

## 2. Building from Source

If you don't have a prebuilt binary, you must compile it. The frontend is embedded directly into the Rust executable.

### Build the Frontend
Navigate to the `web-dashboard` directory and build the static export:
```powershell
cd web-dashboard
npm install
npm run build
```
This will compile the frontend and place the static files in the `out/` directory. Copy the contents of `out/` into `rust-web-dashboard/static/`.

### Build the Backend
Navigate to the `rust-web-dashboard` directory and compile the binary:
```powershell
cd rust-web-dashboard
cargo build --release
```
The final executable will be located in `rust-web-dashboard/target/release/rust-web-dashboard.exe`. Place it on the server with the external asset folders:

```text
<dashboard-folder>\
├── rust-web-dashboard.exe
├── icon\
│   └── *.png
└── images\
    └── background.png
```

The root folder can have any name and can be placed anywhere. The server resolves `/icon/*` and `/img/background.png` from folders beside the executable, regardless of the process working directory. When using NSSM, setting **Startup directory** to the executable folder remains recommended for the dashboard's other relative runtime files.

### Create a Release ZIP

From the repository root, run the release script:

```powershell
.\build_release.ps1
```

The script installs the exact frontend dependencies from `package-lock.json`, builds the static frontend, refreshes the frontend embedded in the Rust executable, performs a locked Rust release build, and creates `Releases\DCS-Web-Dashboard-<version>.zip`. The ZIP contains `rust-web-dashboard.exe`, complete `icon\` and `images\` asset trees, plus an empty `logs\` directory reserved for the dashboard service's stdout and stderr files.

To test into an isolated directory without replacing the normal `Releases` output, or to reuse an already installed `node_modules` tree, use:

```powershell
.\build_release.ps1 -ReleasesDirectory "$env:TEMP\DCS-Web-Dashboard-release-check"
.\build_release.ps1 -SkipDependencyInstall
```

## 3. Discord OAuth2 Setup (Optional)

If you want to allow your community to log in using Discord:
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an Application.
2. Under the **OAuth2** tab, add your Redirect URI: `http://YOUR_PUBLIC_IP:3001/api/auth/callback` (Use `https://your.domain/...` if behind a reverse proxy).
3. Copy the **Client ID** and **Client Secret** for use in your configuration.

A successful login mints a **7-day** session token. Users must have the required Discord role to gain access.

## 4. Firewall & HTTPS

By default, the dashboard runs on port `3001`.
1. Open **Windows Defender Firewall with Advanced Security** -> **Inbound Rules** -> **New Rule**.
2. Select **Port** -> **TCP** -> **Specific local port**: `3001` -> **Allow the connection**.

> [!WARNING]
> **HTTP vs HTTPS**
> The dashboard serves plain HTTP. For public internet access, you should set up a Reverse Proxy (Nginx, Caddy, Cloudflare Tunnel) to provide SSL encryption (HTTPS). If you use a reverse proxy, **do not** open port 3001 to the public internet; bind the dashboard to `127.0.0.1:3001` and only allow the proxy to access it.
