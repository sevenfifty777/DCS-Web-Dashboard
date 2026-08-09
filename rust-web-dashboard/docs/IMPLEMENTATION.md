# IMPLEMENTATION — rust-web-dashboard

Living build log for the Rust port of the DCS-gRPC web dashboard. See [PLAN.md](./PLAN.md)
for the full design, scope, and phased roadmap. This file records what was actually built,
decisions made during the build, and verification results per phase.

---

## Phase 1 — Scaffold (DONE)

Goal: a standalone, compilable Rust crate with protobuf codegen wired up and a single
health endpoint. No feature endpoints yet.

### What was created

| File | Purpose |
| --- | --- |
| `Cargo.toml` | Crate manifest. Standalone binary (`publish = false`, AGPL-3.0-or-later, edition 2021, rust-version 1.85). Declares the **full** intended dependency set up front so one audit covers the whole project. `profile.release` = `opt-level 3` + `lto` + `codegen-units 1` + `strip`. |
| `build.rs` | Compiles vendored protos into tonic **client** stubs. Sets `PROTOC`/`PROTOC_INCLUDE` from `protoc-bundled` so no system `protoc` is required. `build_server(false)`, `build_client(true)`. No serde attributes (see decision below). |
| `src/pb.rs` | Generated-stub module tree. `pub mod dcs { ... }` with 15 leaf packages, each `pub mod v0 { tonic::include_proto!("dcs.<area>.v0"); }`. `#![allow(clippy::all)]` + `#![allow(rustdoc::all)]`. |
| `src/main.rs` | Binary entrypoint. Tracing init (`EnvFilter` default `info,rust_web_dashboard=debug`), `DASHBOARD_ADDR` env (default `0.0.0.0:3001`), axum `Router` with `GET /api/health`, graceful shutdown on Ctrl-C / SIGTERM. |
| `.gitignore` | Ignores `/target`, `*.rs.bk`, `*.pdb`, `.env*` (keeps `.env.example`). |
| `protos/` | Copied verbatim from `web-dashboard/protos`: `dcs/dcs.proto` (umbrella, imports-only) + 15 leaf protos `dcs/<pkg>/v0/<pkg>.proto`. |

### Proto package coverage

The umbrella `package dcs` is imports-only and generates no Rust types, so `src/pb.rs`
enumerates the 15 leaf packages individually: `atmosphere, coalition, common, controller,
custom, group, hook, metadata, mission, net, srs, timer, trigger, unit, world` — each under
`dcs.<area>.v0`.

### Decisions

- **Standalone crate, not a workspace member.** Confirmed no repo-root `Cargo.toml` exists,
  so the new crate is independent of `rust-server`'s cargo workspace. This keeps build/audit
  isolated from the gRPC server.
- **No serde derives on proto types in Phase 1.** `rust-server` derives serde on *all* proto
  messages, but `mission.v0` `details` fields are `google.protobuf.Struct`, which needs a
  custom serde helper (`crate::utils::proto_struct` in rust-server) to compile. To keep Phase 1
  minimal and green, the health route hand-builds its JSON with `serde_json::json!`. Serde
  derives + the `Struct` helper are **deferred to Phase 3/4**, when the first endpoints that
  serialize proto messages are ported.
- **Client-only codegen.** `build_server(false)` — this binary is a gRPC *client* of
  `rust-server`, never a server.
- **`reqwest` with `rustls`** (`default-features = false`, `json` + `rustls-tls`) to avoid a
  native OpenSSL dependency on Windows.
- **`mlua` vendored Lua 5.1** to parse `serverSettings.lua` later (Phase 5) with no system Lua.

### Verification

- `cargo build` → **green** in ~26s (first build fetched `protoc-bundled` and compiled native
  deps `mlua` vendored + `reqwest` rustls). Only warnings are `dead_code` on three generated,
  currently-unused proto template structs (`ShipUnitTemplate`, `HelicopterUnitTemplate`,
  `PlaneUnitTemplate`) — expected, harmless.
- `cargo audit` → **clean**, exit 0, 0 advisories across 243 crate dependencies
  (advisory-db: 1137 advisories loaded).
- `Cargo.lock` generated and should be committed (binary crate; reproducible builds + audit).

### Supply-chain / security notes

