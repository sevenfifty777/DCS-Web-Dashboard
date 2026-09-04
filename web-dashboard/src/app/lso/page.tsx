"use client";

// LSO greenie board.
//
// Replaces the web page that the DCS-gRPC-lso client used to serve on its own
// port. The rows come from the LSO client's `lso.db`, read by the Rust backend
// (`/api/lso/*`); nothing here costs the DCS server a single gRPC call.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import styles from './page.module.css';
import {
  cell,
  formatPoints,
  gradeClass,
  matchesPilot,
  shortTimestamp,
  technicalStatus,
  wireOrSpot,
  type LsoPass,
  type LsoPassesResponse,
  type LsoStatus,
} from './lsoGrades';

const REFRESH_MS = 10_000;
const PAGE_LIMIT = 500;

type BoardState =
  | { kind: 'loading' }
  | { kind: 'unconfigured' }
  | { kind: 'waiting'; dbPath: string | null }
  | { kind: 'ready'; passes: LsoPass[]; total: number };

export default function LsoPage() {
  const [board, setBoard] = useState<BoardState>({ kind: 'loading' });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pilotQuery, setPilotQuery] = useState('');
  const [selected, setSelected] = useState<LsoPass | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/lso/passes?limit=${PAGE_LIMIT}`);
      if (res.ok) {
        const data: LsoPassesResponse = await res.json();
        setBoard({ kind: 'ready', passes: data.passes, total: data.total });
        setError(null);
        setUpdatedAt(new Date());
        return;
      }
      if (res.status === 404) {
        // Either LSO_DIR is unset or lso.db has not been created yet; ask which.
        const statusRes = await apiFetch('/api/lso/status');
        if (statusRes.ok) {
          const status: LsoStatus = await statusRes.json();
          setBoard(status.configured
            ? { kind: 'waiting', dbPath: status.db_path }
            : { kind: 'unconfigured' });
          setError(null);
          setUpdatedAt(new Date());
          return;
        }
      }
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // keep the status-code message
      }
      throw new Error(message);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Refresh failed'));
      setBoard((current) => (current.kind === 'loading' ? { kind: 'unconfigured' } : current));
    }
  }, []);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  const statusText = (() => {
    if (error) return `Refresh error: ${error}`;
    if (!updatedAt) return 'Loading…';
    const count = board.kind === 'ready' ? board.total : 0;
    return `Updated: ${updatedAt.toLocaleTimeString()} — ${count} pass(es)`;
  })();

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>✈️ LSO Greenie Board</h1>
          <p>
            Carrier recoveries graded by DCS-gRPC-lso. The grade is a project-derived training score
            at three gates, never an official USN/USMC certification.
          </p>
        </div>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            placeholder="Filter by pilot"
            value={pilotQuery}
            onChange={(e) => setPilotQuery(e.target.value)}
            aria-label="Filter by pilot"
          />
          <span className={`${styles.status} ${error ? styles.statusError : ''}`}>{statusText}</span>
        </div>
      </div>

      <div className={styles.panel}>
        {board.kind === 'loading' && <div className={styles.empty}>Loading…</div>}
        {board.kind === 'unconfigured' && (
          <div className={styles.empty}>
            The LSO board is not configured. Set <code>LSO_DIR</code> to the LSO client&apos;s output
            directory and restart the dashboard.
          </div>
        )}
        {board.kind === 'waiting' && (
          <div className={styles.empty}>
            Waiting for the first trap. The LSO client has not created{' '}
            <code>{board.dbPath ?? 'lso.db'}</code> yet.
          </div>
        )}
        {board.kind === 'ready' && (
          <PassTable
            passes={board.passes}
            total={board.total}
            pilotQuery={pilotQuery}
            onSelect={setSelected}
          />
        )}
      </div>

      {selected && <TrapSheetModal pass={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function PassTable({
  passes,
  total,
  pilotQuery,
  onSelect,
}: {
  passes: LsoPass[];
  total: number;
  pilotQuery: string;
  onSelect: (pass: LsoPass) => void;
}) {
  const visible = passes.filter((p) => matchesPilot(p, pilotQuery));

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th title="Recording time on the LSO server's local clock">Timestamp (server local)</th>
            <th title="Recovery time in UTC">Grade Date (UTC)</th>
            <th>Mission Time</th>
            <th>Pilot</th>
            <th>Aircraft</th>
            <th>Map</th>
            <th>Grade</th>
            <th>Pts</th>
            <th>Wire/Spot</th>
            <th>Outcome</th>
            <th>Technical status</th>
            <th>DCS Grade</th>
            <th>LSO Notes</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={14} className={styles.empty}>
                {passes.length === 0 ? 'No passes recorded yet.' : 'No passes match this pilot filter.'}
              </td>
            </tr>
          ) : (
            visible.map((p) => {
              // Same countdown as the original board: newest row carries the
              // highest number. `total` covers rows beyond the page limit.
              const index = total - passes.indexOf(p);
              const gc = gradeClass(p.pass_grade);
              return (
                <tr
                  key={p.id}
                  className={styles.row}
                  tabIndex={0}
                  onClick={() => onSelect(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p);
                    }
                  }}
                  title="Open trap sheet"
                >
                  <td className={styles.index}>{index}</td>
                  <td className={styles.stamp} title={p.timestamp}>{shortTimestamp(p.timestamp)}</td>
                  <td className={styles.gdate}>{cell(p.grade_date)}</td>
                  <td className={styles.gdate}>{cell(p.mission_datetime)}</td>
                  <td>{cell(p.pilot_name)}</td>
                  <td>{cell(p.aircraft_type)}</td>
                  <td>{cell(p.map_name)}</td>
                  <td className={`${styles.grade} ${gc ? styles[gc] : ''}`}>{cell(p.pass_grade)}</td>
                  <td className={styles.pts}>{formatPoints(p)}</td>
                  <td>{wireOrSpot(p)}</td>
                  <td>{cell(p.outcome)}</td>
                  <td>{technicalStatus(p)}</td>
                  <td className={styles.wrap}>
                    <div className={styles.gradeText}>{cell(p.dcs_grading)}</div>
                  </td>
                  <td className={`${styles.notes} ${styles.wrap}`}>
                    <div className={styles.notesText}>{cell(p.lso_notes)}</div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

type ChartState =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  /** The server answered 404: the pass exists but its PNG is not on disk. */
  | { kind: 'missing' }
  /** Anything else: server down, proxy 502, network error. Worth a retry. */
  | { kind: 'error'; message: string };

/** Fetch a PNG through `apiFetch` (an `<img src>` cannot carry the JWT header). */
function useChart(passId: number, kind: 'chart' | 'pattern'): [ChartState, () => void] {
  const [attempt, setAttempt] = useState(0);
  const key = `${passId}/${kind}#${attempt}`;
  const path = `/api/lso/passes/${passId}/${kind}`;
  // The result is tagged with the request it belongs to, so switching pass
  // reads as "loading" without resetting state inside the effect.
  const [loaded, setLoaded] = useState<{ key: string; state: ChartState } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const res = await apiFetch(path);
        if (res.status === 404) {
          if (!cancelled) setLoaded({ key, state: { kind: 'missing' } });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ key, state: { kind: 'ready', url: objectUrl } });
      } catch (e: unknown) {
        if (!cancelled) {
          setLoaded({ key, state: { kind: 'error', message: errorMessage(e, 'network error') } });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, path]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [loaded?.key === key ? loaded.state : { kind: 'loading' }, retry];
}

