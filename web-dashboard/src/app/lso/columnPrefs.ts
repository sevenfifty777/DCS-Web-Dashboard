// LSO table column preferences: display order, hidden columns and sort.
//
// Pure helpers only — no React, no `window` — like `components/navPrefs.ts`,
// so they can be unit-tested with node:test. Each table (the board, the
// per-pilot tables) has its own storage key and defaults; every failure mode
// (no storage, quota errors, malformed JSON, unknown version) resolves to the
// table's defaults.

export type SortDir = 'asc' | 'desc';

export interface SortSpec {
  id: string;
  dir: SortDir;
}

export interface ColumnPrefs {
  version: 1;
  /** Column ids in display order. Ids unknown to the table are dropped. */
  order: string[];
  /** Column ids the user hid. */
  hidden: string[];
  /** Active sort, or null for the server order (newest pass first). */
  sort: SortSpec | null;
}

/** What a table declares: its columns in default order and which start hidden. */
export interface TableSpec {
  storageKey: string;
  columns: readonly string[];
  defaultHidden: readonly string[];
}

export interface ResolvedColumns {
  visible: string[];
  hidden: string[];
}

export function defaultColumnPrefs(spec: TableSpec): ColumnPrefs {
  return { version: 1, order: [...spec.columns], hidden: [...spec.defaultHidden], sort: null };
}

/** Parse a stored JSON string, returning `null` for anything unusable. */
export function parseColumnPrefs(raw: string | null): ColumnPrefs | null {
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
  let sort: SortSpec | null = null;
  const rawSort = record.sort as Record<string, unknown> | null | undefined;
  if (rawSort && typeof rawSort.id === 'string' && (rawSort.dir === 'asc' || rawSort.dir === 'desc')) {
    sort = { id: rawSort.id, dir: rawSort.dir };
  }
  return { version: 1, order: ids(record.order), hidden: ids(record.hidden), sort };
}

export function loadColumnPrefs(storage: Pick<Storage, 'getItem'> | null, spec: TableSpec): ColumnPrefs {
  if (!storage) return defaultColumnPrefs(spec);
  try {
    return parseColumnPrefs(storage.getItem(spec.storageKey)) ?? defaultColumnPrefs(spec);
  } catch {
    return defaultColumnPrefs(spec);
  }
}

export function saveColumnPrefs(storage: Pick<Storage, 'setItem'> | null, spec: TableSpec, prefs: ColumnPrefs): void {
  if (!storage) return;
  try {
    storage.setItem(spec.storageKey, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode, quota); the table still works.
  }
}

export function clearColumnPrefs(storage: Pick<Storage, 'removeItem'> | null, spec: TableSpec): void {
  if (!storage) return;
  try {
    storage.removeItem(spec.storageKey);
  } catch {
    // Same tolerance as saveColumnPrefs.
  }
}

/**
 * The full display order: stored ids that the table knows, then every column
 * not yet placed (a column added in a later release) in its default order.
 */
export function fullOrder(prefs: ColumnPrefs, spec: TableSpec): string[] {
  const known = new Set(spec.columns);
  const placed = new Set<string>();
  const merged: string[] = [];
  for (const id of prefs.order) {
    if (known.has(id) && !placed.has(id)) { merged.push(id); placed.add(id); }
  }
  for (const id of spec.columns) {
    if (!placed.has(id)) { merged.push(id); placed.add(id); }
  }
  return merged;
}

export function resolveColumns(prefs: ColumnPrefs, spec: TableSpec): ResolvedColumns {
  const order = fullOrder(prefs, spec);
  const hidden = new Set(prefs.hidden);
  const visible = order.filter(id => !hidden.has(id));
  // Never show an empty table: a stored state that hides everything falls back
  // to showing every column.
  if (visible.length === 0) return { visible: order, hidden: [] };
  return { visible, hidden: order.filter(id => hidden.has(id)) };
}

/**
 * Move `id` one step left (-1) or right (+1) **among the visible columns**,
 * stepping over hidden ones so the move matches what the user sees.
 */
export function moveVisible(prefs: ColumnPrefs, id: string, direction: -1 | 1, spec: TableSpec): ColumnPrefs {
  const { visible } = resolveColumns(prefs, spec);
  const from = visible.indexOf(id);
  if (from < 0) return prefs;
  return moveVisibleIndex(prefs, from, from + direction, spec);
}

