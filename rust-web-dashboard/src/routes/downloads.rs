//! Authenticated file downloads: mission `.miz` files and Tacview recordings.
//!
//! Two rooted trees are exposed — the DCS `Missions/` directory (already listed
//! by [`super::system::mission_browse`]) and the optional Tacview recordings
//! directory (`TACVIEW_DIR`). Every client-supplied path goes through
//! [`resolve_under`], which canonicalizes the join and requires the result to
//! stay inside the root, so these routes can never become an arbitrary-file
//! read of the host.
//!
//! Responses stream from disk via `ReaderStream`: a Tacview `.acmi` can be
//! hundreds of megabytes, which is far too much to buffer into a `Vec<u8>`.
//!
//! All handlers require a valid session (the [`AuthUser`] extractor).

use std::path::{Component, Path, PathBuf};

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use tokio_util::io::ReaderStream;

use crate::auth::AuthUser;
use crate::state::AppState;

/// Newest-first cap on the Tacview listing. A server that has been recording
/// for years holds far more files than anyone scrolls through, and the whole
/// list is serialised into one JSON response.
const TACVIEW_LIST_LIMIT: usize = 200;

/// Maximum directory depth walked when listing Tacview recordings, matching
/// `mission_browse`. Tacview writes either flat or one folder per day.
const TACVIEW_MAX_DEPTH: u32 = 3;

/// `?path=` — a path relative to the route's root directory.
#[derive(Deserialize)]
pub struct DownloadQuery {
    pub path: String,
}

/// Why a download could not be served. The distinction between "escaped the
/// root", "not a file" and "wrong extension" is deliberately collapsed into a
/// single 404 so a caller cannot probe for the existence of paths outside the
/// root.
#[derive(Debug, PartialEq, Eq)]
pub enum DownloadError {
    /// The path was empty, absolute, or contained a `..` component.
    BadRequest(&'static str),
    /// Not found, not a regular file, outside the root, or a disallowed
    /// extension.
    NotFound,
    /// The route's root directory is not configured.
    NotConfigured(&'static str),
    /// An I/O error that is not a plain "missing file".
    Io(String),
}

impl DownloadError {
    fn into_response(self) -> Response {
        match self {
            Self::BadRequest(msg) => {
                (StatusCode::BAD_REQUEST, Json(json!({ "error": msg }))).into_response()
            }
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "File not found" })),
            )
                .into_response(),
            Self::NotConfigured(msg) => {
                (StatusCode::NOT_FOUND, Json(json!({ "error": msg }))).into_response()
            }
            Self::Io(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": msg })),
            )
                .into_response(),
        }
    }
}

/// Resolve `rel` against `root`, rejecting anything that escapes the root.
///
/// The guard is applied to the *parsed* path rather than the raw string, so
/// mixed separators and percent-decoded traversal sequences are all covered.
/// Canonicalization happens after the join, which is what defeats a symlink or
/// NTFS junction inside the root pointing somewhere else — DCS installs on a
/// second drive make those real.
///
/// `allowed_ext` is matched case-insensitively against the end of the file
/// name (not `Path::extension`, so a compound suffix like `.zip.acmi` works).
pub async fn resolve_under(
    root: &Path,
    rel: &str,
    allowed_ext: &[&str],
) -> Result<PathBuf, DownloadError> {
    let trimmed = rel.trim();
    if trimmed.is_empty() {
        return Err(DownloadError::BadRequest("No path provided"));
    }

    // Accept both separators: the browser hands back `/`, `serverSettings.lua`
    // and Windows hand back `\`.
    let normalised = trimmed.replace('\\', "/");
    let candidate = Path::new(&normalised);

    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            // `..`, a leading `/`, a `C:` drive prefix, or a `\\server\share`
            // UNC prefix all mean the caller is trying to leave the root.
            Component::ParentDir
            | Component::RootDir
            | Component::Prefix(_)
            | Component::CurDir => {
                return Err(DownloadError::BadRequest("Invalid path"));
            }
        }
    }

    // The root itself must exist and be canonicalizable before it can be used
    // as a containment boundary.
    let root_canonical = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| DownloadError::NotFound)?;

    let joined = root_canonical.join(candidate);
    let resolved = tokio::fs::canonicalize(&joined)
        .await
        .map_err(|_| DownloadError::NotFound)?;

    if !resolved.starts_with(&root_canonical) {
        return Err(DownloadError::NotFound);
    }

    let metadata = tokio::fs::metadata(&resolved)
        .await
        .map_err(|_| DownloadError::NotFound)?;
    if !metadata.is_file() {
        return Err(DownloadError::NotFound);
    }

    if !has_allowed_extension(&resolved, allowed_ext) {
        return Err(DownloadError::NotFound);
    }

    Ok(resolved)
}

/// Case-insensitive check that the file name ends with one of `allowed`.
fn has_allowed_extension(path: &Path, allowed: &[&str]) -> bool {
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else {
        return false;
    };
    allowed.iter().any(|ext| name.ends_with(&ext.to_lowercase()))
}

