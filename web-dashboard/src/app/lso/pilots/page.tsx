"use client";

// Per-pilot greenie board: one section per pilot with their recent passes.
// Grouping and stats come from `/api/lso/pilots`, so the page never downloads
// the whole history just to show five passes each.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import board from '../page.module.css';
import styles from './page.module.css';
import {
  formatPoints,
  gradeClass,
  matchesPilot,
  type LsoPass,
  type LsoPilot,
  type LsoPilotsResponse,
} from '../lsoGrades';
import { PILOTS_TABLE } from '../lsoColumns';
import { LsoLegend } from '../LsoLegend';
import { ColumnsMenu, LsoTable } from '../LsoTable';
import { TrapSheetModal } from '../TrapSheetModal';

const REFRESH_MS = 15_000;
const DEFAULT_LIMIT = 5;

export default function LsoPilotsPage() {
  const [showAll, setShowAll] = useState(false);
  const [data, setData] = useState<LsoPilotsResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [pilotQuery, setPilotQuery] = useState('');
  const [selected, setSelected] = useState<LsoPass | null>(null);

  const refresh = useCallback(async () => {
    try {
      const url = showAll ? '/api/lso/pilots?all=true' : `/api/lso/pilots?limit=${DEFAULT_LIMIT}`;
      const res = await apiFetch(url);
      if (res.ok) {
        setData(await res.json());
        setNotice(null);
        setError(null);
        setUpdatedAt(new Date());
        return;
      }
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // keep the status-code message
      }
      if (res.status === 404) {
        // LSO_DIR unset or lso.db not created yet: an empty board, not a failure.
        setData(null);
        setNotice(message);
        setError(null);
        setUpdatedAt(new Date());
        return;
      }
      throw new Error(message);
    } catch (e: unknown) {
      setError(errorMessage(e, 'Refresh failed'));
    }
  }, [showAll]);

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
    const pilots = data?.pilots.length ?? 0;
    const passes = data?.total_passes ?? 0;
    return `Updated: ${updatedAt.toLocaleTimeString()} — ${pilots} pilot(s), ${passes} pass(es)`;
  })();

  const visiblePilots = (data?.pilots ?? []).filter((p) => matchesPilot(p, pilotQuery));

  return (
    <div className={board.page}>
      <div className={board.header}>
        <div>
          <h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={board.logo} src="/icon/lso-logo.png" alt="" />
            LSO Pilots
          </h1>
          <p>
            Recoveries grouped by pilot, newest pilot first. Stats cover the whole history;
            the tables show the last {DEFAULT_LIMIT} passes unless you switch to all.
          </p>
          <LsoLegend />
        </div>
        <div className={board.toolbar}>
          <Link href="/lso" className={board.navLink}>
            All passes
          </Link>
          <ColumnsMenu spec={PILOTS_TABLE} />
          <div className={styles.toggle} role="group" aria-label="Passes per pilot">
            <button
              type="button"
              className={`${styles.toggleBtn} ${!showAll ? styles.toggleActive : ''}`}
              onClick={() => setShowAll(false)}
            >
              Last {DEFAULT_LIMIT}
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${showAll ? styles.toggleActive : ''}`}
              onClick={() => setShowAll(true)}
            >
              All
            </button>
          </div>
          <input
            type="search"
            className={board.search}
            placeholder="Filter by pilot"
            value={pilotQuery}
            onChange={(e) => setPilotQuery(e.target.value)}
            aria-label="Filter by pilot"
          />
          <span className={`${board.status} ${error ? board.statusError : ''}`}>{statusText}</span>
        </div>
      </div>

      {notice && <div className={`${board.panel} ${board.empty}`}>{notice}</div>}
      {!notice && data && visiblePilots.length === 0 && (
        <div className={`${board.panel} ${board.empty}`}>
          {data.pilots.length === 0 ? 'No passes recorded yet.' : 'No pilots match this filter.'}
        </div>
      )}
      {!notice && !data && !error && <div className={`${board.panel} ${board.empty}`}>Loading…</div>}

      <div className={styles.pilots}>
        {visiblePilots.map((pilot, i) => (
          <PilotSection key={`${i}-${pilot.pilot_name}`} pilot={pilot} onSelect={setSelected} />
        ))}
      </div>

      {selected && <TrapSheetModal pass={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function PilotSection({ pilot, onSelect }: { pilot: LsoPilot; onSelect: (pass: LsoPass) => void }) {
  const shown = pilot.passes.length;
  const total = pilot.total_passes;
  const indexOf = useCallback((position: number) => total - position, [total]);
  return (
    <section className={`${board.panel} ${styles.pilot}`}>
      <header className={styles.pilotHeader}>
        <div>
          <h2 className={styles.pilotName}>{pilot.pilot_name}</h2>
          {pilot.aliases.length > 0 && (
            <div className={styles.aliases} title="Earlier names seen for this pilot">
              also flew as {pilot.aliases.join(', ')}
            </div>
          )}
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>Passes</dt>
            <dd>{pilot.total_passes}</dd>
          </div>
          <div>
            <dt>Avg pts</dt>
            <dd>{pilot.avg_points != null ? pilot.avg_points.toFixed(2) : '-'}</dd>
          </div>
          <div>
            <dt>Graded</dt>
            <dd>{pilot.graded_passes}</dd>
          </div>
          <div>
            <dt>Last pass</dt>
            <dd>{pilot.last_pass_at || '-'} UTC</dd>
          </div>
        </dl>
        {/* Classic greenie strip: oldest on the left, newest on the right. */}
        <div className={styles.greenie} aria-label={`Recent grades for ${pilot.pilot_name}`}>
          {[...pilot.passes].reverse().map((pass) => {
            const gc = gradeClass(pass.pass_grade);
            return (
              <button
                type="button"
                key={pass.id}
                className={`${styles.square} ${gc ? board[gc] : styles.squareUnknown}`}
                title={`${pass.grade_date} UTC: ${pass.pass_grade} (${formatPoints(pass)} pts)`}
                onClick={() => onSelect(pass)}
              >
                <span className={styles.squareLabel}>{pass.pass_grade}</span>
              </button>
            );
          })}
        </div>
      </header>

      <LsoTable
        spec={PILOTS_TABLE}
        passes={pilot.passes}
        indexOf={indexOf}
        onSelect={onSelect}
        emptyMessage="No passes recorded yet."
        wrapClassName={`${board.tableWrap} ${styles.pilotTable}`}
      />
      {shown < pilot.total_passes && (
        <div className={styles.more}>
          Showing the last {shown} of {pilot.total_passes} passes. Switch to All to see every pass.
        </div>
      )}
    </section>
  );
}
