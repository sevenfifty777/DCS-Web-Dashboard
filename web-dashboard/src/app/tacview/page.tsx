'use client';

// Tacview recordings browser. Reads `TACVIEW_DIR` on the server through
// `/api/tacview/browse` and downloads a recording through
// `/api/tacview/download`. Downloads go via `downloadFile` because the session
// token is a header, not a cookie, so a plain `<a href>` would be rejected.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { downloadFile, formatBytes } from '@/lib/download';
import { errorMessage } from '@/lib/errors';

interface TacviewFile {
  path: string;
  name: string;
  size: number;
  modified_ms: number | null;
}

interface BrowseResponse {
  success: boolean;
  configured: boolean;
  error?: string;
  files: TacviewFile[];
  total?: number;
  limit?: number;
}

const panelStyle: React.CSSProperties = {
  backgroundColor: '#0b1118',
  border: '1px solid var(--panel-border)',
  borderRadius: '4px',
  padding: '2rem',
  display: 'flex',
  flexDirection: 'column',
};

function formatDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export default function TacviewPage() {
  const [state, setState] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [search, setSearch] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');

  // Every state update happens in the promise continuation, never synchronously
  // in the effect body, so this is safe to call from both the mount effect and
  // the Refresh button.
  const fetchFiles = useCallback(() => {
    apiFetch('/api/tacview/browse')
      .then(async (res) => {
        const body: BrowseResponse = await res.json();
        if (!res.ok && !body?.error) throw new Error(`HTTP ${res.status}`);
        setState(body);
        // A configured-but-unreadable directory reports its OS error here
        // rather than silently showing an empty list.
        setFetchError(body.configured && !body.success && body.error ? body.error : '');
      })
      .catch((err: unknown) => setFetchError(errorMessage(err, 'Failed to load recordings')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDownload = async (file: TacviewFile) => {
    setDownloading(file.path);
    setDownloadError('');
    try {
      await downloadFile(
        `/api/tacview/download?path=${encodeURIComponent(file.path)}`,
        file.name,
      );
    } catch (err: unknown) {
      setDownloadError(`${file.name}: ${errorMessage(err)}`);
    } finally {
      setDownloading(null);
    }
  };

  const files = state?.files ?? [];
  const query = search.trim().toLowerCase();
  const visible = query
    ? files.filter((f) => f.path.toLowerCase().includes(query))
    : files;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1>Tacview</h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        Download flight recordings from the server&apos;s Tacview folder.
      </p>

      <div style={{ ...panelStyle, marginTop: '1.5rem', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', borderBottom: '1px solid var(--panel-border)', paddingBottom: '0.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ margin: 0, color: 'var(--primary)' }}>Tacview Recordings</h3>
          <button
            onClick={fetchFiles}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'transparent',
              border: '1px solid var(--primary)',
              color: 'var(--primary)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              fontSize: '11px',
            }}
          >
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem' }}>
            Loading recordings...
          </div>
        ) : state && !state.configured ? (
          <div style={{ color: 'var(--text-secondary)', padding: '1rem', lineHeight: 1.6 }}>
            <strong style={{ color: '#ffaa00' }}>Tacview folder not configured.</strong>
            <div style={{ marginTop: '0.5rem' }}>
              Set <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)' }}>TACVIEW_DIR</code> in the
              service environment (NSSM &rarr; Environment tab) to the recordings folder, for example{' '}
              <code style={{ fontFamily: 'var(--font-mono)', color: '#ccc' }}>C:\Users\admin\Documents\Tacview</code>,
              then restart the dashboard service.
            </div>
          </div>
        ) : (
          <>
            {fetchError && (
              <div style={{ color: '#ff4444', marginBottom: '1rem', fontSize: '13px', wordBreak: 'break-word' }}>
                {fetchError}
              </div>
            )}
            {downloadError && (
              <div style={{ color: '#ff4444', marginBottom: '1rem', fontSize: '12px', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                {downloadError}
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <input
                type="text"
                placeholder="Search recordings..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                  border: '1px solid var(--panel-border)',
                  color: '#fff',
                  borderRadius: '4px',
                  fontFamily: 'var(--font-mono)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {state?.total !== undefined && state.limit !== undefined && state.total > state.limit && (
              <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '1rem' }}>
                Showing the {state.limit} newest of {state.total} recordings.
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {visible.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                  {files.length > 0 ? 'No recordings match your search.' : 'No Tacview recordings found.'}
                </div>
              ) : (
                visible.map((file) => (
                  <div
                    key={file.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      padding: '1rem',
                      backgroundColor: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid var(--panel-border)',
                      borderRadius: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>🎬</span>
                        <strong style={{ color: '#ccc', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                          {file.name}
                        </strong>
                      </div>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                        {formatBytes(file.size)} · {formatDate(file.modified_ms)}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDownload(file)}
                      disabled={downloading !== null}
                      style={{
                        padding: '0.5rem 1rem',
                        backgroundColor: 'transparent',
                        border: '1px solid var(--primary)',
                        color: 'var(--primary)',
                        borderRadius: '4px',
                        cursor: downloading !== null ? 'not-allowed' : 'pointer',
                        fontWeight: 'bold',
                        textTransform: 'uppercase',
                        fontSize: '11px',
                        whiteSpace: 'nowrap',
                        opacity: downloading !== null ? 0.4 : 1,
                      }}
                    >
                      {downloading === file.path ? 'Downloading...' : '⬇ Download'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
