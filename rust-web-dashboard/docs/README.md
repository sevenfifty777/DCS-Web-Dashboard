# rust-web-dashboard

A standalone, single-binary Rust port of the DCS-gRPC web dashboard. The Next.js frontend is
statically exported and embedded into the executable (via `rust-embed`), so the dashboard ships
as one portable binary with no Node.js runtime, no separate web server, and no external static
files at runtime.

It is a gRPC **client** of a running [DCS-gRPC](https://github.com/DCS-gRPC/rust-server) server
and exposes the same HTTP API + SPA the original Next.js app did. See
[PLAN.md](./PLAN.md) for the design and [IMPLEMENTATION.md](./IMPLEMENTATION.md) for the build log.

## Architecture at a glance

- **Embedded SPA** — the Next.js `output: 'export'` bundle (from the `web-dashboard` source
  project) is copied into `static/` and baked into the binary. Deep links and hashed `_next/`
  assets are served with correct MIME types; unknown paths fall back to the SPA shell.
- **HTTP API** — axum routes port the original Next.js API (gRPC proxy + filesystem/OS
  integration), protected by JWT bearer auth (HS256).
- **gRPC client** — `tonic` wrappers call the DCS-gRPC server; background tasks stream events
  and unit positions with reconnect-with-backoff.

> `web-dashboard` remains the **frontend source project**. This crate only embeds its built
> output. The two folders are independent; the binary is portable on its own.

## Prerequisites

- Rust **1.85+** (edition 2021). No system `protoc` needed — protobuf compilation uses
  `protoc-bundled`. No system Lua needed — `mlua` is vendored (Lua 5.1).
- A running DCS-gRPC server for live data (defaults to `http://localhost:50051`).
- To rebuild the embedded frontend: the `web-dashboard` project with `npm` (only when frontend
  changes need re-embedding — see below).

## Build

> **cwd caveat (Windows):** this crate is **not** part of any cargo workspace, and terminals may
> open at the repo root. Always pass `--manifest-path` so cargo finds the right manifest:

```powershell
cargo build --release --manifest-path "C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\Cargo.toml"
```

The release profile uses `opt-level = 3`, `lto`, `codegen-units = 1`, and `strip`. The output
binary is at `target/release/rust-web-dashboard(.exe)`.

## Run

`JWT_SECRET` is **required** at startup. Example smoke run on a local port:

```powershell
$env:JWT_SECRET = "change-me-to-a-long-random-secret"   # must be >= 16 chars
$env:DASHBOARD_ADDR = "127.0.0.1:3099"                   # optional; default 0.0.0.0:3001
cargo run --release --manifest-path "C:\Users\thierry\Documents\GitHub\DCS-gRPC\rust-web-dashboard\Cargo.toml"
```

Then browse `http://127.0.0.1:3099/`. The SPA, deep links (e.g. `/weather`), and `_next/` assets
are all served from the embedded bundle. Background telemetry streams will log
retry-with-backoff warnings until a DCS-gRPC server is reachable — this is expected.

Stop with `Ctrl-C` (graceful shutdown; also handles `SIGTERM`).

## Configuration (environment variables)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | **Yes** | — | HS256 signing secret for bearer tokens. Must be **≥ 16 characters**; the binary refuses to start otherwise. |
| `DASHBOARD_ADDR` | No | `0.0.0.0:3001` | HTTP bind address. |
| `GRPC_ENDPOINT` | No | `http://localhost:50051` | DCS-gRPC server endpoint (normalized to a full URL). |
| `APP_URL` | No | (internal default) | Public base URL; used for Discord OAuth redirects (`{APP_URL}/login#token=…`). |
| `ADMIN_PASSWORD` | No | — | Enables password login when set. |
| `MOBILE_API_KEY` | No | — | Legacy static bearer accepted for mobile clients. |
| `AUDIT_LOG_PATH` | No | (internal default) | Path the access/audit-log route reads. |
| `DCS_SAVED_GAMES_DIR` | No | (derived) | DCS "Saved Games" dir; drives `serverSettings.lua` + `Missions/` routes. |
| `DCS_DYNAMIC_WEATHER_DIR` | No | — | DCS-Dynamic-Weather working dir; weather routes report "not configured" when unset. |
| `PYTHON_EXE` | No | (internal default) | Python interpreter used by the weather generator. |
| `DCS_TASK_WHITELIST` | No | — | Comma-separated, case-insensitive allow-list of Windows scheduled-task names the `/api/server/tasks` route may control. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_GUILD_ID` / `DISCORD_ADMIN_ROLE_ID` | No | — | Enable Discord OAuth login when **all** are set. |

Empty/whitespace-only values are treated as unset.

## Authentication

All API routes (except login/health) require an `Authorization: Bearer <jwt>` header. Tokens are
HS256-signed with `JWT_SECRET` and carry `{ sub, kind, iat, exp }` where `kind ∈ {password,
discord, mobile}`. Password login and the Discord OAuth callback both mint JWTs; the Discord
callback redirects to `{APP_URL}/login#token=<jwt>`. A static `MOBILE_API_KEY` bearer is also
accepted when configured.

## Re-embedding an updated frontend

The embedded SPA is a snapshot of `web-dashboard/out/` copied into `static/`. To refresh it after
frontend changes:

1. In `web-dashboard`, produce the static export (`next.config.ts` already sets
   `output: 'export'`): `npm run build`.
2. Replace the contents of `rust-web-dashboard/static/` with the new `web-dashboard/out/` tree.
3. Rebuild this crate (`cargo build --release --manifest-path …`) so the new assets are embedded.

## Security notes

- Run `cargo audit` (and `cargo deny check`, if configured) after any dependency or build change.
  As of Phase 6, `cargo audit` reports **0 vulnerabilities** across the dependency tree.
- The frontend's `npm audit --omit=dev` reports 2 moderate, **build-time-only** advisories
  (a transitive `postcss` inside Next.js). These are **documented, not remediated** — the only
  fix downgrades Next.js to v9, the issue never executes at runtime, and no affected code ships
  in the embedded `static/` bundle.
- TLS termination and websockets are out of scope (nginx terminates TLS; SSE is used in place of
  websockets).
