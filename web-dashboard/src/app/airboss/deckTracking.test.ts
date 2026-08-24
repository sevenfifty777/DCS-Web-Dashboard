import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendToRadarBatch,
  applyRadarBatch,
  createRadarBatch,
  deckIconRotationRadians,
  findDeckShip,
  isHelicopterUnit,
  nearestShipId,
  parkingSpotSupportsUnit,
  relativeHorizontalSpeed,
  smoothingAlpha,
  synchronizedDeckPosition,
  worldToDeck,
  type RadarSnapshot,
  type RadarUnit,
  type RadarUnitSample,
} from './deckTracking.ts';

const carrier: RadarUnit = {
  id: 72,
  name: 'CVN-72',
  position: { u: 1_000, v: 2_000 },
  orientation: { heading: 90 },
  velocity: { speed: 10, velocity: { x: 0, y: 0, z: 10 } },
  group: { category: 'GROUP_CATEGORY_SHIP' },
};

test('batches unit updates from different category timestamps', () => {
  const batch = createRadarBatch({ time: 123, update: 'unit', unit: carrier });
  assert.ok(batch);
  assert.equal(appendToRadarBatch(batch, {
    time: 123.8,
    update: 'unit',
    unit: { id: 14, position: { u: 1_010, v: 2_000 } },
  }), true);

  const previous: RadarSnapshot = { samples: {} };
  const next = applyRadarBatch(previous, batch);
  assert.deepEqual(Object.keys(next.samples).sort(), ['14', '72']);
  assert.equal(next.samples['14'].time, 123.8);
});

test('removes gone units in the same batch commit', () => {
  const batch = createRadarBatch({ time: 124, update: 'gone', gone: { id: 14 } });
  assert.ok(batch);
  const next = applyRadarBatch({
    samples: {
      '14': { time: 123, unit: { id: 14 } },
      '72': { time: 123, unit: carrier },
    },
  }, batch);
  assert.deepEqual(Object.keys(next.samples), ['72']);
});

test('selects the named ship instead of a nearer aircraft', () => {
  const units = {
    '14': {
      id: 14,
      name: 'CVN-72',
      position: { u: 1_001, v: 2_001 },
      group: { category: 'GROUP_CATEGORY_AIRPLANE' },
    },
    '72': carrier,
  };
  assert.equal(findDeckShip(units, 'cvn-72', null, { u: 1_000, v: 2_000 })?.id, 72);
});

test('converts world coordinates into the ship deck frame', () => {
  const position = worldToDeck({ u: 1_010, v: 2_000 }, carrier.position!, 90);
  assert.equal(position.fwd, 10);
  assert.ok(Math.abs(position.right) < 1e-12);
});

test('projects staggered ship and aircraft samples to one DCS time', () => {
  const shipSample: RadarUnitSample = { time: 100, unit: carrier };
  const aircraftSample: RadarUnitSample = {
    time: 101,
    unit: {
      id: 14,
      position: { u: 1_020, v: 2_000 },
      velocity: { speed: 10, velocity: { x: 0, y: 0, z: 10 } },
    },
  };

  const position = synchronizedDeckPosition(aircraftSample, shipSample, 90);
  assert.ok(position);
  assert.equal(position.fwd, 10);
  assert.ok(Math.abs(position.right) < 1e-12);
});

test('assigns an aircraft to only its nearest ship', () => {
  const tarawa: RadarUnit = {
    ...carrier,
    id: 40,
    name: 'Tarawa',
    position: { u: 16_000, v: 2_000 },
  };
  const samples = {
    '72': { time: 100, unit: carrier },
    '40': { time: 100, unit: tarawa },
  };
  const aircraftSample: RadarUnitSample = {
    time: 101,
    unit: {
      id: 14,
      position: { u: 1_020, v: 2_000 },
      velocity: { speed: 10, velocity: { x: 0, y: 0, z: 10 } },
      group: { category: 'GROUP_CATEGORY_AIRPLANE' },
    },
  };

  assert.equal(nearestShipId(aircraftSample, samples), '72');
});

test('uses velocity relative to the carrier for smoothing', () => {
  const parkedAircraft: RadarUnit = {
    id: 14,
    velocity: { speed: 10, velocity: { x: 0, y: 0, z: 10 } },
  };
  const taxiingAircraft: RadarUnit = {
    id: 18,
    velocity: { speed: 12, velocity: { x: 0, y: 0, z: 12 } },
  };

  assert.equal(relativeHorizontalSpeed(parkedAircraft, carrier), 0);
  assert.equal(relativeHorizontalSpeed(taxiingAircraft, carrier), 2);
  assert.equal(smoothingAlpha(0), 0.05);
  assert.ok(smoothingAlpha(2) > smoothingAlpha(0));
});

test('recognizes helicopter units and restricts them to helicopter terminals', () => {
  const helicopter: RadarUnit = {
    id: 50,
    group: { category: 'GROUP_CATEGORY_HELICOPTER' },
  };
  const airplane: RadarUnit = {
    id: 51,
    group: { category: 'GROUP_CATEGORY_AIRPLANE' },
  };
  const helicopterSpot = { kind: 'helicopter' as const };
  const fixedWingSpot = { kind: 'fixed-wing' as const };

  assert.equal(isHelicopterUnit(helicopter), true);
  assert.equal(isHelicopterUnit(airplane), false);
  assert.equal(parkingSpotSupportsUnit(helicopterSpot, helicopter), true);
  assert.equal(parkingSpotSupportsUnit(fixedWingSpot, helicopter), false);
  assert.equal(parkingSpotSupportsUnit(helicopterSpot, airplane), false);
  assert.equal(parkingSpotSupportsUnit(fixedWingSpot, airplane), true);
});

test('applies parking headings to fixed-wing aircraft and keeps helicopters ship-forward', () => {
  const airplane: RadarUnit = {
    id: 51,
    group: { category: 'GROUP_CATEGORY_AIRPLANE' },
  };
  const helicopter: RadarUnit = {
    id: 52,
    group: { category: 'GROUP_CATEGORY_HELICOPTER' },
  };
  const starboardFacingSpot = { deckHeadingDegrees: 90 };
  const portFacingSpot = { deckHeadingDegrees: -90 };

  assert.equal(deckIconRotationRadians(airplane, starboardFacingSpot, true), Math.PI / 2);
  assert.equal(deckIconRotationRadians(airplane, portFacingSpot, true), -Math.PI / 2);
  assert.equal(deckIconRotationRadians(helicopter, starboardFacingSpot, true), 0);
  assert.equal(deckIconRotationRadians(helicopter, null, true), 0);
});
