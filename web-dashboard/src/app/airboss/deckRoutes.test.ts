import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMITZ_LAUNCH_ROUTES,
  NIMITZ_ROUTE_BY_START,
  NIMITZ_ROUTES_BY_LAUNCH,
  TARAWA_LAUNCH_ROUTES,
  TARAWA_ROUTE_BY_START,
  TARAWA_ROUTES_BY_LAUNCH,
  deckRoutePointAtProgress,
  deckRouteHitTargetAt,
  hasNoAssignedLaunchRoute,
  nearestLaunchRoute,
} from './deckRoutes.ts';
import { NIMITZ_SPOTS, TARAWA_SPOTS } from './deckSpots.ts';

test('indexes every DCS Nimitz launch route by its parking spot', () => {
  assert.equal(NIMITZ_LAUNCH_ROUTES.length, 16);
  assert.equal(NIMITZ_ROUTE_BY_START['17'].launchTermIndex, 23);
  assert.equal(NIMITZ_ROUTE_BY_START['1'].launchTermIndex, 26);
  assert.deepEqual(NIMITZ_ROUTE_BY_START['18'].points.at(-1), { fwd: 55.9, right: -3.68 });
});

test('indexes every DCS Tarawa launch route by its parking spot', () => {
  assert.equal(TARAWA_LAUNCH_ROUTES.length, 4);
  assert.equal(TARAWA_ROUTE_BY_START['8'].launchTermIndex, 17);
  assert.equal(TARAWA_ROUTE_BY_START['5'].launchTermIndex, 20);
});

test('groups every possible parking route by its launch spot', () => {
  assert.deepEqual(
    NIMITZ_ROUTES_BY_LAUNCH['23'].map((route) => route.startTermIndex).sort((a, b) => a - b),
    [3, 5, 11, 16, 17],
  );
  assert.deepEqual(
    NIMITZ_ROUTES_BY_LAUNCH['26'].map((route) => route.startTermIndex).sort((a, b) => a - b),
    [1, 20, 22],
  );
  assert.deepEqual(
    TARAWA_ROUTES_BY_LAUNCH['17'].map((route) => route.startTermIndex),
    [8],
  );
});

test('finds a launch route near a taxiing aircraft', () => {
  assert.equal(
    nearestLaunchRoute(TARAWA_LAUNCH_ROUTES, { fwd: -68, right: 8 }, 3)?.id,
    'tarawa-8-launch-1',
  );
  assert.equal(
    nearestLaunchRoute(TARAWA_LAUNCH_ROUTES, { fwd: 20, right: 30 }, 3),
    null,
  );
});

test('selects the topmost clickable aircraft or parking target', () => {
  const spot = {
    x: 50, y: 60, radius: 10, selectionId: 'spot-route', routeIds: ['spot-route'], message: 'spot',
  };
  const aircraft = {
    x: 50, y: 60, radius: 14, selectionId: 'aircraft-route', routeIds: ['aircraft-route'], message: 'aircraft',
  };

  assert.equal(deckRouteHitTargetAt([spot, aircraft], 52, 62)?.selectionId, 'aircraft-route');
  assert.equal(deckRouteHitTargetAt([spot, aircraft], 100, 100), null);
});

test('keeps a selectable target for a parking spot without a route', () => {
  const target = {
    x: 20,
    y: 30,
    radius: 10,
    selectionId: 'spot:9',
    routeIds: [],
    message: 'No route',
  };

  assert.equal(deckRouteHitTargetAt([target], 20, 30)?.selectionId, 'spot:9');
  assert.deepEqual(deckRouteHitTargetAt([target], 20, 30)?.routeIds, []);
});

test('identifies parking and helicopter spots that need the default no-route highlight', () => {
  const nimitzNoRouteSpots = NIMITZ_SPOTS
    .filter((spot) => hasNoAssignedLaunchRoute(spot, NIMITZ_ROUTE_BY_START))
    .map((spot) => spot.term_index);
  const tarawaNoRouteSpots = TARAWA_SPOTS
    .filter((spot) => hasNoAssignedLaunchRoute(spot, TARAWA_ROUTE_BY_START))
    .map((spot) => spot.term_index);

  assert.deepEqual(nimitzNoRouteSpots, [
    6, 7, 8, 9, 13, 14,
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  ]);
  assert.deepEqual(tarawaNoRouteSpots, [
    1, 2, 3, 4,
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  ]);
});

test('moves a route-flow light by distance from parking to launch', () => {
  const route = {
    id: 'test-route',
    startTermIndex: 1,
    launchTermIndex: 2,
    label: 'Test route',
    points: [
      { fwd: 0, right: 0 },
      { fwd: 10, right: 0 },
      { fwd: 10, right: 10 },
    ],
  };

  assert.deepEqual(deckRoutePointAtProgress(route, 0), { fwd: 0, right: 0 });
  assert.deepEqual(deckRoutePointAtProgress(route, 0.75), { fwd: 10, right: 5 });
  assert.deepEqual(deckRoutePointAtProgress(route, 1), { fwd: 10, right: 10 });
});
