# File Downloads Plan (Missions + Tacview)

Status: **implemented** 2026-09-06 on branch `downloads`. Decisions D1–D6 were
answered as recorded in §10; the sections below describe what was built.

## 1. Goal

The dashboard can currently only *push* files to the server (`POST /api/mission/upload`).
Two download capabilities are requested:

1. **Download mission files** from the DCS `Missions/` tree that the Mission page
   already lists via `GET /api/mission/browse`.
2. **Download Tacview recordings** from the Tacview folder
   (`C:\Users\<user>\Documents\Tacview` by default), configured through an
   environment variable set in NSSM rather than hard-coded.

Both must obey the existing auth model and must not be turnable into an
arbitrary-file-read of the server's disk.

## 2. What exists today (verified in the codebase)

| Concern | Where | Notes |
| --- | --- | --- |
| Upload handler | [system.rs:134](../../rust-web-dashboard/src/routes/system.rs#L134) | multipart, `.miz` only, writes to `Missions/Uploads` |
| Mission listing | [system.rs:198](../../rust-web-dashboard/src/routes/system.rs#L198) | recursive, depth ≤ 3, skips hidden dirs and `Uploads`, returns paths **relative to `Missions/`** with `/` separators |
| Route table | [mod.rs:136](../../rust-web-dashboard/src/routes/mod.rs#L136) | all new routes are registered here |
| Config | [config.rs](../../rust-web-dashboard/src/config.rs) | `optional()` env reader; `missions_dir()` / `uploads_dir()` helpers |
| Auth | [auth.rs:81](../../rust-web-dashboard/src/auth.rs#L81) | `AuthUser` extractor accepts `Authorization: Bearer` **or** an `auth_token` cookie; **no query-parameter token** |
| Frontend fetch | [api.ts:57](../../web-dashboard/src/lib/api.ts#L57) | `apiFetch` injects the Bearer token from `localStorage` |
| Binary response precedent | [lso.rs:191](../../rust-web-dashboard/src/routes/lso.rs#L191) | `serve_png` returns bytes with an explicit `Content-Type` |
| Blob-download precedent | [TrapSheetModal.tsx:29](../../web-dashboard/src/app/lso/TrapSheetModal.tsx#L29) | fetch → `res.blob()` → `URL.createObjectURL` → revoke |
| Mission page | [mission/page.tsx](../../web-dashboard/src/app/mission/page.tsx) | folder browser, upload center, queue lists |
| Sidebar | [Sidebar.tsx:155-169](../../web-dashboard/src/components/Sidebar.tsx#L155-L169) | where a new `Tacview` link goes |

### 2.1 The key constraint: the token is not a cookie

The session JWT lives in `localStorage` and is attached as a header by
`apiFetch`. A naive `<a href="/api/...">Download</a>` sends **no**
`Authorization` header, so it would 401.

Two ways out; this plan picks (A):

- **(A) Blob download (chosen).** `apiFetch` the URL, `res.blob()`, create an
  object URL, click a synthetic `<a download=...>`, revoke the URL. This is the
  same shape as `TrapSheetModal`, needs no backend auth changes, and keeps
  exactly one auth path. Cost: the whole file is buffered in browser memory
  before the save dialog, and there is no native browser progress bar.
- **(B) Short-lived signed download tokens** in a query string, letting a plain
  `<a>` work. More moving parts (new token type, new verify path, tokens landing
  in access logs and browser history). Not worth it unless (A) proves painful
  for multi-GB ACMI files.

**D1 answered: (A).** Note the standing caveat: a multi-GB ACMI held as a blob
spikes browser memory. If recordings ever get that large, revisit (B) or a
desktop-side transfer. See §7.

## 3. Backend design

### 3.1 New config (config.rs)

Add one field to `Config`:

```rust
/// Optional Tacview recordings directory (`Documents\Tacview` by default on a
/// desktop install). When unset, the `/api/tacview/*` routes report
/// "not configured".
pub tacview_dir: Option<PathBuf>,
```

Loaded exactly like `lso_dir`, i.e. trimmed and de-quoted:

```rust
let tacview_dir = optional("TACVIEW_DIR")
    .map(|s| PathBuf::from(s.trim().trim_matches('"').trim_matches('\'')));
```

**D2 answered: no automatic fallback.** Under NSSM the service usually runs
as `LocalSystem` or a dedicated account, so `%USERPROFILE%` resolves to a
profile that has no Tacview data — a silent fallback would show an empty list
and look like a bug. Explicit `TACVIEW_DIR` is clearer, and the "not configured"
message tells the admin what to do. (The docs will give
`C:\Users\<user>\Documents\Tacview` as the example value to copy.)

### 3.2 Path safety helper (new, shared)

Both download routes take a client-supplied relative path. One helper guards
them, in `routes/system.rs` (or a small `routes/files.rs` if you prefer):

```rust
/// Resolve `rel` against `root`, rejecting anything that escapes `root`.
/// Returns the canonical path of an existing regular file.
async fn resolve_under(root: &Path, rel: &str) -> Result<PathBuf, DownloadError>
```

Rules, all enforced:

1. Reject an empty `rel`.
2. Reject absolute paths and Windows drive prefixes (`C:`), UNC prefixes
   (`\\`), and any `..` component — checked on the parsed `Path`, not on the
   raw string, so `..%2f`, `a/../..`, and mixed separators are all covered.
   Accept `/` and `\` as separators (the browser hands back `/`).
3. `tokio::fs::canonicalize` both `root` and the joined path, then require
   `joined.starts_with(root_canonical)`. This is what defeats symlinks/junctions
   pointing outside the tree — DCS mission folders on a separate drive are a
   real thing.
4. Require `metadata.is_file()` — no directory downloads.
5. Enforce the per-route extension allow-list (below) on the **canonical** file
   name.

Failure mapping: `400` for a malformed path, `404` for "not under root / not a
file / wrong extension" (do not distinguish — that would leak whether a path
exists outside the root), `500` for I/O errors.

### 3.3 Streaming file responses

For missions (a few MB) buffering is fine, but ACMI files can be hundreds of MB
to multiple GB, so **stream** rather than `fs::read` into a `Vec<u8>`:

```rust
let file = tokio::fs::File::open(&path).await?;
let stream = tokio_util::io::ReaderStream::new(file);
let body = axum::body::Body::from_stream(stream);
```

Headers on every download response:

- `Content-Type: application/octet-stream` (both `.miz` and `.acmi`/`.zip.acmi`
  are opaque archives; `application/octet-stream` avoids any browser sniffing).
- `Content-Length: <metadata.len()>` so the browser can show progress.
- `Content-Disposition: attachment; filename="<ascii-fallback>"; filename*=UTF-8''<percent-encoded>`
  — RFC 5987 form, because DCS mission names contain spaces, accents, and
  Cyrillic. The ASCII fallback strips non-ASCII and quotes/CR/LF.

`tokio-util` comes in already through `tower-http`'s `fs` feature, but it must
be added as a **direct** dependency to be importable:
`tokio-util = { version = "0.7", features = ["io"] }`.

### 3.4 New endpoints

| Method + path | Purpose |
| --- | --- |
| `GET /api/mission/download?path=<rel>` | Stream one `.miz` from the `Missions/` tree |
| `GET /api/tacview/browse` | List Tacview recordings (name, relative path, size, mtime) |
| `GET /api/tacview/download?path=<rel>` | Stream one recording |

All three take `_user: AuthUser` — same protection as every other data route.

**`GET /api/mission/download`**
- Root: `state.config.missions_dir()`.
- Allow-list: `.miz` only (case-insensitive).
- `Uploads/` **is** downloadable here even though `mission_browse` hides it, so
  the "Uploaded Files" panel can offer a download too. (`mission_status`
  already exposes those paths.)
- Response: stream + headers per §3.3.

**`GET /api/tacview/browse`**
- Root: `config.tacview_dir`; if `None` →
  `{ "success": false, "configured": false, "error": "TACVIEW_DIR is not configured", "files": [] }`
  with HTTP 200, so the page can render a clear message instead of an error
  toast. (Mirrors how the LSO routes report "not configured".)
- Recursive walk, depth ≤ 3, skipping hidden dirs — same shape as
  `mission_browse`, but returning **objects**, not bare strings, because sorting
  by date is the main way anyone finds a Tacview file:

  ```json
  { "success": true, "configured": true, "files": [
      { "path": "2026-09-06/Tacview-20260906-201501-DCS.zip.acmi",
        "name": "Tacview-20260906-201501-DCS.zip.acmi",
        "size": 184320111,
        "modified_ms": 1757193301000 }
  ] }
  ```

- Extensions listed: `.acmi` and `.zip.acmi` (the `.txt.acmi` variant too — the
  rule is simply "ends with `.acmi`").
- The result is capped at **200** entries (`TACVIEW_LIST_LIMIT`), sorted newest
  first *before* truncation so the cap keeps the most recent recordings. The
  response also carries `total` and `limit`, so the page can say "showing the
  200 newest of N". No `?limit=` / `?since=` query params in v1 (decision D3).

**`GET /api/tacview/download`**
- Root: `config.tacview_dir` (404 "not configured" if `None`).
- Allow-list: names ending in `.acmi`.
- Response: stream + headers per §3.3.

### 3.5 Deletion — explicitly out of scope

A "delete old Tacview file" button is an obvious follow-up but is **not** in
this plan. Ask for it separately if wanted; it needs its own confirmation UX.

## 4. Frontend design

### 4.1 Shared download helper — `web-dashboard/src/lib/download.ts` (new)

```ts
/** Fetch an authenticated URL and hand the bytes to the browser's save dialog. */
export async function downloadFile(url: string, filename: string): Promise<void>
```

Implementation: `apiFetch(url)` → on non-OK, parse `{ error }` and throw →
`res.blob()` → `URL.createObjectURL` → create `<a>` with `download=filename`,
`a.click()`, remove it, `URL.revokeObjectURL` in a `finally`. It mirrors
`TrapSheetModal`'s lifecycle so there is one idiom in the codebase.

### 4.2 Mission page ([mission/page.tsx](../../web-dashboard/src/app/mission/page.tsx))

Add a `Download` button (⬇, styled like the existing `Run Now` / `Remove`
outline buttons, in `var(--primary)`) in three places:

1. **Server Files Browser** rows (line ~832 button group) — path is already the
   `Missions/`-relative path the API wants.
2. **Uploaded Files** rows (line ~663) — these come from `mission_status`, so
   normalise to a `Missions/`-relative path before calling
   (`Uploads/<name>`); worth asserting the exact shape during implementation.
3. **Server Queue** rows — **not** given a download button (D4). Queue entries
   are the raw `serverSettings.lua` strings, often absolute or `DCS_ROOT`-relative,
   so they may not resolve under `Missions/`; the same files are reachable
   through the browser panel.

Per-row state: a `downloading: string | null` holding the path in flight, so the
clicked button shows `...` and is disabled. Errors surface in a small red line
under the panel header, reusing `errorMessage` from `@/lib/errors`.

### 4.3 New Tacview page — `web-dashboard/src/app/tacview/page.tsx`

A single panel, styled like the LSO / mission panels (`#0b1118` background,
`var(--panel-border)`, mono font):

- Header `Tacview Recordings` + a refresh button.
- When `configured: false`: an inline note — *"Set `TACVIEW_DIR` in the service
  environment to enable Tacview downloads."*
- Search box filtering on name (client-side, like the mission browser).
- Table: **Name | Size | Recorded | Download**, sorted newest first, with size
  rendered as MB/GB and the date in the user's locale.
- Long lists: render up to the API cap; a plain scroll container as elsewhere.
- Sidebar entry `Tacview` added after `LSO` in
  [Sidebar.tsx](../../web-dashboard/src/components/Sidebar.tsx#L168).

**D5 answered: a separate `/tacview` page** — Tacview is not mission management,
and the Mission page is already dense.

## 5. Documentation and packaging

1. **[docs/src/configuration.md](configuration.md)** — add `TACVIEW_DIR` to the
   NSSM environment-variable table (§2), next to `LSO_DIR`, with the example
   `C:\Users\<user>\Documents\Tacview` and a note that the service account must
   have read access to that folder (this is the real-world gotcha: a
   `LocalSystem` service reading another user's `Documents` needs the ACL to
   allow it).
2. **[docs/src/features.md](features.md)** — document mission download +
   the Tacview page.
3. **[docs/src/rest-api.md](rest-api.md)** — the three new endpoints.
4. **OpenAPI** — add `#[utoipa::path]` annotations on the three handlers,
   register them in the `paths(...)` list in
   [mod.rs:23](../../rust-web-dashboard/src/routes/mod.rs#L23), then regenerate
   `docs/src/openapi.json` with the documented command in
   [mod.rs:106](../../rust-web-dashboard/src/routes/mod.rs#L106).
5. **[docs/src/SUMMARY.md](SUMMARY.md)** — link this plan doc while it is live.

## 6. Implementation steps (ordered)

Each step compiles and is independently reviewable.

1. **Config** — add `tacview_dir` to `Config` + `from_env`. `cargo check`.
2. **Dependency** — add `tokio-util = { version = "0.7", features = ["io"] }`
   to `rust-web-dashboard/Cargo.toml`.
3. **Path guard + streaming helper** — `resolve_under` and a
   `stream_download(path, filename)` helper in `routes/system.rs`, with unit
   tests (§8).
4. **`GET /api/mission/download`** — handler + utoipa annotation + route.
5. **`GET /api/tacview/browse`** — handler + annotation + route.
6. **`GET /api/tacview/download`** — handler + annotation + route.
7. **Regenerate** `docs/src/openapi.json`.
8. **Frontend `lib/download.ts`** helper.
9. **Mission page** download buttons (browser + uploads panels).
10. **Tacview page** + sidebar link.
11. **Docs** — configuration, features, rest-api, SUMMARY.
12. **Build check** — `cargo build --release` and `npm run build` in
    `web-dashboard/` (the static export is embedded by `rust-embed`).
13. **Manual verification** (§9), then commit on `downloads` and open the PR.

## 7. Risks and how they are handled

| Risk | Handling |
| --- | --- |
| Path traversal → arbitrary file read | canonicalize + `starts_with` + extension allow-list + `is_file`; unit-tested (§8) |
| Symlink/junction escaping the root | canonicalization happens after the join, so the link target is what gets checked |
| Very large ACMI buffered in browser memory | server streams; browser still buffers the blob. If files are multi-GB, revisit decision D1 |
| Long-running download killed by a proxy | if the dashboard sits behind IIS/nginx, the proxy read timeout may need raising — flagged in docs, not code |
| Service account cannot read `Documents\Tacview` | documented ACL note; the browse route surfaces the OS error rather than an empty list |
| Non-ASCII mission names breaking the save dialog | RFC 5987 `filename*` with an ASCII fallback |
| Downloading the mission DCS is currently running | reading a `.miz` while DCS has it open is a shared read on Windows and works; if a read ever fails it surfaces as a 500 with the OS message |

## 8. Tests

Rust unit tests (`#[cfg(test)]` in `routes/system.rs`), using `tempfile`-style
temp dirs or a fixture tree:

- `resolve_under` rejects: `..\..\Windows\win.ini`, `../../etc/passwd`,
  `C:\Windows\win.ini`, `\\server\share\x`, `` (empty), a directory, and
  `notes.txt` (wrong extension).
- `resolve_under` accepts: `foo.miz`, `Sub Folder/foo.miz`,
  `Sub Folder\foo.miz`, and a name with spaces + non-ASCII.
- `content_disposition` produces both `filename=` and `filename*=` and strips
  CR/LF and quotes.
- Tacview browse listing sorts newest-first and honours the cap.

Frontend: the repo's existing tests are colocated `*.test.ts` files under
`app/airboss/`. A small `lib/download.test.ts` is feasible if a DOM environment
is configured; otherwise the helper is covered by manual verification.
**D6 answered: manual verification** — `download.ts` is ~20 lines of DOM
plumbing, covered by the checklist in §9.

## 9. Manual verification checklist

1. Set `TACVIEW_DIR` in the NSSM Environment tab; restart the service.
2. Mission page → Server Files Browser → **Download** on a nested mission →
   file saves, opens in the DCS Mission Editor.
3. Mission page → Uploaded Files → **Download** → same.
4. Tacview page → list shows recent recordings with plausible sizes/dates.
5. Download a large `.zip.acmi` → opens in Tacview.
6. `curl` the download endpoint with no token → `401`.
7. `curl "…/api/mission/download?path=..%2f..%2f..%2fWindows%2fwin.ini"` → `404`,
   nothing served.
8. Unset `TACVIEW_DIR`, restart → Tacview page shows the "not configured" note,
   no console errors.

## 10. Decisions (answered 2026-09-06)

| # | Decision | Answer |
| --- | --- | --- |
| D1 | Blob download (A) vs signed download URLs (B) | **A** — fetch → blob → object URL, no backend auth change |
| D2 | Fall back to `%USERPROFILE%\Documents\Tacview` when `TACVIEW_DIR` unset? | **No automatic fallback** |
| D3 | Tacview listing cap / query params | **Hard cap 200, newest-first, no query params in v1** |
| D4 | Download button on Server Queue rows? | **No** — queue left alone in v1 |
| D5 | Separate `/tacview` page vs a Mission-page panel | **Separate page** |
| D6 | Frontend test for `download.ts`? | **Manual verification** |

## 11. What was built

Backend — new [routes/downloads.rs](../../rust-web-dashboard/src/routes/downloads.rs):

- `resolve_under(root, rel, allowed_ext)` — the shared path guard (component
  check → canonicalize → `starts_with` → `is_file` → extension allow-list).
- `content_disposition(filename)` — RFC 5987 header with an ASCII fallback.
- `stream_download(path)` — `ReaderStream` body plus `Content-Length`, so a
  multi-hundred-MB `.acmi` is never buffered server-side.
- Handlers `mission_download`, `tacview_browse`, `tacview_download`, registered
  in [routes/mod.rs](../../rust-web-dashboard/src/routes/mod.rs) and annotated
  for OpenAPI.
- `Config::tacview_dir` from `TACVIEW_DIR` in
  [config.rs](../../rust-web-dashboard/src/config.rs).
- `tokio-util` (feature `io`) added as a direct dependency.

Frontend:

- [lib/download.ts](../../web-dashboard/src/lib/download.ts) — `downloadFile`
  and `formatBytes`.
- [mission/page.tsx](../../web-dashboard/src/app/mission/page.tsx) — Download
  buttons on the server-files browser and uploads panels, with a per-row
  in-flight state and an error line. Uploaded files are absolute on the wire, so
  the handler normalises anything up to and including `Missions/` away before
  calling the endpoint.
- [tacview/page.tsx](../../web-dashboard/src/app/tacview/page.tsx) — the new
  page, plus a sidebar link in
  [Sidebar.tsx](../../web-dashboard/src/components/Sidebar.tsx).

Tests: 6 new unit tests in `routes/downloads.rs` (traversal rejection, mixed
separators, compound `.zip.acmi` suffix, directories and wrong extensions,
`Content-Disposition` encoding). Full suite: 57 passed.

### Deviation from the plan as written

One behaviour was added that §4.2 did not specify: on both Mission-page panels
the **Download** button is shown even for the currently-running mission, whereas
the existing `Add to Queue` / `Run Now` buttons stay hidden there. Downloading
the active mission is safe (Windows allows the shared read) and is exactly the
file an admin is most likely to want, so hiding it would have been an arbitrary
gap.