- `cargo-audit` (0.22.2) installed and run — clean.
- `cargo-deny` is **not installed** (optional license/ban-policy tooling). If license policy
  enforcement is wanted later: `cargo install cargo-deny` then `cargo deny check`.
- Dependency versions are pinned in `Cargo.toml`; `Cargo.lock` locks the full tree.

---

## Phase 2 — Core / AppState + Auth (DONE)

Goal: shared application state, an axum app (CORS + tracing + embedded-SPA fallback + `/api`
router), JWT login (password + Discord OAuth with guild-role gating), and a JWT extractor
middleware for protected routes.

### What was created

| File | Purpose |
| --- | --- |
| `src/config.rs` | Environment-loaded `Config` (behind `Arc`). Requires `JWT_SECRET` (≥16 bytes); optional `ADMIN_PASSWORD`, `MOBILE_API_KEY`; defaults for `APP_URL` (`http://localhost:3001`, trailing slash trimmed), `GRPC_ENDPOINT` (`http://localhost:50051`, scheme auto-prefixed), `AUDIT_LOG_PATH` (`audit_logs.json`). Nested `DiscordConfig::from_env()` returns `Some` only when **all** of `DISCORD_CLIENT_ID/SECRET/GUILD_ID/ADMIN_ROLE_ID` are set (roles comma-split, non-empty). `SESSION_TTL_SECONDS = 7 days`. |
| `src/state.rs` | `#[derive(Clone)] AppState { config: Arc<Config>, grpc: Channel, http: reqwest::Client }`. `AppState::new` builds a **lazy** tonic `Channel` (`from_shared(...)?.connect_lazy()` — no failure if `rust-server` is down) and a shared `reqwest::Client`. `grpc` is `#[allow(dead_code)]` until Phase 3. |
| `src/auth.rs` | JWT issue/verify (`jsonwebtoken`, HS256, `exp` validated). `Claims { sub, kind, iat, exp }`. `AuthUser` extractor via `FromRequestParts<AppState>` (axum 0.8 native async-trait): reads `Authorization: Bearer`, accepts `MOBILE_API_KEY` (constant-time) as a legacy mobile bearer (subject `mobile`), else verifies a JWT. `AuthError` → JSON `{ "error": ... }` with 401/503/500. Audit log: `AuditLog { timestamp_ms, username, user_id, status, reason? }` appended (newest-first, capped at 1000) to `AUDIT_LOG_PATH` via `tokio::fs`. `constant_time_eq` for password/key comparison. |
| `src/routes/mod.rs` | `router() -> Router<AppState>` mounting `GET /api/health`, `POST/DELETE /api/auth`, `GET /api/auth/verify`, `GET /api/auth/discord`, `GET /api/auth/callback`. `health()` returns service/version JSON. |
| `src/routes/auth.rs` | `login` (constant-time vs `ADMIN_PASSWORD` → JWT, `503` if unconfigured, `401` on mismatch), `logout`, `verify` (echoes authenticated subject/kind), `discord_login` (307 redirect to Discord authorize, scope `identify guilds.members.read`), `discord_callback` → exchanges code, fetches `/users/@me` + `/guilds/{guild}/member`, intersects member roles with admin roles, audits SUCCESS/REJECTED, then redirects to `${APP_URL}/login#token=<jwt>` (success) or `?error=<msg>` (failure). |
| `src/embed.rs` | `rust-embed` (`#[folder = "static/"]`) SPA handler: serves the requested asset, else falls back to `index.html` (client-side routing), else `404`. Sets `Content-Type` from the embedded file's mime metadata. |
| `static/index.html` | Placeholder bundle so `rust-embed` compiles; replaced by the Next.js `out/` export in Phase 6. |
| `src/main.rs` | Rewritten: loads `Config`, builds `AppState`, mounts `routes::router().fallback(embed::static_handler)` with `TraceLayer` + permissive `CorsLayer` (GET/POST/PUT/DELETE/OPTIONS, `Authorization`/`Content-Type` headers), `.with_state(...)`, graceful shutdown retained. |

### Decisions

- **JWT bearer, not httpOnly cookie.** The Next.js source set an httpOnly session cookie; the
  Rust port issues a JWT and clients send `Authorization: Bearer <jwt>` (PLAN-mandated, simpler
  for the single-binary + mobile API-key story). The Discord callback hands the token back via
  the URL fragment `#token=` so the SPA can store it without it hitting the server logs.
