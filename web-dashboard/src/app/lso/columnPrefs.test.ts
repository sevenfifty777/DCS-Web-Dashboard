import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareSortValues,
  cycleSort,
  defaultColumnPrefs,
  hideColumn,
  insertionSlotForX,
  isCustomised,
  loadColumnPrefs,
  moveInOrder,
  moveVisible,
  moveVisibleIndex,
  parseColumnPrefs,
  resolveColumns,
  saveColumnPrefs,
  showColumn,
  slotToIndex,
  sortRows,
  type TableSpec,
} from './columnPrefs.ts';
import { caseRank, gradeRank } from './lsoGrades.ts';

const SPEC: TableSpec = {
  storageKey: 'test:columns',
  columns: ['a', 'b', 'c', 'd'],
  defaultHidden: ['c'],
};

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
}

test('defaults resolve to the spec order with the default-hidden columns hidden', () => {
  const cols = resolveColumns(defaultColumnPrefs(SPEC), SPEC);
  assert.deepEqual(cols.visible, ['a', 'b', 'd']);
  assert.deepEqual(cols.hidden, ['c']);
  assert.equal(isCustomised(defaultColumnPrefs(SPEC), SPEC), false);
});

test('unknown stored ids are dropped and new spec columns are appended', () => {
  const prefs = { ...defaultColumnPrefs(SPEC), order: ['d', 'gone', 'a'], hidden: [] };
  assert.deepEqual(resolveColumns(prefs, SPEC).visible, ['d', 'a', 'b', 'c']);
});

test('hiding every column falls back to showing all of them', () => {
  const prefs = { ...defaultColumnPrefs(SPEC), hidden: ['a', 'b', 'c', 'd'] };
  assert.deepEqual(resolveColumns(prefs, SPEC).visible, ['a', 'b', 'c', 'd']);
});

test('parse rejects garbage and keeps a valid sort only', () => {
  assert.equal(parseColumnPrefs('not json'), null);
  assert.equal(parseColumnPrefs('{"version":2}'), null);
  const parsed = parseColumnPrefs('{"version":1,"order":["b","b",3],"hidden":["c"],"sort":{"id":"b","dir":"sideways"}}');
  assert.deepEqual(parsed, { version: 1, order: ['b'], hidden: ['c'], sort: null });
  const sorted = parseColumnPrefs('{"version":1,"order":[],"hidden":[],"sort":{"id":"b","dir":"desc"}}');
  assert.deepEqual(sorted?.sort, { id: 'b', dir: 'desc' });
});

test('load and save round-trip through storage, and fall back to defaults', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadColumnPrefs(storage, SPEC), defaultColumnPrefs(SPEC));
  const prefs = cycleSort(showColumn(defaultColumnPrefs(SPEC), 'c'), 'b');
  saveColumnPrefs(storage, SPEC, prefs);
  assert.deepEqual(loadColumnPrefs(storage, SPEC), prefs);
  assert.deepEqual(loadColumnPrefs(null, SPEC), defaultColumnPrefs(SPEC));
});

test('moveVisible steps over hidden columns', () => {
  // visible: a b d (c hidden between b and d)
  const moved = moveVisible(defaultColumnPrefs(SPEC), 'd', -1, SPEC);
  assert.deepEqual(resolveColumns(moved, SPEC).visible, ['a', 'd', 'b']);
});

test('moveVisible at an edge is a no-op', () => {
  const prefs = defaultColumnPrefs(SPEC);
  assert.equal(moveVisible(prefs, 'a', -1, SPEC), prefs);
  assert.equal(moveVisible(prefs, 'd', 1, SPEC), prefs);
});

test('moveVisibleIndex drops before or after the target like a drag', () => {
  const prefs = { ...defaultColumnPrefs(SPEC), hidden: [] };
  assert.deepEqual(resolveColumns(moveVisibleIndex(prefs, 0, 2, SPEC), SPEC).visible, ['b', 'c', 'a', 'd']);
  assert.deepEqual(resolveColumns(moveVisibleIndex(prefs, 3, 0, SPEC), SPEC).visible, ['d', 'a', 'b', 'c']);
});