/// Build an RFC 5987 `Content-Disposition` value. DCS mission names routinely
/// carry spaces, accents and Cyrillic, so the header pairs an ASCII-only
/// fallback with a UTF-8 `filename*` for browsers that understand it.
pub fn content_disposition(filename: &str) -> String {
    let ascii_fallback: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded = percent_encode(filename);
    format!("attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}")
}

/// Percent-encode for the `filename*` parameter (RFC 5987 `attr-char` set).
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let c = *byte as char;
        if c.is_ascii_alphanumeric() || matches!(c, '!' | '#' | '$' | '&' | '+' | '-' | '.' | '^' | '_' | '`' | '|' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Stream `path` to the client as an attachment.
async fn stream_download(path: &Path) -> Result<Response, DownloadError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|e| DownloadError::Io(e.to_string()))?;
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|e| DownloadError::Io(e.to_string()))?;

    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download".to_string());

    let body = Body::from_stream(ReaderStream::new(file));

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (header::CONTENT_LENGTH, metadata.len().to_string()),
            (header::CONTENT_DISPOSITION, content_disposition(&filename)),
        ],
        body,
    )
        .into_response())
}

// --- /api/mission/download -------------------------------------------------

/// `GET /api/mission/download?path=<rel>` → stream one `.miz` from the DCS
/// `Missions/` tree.
///
/// Unlike [`super::system::mission_browse`], `Missions/Uploads` **is**
/// downloadable here, so the Mission page's "Uploaded Files" panel can offer a
/// download for the files it already lists.
#[utoipa::path(
    get,
    path = "/api/mission/download",
    tags = ["system"],
    security(("jwt" = [])),
    params(("path" = String, Query, description = "Mission path relative to the Missions directory")),
    responses(
        (status = 200, description = "Mission file", content_type = "application/octet-stream"),
        (status = 400, description = "Invalid path"),
        (status = 404, description = "Mission not found")
    )
)]
pub async fn mission_download(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<DownloadQuery>,
) -> Response {
    let root = state.config.missions_dir();
    match resolve_under(&root, &query.path, &[".miz"]).await {
        Ok(path) => match stream_download(&path).await {
            Ok(response) => response,
            Err(err) => err.into_response(),
        },
        Err(err) => err.into_response(),
    }
}

// --- /api/tacview/browse ---------------------------------------------------

/// One Tacview recording in the listing.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TacviewFile {
    /// Path relative to `TACVIEW_DIR`, with `/` separators.
    pub path: String,
    /// Bare file name.
    pub name: String,
    /// Size in bytes.
    pub size: u64,
    /// Last-modified time in milliseconds since the Unix epoch, or `null` when
    /// the filesystem does not report one.
    pub modified_ms: Option<u64>,
}

/// `GET /api/tacview/browse` → list recordings under `TACVIEW_DIR`, newest
/// first, capped at [`TACVIEW_LIST_LIMIT`].
///
/// An unconfigured `TACVIEW_DIR` answers `200` with `configured: false` rather
/// than an error status, so the page can render a "set this variable" note
/// instead of a failure toast.
#[utoipa::path(
    get,
    path = "/api/tacview/browse",
    tags = ["system"],
    security(("jwt" = [])),
    responses((status = 200, description = "List of Tacview recordings"))
)]
pub async fn tacview_browse(_user: AuthUser, State(state): State<AppState>) -> Response {
    let Some(root) = state.config.tacview_dir.clone() else {
        return Json(json!({
            "success": false,
            "configured": false,
            "error": "TACVIEW_DIR is not configured",
            "files": [],
        }))
        .into_response();
    };

    let mut files: Vec<TacviewFile> = Vec::new();
    let mut stack = vec![(root.clone(), 0u32)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > TACVIEW_MAX_DEPTH {
            continue;
        }
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            // Surface the failure only for the root itself: a single
            // unreadable subfolder should not fail the whole listing.
            Err(e) if dir == root => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "success": false,
                        "configured": true,
                        "error": format!("Cannot read {}: {e}", root.display()),
                        "files": [],
                    })),
                )
                    .into_response();
            }
            Err(_) => continue,
        };

        while let Ok(Some(entry)) = entries.next_entry().await {
            let Ok(file_type) = entry.file_type().await else {
                continue;
            };
            let name = entry.file_name();
            let name = name.to_string_lossy().into_owned();

            if file_type.is_dir() {
                if name.starts_with('.') {
                    continue;
                }
                stack.push((entry.path(), depth + 1));
                continue;
            }

            if !name.to_lowercase().ends_with(".acmi") {
                continue;
            }

            let Ok(metadata) = entry.metadata().await else {
                continue;
            };
            let full_path = entry.path();
            let rel = full_path
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());

            files.push(TacviewFile {
                path: rel,
                name,
                size: metadata.len(),
                modified_ms: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            });
        }
    }

    // Newest first, then truncate: the cap must keep the most recent files, not
    // whichever ones the directory walk happened to reach first.
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms).then(a.name.cmp(&b.name)));
    let total = files.len();
    files.truncate(TACVIEW_LIST_LIMIT);

    Json(json!({
        "success": true,
        "configured": true,
        "files": files,
        "total": total,
        "limit": TACVIEW_LIST_LIMIT,
    }))
    .into_response()
}

