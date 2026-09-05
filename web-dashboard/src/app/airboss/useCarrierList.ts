"use client";

// Detected carrier list: one `GET /api/airboss/carriers` on load (one mission
// Eval), a manual Refresh, and an automatic refresh when the free radar stream
// shows a carrier-looking ship the list does not know, rate-limited.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  CARRIER_REFRESH_MIN_INTERVAL_MS,
  unknownCarrierGroupsInRadar,
  type DetectedCarrier,
} from './carrierDetection';
import type { RadarUnit } from './deckTracking';

export interface CarrierListState {
  carriers: DetectedCarrier[];
  loading: boolean;
  error: string | null;
  /** Wall-clock time of the last successful list, or null. */
  refreshedAt: number | null;
  refresh: () => Promise<void>;
}

export function useCarrierList(radarUnits: Record<string, RadarUnit>): CarrierListState {
  const [carriers, setCarriers] = useState<DetectedCarrier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const lastAttemptAt = useRef(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastAttemptAt.current = Date.now();
    setLoading(true);
    try {
      const res = await apiFetch('/api/airboss/carriers');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      const list = Array.isArray(data.carriers) ? data.carriers as DetectedCarrier[] : [];
      setCarriers(list);
      setError(null);
      setRefreshedAt(Date.now());
    } catch (err) {
      setError(String(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  // Initial scan, deferred to a timer callback so the state updates happen
  // outside the effect body (the fetch itself is asynchronous anyway).
  useEffect(() => {
    const handle = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(handle);
  }, [refresh]);

  const knownGroups = useMemo(() => new Set(carriers.map((carrier) => carrier.group)), [carriers]);
  // Hinted groups that a refresh did not return (hulls the controller excludes
  // or classifies as non-carriers): remembered so they do not re-trigger a
  // refresh every 30 s for the rest of the session.
  const rejectedGroups = useRef<Set<string>>(new Set());

  // A ship whose type hints at a carrier but whose group is not in the list
  // means something spawned since the last fetch: refresh once per 30 s at most.
  useEffect(() => {
    const unknown = unknownCarrierGroupsInRadar(radarUnits, knownGroups)
      .filter((group) => !rejectedGroups.current.has(group));
    if (unknown.length === 0) return;
    if (Date.now() - lastAttemptAt.current < CARRIER_REFRESH_MIN_INTERVAL_MS) return;
    void refresh().then(() => {
      for (const group of unknown) rejectedGroups.current.add(group);
    });
  }, [radarUnits, knownGroups, refresh]);

  // A group that later shows up in the list is no longer rejected.
  useEffect(() => {
    for (const group of knownGroups) rejectedGroups.current.delete(group);
  }, [knownGroups]);

  return { carriers, loading, error, refreshedAt, refresh };
}
