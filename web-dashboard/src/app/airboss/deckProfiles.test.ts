import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARA_VDM_PROFILE,
  DECK_PROFILE_IMAGES,
  DECK_PROFILES,
  ESSEX_PROFILE,
  FORRESTAL_PROFILE,
  GENERIC_CATOBAR_PROFILE,
  GENERIC_VSTOL_PROFILE,
  INVINCIBLE_PROFILE,
  KUZNETSOV_PROFILE,
  NIMITZ_PROFILE,
  TARAWA_PROFILE,
  deckProfileForType,
} from './deckProfiles.ts';
import { NIMITZ_SPOTS, TARAWA_SPOTS } from './deckSpots.ts';
import { NIMITZ_LAUNCH_ROUTES, TARAWA_LAUNCH_ROUTES } from './deckRoutes.ts';

test('looks up dedicated profiles by DCS type name, case-insensitively', () => {
  for (const type of ['CVN_71', 'CVN_72', 'CVN_73', 'CVN_75', 'Stennis', 'cvn_72']) {
    assert.equal(deckProfileForType(type), NIMITZ_PROFILE, type);
  }
  assert.equal(deckProfileForType('LHA_Tarawa'), TARAWA_PROFILE);
  assert.equal(deckProfileForType('LHA_Tarawa', 'catobar'), TARAWA_PROFILE, 'type wins over class');
});

test('maps the image-only hulls to their own profiles', () => {
  assert.equal(deckProfileForType('Forrestal', 'catobar'), FORRESTAL_PROFILE);
  assert.equal(deckProfileForType('CV_1143_5', 'stobar'), KUZNETSOV_PROFILE);
  assert.equal(deckProfileForType('KUZNECOW', 'stobar'), KUZNETSOV_PROFILE);
  assert.equal(deckProfileForType('Essex', 'stobar'), ESSEX_PROFILE);
  assert.equal(deckProfileForType('hms_invincible', 'vstol'), INVINCIBLE_PROFILE);
  assert.equal(deckProfileForType('ara_vdm', 'catobar'), ARA_VDM_PROFILE);
  for (const profile of [FORRESTAL_PROFILE, KUZNETSOV_PROFILE, ESSEX_PROFILE, INVINCIBLE_PROFILE, ARA_VDM_PROFILE]) {
    // Captured bow-left like the Nimitz view.
    assert.equal(profile.imageRotation, Math.PI / 2, profile.key);
    assert.equal(profile.imageBowHeadingDeg, 270, profile.key);
    assert.match(profile.imageSrc ?? '', /^\/img\/.+-top-transp\.png$/, profile.key);
  }
  assert.equal(ESSEX_PROFILE.deckOffsetDeg, 0, 'axial deck');
  assert.equal(INVINCIBLE_PROFILE.deckOffsetDeg, 0);
  assert.equal(FORRESTAL_PROFILE.deckOffsetDeg, 9.14);
});

test('model origin offsets follow the take-off run geometry of each DCS deck', () => {
  // A catapult or ramp run ends at the bow; compare with half the hull length.
  const bowFromRun = (startFwd: number, runMeters: number, azimuthDeg: number) =>
    startFwd + runMeters * Math.cos((azimuthDeg > 180 ? azimuthDeg - 360 : azimuthDeg) * Math.PI / 180);
  const nimitzBow = bowFromRun(59.954, 107.8, 354.3);
  assert.ok(Math.abs(nimitzBow - NIMITZ_PROFILE.lengthMeters / 2 - NIMITZ_PROFILE.imageCenterFwdMeters) < 3, `Nimitz bow ${nimitzBow}`);
  const forrestalBow = bowFromRun(82.414, 94.5, 356.72);
  assert.ok(Math.abs(forrestalBow - FORRESTAL_PROFILE.lengthMeters / 2 - FORRESTAL_PROFILE.imageCenterFwdMeters) < 3, `Forrestal bow ${forrestalBow}`);
  const kuznetsovBow = bowFromRun(78.36, 102.368, 353.8);
  assert.ok(Math.abs(kuznetsovBow - KUZNETSOV_PROFILE.lengthMeters / 2 - KUZNETSOV_PROFILE.imageCenterFwdMeters) < 3, `Kuznetsov bow ${kuznetsovBow}`);
  for (const profile of [TARAWA_PROFILE, ESSEX_PROFILE, INVINCIBLE_PROFILE, ARA_VDM_PROFILE, GENERIC_CATOBAR_PROFILE, GENERIC_VSTOL_PROFILE]) {
    assert.equal(profile.imageCenterFwdMeters, 0, profile.key);
  }
});