test('moveInOrder swaps within the full order, hidden columns included', () => {
  const moved = moveInOrder(defaultColumnPrefs(SPEC), 'c', 1, SPEC);
  assert.deepEqual(moved.order, ['a', 'b', 'd', 'c']);
  assert.deepEqual(resolveColumns(moved, SPEC).visible, ['a', 'b', 'd']);
});

test('hide refuses the last visible column and drops a sort on the hidden column', () => {
  let prefs = cycleSort(defaultColumnPrefs(SPEC), 'b');
  prefs = hideColumn(prefs, 'b', SPEC);
  assert.equal(prefs.sort, null);
  assert.deepEqual(resolveColumns(prefs, SPEC).visible, ['a', 'd']);
  prefs = hideColumn(prefs, 'a', SPEC);
  const last = hideColumn(prefs, 'd', SPEC);
  assert.equal(last, prefs);
  assert.equal(isCustomised(prefs, SPEC), true);
});

test('cycleSort goes asc, desc, then off; another column restarts at asc', () => {
  let prefs = defaultColumnPrefs(SPEC);
  prefs = cycleSort(prefs, 'a');
  assert.deepEqual(prefs.sort, { id: 'a', dir: 'asc' });
  prefs = cycleSort(prefs, 'a');
  assert.deepEqual(prefs.sort, { id: 'a', dir: 'desc' });
  assert.deepEqual(cycleSort(prefs, 'b').sort, { id: 'b', dir: 'asc' });
  assert.equal(cycleSort(prefs, 'a').sort, null);
});

test('compareSortValues puts missing values last in both directions', () => {
  const values = [3, null, 1, 'x', null];
  const asc = [...values].sort((a, b) => compareSortValues(a, b, 'asc'));
  const desc = [...values].sort((a, b) => compareSortValues(a, b, 'desc'));
  assert.deepEqual(asc, [1, 3, 'x', null, null]);
  assert.deepEqual(desc, ['x', 3, 1, null, null]);
  assert.ok(compareSortValues('Case II', 'case iii', 'asc') < 0);
  assert.ok(compareSortValues('wire 2', 'wire 10', 'asc') < 0);
});

test('sortRows is stable for equal keys', () => {
  const rows = [
    { id: 1, k: 'b' },
    { id: 2, k: 'a' },
    { id: 3, k: 'b' },
    { id: 4, k: 'a' },
  ];
  assert.deepEqual(sortRows(rows, r => r.k, 'asc').map(r => r.id), [2, 4, 1, 3]);
  assert.deepEqual(sortRows(rows, r => r.k, 'desc').map(r => r.id), [1, 3, 2, 4]);
});

test('insertion slot and slot-to-index follow the horizontal midpoints', () => {
  const rects = [{ left: 0, right: 100 }, { left: 100, right: 150 }, { left: 150, right: 300 }];
  assert.equal(insertionSlotForX(10, rects), 0);
  assert.equal(insertionSlotForX(60, rects), 1);
  assert.equal(insertionSlotForX(140, rects), 2);
  assert.equal(insertionSlotForX(290, rects), 3);
  assert.equal(slotToIndex(0, 3), 2);
  assert.equal(slotToIndex(2, 0), 0);
});

test('gradeRank orders the NAVAIR grades and caseRank orders cases with night after day', () => {
  const grades = ['C', '_OK_', '--', 'OK', 'WO', '(OK)', 'B'];
  assert.deepEqual(
    [...grades].sort((a, b) => (gradeRank(a) ?? -1) - (gradeRank(b) ?? -1)),
    ['C', 'WO', 'B', '--', '(OK)', 'OK', '_OK_'],
  );
  assert.equal(gradeRank('???'), null);
  const day1 = caseRank({ ordered_case: 'I', night: false })!;
  const night1 = caseRank({ ordered_case: 'I', night: true })!;
  const day3 = caseRank({ ordered_case: 'III', night: null })!;
  assert.ok(day1 < night1 && night1 < day3);
  assert.equal(caseRank({ ordered_case: 'indeterminate', night: null }), null);
  assert.equal(caseRank({ ordered_case: null, night: null }), null);
});
