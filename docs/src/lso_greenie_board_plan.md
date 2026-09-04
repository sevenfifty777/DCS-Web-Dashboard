# LSO Greenie Board Page Plan

Status: proposed 2026-09-04, branch `lso`. Nothing below is implemented yet.

## Goal

Move the greenie board served by the `DCS-gRPC-lso` client (`lso.exe run --web-port 8080`) into
this dashboard as a new **LSO** page, then delete the LSO client's built-in HTTP server. The new
page must show the same 14 columns with the same grade colouring and 10 s refresh, and it must not
add a single DCS-gRPC call: the board is read from files the LSO client already writes.

## Current state

| Side | What exists today |
| --- | --- |
| LSO client (`../DCS-gRPC-lso`) | `src/web.rs` runs an axum 0.7 server on `127.0.0.1:<port>` with `GET /` (inline HTML, 14-column table, 10 s `setInterval`) and `GET /api/passes` (`Vec<StoredPass>` from `RecoveryDb::all_passes`, UCID stripped unless `--web-expose-ucid`). Restarted with backoff from `src/commands/run.rs`. |
| LSO data | `<out-dir>/lso.db` (SQLite, table `passes`, additive migrations 1–6, `INSERT OR IGNORE` keyed by `recovery_id`). Per pass: `<out-dir>/<timestamp>.png` (trap sheet), `<timestamp>-pattern.png`, `<timestamp>.json`, optional `.zip.acmi`. The `timestamp` column is the file stem `LSO-<yyyymmdd>-<hhmmss>-<pilot>-<recovery-id>`. |
| LSO notes | `lso_notes` is not stored; it is computed at query time by `src/lso_notation::to_english(dcs_grading)` (pure function, no dependencies, ~220 lines plus tests). |
| Dashboard backend | axum 0.8 + utoipa. File-backed pages follow the Foothold pattern: a `Config` path from an env var, a parser module (`src/foothold.rs`), handlers in `src/routes/system.rs`, routes and `ApiDoc` entries in `src/routes/mod.rs`. No SQLite dependency yet (`mlua` is the only native dep). |
| Dashboard frontend | Next.js static export. Table pages (`src/app/leaderboard/page.tsx`) poll with `apiFetch` every 10 s. Links live in `src/components/Sidebar.tsx`. All routes sit behind `AuthGate` (JWT). |

## Design decision: read `lso.db` directly

The dashboard opens `lso.db` **read-only** with `rusqlite` and serves the rows itself.

Why this and not proxying the LSO client's `/api/passes`:

- The user goal is to remove the LSO web server, not to keep it alive as a JSON backend.
- One process, one port, one auth layer. No loopback hop, no second `axum` in the LSO binary.
- Zero DCS-gRPC cost either way, but direct reads also survive an LSO restart (the board still shows history while `lso.exe` is down).
- `docs/DATA_CONTRACTS.md` in the LSO repo already commits to additive-only SQLite migrations and says "dashboard consumers may ignore unknown fields". This plan is the consumer it anticipates.

Cost: `lso_notation.rs` must be ported (copied verbatim with its tests) and the dashboard gains a `rusqlite` bundled build (~1 min extra compile). Both are acceptable; a later cleanup can extract `lso-notation` into a dependency-free crate in the LSO repo and pull it in as a git dependency from both sides.

Assumption: the dashboard and `lso.exe` run on the same Windows host, which already holds for Saved Games, `serverSettings.lua`, and scheduled-task features.

## Phase 0: LSO client prep (small, ships first)

1. In `src/db.rs` `RecoveryDb::open`, set `PRAGMA journal_mode=WAL;` and `PRAGMA busy_timeout=2000;` right after `Connection::open`. WAL lets the dashboard read while LSO inserts without either side waiting on a lock. Add a test that the pragma is applied and that `lso.db-wal` / `lso.db-shm` appear next to the database.
2. No schema change. `lso_notes` stays computed, not stored, so translator improvements keep applying to old rows.
3. Tag a release; the dashboard docs will state the minimum LSO version.

## Phase 1: dashboard backend

Files to add or touch, in order:

1. `rust-web-dashboard/Cargo.toml`: add `rusqlite = { version = "0.31", features = ["bundled"] }` (same version as the LSO client).
2. `src/config.rs`: new field `lso_dir: Option<PathBuf>` from env `LSO_DIR` (the LSO `--out-dir`). Unset means the page reports "not configured", like `DCS_DYNAMIC_WEATHER_DIR`.
3. `src/lso_notation.rs`: verbatim copy of the LSO module, tests included. Header comment names the source file and commit so drift is visible.
4. `src/lso.rs`, the reader:
   - `open_read_only(dir) -> rusqlite::Connection` with `OpenFlags::SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`, `busy_timeout(2 s)`, `PRAGMA query_only=1`. Open per request inside `spawn_blocking`; the DB may not exist until the first trap, so a missing file is a 404 with `{ "error": "lso.db not found" }`, never a 500.
   - `list_passes(conn, limit, since_id) -> Vec<LsoPass>` using `SELECT * FROM passes ORDER BY id DESC LIMIT ?`. Read every column by name and tolerate absent columns (check `stmt.column_names()` first) so a dashboard newer than the LSO schema still works. Compute `lso_notes` via `lso_notation::to_english`.
   - `LsoPass` mirrors `StoredPass` field for field **minus `pilot_ucid`**. The dashboard never returns the UCID; there is no opt-in flag.
   - `chart_path(dir, timestamp, kind) -> PathBuf`: validate `timestamp` against `^LSO-[0-9]{8}-[0-9]{6}-[A-Za-z0-9]+-[A-Za-z0-9_-]+$` before joining, then `<dir>/<timestamp>.png` or `<dir>/<timestamp>-pattern.png`. This blocks path traversal.
   - Unit tests with an in-memory or temp DB: legacy 6-column schema still lists, `points_awarded` false round-trips, UCID column is never serialised, traversal names are rejected.
5. `src/routes/lso.rs`, all handlers take `_user: AuthUser`:

   | Route | Response |
   | --- | --- |
   | `GET /api/lso/status` | `{ configured, db_present, db_path, pass_count, last_pass_at }` for the page header and the "not configured" state. |
   | `GET /api/lso/passes?limit=200&since_id=` | `{ passes: LsoPass[], total }` newest first. Default limit 200, max 2000. |
   | `GET /api/lso/passes/{id}/chart` | `image/png` trap sheet (`<timestamp>.png`), 404 if missing. |
   | `GET /api/lso/passes/{id}/pattern` | `image/png` overhead pattern chart. |

   The id lookup resolves `timestamp` from the row so the client never sends a filename.
6. `src/routes/mod.rs`: mount the four routes, add them to `ApiDoc` paths, add `LsoPass` and the status struct to `components(schemas)`, add tag `lso`.
7. Regenerate `docs/src/openapi.json` with `EXPORT_OPENAPI=1`.

Nothing in this phase touches `AppState.grpc`. Add a comment in `routes/lso.rs` saying so, since the project goal is minimal DCS-gRPC load.

## Phase 2: dashboard frontend

1. `web-dashboard/src/app/lso/lsoGrades.ts` plus `lsoGrades.test.ts` (pure helpers, same convention as `airboss/deckSpots.ts`):
   - `gradeClass(grade)`: `_OK_` → `uni`, `OK` → `ok`, `(OK)` → `okp`, `--` → `ng`, `C` → `cut`, `B` and `WO` → `muted`.
   - `points(pass)`: `undefined` when `points_awarded === false`; else `grade_points` when present; else legacy map `_OK_ 5, OK 4, (OK) 3, -- 2, B 2.5, WO 1, C 0`. Format with 2 decimals when `spot` is set, else 1.
   - `wireOrSpot(pass)`: `spot ?? wire ?? '-'`.
   - `technicalStatus(pass)`: `Available` when `completeness === 'complete'`, else `Unavailable — <completeness>`.
2. `web-dashboard/src/app/lso/page.tsx` + `page.module.css`:
   - Header "LSO Greenie Board", status line "Updated hh:mm:ss, N pass(es)" and error text, matching the LSO page.
   - Table with the same 14 columns in the same order: #, Timestamp, Grade Date, Mission Time, Pilot, Aircraft, Map, Grade, Pts, Wire/Spot, Outcome, Technical status, DCS Grade, LSO Notes. `#` counts down from the total like the original.
   - Grade colours reuse dashboard tokens: `uni` gold with glow, `ok` `var(--success)`, `okp` lighter green, `ng` `var(--warning)`, `cut` `var(--danger)`, `muted` `var(--text-dim)`.
   - Poll `/api/lso/passes` every 10 s with `apiFetch`, same `setTimeout(0)` + `setInterval` pattern as the leaderboard page. Keep the last good table on a failed refresh.
   - "Not configured" and "no passes yet" empty states driven by `/api/lso/status`.
   - Clicking a row opens a modal with the trap sheet and pattern PNGs loaded through `apiFetch` into an object URL (an `<img src>` cannot send the JWT header). This is the one addition beyond parity; it costs nothing on the server.
   - Optional, behind a toggle: filter by pilot text and carrier, and a per-pilot summary strip (passes, average points, boarding rate). Ship parity first.