- **`timestamp_ms: i64` (epoch millis), not an ISO-8601 string.** Avoids pulling in `chrono`/
  `time` purely for audit formatting. `audit_logs.json` is a new internal file, so the format
  is ours to define; the dashboard renders the millis client-side.
- **No `.env` auto-load (`dotenvy` skipped).** Keeps the audited dependency set minimal; env
  vars are set by the launching shell/service. The build needs no env vars; only **runtime**
  requires `JWT_SECRET`.
- **Lazy gRPC channel.** `connect_lazy()` means the dashboard starts even when `rust-server`
  isn't running yet (DCS not launched). The field is wired now and consumed in Phase 3.
- **Permissive CORS.** `allow_origin(Any)` mirrors the dev posture; tighten to the real origin
  in Phase 6 if the dashboard is served cross-origin in production.

### Environment variables

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET` | **yes** (runtime) | — | HS256 signing secret, ≥16 bytes. |
| `ADMIN_PASSWORD` | no | — | Enables password login (`POST /api/auth`). Absent → `503`. |
| `MOBILE_API_KEY` | no | — | Legacy mobile bearer accepted by the `AuthUser` extractor. |
| `APP_URL` | no | `http://localhost:3001` | Front-end origin for Discord redirect. |
| `GRPC_ENDPOINT` | no | `http://localhost:50051` | DCS-gRPC server address. |
| `AUDIT_LOG_PATH` | no | `audit_logs.json` | Auth audit trail file. |
| `DASHBOARD_ADDR` | no | `0.0.0.0:3001` | Listen address. |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_GUILD_ID` / `DISCORD_ADMIN_ROLE_ID` | all-or-nothing | — | Enable Discord OAuth + guild-role gating (`ADMIN_ROLE_ID` comma-separated). |

### Verification

- `cargo build` → **green** (~9s incremental).
- `cargo clippy -- -D warnings` → **clean**, no warnings (generated stubs silenced via
  `#![allow(dead_code)]` in `src/pb.rs`; `grpc` field `#[allow(dead_code)]`).
- `cargo audit` → **clean**, exit 0, 0 advisories across 243 crate dependencies.
- No new dependencies introduced (all Phase 2 crates were already declared and audited in
  Phase 1). Server not started during verification (DCS offline; runtime-only env vars).

## Phase 3 — Unary endpoints (DONE)

Goal: port the REST routes that wrap unary RPCs — health, players, chat, console/eval,
triggers (user flags), atmosphere, and mission status/control — mirroring
`web-dashboard/src/lib/grpc.ts`, consuming `AppState.grpc`.

### What was created / changed

| File | Purpose |
| --- | --- |
| `src/grpc.rs` | **New.** Thin async wrappers over the tonic unary RPCs, one per `grpc.ts` promise helper. Each fn takes a `Channel` (cloned per call), builds the relevant `XxxServiceClient::new(channel)`, issues a `tonic::Request`, and returns the inner response (or `tonic::Status`). 16 wrappers across Metadata (`get_health`, `get_version`), Net (`get_players`, `send_chat`), Hook (`get_mission_name`, `get_paused`, `set_paused`, `stop_mission`, `reload_current_mission`, `load_mission`), Custom (`custom_eval`), Trigger (`get_user_flag`, `set_user_flag`), Atmosphere (`get_wind`, `get_temperature_and_pressure`). |
| `src/routes/dcs.rs` | **New.** Axum handlers that call `crate::grpc` and hand-build JSON with `serde_json::json!` to match the Next.js response shapes. `health` (public), `players`, `chat`, `console`, `get_flag`/`set_flag` (`/api/triggers`), `atmosphere`, `mission_status`, `mission_action`. Shared error helpers map `tonic::Status` → `500 { error, details }`; input validation returns `400`. Coalition int↔name via `Coalition::try_from(..).as_str_name()`. |
| `src/routes/mod.rs` | Mounted the new routes; repurposed `/api/health` to hit the DCS server (Metadata `GetHealth`+`GetVersion`) and moved the process-liveness probe to **`/healthz`** (renamed `health()` → `liveness()`). |
| `src/main.rs` | Added `mod grpc;`. |
| `src/state.rs` | Removed the `#[allow(dead_code)]` on `grpc` (now consumed by the handlers). |

