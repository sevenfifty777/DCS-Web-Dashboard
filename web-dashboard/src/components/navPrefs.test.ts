import assert from 'node:assert/strict';
import test from 'node:test';

import type { NavPage } from './navPages.ts';
import {
  NAV_PREFS_KEY,
  clearNavPrefs,
  defaultNavPrefs,
  hidePage,
  insertionSlotFor,
  isCustomised,
  loadNavPrefs,
  moveDown,
  moveUp,
  moveVisibleIndex,
  parseNavPrefs,
  resolveNav,
  saveNavPrefs,
  showPage,
  slotToIndex,
} from './navPrefs.ts';

const PAGES: readonly NavPage[] = [
  { id: 'a', href: '/', label: 'A', pinned: true },
  { id: 'b', href: '/b', label: 'B' },
  { id: 'c', href: '/c', label: 'C' },
  { id: 'd', href: '/d', label: 'D' },
];

const ids = (pages: NavPage[]) => pages.map(page => page.id);

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
}

test('empty prefs resolve to the registry order with nothing hidden', () => {
  const nav = resolveNav(defaultNavPrefs(), PAGES);
  assert.deepEqual(ids(nav.visible), ['a', 'b', 'c', 'd']);
  assert.deepEqual(nav.hidden, []);
});

test('unknown ids are dropped and missing registry pages are appended', () => {
  const nav = resolveNav({ version: 1, order: ['d', 'zzz', 'b'], hidden: [] }, PAGES);
  assert.deepEqual(ids(nav.visible), ['d', 'b', 'a', 'c']);
});

test('hidden pinned ids are ignored, hidden unknown ids are dropped', () => {
  const nav = resolveNav({ version: 1, order: [], hidden: ['a', 'c', 'nope'] }, PAGES);
  assert.deepEqual(ids(nav.visible), ['a', 'b', 'd']);
  assert.deepEqual(ids(nav.hidden), ['c']);
});

test('moveUp on the first item and moveDown on the last are no-ops', () => {
  const prefs = defaultNavPrefs();
  assert.equal(moveUp(prefs, 'a', PAGES), prefs);
  assert.equal(moveDown(prefs, 'd', PAGES), prefs);
  assert.equal(moveUp(prefs, 'missing', PAGES), prefs);
});

test('moveUp / moveDown swap with the visible neighbour', () => {
  const up = moveUp(defaultNavPrefs(), 'c', PAGES);
  assert.deepEqual(ids(resolveNav(up, PAGES).visible), ['a', 'c', 'b', 'd']);
  const down = moveDown(up, 'c', PAGES);
  assert.deepEqual(ids(resolveNav(down, PAGES).visible), ['a', 'b', 'c', 'd']);
});

test('moving past a hidden neighbour steps over it and keeps it in place', () => {
  // Order a b c d with c hidden: moving d up should land before b, and c
  // should now sit after d so unhiding it restores a sensible order.
  const prefs = hidePage(defaultNavPrefs(), 'c', PAGES);
  const moved = moveUp(prefs, 'd', PAGES);
  assert.deepEqual(ids(resolveNav(moved, PAGES).visible), ['a', 'd', 'b']);
  assert.deepEqual(moved.order, ['a', 'd', 'b', 'c']);
  assert.deepEqual(ids(resolveNav(showPage(moved, 'c'), PAGES).visible), ['a', 'd', 'b', 'c']);
});

test('moveVisibleIndex reorders by visible position in both directions', () => {
  const down = moveVisibleIndex(defaultNavPrefs(), 0, 2, PAGES);
  assert.deepEqual(ids(resolveNav(down, PAGES).visible), ['b', 'c', 'a', 'd']);
  const up = moveVisibleIndex(down, 3, 0, PAGES);
  assert.deepEqual(ids(resolveNav(up, PAGES).visible), ['d', 'b', 'c', 'a']);
  assert.equal(moveVisibleIndex(up, 1, 1, PAGES), up);
  assert.equal(moveVisibleIndex(up, 1, 9, PAGES), up);
});

