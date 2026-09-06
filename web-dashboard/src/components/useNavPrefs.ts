"use client";

// React binding for the navigation preferences.
//
// The dashboard is a static export, so the first render happens without
// `localStorage`. Like AuthGate, we use `useSyncExternalStore` with a server
// snapshot equal to the defaults, so the prerendered markup and the first
// client render agree and there is no hydration mismatch. Once mounted the
// store re-reads storage, and a `storage` event from another tab re-reads it
// again so every open tab shows the same panel.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { NAV_PAGES } from './navPages';
import {
  NAV_PREFS_KEY,
  clearNavPrefs,
  defaultNavPrefs,
  loadNavPrefs,
  resolveNav,
  saveNavPrefs,
  type NavPrefs,
  type ResolvedNav,
} from './navPrefs';

const listeners = new Set<() => void>();
// Cached snapshot: useSyncExternalStore requires referential stability between
// calls when nothing changed, and `loadNavPrefs` builds a fresh object each time.
let cachedRaw: string | null | undefined;
let cachedPrefs: NavPrefs = defaultNavPrefs();
const DEFAULTS = defaultNavPrefs();

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(): NavPrefs {
  const store = storage();
  let raw: string | null = null;
  try {
    raw = store ? store.getItem(NAV_PREFS_KEY) : null;
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = loadNavPrefs(store);
  }
  return cachedPrefs;
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NAV_PREFS_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export interface NavPrefsStore {
  prefs: NavPrefs;
  nav: ResolvedNav;
  /** Persist new preferences and notify every subscriber in this tab. */
  update: (next: NavPrefs | ((current: NavPrefs) => NavPrefs)) => void;
  /** Drop the stored preferences and go back to the registry defaults. */
  reset: () => void;
}

export function useNavPrefs(): NavPrefsStore {
  const prefs = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
  const nav = useMemo(() => resolveNav(prefs, NAV_PAGES), [prefs]);

  const update = useCallback((next: NavPrefs | ((current: NavPrefs) => NavPrefs)) => {
    const current = snapshot();
    const resolved = typeof next === 'function' ? next(current) : next;
    if (resolved === current) return;
    saveNavPrefs(storage(), resolved);
    emit();
  }, []);

  const reset = useCallback(() => {
    clearNavPrefs(storage());
    emit();
  }, []);

  return { prefs, nav, update, reset };
}
