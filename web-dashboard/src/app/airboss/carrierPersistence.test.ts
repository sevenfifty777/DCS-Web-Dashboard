import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emptyLayout,
  layoutStorageKey,
  loadLayout,
  parseLayout,
  saveLayout,
  serializeLayout,
} from './carrierPersistence.ts';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) { return this.store.get(key) ?? null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

test('keys the layout by mission name with an unknown fallback', () => {
  assert.equal(layoutStorageKey('Foothold Syria'), 'airboss:layout:Foothold Syria');
  assert.equal(layoutStorageKey('  Foothold Syria  '), 'airboss:layout:Foothold Syria');
  assert.equal(layoutStorageKey(''), 'airboss:layout:unknown');
  assert.equal(layoutStorageKey(null), 'airboss:layout:unknown');
});

test('round-trips panels, manual names and the planner flag', () => {
  const layout = emptyLayout();
  layout.panels['CVN-72'] = { show: true, sync: true, targetWod: 28 };
  layout.panels['Tarawa'] = { show: false, sync: false, targetWod: null };
  layout.manualNames = ['HMS Invincible'];
  layout.showPlanner = true;
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout);
});

test('rejects malformed or foreign data instead of throwing', () => {
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout(''), null);
  assert.equal(parseLayout('not json'), null);
  assert.equal(parseLayout('42'), null);
  assert.equal(parseLayout('{"version":2,"panels":{}}'), null);
  assert.equal(parseLayout('{"version":1}'), null);
  const tolerant = parseLayout(JSON.stringify({
    version: 1,
    panels: {
      'CVN-72': { show: 'yes', sync: 'yes', targetWod: 'fast' },
      '': { show: true },
      'CVN-74': 7,
    },
    manualNames: ['A', 3, '', 'A'],
    showPlanner: 'true',
  }));
  assert.deepEqual(tolerant, {
    version: 1,
    panels: { 'CVN-72': { show: true, sync: false, targetWod: null } },
    manualNames: ['A'],
    showPlanner: false,
  });
});

test('loads and saves through a storage object, tolerating its absence', () => {
  const storage = new MemoryStorage();
  const layout = emptyLayout();
  layout.panels['CVN-74'] = { show: true, sync: true, targetWod: 26.5 };
  saveLayout(storage, 'Mission A', layout);
  assert.deepEqual(loadLayout(storage, 'Mission A'), layout);
  assert.deepEqual(loadLayout(storage, 'Mission B'), emptyLayout());
  assert.deepEqual(loadLayout(null, 'Mission A'), emptyLayout());
  saveLayout(null, 'Mission A', layout);
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadLayout(broken, 'Mission A'), emptyLayout());
  saveLayout(broken, 'Mission A', layout);
});
