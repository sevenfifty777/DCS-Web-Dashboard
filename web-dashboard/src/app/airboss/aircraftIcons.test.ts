import assert from 'node:assert/strict';
import test from 'node:test';

import { AIRCRAFT_ICON_FILES, aircraftIconForType } from './aircraftIcons.ts';

const expectedMappings: Array<[string, string]> = [
  ['F-14BU', 'f-14_icon_park.png'],
  ['FA-18C_hornet', 'F-18_icon_park.png'],
  ['AV8BNA', 'AV88_icon.park.png'],
  ['A-4E-C', 'A-4E-C_icon_park.png'],
  ['A-6E', 'A-6E_icon_park.png'],
  ['E-2D', 'E-2D_icon_park.png'],
  ['E-2C', 'E-2D_icon_park.png'],
  ['S-3B Tanker', 'S-3B_icon_park.png'],
  ['AH-64D_BLK_II', 'ah-64d_icon_park.png'],
  ['CH-47Fbl1', 'CH-47F_icon_park.png'],
  ['Ka-50_3', 'Ka-50_3_icon_park.png'],
  ['OH58D', 'oh58d_icon_park.png'],
  ['SA342Mistral', 'sa342_icon_park.png'],
  ['UH-1H', 'UH-1H_icon_park.png'],
  ['T-45', 'T45C_icon_park.png'],
];

test('maps DCS aircraft type variants to their deck icons', () => {
  for (const [aircraftType, expectedFileName] of expectedMappings) {
    assert.equal(aircraftIconForType(aircraftType)?.fileName, expectedFileName);
  }
});

test('uses catapult variants only when they exist', () => {
  assert.equal(aircraftIconForType('F-14B', true)?.fileName, 'f-14_icon_cat.png');
  assert.equal(aircraftIconForType('FA-18C_hornet', true)?.fileName, 'F-18_icon_cat.png');
  assert.equal(aircraftIconForType('E-2D', true)?.fileName, 'E-2D_icon_cat.png');
  assert.equal(aircraftIconForType('S-3B Tanker', true)?.fileName, 'S-3B_icon_cat.png');
  assert.equal(aircraftIconForType('A-4E-C', true)?.fileName, 'A-4E-C_icon_park.png');
});

test('returns null for aircraft without a dedicated icon', () => {
  assert.equal(aircraftIconForType('C-130J-30'), null);
});

test('preload list contains every icon exactly once', () => {
  assert.equal(new Set(AIRCRAFT_ICON_FILES).size, AIRCRAFT_ICON_FILES.length);
  assert.equal(AIRCRAFT_ICON_FILES.length, 18);
});