test('each deck carries the spot and route counts of its DCS RunwaysAndRoutes table', () => {
  const summary = Object.fromEntries(Object.values(DECK_PROFILES).map((profile) => [profile.key, {
    fixedWing: profile.spots.filter((spot) => spot.kind === 'fixed-wing').length,
    launch: profile.spots.filter((spot) => spot.kind === 'catapult' || spot.kind === 'stovl' || spot.kind === 'deck-run').length,
    helicopter: profile.spots.filter((spot) => spot.kind === 'helicopter').length,
    routes: profile.launchRoutes.length,
  }]));
  assert.deepEqual(summary, {
    nimitz: { fixedWing: 22, launch: 4, helicopter: 8, routes: 16 },
    forrestal: { fixedWing: 12, launch: 4, helicopter: 16, routes: 12 },
    kuznetsov: { fixedWing: 9, launch: 3, helicopter: 8, routes: 9 },
    essex: { fixedWing: 34, launch: 1, helicopter: 1, routes: 17 },
    invincible: { fixedWing: 6, launch: 1, helicopter: 7, routes: 4 },
    'ara-vdm': { fixedWing: 11, launch: 1, helicopter: 6, routes: 8 },
    tarawa: { fixedWing: 8, launch: 4, helicopter: 8, routes: 4 },
    'generic-catobar': { fixedWing: 0, launch: 0, helicopter: 0, routes: 0 },
    'generic-vstol': { fixedWing: 0, launch: 0, helicopter: 0, routes: 0 },
  });
});

test('every route on every deck links a real parking spot to a real launch spot', () => {
  for (const profile of Object.values(DECK_PROFILES)) {
    const spotByIndex = new Map(profile.spots.map((spot) => [String(spot.term_index), spot]));
    const ids = new Set<string>();
    for (const launchRoute of profile.launchRoutes) {
      const where = `${profile.key} ${launchRoute.id}`;
      assert.ok(!ids.has(launchRoute.id), `${where}: duplicate id`);
      ids.add(launchRoute.id);
      assert.ok(launchRoute.points.length >= 2, `${where}: needs a polyline`);

      const start = spotByIndex.get(String(launchRoute.startTermIndex));
      assert.ok(start?.position && start.kind === 'fixed-wing', `${where}: start spot ${launchRoute.startTermIndex} missing`);
      const first = launchRoute.points[0];
      // DCS spawn points sit up to a few metres from the parking spot they belong to.
      assert.ok(Math.hypot(first.fwd - start.position.u, first.right - start.position.v) <= 5,
        `${where}: route starts ${Math.hypot(first.fwd - start.position.u, first.right - start.position.v).toFixed(1)} m from spot ${launchRoute.startTermIndex}`);

      const launch = spotByIndex.get(String(launchRoute.launchTermIndex));
      assert.ok(launch?.position && launch.kind !== 'fixed-wing' && launch.kind !== 'helicopter', `${where}: launch spot ${launchRoute.launchTermIndex} missing`);
      const last = launchRoute.points.at(-1)!;
      assert.ok(Math.hypot(last.fwd - launch.position.u, last.right - launch.position.v) <= 1,
        `${where}: route ends ${Math.hypot(last.fwd - launch.position.u, last.right - launch.position.v).toFixed(1)} m from launch spot ${launchRoute.launchTermIndex}`);

      assert.equal(profile.routeById[launchRoute.id], launchRoute);
      assert.equal(profile.routeByStart[String(launchRoute.startTermIndex)], launchRoute, `${where}: one route per parking spot`);
      assert.ok(profile.routesByLaunch[String(launchRoute.launchTermIndex)].includes(launchRoute));
    }
    // Every spot lies within the hull footprint, measured from the hull's mid-length.
    for (const spot of profile.spots) {
      if (!spot.position) continue;
      const fromMidLength = spot.position.u - profile.imageCenterFwdMeters;
      assert.ok(Math.abs(fromMidLength) <= profile.lengthMeters / 2 + 5 && Math.abs(spot.position.v) <= profile.beamMeters / 2 + 5,
        `${profile.key}: spot ${spot.term_index} at (${spot.position.u}, ${spot.position.v}) is outside a ${profile.lengthMeters} x ${profile.beamMeters} m hull`);
    }
    // Launch spots on the new decks carry their display label.
    for (const spot of profile.spots) {
      if (spot.kind === 'deck-run' || (spot.kind === 'catapult' && profile.key !== 'nimitz') || (spot.kind === 'stovl' && profile.key !== 'tarawa')) {
        assert.ok(spot.launchLabel, `${profile.key}: launch spot ${spot.term_index} has no label`);
      }
    }
  }
});

