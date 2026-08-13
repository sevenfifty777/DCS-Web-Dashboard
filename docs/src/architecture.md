# Architecture Overview

DCS-Web-Dashboard is composed of two primary components, but unlike traditional web applications, they are compiled together into a **single, self-contained executable** (`rust-web-dashboard.exe`). There is no Node.js runtime, no separate web server, and no external static files at runtime.

## 1. The Rust Backend (`rust-web-dashboard`)
This is a standalone binary that acts as the core controller. 
- **HTTP API**: It uses **Axum** to serve the REST API. These routes port the original Next.js API (gRPC proxy + filesystem/OS integration) and are protected by JWT bearer authentication (HS256).
- **gRPC Client**: It connects to the **DCS-gRPC** server using **Tonic** (a Rust gRPC framework) to pull live telemetry (like unit positions and events) and issue commands to the game server (like sending chat or kicking players).
- **OS Integration**: It executes native Windows processes via PowerShell (to control DCS, SRS, and Scheduled Tasks) and interacts directly with DCS filesystem files like `serverSettings.lua`.

## 2. The Next.js Frontend (`web-dashboard`)
This is the user interface of the dashboard, built with React and Next.js.
- **Embedded SPA**: During the build process, the Next.js application is statically exported (`output: 'export'`) as HTML, CSS, and JS. This output is copied into the Rust crate's `static/` folder and baked directly into the binary using `rust-embed`.
- **Routing**: Deep links (e.g., `/weather`) and hashed `/_next/` assets are served by the Rust backend with the correct MIME types. Unknown paths fall back to the SPA shell.

> **Note:** The `web-dashboard` directory remains the frontend source project. The Rust crate only embeds its built output. The two folders are independent during development, but the final binary is completely portable on its own.

## Security Notes
- **Vulnerabilities**: The Rust backend dependencies are routinely audited (`cargo audit`). The frontend's build-time Node dependencies do not execute at runtime and are not shipped in the final binary.
- **TLS & HTTPS**: TLS termination and websockets are intentionally out of scope for the binary. It serves plain HTTP. For secure public access, you must put a reverse proxy (like Nginx, Caddy, or Cloudflare Tunnels) in front to handle HTTPS, and the dashboard uses Server-Sent Events (SSE) instead of websockets for live data.