function ChartPanel({
  title,
  state,
  alt,
  onRetry,
}: {
  title: string;
  state: ChartState;
  alt: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.chart}>
      <h3>{title}</h3>
      {state.kind === 'loading' && <div className={styles.chartMissing}>Loading…</div>}
      {state.kind === 'missing' && (
        <div className={styles.chartMissing}>No PNG on disk for this pass.</div>
      )}
      {state.kind === 'error' && (
        <div className={styles.chartMissing}>
          Could not load the chart ({state.message}). The dashboard may be restarting.{' '}
          <button type="button" className={styles.close} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {/* Blob URL of unknown dimensions from an authenticated fetch; next/image adds nothing here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {state.kind === 'ready' && <img src={state.url} alt={alt} />}
    </div>
  );
}

function TrapSheetModal({ pass, onClose }: { pass: LsoPass; onClose: () => void }) {
  const [approach, retryApproach] = useChart(pass.id, 'chart');
  const [pattern, retryPattern] = useChart(pass.id, 'pattern');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gc = gradeClass(pass.pass_grade);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={`Trap sheet for ${pass.pilot_name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>
              {pass.pilot_name}{' '}
              <span className={`${styles.grade} ${gc ? styles[gc] : ''}`}>{pass.pass_grade}</span>
            </h2>
            <p className={styles.modalMeta}>
              <span>{cell(pass.aircraft_type)}</span>
              <span>{cell(pass.carrier_name ?? pass.carrier_type)}</span>
              <span>{cell(pass.grade_date)} UTC</span>
              <span>Wire/Spot {wireOrSpot(pass)}</span>
              <span>Pts {formatPoints(pass)}</span>
              <span>{cell(pass.outcome)}</span>
              {pass.lso_notes && <span>{pass.lso_notes}</span>}
            </p>
            <p className={styles.modalStem}>{pass.timestamp}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={styles.charts}>
          <ChartPanel
            title="Final approach"
            state={approach}
            alt={`Trap sheet ${pass.timestamp}`}
            onRetry={retryApproach}
          />
          <ChartPanel
            title="Overhead pattern"
            state={pattern}
            alt={`Pattern chart ${pass.timestamp}`}
            onRetry={retryPattern}
          />
        </div>
      </div>
    </div>
  );
}
