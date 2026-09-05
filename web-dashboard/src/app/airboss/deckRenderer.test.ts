import assert from 'node:assert/strict';
import test from 'node:test';

import { drawDeckRouteFlow, drawDeckView, type DeckRenderInput } from './deckRenderer.ts';
import { drawWindWheel } from './wheelRenderer.ts';
import { GENERIC_VSTOL_PROFILE, NIMITZ_PROFILE, TARAWA_PROFILE } from './deckProfiles.ts';
import type { RadarSnapshot, RadarUnit } from './deckTracking.ts';

/**
 * Recording stub for a 2D context: every method call is logged, every
 * property assignment accepted, so the renderers can run under node.
 */
function stubCanvas(width: number, height: number) {
  const calls: string[] = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy({} as Record<string, unknown>, {
    get(_target, property: string) {
      if (property === 'measureText') return () => ({ width: 40 });
      if (property === 'createRadialGradient') return () => gradient;
      return (...args: unknown[]) => {
        calls.push(`${property}(${args.length})`);
      };
    },
    set() { return true; },
  });
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

function loadedImage(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  return {
    complete: true,
    naturalWidth,
    naturalHeight,
    width: naturalWidth,
    height: naturalHeight,
  } as unknown as HTMLImageElement;
}

function shipUnit(id: number, groupName: string, type: string, heading: number): RadarUnit {
  return {
    id,
    name: `${groupName}-1`,
    type,
    position: { u: 1000, v: 2000 },
    orientation: { heading },
    velocity: { heading, speed: 6, velocity: { x: 6, y: 0, z: 0 } },
    group: { name: groupName, category: 'GROUP_CATEGORY_SHIP' },
  };
}

function aircraftUnit(id: number, type: string, offsetNorth: number, offsetEast: number): RadarUnit {
  return {
    id,
    name: `plane-${id}`,
    type,
    player_name: `Pilot ${id}`,
    position: { u: 1000 + offsetEast, v: 2000 + offsetNorth },
    velocity: { heading: 0, speed: 6, velocity: { x: 6, y: 0, z: 0 } },
    group: { name: 'Hornets', category: 'GROUP_CATEGORY_AIRPLANE' },
  };
}

function snapshotOf(units: RadarUnit[]): RadarSnapshot {
  return { samples: Object.fromEntries(units.map((unit) => [String(unit.id), { time: 100, unit }])) };
}

function baseInput(overrides: Partial<DeckRenderInput>): DeckRenderInput {
  return {
    profile: NIMITZ_PROFILE,
    shipImage: loadedImage(1200, 300),
    shipName: 'CVN-72',
    fallbackPosition: null,
    fallbackHeading: null,
    lockedUnitId: null,
    smoothed: {},
    radarSnapshot: { samples: {} },
    radarUnits: {},
    selectedSelectionId: null,
    selectedRouteIds: [],
    planeIcons: {},
    ...overrides,
  };
}

test('draws a waiting message and no targets when the ship is unknown', () => {
  const { canvas, calls } = stubCanvas(500, 1100);
  const result = drawDeckView(canvas, baseInput({}));
  assert.deepEqual(result, { hitTargets: [], shipUnitId: null });
  assert.ok(calls.includes('fillText(3)'));
  assert.ok(!calls.includes('drawImage(5)'));
});

test('draws the Nimitz deck with spots, a parked aircraft and click targets', () => {
  const ship = shipUnit(10, 'CVN-72', 'CVN_72', 0);
  // Spot 17 is at fwd 24.5 m, right 9.5 m: ship heading north, so north +24.5, east +9.5.
  const hornet = aircraftUnit(11, 'FA-18C_hornet', 24.5, 9.5);
  const units = { 10: ship, 11: hornet };
  const { canvas, calls } = stubCanvas(500, 1100);
  const smoothed = {};
  const result = drawDeckView(canvas, baseInput({
    radarUnits: units,
    radarSnapshot: snapshotOf([ship, hornet]),
    smoothed,
  }));
  assert.equal(result.shipUnitId, '10');
  assert.ok(calls.includes('drawImage(5)'), 'ship image drawn');
  assert.ok(Object.keys(smoothed).includes('11'), 'aircraft position smoothed');
  const spotTargets = result.hitTargets.filter((target) => target.selectionId?.startsWith('cvn-') || target.selectionId?.startsWith('spot:') || target.selectionId?.startsWith('launch:'));
  assert.ok(spotTargets.length >= NIMITZ_PROFILE.spots.length, 'one target per spot plus the aircraft');
  const aircraftTarget = result.hitTargets.at(-1)!;
  assert.equal(aircraftTarget.selectionId, 'cvn-17-cat-1');
  assert.equal(aircraftTarget.message, 'CVN-72: Spot 17 → CAT 1 (Pilot 11)');
  const launch = result.hitTargets.find((target) => target.selectionId === 'launch:23')!;
  assert.match(launch.message, /^CVN-72: CAT 1 → parking spots 3, 5, 11, 16, 17/);
});

test('highlights the selected route and falls back to the poll position when the stream lacks the ship', () => {
  const { canvas, calls } = stubCanvas(400, 1100);
  const result = drawDeckView(canvas, baseInput({
    profile: TARAWA_PROFILE,
    shipImage: loadedImage(300, 1200),
    shipName: 'Tarawa',
    fallbackPosition: { u: 5, v: 6 },
    fallbackHeading: 90,
    selectedSelectionId: 'tarawa-8-launch-1',
    selectedRouteIds: ['tarawa-8-launch-1'],
  }));
  assert.equal(result.shipUnitId, null);
  assert.ok(calls.includes('drawImage(5)'));
  assert.ok(calls.filter((call) => call === 'stroke(0)').length > 2, 'route polyline stroked');
  assert.equal(result.hitTargets.length, TARAWA_PROFILE.spots.length);
});

test('draws a generic outline when the profile has no image', () => {
  const ship = shipUnit(20, 'HMS Invincible', 'hms_invincible', 45);
  const { canvas, calls } = stubCanvas(400, 1100);
  const result = drawDeckView(canvas, baseInput({
    profile: GENERIC_VSTOL_PROFILE,
    shipImage: null,
    shipName: 'HMS Invincible',
    radarUnits: { 20: ship },
    radarSnapshot: snapshotOf([ship]),
    dimmed: true,
  }));
  assert.equal(result.shipUnitId, '20');
  assert.ok(!calls.includes('drawImage(5)'));
  assert.ok(calls.includes('quadraticCurveTo(4)'), 'hull outline drawn');
  assert.deepEqual(result.hitTargets, []);
});

test('route flow overlay and wind wheel run against the stub context', () => {
  const overlay = stubCanvas(500, 1100);
  drawDeckRouteFlow(overlay.canvas, [NIMITZ_PROFILE.launchRoutes[0]], 332, 700);
  assert.ok(overlay.calls.filter((call) => call === 'stroke(0)').length > 0);
  drawDeckRouteFlow(overlay.canvas, [], 332, 0);

  const wheel = stubCanvas(480, 480);
  drawWindWheel(wheel.canvas, {
    carrierImage: loadedImage(1200, 300),
    imageBowHeadingDeg: 270,
    windFromDeg: 30,
    windSpeedKt: 8,
    plannedHeadingDeg: 40,
    plannedSpeedKt: 17,
    deckHeadingDeg: 30.86,
    apparentFromDeg: 31,
    apparentSpeedKt: 24,
    actualHeadingDeg: 120,
    actualSpeedKt: 12,
    dimmed: true,
    tag: 'NOT SYNCED',
  });
  assert.equal(wheel.calls.filter((call) => call === 'drawImage(5)').length, 2, 'actual ship plus planned ghost');
  assert.ok(wheel.calls.includes('strokeRect(4)'), 'tag box drawn');
  drawWindWheel(null, {
    carrierImage: null,
    imageBowHeadingDeg: 0,
    windFromDeg: 0,
    windSpeedKt: 0,
    plannedHeadingDeg: 0,
    plannedSpeedKt: 0,
    deckHeadingDeg: 0,
    apparentFromDeg: 0,
    apparentSpeedKt: 0,
    actualHeadingDeg: null,
    actualSpeedKt: null,
  });
});
