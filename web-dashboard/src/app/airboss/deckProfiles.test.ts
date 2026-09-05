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
    // Captured bow-left like the Nimitz view; no spots or routes yet.
    assert.equal(profile.imageRotation, Math.PI / 2, profile.key);
    assert.equal(profile.imageBowHeadingDeg, 270, profile.key);
    assert.match(profile.imageSrc ?? '', /^\/img\/.+-top-transp\.png$/, profile.key);
    assert.deepEqual(profile.spots, []);
    assert.deepEqual(profile.launchRoutes, []);
  }
  assert.equal(ESSEX_PROFILE.deckOffsetDeg, 0, 'axial deck');
  assert.equal(INVINCIBLE_PROFILE.deckOffsetDeg, 0);
  assert.equal(FORRESTAL_PROFILE.deckOffsetDeg, 9.14);
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