### Endpoint map

| Method + path | Auth | RPC(s) | Response shape |
| --- | --- | --- | --- |
| `GET /healthz` | public | none | `{ status, service, version }` (process liveness) |
| `GET /api/health` | public | Metadata `GetHealth` + `GetVersion` | `{ health: { alive }, version: { version } }` |
| `GET /api/players` | yes | Net `GetPlayers` | `{ players: [{ id, name, coalition(name), slot, ping, remote_address, ucid, locale }] }` |
| `POST /api/chat` | yes | Net `SendChat` | `{ success: true }` |
| `POST /api/console` | yes | Custom `Eval` | `{ result: <json> }` |
| `GET /api/triggers` | yes | Trigger `GetUserFlag` | `{ flag, value }` |
| `POST /api/triggers` | yes | Trigger `SetUserFlag` | `{ success, flag, value }` |
| `GET /api/atmosphere` | yes | Atmosphere `GetWind` + `GetTemperatureAndPressure` | `{ wind: { heading, strength }, atmosphere: { temperature, pressure } }` |
| `GET /api/mission` | yes | Hook `GetMissionName` + `GetPaused` | `{ currentMission, isPaused, serverInfo, queue, uploadedMissions }` |
| `POST /api/mission` | yes | Hook `SetPaused`/`StopMission`/`ReloadCurrentMission`/`LoadMission` | `{ success, action }` |

### Decisions

- **No serde derives on proto types (PLAN divergence, documented).** PLAN §Phase 3 anticipated
  introducing serde derives + the `google.protobuf.Struct` helper here. In practice every Phase 3
  endpoint is unary and its response is small, so the handlers hand-build JSON with
  `serde_json::json!` and read proto fields directly. This keeps `build.rs`/`src/pb.rs` and the
  audited dependency surface **unchanged**. The `Struct` helper is genuinely needed only for the
  mission streaming events/units (`details` is `google.protobuf.Struct`) — **deferred to Phase 4**,
  where it actually lands.
- **`/api/health` repurposed; `/healthz` added.** The Phase 2 `/api/health` was a *process*
  liveness probe. The frontend expects `/api/health` to report the **DCS server** status
  (`{ health:{alive}, version:{version} }`), so Phase 3 points `/api/health` at MetadataService
  and moves the process probe to `/healthz`. `/api/health` stays public so the login screen can
  show server status pre-auth.
- **Mission route split — gRPC now, FS later.** `GET /api/mission` returns the gRPC-derived
  `currentMission`/`isPaused`; `serverInfo` is `null` and `queue`/`uploadedMissions` are empty
  arrays for now. `POST /api/mission` handles `pause`/`resume`/`stop`/`reload`/`load_file` via
  Hook RPCs; `add_to_queue`/`remove_from_queue` return **501** (queue management is
  `serverSettings.lua`-backed → **Phase 5**). `load_file` requires `payload.file_name` and
  backslash-escapes it before the RPC.
- **`/api/weather` not in Phase 3.** It is filesystem/preset-backed (not a unary RPC) →
  **Phase 5**. The pure-gRPC `/api/atmosphere` is what ships here.
- **Auth coverage.** All new DCS data/control endpoints require `AuthUser`; only `/api/health`
  and `/healthz` are public.

### Verification

- `cargo build` → **green** (~6s).
- `cargo clippy -- -D warnings` → **clean**, no warnings.
- `cargo audit` → **clean**, exit 0 (243 crate dependencies; **no new deps** — `Cargo.lock`
  unchanged).
- Runtime curl checks (`/api/health`, `/api/players`, `/api/atmosphere`) require a live
  DCS-gRPC server and are **deferred to a runtime smoke test**; the lazy channel means the
  binary compiles and starts offline.

## Phase 4 — Telemetry streams (DONE)

Real-time `/api/events/stream` and `/api/radar/stream` SSE endpoints, fed by long-lived
upstream gRPC streams fanned out to all connected clients via broadcast channels.

### Files added

