# Architecture Overview

DCS-Web-Dashboard is composed of two primary components compiled into one executable (`rust-web-dashboard.exe`). There is no Node.js runtime or separate web server. Large replaceable assets are kept outside the executable in `media`, `images`, and `icon` folders beside it to keep the binary smaller.

## 1. The Rust Backend (`rust-web-dashboard`)
This is a standalone binary that acts as the core controller. 
- **HTTP API**: It uses **Axum** to serve the REST API. These routes port the original Next.js API (gRPC proxy + filesystem/OS integration) and are protected by JWT bearer authentication (HS256).
- **gRPC Client**: It connects to the **DCS-gRPC** server using **Tonic** (a Rust gRPC framework) to pull live telemetry (like unit positions and events) and issue commands to the game server (like sending chat or kicking players).
- **OS Integration**: It executes native Windows processes via PowerShell (to control DCS, SRS, and Scheduled Tasks) and interacts directly with DCS filesystem files like `serverSettings.lua`.

## 2. The Next.js Frontend (`web-dashboard`)
This is the user interface of the dashboard, built with React and Next.js.
- **Embedded SPA**: During the build process, the Next.js application is statically exported (`output: 'export'`) as HTML, CSS, and JS. This output is copied into the Rust crate's `static/` folder and baked directly into the binary using `rust-embed`.
- **Routing**: Deep links (e.g., `/weather`) and hashed `/_next/` assets are served by the Rust backend with the correct MIME types. Unknown paths fall back to the SPA shell.
- **External Assets**: `/media/background.mp4`, `/img/background.png`, and `/icon/*` are served from the `media`, `images`, and `icon` folders beside `rust-web-dashboard.exe`. Paths are resolved from the executable itself, so the parent folder can have any name and the process working directory does not affect asset loading.

> **Note:** The `web-dashboard` directory remains the frontend source project. The Rust crate embeds its built application output but excludes the external media, background, and aircraft-icon assets.

## Security Notes
- **Vulnerabilities**: The Rust backend dependencies are routinely audited (`cargo audit`). The frontend's build-time Node dependencies do not execute at runtime and are not shipped in the final binary.
- **TLS & HTTPS**: TLS termination and websockets are intentionally out of scope for the binary. It serves plain HTTP. For secure public access, you must put a reverse proxy (like Nginx, Caddy, or Cloudflare Tunnels) in front to handle HTTPS, and the dashboard uses Server-Sent Events (SSE) instead of websockets for live data.