test('moveVisibleIndex ignores hidden pages when counting positions', () => {
  const prefs = hidePage(defaultNavPrefs(), 'b', PAGES); // visible: a c d
  const moved = moveVisibleIndex(prefs, 2, 0, PAGES);   // d to the top
  assert.deepEqual(ids(resolveNav(moved, PAGES).visible), ['d', 'a', 'c']);
  assert.deepEqual(ids(resolveNav(moved, PAGES).hidden), ['b']);
});

test('hidePage / showPage round-trip and refuse pinned pages', () => {
  const prefs = defaultNavPrefs();
  assert.equal(hidePage(prefs, 'a', PAGES), prefs);
  const hidden = hidePage(prefs, 'b', PAGES);
  assert.deepEqual(hidden.hidden, ['b']);
  assert.equal(hidePage(hidden, 'b', PAGES), hidden);
  const shown = showPage(hidden, 'b');
  assert.deepEqual(shown.hidden, []);
  assert.equal(showPage(shown, 'b'), shown);
});

test('isCustomised is false for the defaults and true after any change', () => {
  assert.equal(isCustomised(defaultNavPrefs(), PAGES), false);
  assert.equal(isCustomised({ version: 1, order: ['a', 'b', 'c', 'd'], hidden: [] }, PAGES), false);
  assert.equal(isCustomised(moveDown(defaultNavPrefs(), 'a', PAGES), PAGES), true);
  assert.equal(isCustomised(hidePage(defaultNavPrefs(), 'd', PAGES), PAGES), true);
});

test('parseNavPrefs rejects malformed input and dedupes ids', () => {
  assert.equal(parseNavPrefs(null), null);
  assert.equal(parseNavPrefs(''), null);
  assert.equal(parseNavPrefs('{not json'), null);
  assert.equal(parseNavPrefs('"a string"'), null);
  assert.equal(parseNavPrefs('{"version":2,"order":[]}'), null);
  assert.deepEqual(
    parseNavPrefs('{"version":1,"order":["b","b",3,"a"],"hidden":"nope"}'),
    { version: 1, order: ['b', 'a'], hidden: [] },
  );
});

test('load / save / clear tolerate missing and broken storage', () => {
  const storage = new MemoryStorage();
  const prefs = hidePage(moveDown(defaultNavPrefs(), 'a', PAGES), 'd', PAGES);
  saveNavPrefs(storage, prefs);
  assert.deepEqual(loadNavPrefs(storage), prefs);
  clearNavPrefs(storage);
  assert.equal(storage.getItem(NAV_PREFS_KEY), null);
  assert.deepEqual(loadNavPrefs(storage), defaultNavPrefs());

  assert.deepEqual(loadNavPrefs(null), defaultNavPrefs());
  saveNavPrefs(null, prefs);
  clearNavPrefs(null);

  const broken = {
    getItem() { throw new Error('nope'); },
    setItem() { throw new Error('nope'); },
    removeItem() { throw new Error('nope'); },
  };
  assert.deepEqual(loadNavPrefs(broken), defaultNavPrefs());
  saveNavPrefs(broken, prefs);
  clearNavPrefs(broken);
});

test('insertionSlotFor picks the first midpoint below the pointer', () => {
  const rects = [
    { top: 0, bottom: 20 },
    { top: 20, bottom: 40 },
    { top: 40, bottom: 60 },
  ];
  assert.equal(insertionSlotFor(-5, rects), 0);
  assert.equal(insertionSlotFor(5, rects), 0);
  assert.equal(insertionSlotFor(15, rects), 1);
  assert.equal(insertionSlotFor(35, rects), 2);
  assert.equal(insertionSlotFor(55, rects), 3);
  assert.equal(insertionSlotFor(999, rects), 3);
  assert.equal(insertionSlotFor(10, []), 0);
});

test('slotToIndex accounts for the dragged item leaving its slot', () => {
  assert.equal(slotToIndex(0, 0), 0);
  assert.equal(slotToIndex(0, 1), 0); // slot right after itself = no move
  assert.equal(slotToIndex(0, 3), 2);
  assert.equal(slotToIndex(2, 0), 0);
  assert.equal(slotToIndex(2, 2), 2);
});