- `src/proto_json.rs` — reflection-based JSON renderer matching the legacy Node wire format.
- `src/telemetry.rs` — background producer tasks (`run_events`, `run_units` ×4) with
  reconnect/backoff, publishing rendered JSON to broadcast channels.
- `src/routes/stream.rs` — `events_stream` / `radar_stream` SSE handlers subscribing to the
  broadcast channels.

### Files edited

- `Cargo.toml` — added `prost-reflect = { version = "0.14", features = ["serde"] }`.
- `build.rs` — emit a `file_descriptor_set_path` (`$OUT_DIR/dcs_descriptor.bin`) from
  `tonic-build` for runtime reflection.
- `src/pb.rs` — expose `FILE_DESCRIPTOR_SET` (`include_bytes!` of the descriptor set).
- `src/grpc.rs` — `stream_events` / `stream_units` wrappers returning `tonic::Streaming<…>`.
- `src/state.rs` — `events_tx` / `units_tx` broadcast senders (capacity 1024, latest-wins).
- `src/routes/mod.rs` — public `/api/events/stream` + `/api/radar/stream` routes (an
  `EventSource` cannot send an `Authorization` header, matching the original routes).
- `src/main.rs` — `proto_json` + `telemetry` modules; `telemetry::spawn(...)` on startup.

### Wire-format fidelity (Strategy A — prost-reflect)

The original Next.js backend decoded gRPC with `@grpc/proto-loader`
(`{ keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }`). Browser
(`Map.tsx`) and Android consumers depend on that exact shape. Rather than hand-roll ~40 event
oneof variants and every nested message (Strategy B, rejected as error-prone), we transcode
each typed message into a `DynamicMessage` and serialize with
`SerializeOptions::use_proto_field_name(true).skip_default_fields(false)`, which yields
snake_case names, UPPER_SNAKE enum strings, 64-bit-as-string, and included defaults.

Canonical proto JSON omits proto-loader's `oneofs: true` virtual discriminator, so
`inject_oneof_discriminators` walks the message and adds `"<oneof>": "<variant>"` (e.g.
`{ "update": "unit", "unit": { … } }`). Synthetic proto3-`optional` oneofs (single member) are
skipped, and `google.protobuf.*` well-known types are guarded against recursion since they
serialize to canonical JSON that no longer mirrors their fields (handles the
`google.protobuf.Struct` event `details` deferred from Phase 3).

### Concurrency / resilience

- One upstream `StreamEvents` + four `StreamUnits` (Airplane/Helicopter/Ground/Ship) tasks
  shared across all SSE clients → minimal load on DCS-gRPC.
- Reconnect with capped exponential backoff (1 s → 30 s) since the gRPC server restarts on
  every DCS mission/world reload.
- Lagging (slow) SSE clients drop frames (`BroadcastStreamRecvError::Lagged`) rather than
  stalling producers; sends with no subscribers are ignored.

### Verification

- `cargo build` → **green** (fixed one error: `ReflectMessage` trait needed in scope for
  `DynamicMessage::descriptor()`).
- `cargo clippy --all-targets -- -D warnings` → **clean**.
- `cargo audit` → **clean**, exit 0 (246 crate dependencies; new deps `prost-reflect 0.14.7`,
  `ordered-float 2.10.1`, `serde-value 0.7.0` — no advisories).
- Runtime SSE checks require a live DCS-gRPC server and are **deferred to a runtime smoke
  test**.

## Phase 5 — Filesystem + OS integration (DONE)

Ports the filesystem/OS half of the Next.js API into Rust.

### Config (`src/config.rs`)
Added `audit_log_path`, `dcs_saved_games_dir`, `dcs_dynamic_weather_dir` (optional),
`python_exe`, and `task_whitelist` (lowercased), plus helpers `server_settings_path()`,
`missions_dir()`, and `uploads_dir()`.

### `serverSettings.lua` (`src/settings_lua.rs`)
`mlua` (vendored Lua 5.1) + `spawn_blocking` parse the file into JSON by reading the global
`cfg` table — more robust than the original regex read path. The **write** path
(`serialize_settings`) reproduces the source's exact CRLF + tab byte layout so the file stays
diff-stable and DCS-compatible. `mutate_queue` adds/removes a `missionList` entry. Public IP is
fetched once (api.ipify.org) and cached via `OnceCell`, with an `"Unknown IP"` fallback.

