// Authenticated file downloads.
//
// The session JWT lives in localStorage and is attached as a header by
// `apiFetch`, so a plain `<a href="/api/...">` would reach the server without
// it and be rejected. Instead the bytes are fetched, turned into an object URL
// and handed to a synthetic `<a download>` — the same lifecycle the LSO
// trap-sheet viewer uses for its PNGs, with the object URL always revoked.

import { apiFetch } from '@/lib/api';

/**
 * Fetch an authenticated URL and hand the bytes to the browser's save dialog.
 *
 * Throws with the server's `error` message when the request fails, so callers
 * can surface it in the UI.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await apiFetch(url);

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Download failed (HTTP ${res.status})`;
    throw new Error(message);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Safari needs the URL alive until the click has been processed; a task
    // boundary is enough, and the blob is freed either way.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/** Human-readable byte size for a file listing (e.g. `1.4 GB`). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