test('falls back on the deck class for hulls without a profile', () => {
  assert.equal(deckProfileForType('Clemenceau_mod', 'catobar'), GENERIC_CATOBAR_PROFILE);
  assert.equal(deckProfileForType('juan_carlos_mod', 'vstol'), GENERIC_VSTOL_PROFILE);
  assert.equal(deckProfileForType('mystery_hull', 'unknown'), GENERIC_VSTOL_PROFILE);
  assert.equal(deckProfileForType(undefined, undefined), GENERIC_CATOBAR_PROFILE);
  assert.equal(deckProfileForType('', null), GENERIC_CATOBAR_PROFILE);
});

test('existing decks keep their geometry, spots and routes', () => {
  assert.equal(NIMITZ_PROFILE.lengthMeters, 332);
  assert.equal(NIMITZ_PROFILE.imageRotation, Math.PI / 2);
  assert.equal(NIMITZ_PROFILE.imageBowHeadingDeg, 270);
  assert.equal(NIMITZ_PROFILE.spots, NIMITZ_SPOTS);
  assert.equal(NIMITZ_PROFILE.launchRoutes, NIMITZ_LAUNCH_ROUTES);
  assert.equal(NIMITZ_PROFILE.deckOffsetDeg, 9.14);
  assert.equal(NIMITZ_PROFILE.deckCanvasWidth, 500);

  assert.equal(TARAWA_PROFILE.lengthMeters, 254);
  assert.equal(TARAWA_PROFILE.imageRotation, 0);
  assert.equal(TARAWA_PROFILE.imageBowHeadingDeg, 0);
  assert.equal(TARAWA_PROFILE.spots, TARAWA_SPOTS);
  assert.equal(TARAWA_PROFILE.launchRoutes, TARAWA_LAUNCH_ROUTES);
  assert.equal(TARAWA_PROFILE.deckOffsetDeg, 0);
  assert.equal(TARAWA_PROFILE.deckCanvasWidth, 400);
});

test('generic profiles have no image, spots or routes and sane offsets', () => {
  for (const profile of [GENERIC_CATOBAR_PROFILE, GENERIC_VSTOL_PROFILE]) {
    assert.equal(profile.imageSrc, null);
    assert.deepEqual(profile.spots, []);
    assert.deepEqual(profile.launchRoutes, []);
    assert.deepEqual(Object.keys(profile.routeById), []);
  }
  assert.equal(GENERIC_CATOBAR_PROFILE.deckOffsetDeg, 9.14);
  assert.equal(GENERIC_VSTOL_PROFILE.deckOffsetDeg, 0);
  assert.equal(GENERIC_CATOBAR_PROFILE.lengthMeters, 300);
  assert.equal(GENERIC_VSTOL_PROFILE.lengthMeters, 210);
});

test('every profile is registered under its own key and images are unique', () => {
  for (const [key, profile] of Object.entries(DECK_PROFILES)) {
    assert.equal(profile.key, key);
  }
  assert.deepEqual(
    [...DECK_PROFILE_IMAGES].sort(),
    [
      '/img/ara-vdm-top-transp.png',
      '/img/carrier-top-full-transp.png',
      '/img/essex-top-transp.png',
      '/img/forrestal-top-transp.png',
      '/img/invincible-top-transp.png',
      '/img/kuznetsov-top-transp.png',
      '/img/tarawa-top-full-transp.png',
    ],
  );
});
