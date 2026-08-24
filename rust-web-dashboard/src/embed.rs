//! Single-binary static asset serving for the embedded SPA.
//!
//! The compiled Next.js export is embedded at build time via [`rust_embed`].
//! Unknown paths fall back to `index.html` so client-side routing works. In
//! Phase 6 the `static/` folder is regenerated from the Next.js `out/` export;
//! for now it carries a placeholder page.

use axum::{
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::{EmbeddedFile, RustEmbed};

#[derive(RustEmbed)]
#[folder = "static/"]
#[exclude = "*.mp4"]
#[exclude = "img/background.png"]
#[exclude = "icon/*"]
struct Assets;

/// Serve an embedded asset, falling back to `index.html` for SPA routes.
////
/// Next.js static export emits one HTML file per route (`weather.html`,
/// `settings.html`, ...) plus hashed assets under `_next/`. To make deep links
/// and hard refreshes work we try, in order: the exact path, `<path>.html`, and
/// `<path>/index.html`, before falling back to `index.html` for client-side
/// routing.
pub async fn static_handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    if let Some(file) = Assets::get(path) {
        return serve(file);
    }

    let trimmed = path.trim_end_matches('/');
    for candidate in [format!("{trimmed}.html"), format!("{trimmed}/index.html")] {
        if let Some(file) = Assets::get(&candidate) {
            return serve(file);
        }
    }

    match Assets::get("index.html") {
        Some(index) => serve(index),
        None => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

fn serve(file: EmbeddedFile) -> Response {
    let mime = file.metadata.mimetype().to_string();
    ([(header::CONTENT_TYPE, mime)], file.data).into_response()
}

#[cfg(test)]
mod tests {
    use super::Assets;

    #[test]
    fn aircraft_icons_are_not_embedded_in_the_executable() {
        assert!(Assets::get("index.html").is_some());
        assert!(Assets::iter().all(|path| !path.starts_with("icon/")));
    }
}
