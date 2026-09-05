// Deck profile registry: everything the deck and wheel renderers need for one
// hull type, keyed by DCS unit type name with a fallback on the controller's
// deck classification. Adding a carrier type is a new row here (plus spots and
// routes in deckSpots.ts / deckRoutes.ts), never a change to the page.

import type { ParkingSpot } from './deckTracking';
import {
  ARA_VDM_SPOTS,
  ESSEX_SPOTS,
  FORRESTAL_SPOTS,
  INVINCIBLE_SPOTS,
  KUZNETSOV_SPOTS,
  NIMITZ_SPOTS,
  TARAWA_SPOTS,
} from './deckSpots.ts';
import {
  ARA_VDM_LAUNCH_ROUTES,
  ESSEX_LAUNCH_ROUTES,
  FORRESTAL_LAUNCH_ROUTES,
  INVINCIBLE_LAUNCH_ROUTES,
  KUZNETSOV_LAUNCH_ROUTES,
  NIMITZ_LAUNCH_ROUTES,
  NIMITZ_ROUTE_BY_ID,
  NIMITZ_ROUTE_BY_START,
  NIMITZ_ROUTES_BY_LAUNCH,
  TARAWA_LAUNCH_ROUTES,
  TARAWA_ROUTE_BY_ID,
  TARAWA_ROUTE_BY_START,
  TARAWA_ROUTES_BY_LAUNCH,
  indexDeckRoutes,
  type DeckLaunchRoute,
} from './deckRoutes.ts';

/** Classification produced by `CarrierRecovery.classifyDeck` in the Lua controller. */
export type DeckClass = 'catobar' | 'stobar' | 'vstol' | 'unknown';

export type DeckProfileKey =
  | 'nimitz' | 'forrestal' | 'kuznetsov' | 'essex' | 'invincible' | 'ara-vdm' | 'tarawa'
  | 'generic-catobar' | 'generic-vstol';

export interface DeckProfile {
  key: DeckProfileKey;
  /** Short label shown in the panel header ("NIMITZ CLASS"). */
  label: string;
  /** Top-down deck image, or null for an outline-only generic deck. */
  imageSrc: string | null;
  /** Radians to rotate the natural image so the bow points up on the deck view. */
  imageRotation: number;
  /** Compass heading the natural image's bow points to, used by the wind wheel. */
  imageBowHeadingDeg: number;
  lengthMeters: number;
  /** Used for the outline of image-less generic decks. */
  beamMeters: number;
  /**
   * Model-frame "forward" coordinate of the hull's mid-length, metres. DCS
   * spot coordinates and the streamed ship position are in the model frame,
   * whose origin is not always at mid-length; the image is centred on
   * mid-length, so spots, routes and aircraft are drawn this far aft of the
   * image centre. Estimated from where the catapult or deck-run ends (the bow).
   */
  imageCenterFwdMeters: number;
  deckCanvasWidth: number;
  deckCanvasHeight: number;
  spots: ParkingSpot[];
  launchRoutes: DeckLaunchRoute[];
  routeById: Readonly<Record<string, DeckLaunchRoute>>;
  routeByStart: Readonly<Record<string, DeckLaunchRoute>>;
  routesByLaunch: Readonly<Record<string, DeckLaunchRoute[]>>;
  /** Angled-deck offset shown on the wheel before the first controller report, degrees. */
  deckOffsetDeg: number;
}

const NO_ROUTES: Readonly<Record<string, DeckLaunchRoute>> = Object.freeze({});
const NO_ROUTE_GROUPS: Readonly<Record<string, DeckLaunchRoute[]>> = Object.freeze({});

