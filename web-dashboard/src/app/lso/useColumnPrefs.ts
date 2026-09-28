"use client";

// React binding for the LSO table column preferences.
//
// Same approach as `components/useNavPrefs.ts`: `useSyncExternalStore` with a
// server snapshot equal to the table defaults (the dashboard is a static
// export), a per-key cached snapshot for referential stability, and a
// `storage` listener so other tabs follow. Every table instance using the same
// spec shares one setting, which is what the per-pilot page relies on.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  clearColumnPrefs,
  defaultColumnPrefs,
  loadColumnPrefs,
  resolveColumns,
  saveColumnPrefs,
  type ColumnPrefs,
  type ResolvedColumns,
  type TableSpec,
} from './columnPrefs';

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; prefs: ColumnPrefs }>();
const defaults = new Map<string, ColumnPrefs>();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function defaultsFor(spec: TableSpec): ColumnPrefs {
  let value = defaults.get(spec.storageKey);
  if (!value) {
    value = defaultColumnPrefs(spec);
    defaults.set(spec.storageKey, value);
  }
  return value;
}

function snapshot(spec: TableSpec): ColumnPrefs {
  const store = storage();
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(spec.storageKey) : null;
  } catch {
    raw = null;
  }
  const cached = cache.get(spec.storageKey);
  if (cached && cached.raw === raw) return cached.prefs;
  const prefs = raw === null ? defaultsFor(spec) : loadColumnPrefs(store, spec);
  cache.set(spec.storageKey, { raw, prefs });
  return prefs;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith('dashboard:lso-columns:')) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface ColumnPrefsStore {
  prefs: ColumnPrefs;
  columns: ResolvedColumns;
  /** Persist new preferences and notify every table using the same spec. */
  update: (next: ColumnPrefs | ((current: ColumnPrefs) => ColumnPrefs)) => void;
  /** Drop the stored preferences and go back to the table defaults. */
  reset: () => void;
}

export function useColumnPrefs(spec: TableSpec): ColumnPrefsStore {
  const getSnapshot = useCallback(() => snapshot(spec), [spec]);
  const getServerSnapshot = useCallback(() => defaultsFor(spec), [spec]);
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const columns = useMemo(() => resolveColumns(prefs, spec), [prefs, spec]);

  const update = useCallback((next: ColumnPrefs | ((current: ColumnPrefs) => ColumnPrefs)) => {
    const current = snapshot(spec);
    const resolved = typeof next === 'function' ? next(current) : next;
    if (resolved === current) return;
    saveColumnPrefs(storage(), spec, resolved);
    emit();
  }, [spec]);

  const reset = useCallback(() => {
    clearColumnPrefs(storage(), spec);
    emit();
  }, [spec]);

  return { prefs, columns, update, reset };
}
