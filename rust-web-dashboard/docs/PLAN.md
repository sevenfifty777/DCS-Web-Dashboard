# PLAN — Standalone Rust Backend for the DCS Dashboard

## 1. Objective

Migrate the existing Next.js API-route backend (`web-dashboard/src/app/api`, ~20 routes) into a new standalone Rust binary in `rust-web-dashboard/`. The single self-contained executable will:

- Serve the embedded Next.js static export (`out/`) via `rust-embed`.
- Expose a JWT-protected REST + Server-Sent Events (SSE) API consumed by both the web frontend and the Android app.
- Hold persistent `tonic` gRPC streams to the DCS-gRPC server (`localhost:50051`) with **broadcast fan-out** (one upstream stream feeds all clients).
- Perform native async filesystem and OS-command work (settings parsing, mission upload, log access, RDP status, scheduled tasks).
- Run behind a TLS-terminating reverse proxy (nginx).

**Non-goal:** This document is the plan only. No application code is written until the plan is approved.

## 2. Scope

### In scope
- Full port of the 20 API routes and the gRPC client wrappers from `web-dashboard/src/lib/grpc.ts`.
- Unified JWT bearer auth (web + Android) including password login and Discord OAuth with guild-role check.
- Single shared upstream gRPC stream per telemetry feed with broadcast fan-out; SSE preserved in the existing `data: {json}\n\n` wire format.
- Native filesystem and OS-command endpoints.
- Embedding the Next.js export and producing a single binary.

### Out of scope
- Native Rust TLS (handled by the reverse proxy).
- WebSockets (SSE is retained).
- Any change to the DCS-gRPC server itself.
- A database / persistence layer.
- Android app changes beyond the auth header + base URL.

## 3. Recommended Crate Stack

| Concern | Crate(s) | Notes |
| --- | --- | --- |
| Async runtime | `tokio` (`rt-multi-thread`, `macros`, `sync`, `fs`, `time`, `process`) | Multi-threaded executor |
| HTTP / SSE | `axum`, `tower-http` (`cors`, `trace`, `compression`) | Native SSE router |
| gRPC client | `tonic` 0.13 + `prost`; `tonic-build` in `build.rs` | **Pin tonic 0.13** to match `rust-server/Cargo.toml` so prost types align |
| Static embed | `rust-embed` | Bake the Next.js `out/` export into the binary |
| Auth | `jsonwebtoken` (HS256 bearer), `reqwest` | Discord OAuth calls |
| Serialization | `serde`, `serde_json` | |
| Logging | `tracing`, `tracing-subscriber` | Replaces `src/lib/logger.ts` |
| Errors | `anyhow`, `thiserror` | |
| Lua parsing | `mlua` (`lua51`) | Safe `serverSettings.lua` parse |
| OS commands | `tokio::process` | `quser`, PowerShell scheduled-task control |

> **Security:** every crate above and any transitive additions must be checked for CVEs / supply-chain risk. Run `cargo audit` and `cargo deny check` after each dependency change; pin versions in `Cargo.toml` and commit `Cargo.lock`.

## 4. Concurrency Model

- Multi-threaded `#[tokio::main]`. A shared `Arc<AppState>` holds cloneable gRPC channels, the JWT secret, and one `broadcast::Sender` per telemetry stream.
- At startup, spawn one long-lived background task per upstream stream:
  - `events_task` → `Mission.StreamEvents`
  - `radar_task` → `Mission.StreamUnits` (×4 unit categories)
  - Each pushes messages into its `tokio::sync::broadcast` channel and **auto-reconnects with backoff** when DCS restarts.
- SSE handlers subscribe to the broadcast and emit the existing `data: {json}\n\n` shape — so one upstream gRPC stream feeds all connected clients (replacing the current per-client streams in `radar/stream/route.ts`).
- Unary RPCs (health, players, chat, atmosphere, eval, triggers) `await` directly on a cloned channel.
- Filesystem work via `tokio::fs`; OS commands via `tokio::process`; any blocking Lua parse via `spawn_blocking`.

## 5. Architecture Map

```
                         ┌──────────────────────────────────────────────┐
   Browser / Android ───▶│            rust-web-dashboard (binary)        │
        (HTTPS)          │                                              │
                         │  axum router                                 │
   nginx (TLS) ─────────▶│   ├─ /            → rust-embed (Next.js out/)│
                         │   ├─ /api/auth    → JWT (password + Discord)  │
                         │   ├─ /api/*  unary → tonic unary RPC          │
                         │   └─ /api/*/stream→ SSE  ◀── broadcast::Recv  │
                         │                                              │
                         │  AppState (Arc)                              │
                         │   ├─ gRPC channels (clone-per-call)          │
                         │   ├─ broadcast::Sender (events, radar×4)     │
                         │   └─ JWT secret / config                     │
                         │                                              │
                         │  background tasks (reconnect w/ backoff)     │
                         │   ├─ events_task  ─┐                         │
                         │   └─ radar_task   ─┴─▶ tonic streams ───────┐│
                         └──────────────────────────────────────────┼─┘
                                                                     ▼
                                              DCS-gRPC server (localhost:50051)
```

## 6. Endpoint / RPC Inventory (port targets)

Source of truth: `web-dashboard/src/lib/grpc.ts` and `web-dashboard/src/app/api/*`.