// --- /api/tacview/download -------------------------------------------------

/// `GET /api/tacview/download?path=<rel>` → stream one recording from
/// `TACVIEW_DIR`.
#[utoipa::path(
    get,
    path = "/api/tacview/download",
    tags = ["system"],
    security(("jwt" = [])),
    params(("path" = String, Query, description = "Recording path relative to TACVIEW_DIR")),
    responses(
        (status = 200, description = "Tacview recording", content_type = "application/octet-stream"),
        (status = 400, description = "Invalid path"),
        (status = 404, description = "Recording not found or TACVIEW_DIR not configured")
    )
)]
pub async fn tacview_download(
    _user: AuthUser,
    State(state): State<AppState>,
    Query(query): Query<DownloadQuery>,
) -> Response {
    let Some(root) = state.config.tacview_dir.clone() else {
        return DownloadError::NotConfigured("TACVIEW_DIR is not configured").into_response();
    };
    match resolve_under(&root, &query.path, &[".acmi"]).await {
        Ok(path) => match stream_download(&path).await {
            Ok(response) => response,
            Err(err) => err.into_response(),
        },
        Err(err) => err.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp directory holding a small fixture tree, removed on drop.
    struct TempTree(PathBuf);

    impl TempTree {
        fn new(tag: &str) -> Self {
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "dashboard-downloads-{tag}-{}-{unique}",
                std::process::id()
            ));
            std::fs::create_dir_all(dir.join("Sub Folder")).expect("create temp tree");
            std::fs::write(dir.join("foo.miz"), b"miz").expect("write foo.miz");
            std::fs::write(dir.join("notes.txt"), b"txt").expect("write notes.txt");
            std::fs::write(dir.join("Sub Folder/Ясный Сокол.miz"), b"miz")
                .expect("write unicode miz");
            std::fs::write(dir.join("Sub Folder/Tacview-20260906.zip.acmi"), b"acmi")
                .expect("write acmi");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn accepts_files_inside_the_root() {
        let tree = TempTree::new("accept");
        let root = tree.path();

        for rel in [
            "foo.miz",
            "Sub Folder/Ясный Сокол.miz",
            // The Windows separator must work too: queue entries and
            // `serverSettings.lua` use backslashes.
            "Sub Folder\\Ясный Сокол.miz",
        ] {
            let resolved = resolve_under(root, rel, &[".miz"]).await;
            assert!(resolved.is_ok(), "{rel} should resolve, got {resolved:?}");
        }
    }

    #[tokio::test]
    async fn accepts_compound_acmi_suffix() {
        let tree = TempTree::new("acmi");
        let resolved =
            resolve_under(tree.path(), "Sub Folder/Tacview-20260906.zip.acmi", &[".acmi"]).await;
        assert!(resolved.is_ok(), "compound suffix should resolve: {resolved:?}");
    }

    #[tokio::test]
    async fn rejects_traversal_and_absolute_paths() {
        let tree = TempTree::new("reject");
        let root = tree.path();

        for rel in [
            "..\\..\\Windows\\win.ini",
            "../../etc/passwd",
            "Sub Folder/../../outside.miz",
            "C:\\Windows\\win.ini",
            "/etc/passwd",
            "\\\\server\\share\\x.miz",
            "",
            "   ",
        ] {
            let resolved = resolve_under(root, rel, &[".miz"]).await;
            assert!(
                resolved.is_err(),
                "{rel:?} must be rejected, got {resolved:?}"
            );
        }
    }

    #[tokio::test]
    async fn rejects_directories_and_wrong_extensions() {
        let tree = TempTree::new("kind");
        let root = tree.path();

        assert_eq!(
            resolve_under(root, "Sub Folder", &[".miz"]).await.unwrap_err(),
            DownloadError::NotFound,
            "a directory is not downloadable"
        );
        assert_eq!(
            resolve_under(root, "notes.txt", &[".miz"]).await.unwrap_err(),
            DownloadError::NotFound,
            "extension outside the allow-list is not downloadable"
        );
        assert_eq!(
            resolve_under(root, "missing.miz", &[".miz"]).await.unwrap_err(),
            DownloadError::NotFound,
        );
    }

    #[test]
    fn content_disposition_carries_ascii_and_utf8_names() {
        let header = content_disposition("Ясный Сокол.miz");
        assert!(header.starts_with("attachment; "));
        // Non-ASCII collapses to `_` in the fallback, and the UTF-8 form is
        // percent-encoded.
        assert!(header.contains("filename=\"_____ _____.miz\""), "{header}");
        assert!(header.contains("filename*=UTF-8''"), "{header}");
        assert!(header.contains("%D0%AF"), "{header}");
    }

    #[test]
    fn content_disposition_strips_quotes_and_control_characters() {
        let header = content_disposition("bad\"name\r\n.miz");
        assert!(header.contains("filename=\"bad_name__.miz\""), "{header}");
        assert!(!header.contains('\r'), "{header}");
        assert!(!header.contains('\n'), "{header}");
    }
}
