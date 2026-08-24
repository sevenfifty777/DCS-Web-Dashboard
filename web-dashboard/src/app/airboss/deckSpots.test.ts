import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMITZ_SPOTS,
  TARAWA_SPOTS,
  DECK_SPOT_STYLES,
} from './deckSpots.ts';

test('includes every Nimitz helicopter terminal from the DCS route file', () => {
  const helicopterSpots = NIMITZ_SPOTS.filter((spot) => spot.kind === 'helicopter');

  assert.deepEqual(helicopterSpots.map((spot) => ({
    index: spot.term_index,
    position: spot.position,
    heading: spot.deckHeadingDegrees,
  })), [
    { index: 'H1', position: { u: 147, v: -0.18 }, heading: 0 },
    { index: 'H2', position: { u: 113, v: -10.3 }, heading: 0 },
    { index: 'H3', position: { u: 55, v: -31.45 }, heading: 0 },
    { index: 'H4', position: { u: 20.6, v: -28.75 }, heading: 0 },
    { index: 'H5', position: { u: -8.9, v: -28.75 }, heading: 0 },
    { index: 'H6', position: { u: -39.7, v: -28.75 }, heading: 0 },
    { index: 'H7', position: { u: -100.6, v: -31 }, heading: 0 },
    { index: 'H8', position: { u: -94.8, v: 32.2 }, heading: 0 },
  ]);
});

test('classifies Tarawa helicopter terminals separately from fixed-wing spots', () => {
  assert.deepEqual(
    TARAWA_SPOTS
      .filter((spot) => spot.kind === 'helicopter')
      .map((spot) => spot.term_index),
    ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8'],
  );
  assert.equal(TARAWA_SPOTS.filter((spot) => spot.kind === 'fixed-wing').length, 8);
  assert.equal(TARAWA_SPOTS.filter((spot) => spot.kind === 'stovl').length, 4);
});

test('orients fixed-wing parking toward the deck centerline on both ships', () => {
  for (const spots of [NIMITZ_SPOTS, TARAWA_SPOTS]) {
    const fixedWingSpots = spots.filter((spot) => spot.kind === 'fixed-wing');

    for (const spot of fixedWingSpots) {
      assert.ok(spot.position);
      const expectedHeading = spot.position.v < 0 ? 90 : -90;
      assert.equal(spot.deckHeadingDegrees, expectedHeading);
    }
  }
});

test('uses distinct high-contrast colors for each deck spot purpose', () => {
  const fixedWingColor = DECK_SPOT_STYLES['fixed-wing'].color;
  const helicopterColor = DECK_SPOT_STYLES.helicopter.color;
  const catapultColor = DECK_SPOT_STYLES.catapult.color;
  const stovlColor = DECK_SPOT_STYLES.stovl.color;

  assert.equal(new Set([fixedWingColor, helicopterColor, catapultColor]).size, 3);
  assert.equal(catapultColor, stovlColor);
});