export const NIMITZ_PROFILE: DeckProfile = {
  key: 'nimitz',
  label: 'NIMITZ CLASS',
  imageSrc: '/img/carrier-top-full-transp.png',
  // The Nimitz image natively faces West (left): rotate 90° to face up.
  imageRotation: Math.PI / 2,
  imageBowHeadingDeg: 270,
  lengthMeters: 332,
  beamMeters: 77,
  // Cat 1 ends at 167.7 m against a 166 m half-length: origin at mid-length.
  imageCenterFwdMeters: 0,
  deckCanvasWidth: 500,
  deckCanvasHeight: 1100,
  spots: NIMITZ_SPOTS,
  launchRoutes: NIMITZ_LAUNCH_ROUTES,
  routeById: NIMITZ_ROUTE_BY_ID,
  routeByStart: NIMITZ_ROUTE_BY_START,
  routesByLaunch: NIMITZ_ROUTES_BY_LAUNCH,
  deckOffsetDeg: 9.14,
};

/**
 * Profile for a hull whose top view was captured with the bow to the left,
 * like the Nimitz one. Spots and routes come from the DCS
 * `*_RunwaysAndRoutes.lua` tables (see deckSpots.ts / deckRoutes.ts). Lengths
 * are the DCS model's `GT.Length` where the mod states it, since the image is
 * of that model and the spot coordinates are in its frame.
 */
function hullProfile(
  key: DeckProfileKey,
  label: string,
  imageSrc: string,
  lengthMeters: number,
  beamMeters: number,
  imageCenterFwdMeters: number,
  deckCanvasWidth: number,
  deckOffsetDeg: number,
  spots: ParkingSpot[],
  routes: DeckLaunchRoute[],
): DeckProfile {
  return {
    key,
    label,
    imageSrc,
    imageRotation: Math.PI / 2,
    imageBowHeadingDeg: 270,
    lengthMeters,
    beamMeters,
    imageCenterFwdMeters,
    deckCanvasWidth,
    deckCanvasHeight: 1100,
    spots,
    ...indexDeckRoutes(routes),
    deckOffsetDeg,
  };
}

// Cats 1 and 2 (82.4 m + 94.5 m run) end at +176.7 m: the bow. Mid-length of
// a 325 m hull is therefore 13 m forward of the model origin.
export const FORRESTAL_PROFILE = hullProfile(
  'forrestal', 'FORRESTAL CLASS', '/img/forrestal-top-transp.png', 325, 76, 13, 500, 9.14,
  FORRESTAL_SPOTS, FORRESTAL_LAUNCH_ROUTES,
);
// Ramps 1 and 2 (78.4 m + 102.4 m run) end at the ski-jump lip, +180 m; the
// "M" helicopter terminal then lands on the painted M of the deck texture.
export const KUZNETSOV_PROFILE = hullProfile(
  'kuznetsov', 'KUZNETSOV CLASS', '/img/kuznetsov-top-transp.png', 304.5, 72, 28, 500, 9.14,
  KUZNETSOV_SPOTS, KUZNETSOV_LAUNCH_ROUTES,
);
export const ESSEX_PROFILE = hullProfile(
  'essex', 'ESSEX CLASS (1944)', '/img/essex-top-transp.png', 275, 45, 0, 400, 0,
  ESSEX_SPOTS, ESSEX_LAUNCH_ROUTES,
);
export const INVINCIBLE_PROFILE = hullProfile(
  'invincible', 'INVINCIBLE CLASS', '/img/invincible-top-transp.png', 209.4, 36, 0, 400, 0,
  INVINCIBLE_SPOTS, INVINCIBLE_LAUNCH_ROUTES,
);
export const ARA_VDM_PROFILE = hullProfile(
  'ara-vdm', 'ARA VEINTICINCO DE MAYO', '/img/ara-vdm-top-transp.png', 212, 40, 0, 400, 9.14,
  ARA_VDM_SPOTS, ARA_VDM_LAUNCH_ROUTES,
);