/**
 * Reorder so that the visible column at index `from` lands at visible index
 * `to` (drag and drop). Hidden columns keep their slots relative to the rest.
 */
export function moveVisibleIndex(prefs: ColumnPrefs, from: number, to: number, spec: TableSpec): ColumnPrefs {
  const { visible } = resolveColumns(prefs, spec);
  if (from === to || from < 0 || to < 0 || from >= visible.length || to >= visible.length) return prefs;
  const id = visible[from];
  const targetId = visible[to];
  const next = fullOrder(prefs, spec).filter(item => item !== id);
  const targetIndex = next.indexOf(targetId);
  // Dropping right of the target means "after it"; left means "before it".
  next.splice(from < to ? targetIndex + 1 : targetIndex, 0, id);
  return { ...prefs, order: next };
}

/** Move `id` one step within the full order (hidden columns included), as the Columns menu lists them. */
export function moveInOrder(prefs: ColumnPrefs, id: string, direction: -1 | 1, spec: TableSpec): ColumnPrefs {
  const order = fullOrder(prefs, spec);
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return prefs;
  const next = order.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return { ...prefs, order: next };
}

/** Hide a column; refused for the last visible one. Hiding the sort column drops the sort. */
export function hideColumn(prefs: ColumnPrefs, id: string, spec: TableSpec): ColumnPrefs {
  const { visible } = resolveColumns(prefs, spec);
  if (!visible.includes(id) || visible.length <= 1) return prefs;
  return {
    ...prefs,
    order: fullOrder(prefs, spec),
    hidden: [...prefs.hidden.filter(item => item !== id), id],
    sort: prefs.sort?.id === id ? null : prefs.sort,
  };
}

export function showColumn(prefs: ColumnPrefs, id: string): ColumnPrefs {
  if (!prefs.hidden.includes(id)) return prefs;
  return { ...prefs, hidden: prefs.hidden.filter(item => item !== id) };
}

export function setSort(prefs: ColumnPrefs, sort: SortSpec | null): ColumnPrefs {
  const same = sort === null ? prefs.sort === null : prefs.sort?.id === sort.id && prefs.sort.dir === sort.dir;
  return same ? prefs : { ...prefs, sort };
}

/** Header click: ascending, then descending, then back to the default order. */
export function cycleSort(prefs: ColumnPrefs, id: string): ColumnPrefs {
  if (prefs.sort?.id !== id) return setSort(prefs, { id, dir: 'asc' });
  if (prefs.sort.dir === 'asc') return setSort(prefs, { id, dir: 'desc' });
  return setSort(prefs, null);
}

/** True when the prefs differ from the table defaults in any way the user can see. */
export function isCustomised(prefs: ColumnPrefs, spec: TableSpec): boolean {
  if (prefs.sort) return true;
  const current = resolveColumns(prefs, spec);
  const defaults = resolveColumns(defaultColumnPrefs(spec), spec);
  return current.visible.join('|') !== defaults.visible.join('|')
    || current.hidden.join('|') !== defaults.hidden.join('|');
}

/** A cell's sort key; null means "no value" and always sorts last. */
export type SortValue = string | number | null;

/**
 * Compare two sort keys in the given direction. Missing values go last in both
 * directions; numbers sort before text; text compares case-insensitively with
 * digits read as numbers ("Case II" < "Case III", "wire 2" < "wire 10").
 */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  let result: number;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'number') result = -1;
  else if (typeof b === 'number') result = 1;
  else result = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? result : -result;
}

/** Stable sort: rows with equal keys keep their incoming (newest first) order. */
export function sortRows<T>(rows: readonly T[], key: (row: T) => SortValue, dir: SortDir): T[] {
  return rows
    .map((row, index) => ({ row, index, value: key(row) }))
    .sort((a, b) => compareSortValues(a.value, b.value, dir) || a.index - b.index)
    .map(item => item.row);
}

/**
 * Insertion slot for a dragged header: the index of the first column whose
 * horizontal midpoint is right of the pointer, or `rects.length` when the
 * pointer is past every midpoint.
 */
export function insertionSlotForX(pointerX: number, rects: readonly { left: number; right: number }[]): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (pointerX < (rect.left + rect.right) / 2) return index;
  }
  return rects.length;
}

/**
 * Convert an insertion slot (0..n, measured on the row that still contains the
 * dragged column at `from`) into the visible index the column ends up at.
 */
export function slotToIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}
