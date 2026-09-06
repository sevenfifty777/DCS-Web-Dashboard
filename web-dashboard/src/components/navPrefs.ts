// Left-panel navigation preferences: which pages are shown and in what order.
//
// Pure helpers only — no React, no `window` — so they can be unit-tested with
// node:test and reused if preferences ever move to the backend. Storage is
// passed in as a `Storage`-like object and every failure mode (no storage,
// quota errors, malformed JSON, unknown version) resolves to the defaults.

import type { NavPage } from './navPages';

export const NAV_PREFS_KEY = 'dashboard:nav:v1';

export interface NavPrefs {
  version: 1;
  /** Page ids in display order. Ids unknown to the registry are dropped. */
  order: string[];
  /** Page ids the user hid. Pinned pages are ignored here. */
  hidden: string[];
}

export interface ResolvedNav {
  visible: NavPage[];
  hidden: NavPage[];
}

export function defaultNavPrefs(): NavPrefs {
  return { version: 1, order: [], hidden: [] };
}

/** Parse a stored JSON string, returning `null` for anything unusable. */
export function parseNavPrefs(raw: string | null): NavPrefs | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const ids = (list: unknown): string[] => Array.isArray(list)
    ? Array.from(new Set(list.filter((item): item is string => typeof item === 'string')))
    : [];
  return { version: 1, order: ids(record.order), hidden: ids(record.hidden) };
}

export function loadNavPrefs(storage: Pick<Storage, 'getItem'> | null): NavPrefs {
  if (!storage) return defaultNavPrefs();
  try {
    return parseNavPrefs(storage.getItem(NAV_PREFS_KEY)) ?? defaultNavPrefs();
  } catch {
    return defaultNavPrefs();
  }
}

export function saveNavPrefs(storage: Pick<Storage, 'setItem'> | null, prefs: NavPrefs): void {
  if (!storage) return;
  try {
    storage.setItem(NAV_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode, quota); the sidebar still works.
  }
}

export function clearNavPrefs(storage: Pick<Storage, 'removeItem'> | null): void {
  if (!storage) return;
  try {
    storage.removeItem(NAV_PREFS_KEY);
  } catch {
    // Same tolerance as saveNavPrefs.
  }
}

/**
 * Merge stored preferences with the page registry:
 * 1. keep `prefs.order` ids that exist in the registry, in that order;
 * 2. append every registry page not yet placed, in registry order;
 * 3. hide the ids listed in `prefs.hidden`, except pinned pages.
 */
export function resolveNav(prefs: NavPrefs, pages: readonly NavPage[]): ResolvedNav {
  const byId = new Map(pages.map(page => [page.id, page]));
  const placed = new Set<string>();
  const ordered: NavPage[] = [];
  for (const id of prefs.order) {
    const page = byId.get(id);
    if (page && !placed.has(id)) {
      ordered.push(page);
      placed.add(id);
    }
  }
  for (const page of pages) {
    if (!placed.has(page.id)) {
      ordered.push(page);
      placed.add(page.id);
    }
  }
  const hiddenIds = new Set(prefs.hidden.filter(id => byId.has(id) && !byId.get(id)!.pinned));
  return {
    visible: ordered.filter(page => !hiddenIds.has(page.id)),
    hidden: ordered.filter(page => hiddenIds.has(page.id)),
  };
}

/** The full display order (visible and hidden interleaved) as ids. */
function fullOrder(prefs: NavPrefs, pages: readonly NavPage[]): string[] {
  const byId = new Map(pages.map(page => [page.id, page]));
  const placed = new Set<string>();
  const merged: string[] = [];
  for (const id of prefs.order) {
    if (byId.has(id) && !placed.has(id)) { merged.push(id); placed.add(id); }
  }
  for (const page of pages) {
    if (!placed.has(page.id)) { merged.push(page.id); placed.add(page.id); }
  }
  return merged;
}

/**
 * Move `id` one step up or down **among the visible pages**. Hidden pages in
 * between are stepped over so the move matches what the user sees, and the
 * hidden page keeps its slot relative to the moved page.
 */
function moveVisible(prefs: NavPrefs, id: string, direction: -1 | 1, pages: readonly NavPage[]): NavPrefs {
  const order = fullOrder(prefs, pages);
  const { visible } = resolveNav(prefs, pages);
  const visibleIndex = visible.findIndex(page => page.id === id);
  if (visibleIndex < 0) return prefs;
  const targetVisible = visibleIndex + direction;
  if (targetVisible < 0 || targetVisible >= visible.length) return prefs;
  const targetId = visible[targetVisible].id;
  const from = order.indexOf(id);
  const to = order.indexOf(targetId);
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return { ...prefs, order: next };
}

export function moveUp(prefs: NavPrefs, id: string, pages: readonly NavPage[]): NavPrefs {
  return moveVisible(prefs, id, -1, pages);
}

export function moveDown(prefs: NavPrefs, id: string, pages: readonly NavPage[]): NavPrefs {
  return moveVisible(prefs, id, 1, pages);
}

/**
 * Reorder the visible list so that the page at visible index `from` lands at
 * visible index `to` (drag and drop). Hidden pages keep their relative slots.
 */
export function moveVisibleIndex(prefs: NavPrefs, from: number, to: number, pages: readonly NavPage[]): NavPrefs {
  const { visible } = resolveNav(prefs, pages);
  if (from === to || from < 0 || to < 0 || from >= visible.length || to >= visible.length) return prefs;
  const order = fullOrder(prefs, pages);
  const id = visible[from].id;
  const targetId = visible[to].id;
  const next = order.filter(item => item !== id);
  const targetIndex = next.indexOf(targetId);
  // Dropping below the target means "after it"; above means "before it".
  next.splice(from < to ? targetIndex + 1 : targetIndex, 0, id);
  return { ...prefs, order: next };
}

export function hidePage(prefs: NavPrefs, id: string, pages: readonly NavPage[]): NavPrefs {
  const page = pages.find(item => item.id === id);
  if (!page || page.pinned || prefs.hidden.includes(id)) return prefs;
  return { ...prefs, order: fullOrder(prefs, pages), hidden: [...prefs.hidden, id] };
}

export function showPage(prefs: NavPrefs, id: string): NavPrefs {
  if (!prefs.hidden.includes(id)) return prefs;
  return { ...prefs, hidden: prefs.hidden.filter(item => item !== id) };
}

/** True when the prefs differ from the defaults in any way the user can see. */
export function isCustomised(prefs: NavPrefs, pages: readonly NavPage[]): boolean {
  const { visible, hidden } = resolveNav(prefs, pages);
  if (hidden.length > 0) return true;
  return visible.some((page, index) => page.id !== pages[index].id);
}

/**
 * Insertion slot for a dragged item: the index of the first item whose vertical
 * midpoint is below the pointer, or `rects.length` when the pointer is past
 * every midpoint. Pure so it can be tested with synthetic rectangles.
 */
export function insertionSlotFor(pointerY: number, rects: readonly { top: number; bottom: number }[]): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (pointerY < (rect.top + rect.bottom) / 2) return index;
  }
  return rects.length;
}

/**
 * Convert an insertion slot (0..n, measured on the list that still contains
 * the dragged item at `from`) into the visible index the item ends up at.
 */
export function slotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}