export const TARAWA_PROFILE: DeckProfile = {
  key: 'tarawa',
  label: 'TARAWA CLASS (LHA)',
  imageSrc: '/img/tarawa-top-full-transp.png',
  // The Tarawa image natively faces North (up).
  imageRotation: 0,
  imageBowHeadingDeg: 0,
  lengthMeters: 254,
  beamMeters: 40,
  imageCenterFwdMeters: 0,
  deckCanvasWidth: 400,
  deckCanvasHeight: 1100,
  spots: TARAWA_SPOTS,
  launchRoutes: TARAWA_LAUNCH_ROUTES,
  routeById: TARAWA_ROUTE_BY_ID,
  routeByStart: TARAWA_ROUTE_BY_START,
  routesByLaunch: TARAWA_ROUTES_BY_LAUNCH,
  deckOffsetDeg: 0,
};

export const GENERIC_CATOBAR_PROFILE: DeckProfile = {
  key: 'generic-catobar',
  label: 'CARRIER (GENERIC DECK)',
  imageSrc: null,
  imageRotation: 0,
  imageBowHeadingDeg: 0,
  lengthMeters: 300,
  beamMeters: 70,
  imageCenterFwdMeters: 0,
  deckCanvasWidth: 500,
  deckCanvasHeight: 1100,
  spots: [],
  launchRoutes: [],
  routeById: NO_ROUTES,
  routeByStart: NO_ROUTES,
  routesByLaunch: NO_ROUTE_GROUPS,
  deckOffsetDeg: 9.14,
};

export const GENERIC_VSTOL_PROFILE: DeckProfile = {
  key: 'generic-vstol',
  label: 'VSTOL CARRIER (GENERIC DECK)',
  imageSrc: null,
  imageRotation: 0,
  imageBowHeadingDeg: 0,
  lengthMeters: 210,
  beamMeters: 36,
  imageCenterFwdMeters: 0,
  deckCanvasWidth: 400,
  deckCanvasHeight: 1100,
  spots: [],
  launchRoutes: [],
  routeById: NO_ROUTES,
  routeByStart: NO_ROUTES,
  routesByLaunch: NO_ROUTE_GROUPS,
  deckOffsetDeg: 0,
};

export const DECK_PROFILES: Readonly<Record<DeckProfileKey, DeckProfile>> = {
  nimitz: NIMITZ_PROFILE,
  forrestal: FORRESTAL_PROFILE,
  kuznetsov: KUZNETSOV_PROFILE,
  essex: ESSEX_PROFILE,
  invincible: INVINCIBLE_PROFILE,
  'ara-vdm': ARA_VDM_PROFILE,
  tarawa: TARAWA_PROFILE,
  'generic-catobar': GENERIC_CATOBAR_PROFILE,
  'generic-vstol': GENERIC_VSTOL_PROFILE,
};

/** DCS unit type names with a dedicated profile. Keys are compared case-insensitively. */
const PROFILE_BY_TYPE: Readonly<Record<string, DeckProfileKey>> = {
  cvn_71: 'nimitz',
  cvn_72: 'nimitz',
  cvn_73: 'nimitz',
  cvn_75: 'nimitz',
  stennis: 'nimitz',
  forrestal: 'forrestal',
  cv_1143_5: 'kuznetsov',
  kuznecow: 'kuznetsov',
  essex: 'essex',
  hms_invincible: 'invincible',
  ara_vdm: 'ara-vdm',
  lha_tarawa: 'tarawa',
};

/** Every image the profiles reference, for preloading. */
export const DECK_PROFILE_IMAGES: string[] = Array.from(new Set(
  Object.values(DECK_PROFILES)
    .map((profile) => profile.imageSrc)
    .filter((src): src is string => src !== null),
));

export function deckProfileForType(
  typeName: string | null | undefined,
  deckClass?: DeckClass | string | null,
): DeckProfile {
  const key = PROFILE_BY_TYPE[(typeName ?? '').trim().toLowerCase()];
  if (key) return DECK_PROFILES[key];
  return deckClass === 'vstol' || deckClass === 'unknown'
    ? GENERIC_VSTOL_PROFILE
    : GENERIC_CATOBAR_PROFILE;
}