> **Non-`Send` `mlua`:** this crate builds `mlua` with `lua51`/`vendored` and no `send`
> feature, so `Lua` and `mlua::Error` are neither `Send` nor `Sync`. All Lua work runs inside a
> single `spawn_blocking` closure that returns an owned `serde_json::Value`, and `LuaError`
> values are bridged into `anyhow` at each boundary via a small `to_anyhow` stringify helper
> (a direct `?` conversion is impossible because `LuaError: !Send + !Sync + !StdError`).

### OS-backed endpoints (`src/routes/system.rs`)
Ten session-protected handlers wired in `src/routes/mod.rs`:
`/api/settings` (GET/POST), `/api/mission/upload` (multipart), `/api/mission/browse`,
`/api/logs/access`, `/api/rdp-status`, `/api/server/tasks` (GET/POST), `/api/weather` (GET),
and `/api/weather/apply` (POST). OS-command endpoints keep the task whitelist and `'`→`''`
PowerShell sanitization. Audit-log reads live in `auth::read_audit_logs`.

### Verification
`cargo build` ✓ · `cargo clippy --all-targets -- -D warnings` ✓ · `cargo audit` ✓
(0 vulnerabilities; `axum` multipart added `multer`, `encoding_rs`, `spin` to the tree).

## Phase 6 — Packaging (DONE)

Embeds the Next.js static export into the binary so the dashboard ships as a single,
portable executable (Option A — *runtime independence only*; `web-dashboard` remains the
frontend source project, no restructuring).

### Static export → embedded assets

- `web-dashboard` builds with `next.config.ts` `output: 'export'`, producing a full static
  bundle in `web-dashboard/out/` (all routes + `_next/` + assets).
- The `out/` tree (**172 files**) was copied verbatim into `rust-web-dashboard/static/`, which
  is the `rust-embed` source folder baked into the binary at compile time.

### Asset serving (`src/embed.rs`)

`#[derive(RustEmbed)] #[folder = "static/"] struct Assets;`. `static_handler(uri)` resolves a
request path by trying, in order: the exact path, `<path>.html`, then `<path>/index.html`, and
finally falls back to `index.html` (SPA fallback). `serve()` sets `CONTENT_TYPE` from the
embedded file's `metadata.mimetype()`, so deep links (e.g. `/weather` → `weather.html`) and
hashed `_next/` assets get correct MIME types.

### Verification

- `cargo build` ✓ · `cargo clippy -- -D warnings` ✓ (clean, 1.70s) ·
  `cargo audit` ✓ (exit 0; 0 vulnerabilities across 249 crate dependencies; 1137 advisories).
- **Single-binary smoke test** (`JWT_SECRET` set, `DASHBOARD_ADDR=127.0.0.1:3099`, no live
  DCS-gRPC backend):
  - Boots and binds the configured address; background telemetry streams retry-with-backoff
    against `localhost:50051` as expected (no DCS server during the test).
  - `GET /` → **200** `text/html` (8649 bytes) — embedded SPA shell served.
  - `GET /weather` → **200** `text/html`, body contains weather content — deep-link rewrite to
    `weather.html` via `static_handler` works.
  - `GET /_next/static/chunks/<hash>.js` → **200** `text/javascript` (28377 bytes) — hashed
    asset served with correct MIME from embedded metadata.

### Decisions / security notes

- **Option A (runtime independence only).** Embed `out/` → `static/`, ship one binary. The repo
  keeps two folders (`web-dashboard` frontend source + `rust-web-dashboard` binary); no frontend
  relocation. `web-dashboard` is left exactly as-is.
- **`JWT_SECRET` is required at startup** (no default; must be ≥ 16 chars) — `src/config.rs`
  bails otherwise. `APP_URL` optional; gRPC endpoint defaults to `http://localhost:50051`
  (`GRPC_ENDPOINT`); bind defaults to `0.0.0.0:3001` (`DASHBOARD_ADDR`).
- **npm audit (frontend build-time only):** `npm audit --omit=dev` reports **2 moderate**
  advisories in a build-time-only `postcss` transitively inside Next.js. **Documented, not
  remediated** — the only fix path downgrades Next.js to v9, the issue is build-time only, and
  no affected code ships in `out/`/`static/`.