3. `src/components/Sidebar.tsx`: add `<Link href="/lso">LSO</Link>` after Airboss Planner.
4. Mobile: the table scrolls inside its own `overflow-x: auto` wrapper; LSO Notes column wraps.

## Phase 3: retire the LSO client web server

Do this only after Phase 2 has run against live traps for one flying session.

1. Delete `src/web.rs` and `mod web` in `src/main.rs`.
2. `src/commands/run.rs`: remove `web_port` and `web_expose_ucid` options and the restart loop. Reject the old flags with a clear clap error message for one release ("--web-port was removed in 0.4.0; use the DCS Web Dashboard LSO page").
3. `src/db.rs`: `all_passes`, `StoredPass` and `force_query_failure_for_test` lose their only callers. Keep `all_passes` under `#[cfg(test)]` for the migration tests; drop the rest.
4. `Cargo.toml`: remove `axum`. Run `cargo tree` to confirm no other crate pulled it in.
5. Docs: README "Web and Discord" section, `docs/ADMIN_GUIDE.md` flag table, `docs/DATA_CONTRACTS.md` SQLite paragraph (replace the loopback endpoint sentence with the dashboard read-only contract and the WAL requirement), `CHANGES.md` entry, version bump to 0.4.0.
6. CI: existing tests still pass; the `database_failure_is_an_http_500` test goes away with `web.rs`.

## Phase 4: docs, release, memory

- Dashboard `docs/src/configuration.md`: add `LSO_DIR` under a new "LSO Greenie Board" table with an example path and the minimum LSO version.
- Dashboard `docs/src/features.md`: new "LSO Greenie Board" section.
- `README.md` feature bullet.
- Build with `build_release.ps1` so the embedded `static/` export contains the new page.
- Update the project memory note so future sessions know the board is file-backed and gRPC-free.

## Verification

| Check | How |
| --- | --- |
| Backend unit | `cargo test` in `rust-web-dashboard`: notation tests, legacy schema listing, traversal rejection, UCID absent from JSON. |
| Concurrency | Run `lso.exe` writing traps while hammering `/api/lso/passes` with a loop; no `database is locked` errors on either side. |
| Parity | Open the old LSO page and the new page side by side during one recovery session; every cell matches for the same rows. |
| No gRPC | `grep -n "grpc" src/routes/lso.rs src/lso.rs` returns nothing except the comment. DCS-gRPC log shows no new RPCs when the page is open. |
| Missing DB | Point `LSO_DIR` at an empty folder; page shows the "waiting for first trap" state, backend logs no errors. |
| Auth | Unauthenticated `curl /api/lso/passes` returns 401; the PNG routes too. |

## Risks and open points

- **Read-only open with WAL**: a `SQLITE_OPEN_READ_ONLY` connection needs `lso.db-shm` to exist or the folder to be writable. On the same host with LSO running both hold. If the dashboard ever runs as a different Windows user with no write access to `LSO_DIR`, fall back to opening read-write and relying on `PRAGMA query_only`.
- **Schema drift**: the dashboard selects by column name and tolerates missing columns, so an older LSO keeps working. A newer LSO adding columns is fine by contract.
- **Duplicated translator**: `lso_notation.rs` exists in two repos until the crate extraction happens. The header comment records the source commit.
- **Admin-only board**: everything behind `AuthGate` is admin-only today. Pilots who used the loopback page through a tunnel will need a dashboard login. A public read-only board is a separate decision.
- **rusqlite version**: pin 0.31 to match the LSO client so both link the same bundled SQLite.

## Effort

| Phase | Estimate |
| --- | --- |
| 0 LSO WAL pragma | 1 h |
| 1 backend | 1 day |
| 2 frontend parity + chart modal | 1 day |
| 3 LSO cleanup | 2 h |
| 4 docs and release | 2 h |
