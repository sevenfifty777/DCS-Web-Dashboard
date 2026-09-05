import assert from 'node:assert/strict';
import test from 'node:test';

import {
  coalitionLabel,
  deckClassLabel,
  typeNameLooksLikeCarrier,
  unknownCarrierGroupsInRadar,
} from './carrierDetection.ts';
import type { RadarUnit } from './deckTracking.ts';

function ship(id: number, type: string, groupName: string, category = 'GROUP_CATEGORY_SHIP'): RadarUnit {
  return { id, type, name: `${groupName}-1`, group: { name: groupName, category }, position: { u: 0, v: 0 } };
}

test('recognises carrier hulls by type name and ignores escorts', () => {
  for (const type of ['CVN_71', 'CVN_75', 'Stennis', 'Forrestal', 'LHA_Tarawa', 'KUZNECOW', 'CV_1143_5', 'hms_invincible', 'Type_071', 'L61_Juan_Carlos']) {
    assert.ok(typeNameLooksLikeCarrier(type), type);
  }
  for (const type of ['USS_Arleigh_Burke_IIa', 'TICONDEROG', 'PERRY', 'speedboat', '', undefined]) {
    assert.ok(!typeNameLooksLikeCarrier(type), String(type));
  }
});

test('reports ship groups the detected list does not know yet', () => {
  const units: Record<string, RadarUnit> = {
    1: ship(1, 'CVN_72', 'CVN-72'),
    2: ship(2, 'CVN_73', 'CVN-74'),
    3: ship(3, 'LHA_Tarawa', 'Tarawa'),
    4: ship(4, 'USS_Arleigh_Burke_IIa', 'Escort'),
    5: ship(5, 'CVN_71', 'Airborne CVN', 'GROUP_CATEGORY_AIRPLANE'),
    6: { id: 6, type: 'FA-18C_hornet', group: { name: 'Hornets', category: 'GROUP_CATEGORY_AIRPLANE' } },
  };
  assert.deepEqual(unknownCarrierGroupsInRadar(units, new Set(['CVN-72'])), ['CVN-74', 'Tarawa']);
  assert.deepEqual(unknownCarrierGroupsInRadar(units, new Set(['CVN-72', 'CVN-74', 'Tarawa'])), []);
  assert.deepEqual(unknownCarrierGroupsInRadar({}, new Set()), []);
});

test('labels coalitions and deck classes for the panel header', () => {
  assert.equal(coalitionLabel(2), 'BLUE');
  assert.equal(coalitionLabel(1), 'RED');
  assert.equal(coalitionLabel(0), 'NEUTRAL');
  assert.equal(coalitionLabel(null), '—');
  assert.equal(deckClassLabel('catobar'), 'CATOBAR');
  assert.equal(deckClassLabel('vstol'), 'VSTOL');
  assert.equal(deckClassLabel('unknown'), 'UNCLASSIFIED');
  assert.equal(deckClassLabel(undefined), 'SHIP');
});
