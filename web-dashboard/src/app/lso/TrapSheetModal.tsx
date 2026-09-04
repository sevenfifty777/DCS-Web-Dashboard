"use client";

// Trap-sheet viewer shared by the greenie board and the per-pilot page.
// Both PNGs come through `apiFetch` because an `<img src>` cannot carry the
// JWT header; the blobs are turned into object URLs and revoked on close.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import styles from './page.module.css';
import { cell, formatPoints, gradeClass, wireOrSpot, type LsoPass } from './lsoGrades';

type ChartState =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  /** The server answered 404: the pass exists but its PNG is not on disk. */
  | { kind: 'missing' }
  /** Anything else: server down, proxy 502, network error. Worth a retry. */
  | { kind: 'error'; message: string };

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

export function TrapSheetModal({ pass, onClose }: { pass: LsoPass; onClose: () => void }) {
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
