// Deck profile registry: everything the deck and wheel renderers need for one
// hull type, keyed by DCS unit type name with a fallback on the controller's
// deck classification. Adding a carrier type is a new row here (plus spots and
// routes in deckSpots.ts / deckRoutes.ts), never a change to the page.

import type { ParkingSpot } from './deckTracking';
import { NIMITZ_SPOTS, TARAWA_SPOTS } from './deckSpots.ts';
import {
  NIMITZ_LAUNCH_ROUTES,
  NIMITZ_ROUTE_BY_ID,
  NIMITZ_ROUTE_BY_START,
  NIMITZ_ROUTES_BY_LAUNCH,
  TARAWA_LAUNCH_ROUTES,
  TARAWA_ROUTE_BY_ID,
  TARAWA_ROUTE_BY_START,
  TARAWA_ROUTES_BY_LAUNCH,
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
 * Image-only profile (no parking spots or routes yet). All the top views below
 * were captured with the bow to the left, like the Nimitz one.
 */
function imageOnlyProfile(
  key: DeckProfileKey,
  label: string,
  imageSrc: string,
  lengthMeters: number,
  beamMeters: number,
  deckCanvasWidth: number,
  deckOffsetDeg: number,
): DeckProfile {
  return {
    key,
    label,
    imageSrc,
    imageRotation: Math.PI / 2,
    imageBowHeadingDeg: 270,
    lengthMeters,
    beamMeters,
    deckCanvasWidth,
    deckCanvasHeight: 1100,
    spots: [],
    launchRoutes: [],
    routeById: NO_ROUTES,
    routeByStart: NO_ROUTES,
    routesByLaunch: NO_ROUTE_GROUPS,
    deckOffsetDeg,
  };
}

export const FORRESTAL_PROFILE = imageOnlyProfile(
  'forrestal', 'FORRESTAL CLASS', '/img/forrestal-top-transp.png', 325, 76, 500, 9.14,
);
export const KUZNETSOV_PROFILE = imageOnlyProfile(
  'kuznetsov', 'KUZNETSOV CLASS', '/img/kuznetsov-top-transp.png', 305, 72, 500, 9.14,
);
export const ESSEX_PROFILE = imageOnlyProfile(
  'essex', 'ESSEX CLASS (1944)', '/img/essex-top-transp.png', 266, 45, 400, 0,
);
export const INVINCIBLE_PROFILE = imageOnlyProfile(
  'invincible', 'INVINCIBLE CLASS', '/img/invincible-top-transp.png', 209, 36, 400, 0,
);
export const ARA_VDM_PROFILE = imageOnlyProfile(
  'ara-vdm', 'ARA VEINTICINCO DE MAYO', '/img/ara-vdm-top-transp.png', 212, 40, 400, 9.14,
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