| Area | API route(s) | gRPC service.method |
| --- | --- | --- |
| Health/version | `/api/health` | `MetadataService.GetHealth`, `.GetVersion` |
| Players | `/api/players` | `NetService.GetPlayers` |
| Chat | `/api/chat` | `NetService.SendChat` |
| Mission control | `/api/mission` | `HookService.GetMissionName`/`GetPaused`/`SetPaused`/`StopMission`/`ReloadCurrentMission`/`LoadMission` |
| Console (Lua) | `/api/console` | `HookService.Eval`, `CustomService.Eval` |
| Triggers | `/api/triggers` | `TriggerService.GetUserFlag`/`SetUserFlag` |
| Atmosphere/weather | `/api/atmosphere`, `/api/weather` | `AtmosphereService.GetWind`/`GetTemperatureAndPressure` |
| Events (SSE) | `/api/events` | `MissionService.StreamEvents` |
| Radar (SSE) | `/api/radar/stream` | `MissionService.StreamUnits` (×4 categories) |
| Settings | `/api/settings` | FS + `mlua` parse of `serverSettings.lua` |
| Mission files | `/api/mission/upload`, `/api/mission/browse` | `tokio::fs` |
| Logs | `/api/logs/access` | `tokio::fs` |
| RDP status | `/api/rdp-status` | `tokio::process` (`quser`) |
| Server tasks | `/api/server/tasks` | `tokio::process` (PowerShell, whitelist env) |
| Auth | `/api/auth` | `jsonwebtoken`, `reqwest` (Discord OAuth) |

Proto packages consumed (from `web-dashboard/protos/dcs/`): `metadata/v0`, `hook/v0`, `net/v0`, `mission/v0`, `trigger/v0`, `custom/v0`, `atmosphere/v0`.

## 7. Phased Steps

| Phase | Description | Depends on |
| --- | --- | --- |
| **1 — Scaffold & codegen** | `cargo new rust-web-dashboard` as a **standalone** crate (do not join the `rust-server` workspace). Point `build.rs`/`tonic-build` at the protos. Pin tonic 0.13. Green `cargo build` + `cargo audit`/`cargo deny`. Finalize this `docs/PLAN.md`. | — |
| **2 — Core / auth** | `AppState`, axum app with `rust-embed` fallback + `/api` router + CORS + tracing. JWT login (password + Discord OAuth callback with guild-role check) + extractor middleware. | 1 |
| **3 — Unary endpoints** | Port health, players, chat, atmosphere, weather, console, triggers, mission from the `grpc.ts` promise wrappers to tonic. Internally parallelizable. | 2 |
| **4 — Telemetry** | Broadcast channels + `events_task`/`radar_task` with reconnect; SSE handlers matching the current format. | 2 |
| **5 — FS + OS** | settings GET/POST (`mlua` parse + manual CRLF serialize preserving `advanced`/`missionList`), mission/upload, mission/browse, logs/access, rdp-status (`quser`), server/tasks (PowerShell, keep whitelist env). Parallel with 3/4. | 2 |
| **6 — Packaging** | Add `output: 'export'` to `next.config.ts`, switch frontend to JWT + same-origin `/api`, build `out/`, embed, single-binary smoke test. Write `docs/IMPLEMENTATION.md`, then `docs/README.md`. | 3, 4, 5 |

## 8. Relevant Files

- `rust-web-dashboard/` (new): `Cargo.toml`, `build.rs`, `src/main.rs`, `state.rs`, `auth.rs`, `grpc/`, `routes/`, `telemetry.rs`, `settings_lua.rs`.
- `web-dashboard/src/lib/grpc.ts` — authoritative list of RPCs/methods to port.
- `web-dashboard/src/app/api/*` — the ~20 routes to translate.
- `web-dashboard/protos/dcs/mission/v0/mission.proto` — server-streaming `StreamEvents`/`StreamUnits`.
- `rust-server/Cargo.toml` — version-match `tonic`/`tokio`.

## 9. Verification

- `cargo build && cargo clippy -- -D warnings`; `cargo audit`/`cargo deny` clean.
- With DCS-gRPC up: `curl /api/health`, `/api/players`, `/api/atmosphere` return expected JSON.
- Open two `curl -N /api/radar/stream` clients; confirm both receive data from a **single** upstream gRPC stream (broadcast fan-out).
- Restart DCS-gRPC; confirm background tasks reconnect and SSE resumes.
- Wrong vs right `/api/auth` password → 401 vs JWT; protected route with/without `Authorization: Bearer` → 401 vs 200.
- `/api/settings` GET→POST round-trips `serverSettings.lua` without corrupting `advanced`/`missionList` (diff vs backup).
- `/api/mission/upload` writes to `Missions/Uploads`; `/api/mission/browse` lists it; `/api/server/tasks` respects the whitelist.
- Visit `/` → embedded Next.js loads and talks to same-origin `/api`; full binary runs behind nginx TLS with only env vars set.

## 10. Key Decisions

- **Auth:** JWT bearer (one model for web + Android).
- **Streaming:** single shared upstream stream per feed with broadcast fan-out; SSE retained.
- **Frontend delivery:** embedded via `rust-embed`.
- **TLS:** terminated at the reverse proxy.
- **Crate alignment:** tonic/tokio pinned to match `rust-server`.

## 11. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| `tonic`/`prost` version drift vs `rust-server` | Pin tonic 0.13; verify generated types compile against shared protos |
| `serverSettings.lua` corruption on round-trip | Preserve CRLF + ordering; manual serialize; diff against backup in verification |
| DCS restarts dropping streams | Auto-reconnect with backoff in background tasks |
| Supply-chain / CVE in new crates | `cargo audit` + `cargo deny` after every dependency change; commit `Cargo.lock` |
| OS-command injection (`quser`, PowerShell) | Keep the existing task whitelist; no unsanitized user input into command args |
