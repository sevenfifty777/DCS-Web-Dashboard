import type { DeckPosition, ParkingSpot } from './deckTracking';

/** Deck profile key (see deckProfiles.ts); kept as an alias for older imports. */
export type DeckId = string;

export interface DeckLaunchRoute {
  id: string;
  startTermIndex: number;
  launchTermIndex: number;
  label: string;
  points: DeckPosition[];
}

export interface DeckRouteHitTarget {
  x: number;
  y: number;
  radius: number;
  /** Stable key used to toggle this route selection. */
  selectionId: string | null;
  /** One route for parking/aircraft targets, or every route for a launch target. */
  routeIds: string[];
  message: string;
}

export function deckRouteHitTargetAt(
  targets: DeckRouteHitTarget[],
  x: number,
  y: number,
): DeckRouteHitTarget | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (Math.hypot(x - target.x, y - target.y) <= target.radius) return target;
  }
  return null;
}

export function hasNoAssignedLaunchRoute(
  spot: ParkingSpot,
  routeByStart: Readonly<Record<string, DeckLaunchRoute>>,
): boolean {
  if (spot.kind !== 'fixed-wing' && spot.kind !== 'helicopter') return false;
  return spot.term_index === undefined || routeByStart[String(spot.term_index)] === undefined;
}

function route(
  id: string,
  startTermIndex: number,
  launchTermIndex: number,
  label: string,
  coordinates: Array<[number, number]>,
): DeckLaunchRoute {
  return {
    id,
    startTermIndex,
    launchTermIndex,
    label,
    points: coordinates.map(([fwd, right]) => ({ fwd, right })),
  };
}

// GT.TaxiForTORoutes from USS_Nimitz_RunwaysAndRoutes.lua.
export const NIMITZ_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('cvn-17-cat-1', 17, 23, 'Spot 17 → CAT 1', [
    [24.5, 9.5], [18.5, 3], [19, -2], [26, -3], [39.5, 15], [44, 21], [55, 18.54],
  ]),
  route('cvn-18-cat-2', 18, 24, 'Spot 18 → CAT 2', [
    [7.6, 10.5], [3.1, 4], [7.5, -1], [28.5, -2.75], [44.3, -3.25], [55.9, -3.68],
  ]),
  route('cvn-19-cat-3', 19, 25, 'Spot 19 → CAT 3', [
    [-9.9, 10.8], [-18.5, -1], [-62, -1.5], [-67, -17], [-55, -18.8], [-39.4, -19.92],
  ]),
  route('cvn-20-cat-4', 20, 26, 'Spot 20 → CAT 4', [
    [-26, 12], [-39, 4], [-81, -2.7], [-83, -20], [-79, -32.8], [-70, -33.3], [-58.5, -32.8],
  ]),
  route('cvn-11-cat-1', 11, 23, 'Spot 11 → CAT 1', [
    [-11, 34], [-11, 8], [34.25, 8], [39.5, 15], [44, 21], [55, 18.54],
  ]),
  route('cvn-10-cat-2', 10, 24, 'Spot 10 → CAT 2', [
    [-23, 34], [-23, 11], [7, 3], [44.3, -3.25], [55.9, -3.68],
  ]),
  route('cvn-21-cat-3', 21, 25, 'Spot 21 → CAT 3', [
    [-96, -34], [-96, -16], [-75, -16], [-65, -17.3], [-55, -18.8], [-39.4, -19.92],
  ]),
  route('cvn-22-cat-4', 22, 26, 'Spot 22 → CAT 4', [
    [-108, -34], [-108, -14], [-90, -14], [-79, -32.8], [-70, -33.3], [-58.5, -32.8],
  ]),
  route('cvn-5-cat-1', 5, 23, 'Spot 5 → CAT 1', [
    [-90, 34], [-90, 16.5], [-40, 7], [-25, 8], [34.25, 8], [39.5, 15], [44, 21], [55, 18.54],
  ]),
  route('cvn-4-cat-2', 4, 24, 'Spot 4 → CAT 2', [
    [-102.5, 34], [-102.5, 12.7], [-60, 8], [-10, 3.8], [44.3, -3.25], [55.9, -3.68],
  ]),
  route('cvn-16-cat-1', 16, 23, 'Spot 16 → CAT 1', [
    [35, 34], [35, 24], [24, 9.5], [18.5, 3], [19, -2], [26, -3], [39.5, 15], [44, 21], [55, 18.54],
  ]),
  route('cvn-15-cat-2', 15, 24, 'Spot 15 → CAT 2', [
    [23, 34], [23, 23], [8.6, 10.5], [3.1, 4], [7.5, -1], [28.5, -2.75], [44.3, -3.25], [55.9, -3.68],
  ]),
  route('cvn-12-cat-2', 12, 24, 'Spot 12 → CAT 2', [
    [6, 32.5], [6, 10.5], [13, 0], [28.5, -2.75], [44.3, -3.25], [55.9, -3.68],
  ]),
  route('cvn-3-cat-1', 3, 23, 'Spot 3 → CAT 1', [
    [-118, 28], [-112, 16], [-90, 16.5], [-40, 7], [-25, 8], [34.25, 8], [39.5, 15], [44, 21], [55, 18.54],
  ]),
  route('cvn-2-cat-3', 2, 25, 'Spot 2 → CAT 3', [
    [-129.2, 26.2], [-116.5, 10], [-96, -16], [-75, -16], [-65, -17.3], [-55, -18.8], [-39.4, -19.92],
  ]),
  route('cvn-1-cat-4', 1, 26, 'Spot 1 → CAT 4', [
    [-141.15, 24.2], [-137, 21.2], [-130, 4], [-108, -13], [-90, -13], [-79, -32.8], [-70, -33.3], [-58.5, -32.8],
  ]),
];

// GT.TaxiForTORoutes from TarawaRunwaysAndRoutes.lua.
export const TARAWA_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('tarawa-8-launch-1', 8, 17, 'Spot 8 → STOVL 1', [
    [-70, 14], [-68, 8], [-60, -5.5], [-35, -5.5],
  ]),
  route('tarawa-7-launch-2', 7, 18, 'Spot 7 → STOVL 2', [
    [-85, 14], [-83, 8], [-75, -5.5], [-60, -6.2],
  ]),
  route('tarawa-6-launch-3', 6, 19, 'Spot 6 → STOVL 3', [
    [-100, 14], [-98, 9], [-90, -5.5], [-65, -6.5],
  ]),
  route('tarawa-5-launch-4', 5, 20, 'Spot 5 → STOVL 4', [
    [-115, 14], [-113, 8], [-110, -7.5],
  ]),
];

// GT.TaxiForTORoutes from CV-59-Forrestal_RunwaysAndRoutes.lua. Spawn spots
// 9 to 12 are the six-pack; routes 5 and 6 start a few metres from parking
// spots 8 and 7, as the DCS file does.
export const FORRESTAL_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('cv59-9-cat-2', 9, 14, 'Spot 9 → CAT 2', [
    [58.2, 1.3], [56, -8.7], [71.6, -15.7], [83.3, -13.1],
  ]),
  route('cv59-10-cat-1', 10, 13, 'Spot 10 → CAT 1', [
    [47.2, 3.2], [46.2, -2.1], [74, 15.3], [82.4, 12.7],
  ]),
  route('cv59-11-cat-3', 11, 15, 'Spot 11 → CAT 3', [
    [36, 5.6], [31.9, -15], [10.5, -15.2], [-32.6, -3.9], [-49.4, -9.3], [-36.6, -19.3],
  ]),
  route('cv59-12-cat-4', 12, 16, 'Spot 12 → CAT 4', [
    [24.4, 7.8], [21.6, -3.9], [-50.4, -2.2], [-61, -32.2], [-46.8, -32.8],
  ]),
  route('cv59-8-cat-1', 8, 13, 'Spot 8 → CAT 1', [
    [54.8, 32.6], [54.8, 28], [62.1, 11.9], [82.4, 12.7],
  ]),
  route('cv59-7-cat-2', 7, 14, 'Spot 7 → CAT 2', [
    [43, 32.6], [43, 21.8], [17, 6.8], [68, -14.1], [82.7, -13.1],
  ]),
  route('cv59-6-cat-3', 6, 15, 'Spot 6 → CAT 3', [
    [-17.8, 32.6], [-17.8, 6], [-73, -3.8], [-36.6, -19.3],
  ]),
  route('cv59-5-cat-4', 5, 16, 'Spot 5 → CAT 4', [
    [-28.3, 32.6], [-27.5, 6], [-49.3, 2.1], [-78.9, -16.9], [-63.2, -33.2], [-47, -33],
  ]),
  route('cv59-4-cat-3', 4, 15, 'Spot 4 → CAT 3', [
    [-38.8, 32.6], [-38.8, 13.5], [-32.7, 2], [-82, 3.1], [-36.6, -19.3],
  ]),
  route('cv59-3-cat-4', 3, 16, 'Spot 3 → CAT 4', [
    [-49.3, 32.6], [-49.3, 17.7], [-47.1, 4], [-94.7, 2.6], [-83, -11.6], [-63.2, -33.2], [-47, -33],
  ]),
  route('cv59-2-cat-3', 2, 15, 'Spot 2 → CAT 3', [
    [-59.8, 32.6], [-59.8, 17.7], [-32.7, 8], [-82, 5.1], [-36.6, -19.3],
  ]),
  route('cv59-1-cat-4', 1, 16, 'Spot 1 → CAT 4', [
    [-70.3, 32.6], [-70.3, 25.7], [-47.1, 14], [-94.7, 2.6], [-83, -14.6], [-63.2, -33.2], [-47, -33],
  ]),
];

// GT.TaxiForTORoutes from CV_1143_5_RunwaysAndRoutes.lua. Every spawn spot
// sits a few metres from the matching parking spot; the DCS start points are kept.
export const KUZNETSOV_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('kuz-9-ramp-1', 9, 10, 'Spot 9 → RAMP 1', [
    [36.3, 9], [40, 3.5], [58, 12.5], [78.35, 11.23],
  ]),
  route('kuz-8-ramp-2', 8, 11, 'Spot 8 → RAMP 2', [
    [23.5, 7.4], [30.5, -2.4], [55, -13.7], [78.33, -11.23],
  ]),
  route('kuz-7-ramp-1', 7, 10, 'Spot 7 → RAMP 1', [
    [8.2, 8.8], [20, -6.5], [49, -6.8], [52, 10.3], [78.34, 11.23],
  ]),
  route('kuz-6-ramp-2', 6, 11, 'Spot 6 → RAMP 2', [
    [-6.7, 9], [0, 0], [16, -9.7], [20, -10], [55, -13.7], [78.33, -11.23],
  ]),
  route('kuz-5-ramp-1', 5, 10, 'Spot 5 → RAMP 1', [
    [-29.5, 11.5], [-23, 3.5], [-8, -6], [20, -10], [49, -6.8], [52, 10.3], [78.34, 11.23],
  ]),
  route('kuz-4-ramp-3', 4, 12, 'Spot 4 → RAMP 3', [
    [-57.5, 17], [-51.5, 7], [-38, -14], [-33, -21], [-14.26, -20.3],
  ]),
  route('kuz-3-ramp-3', 3, 12, 'Spot 3 → RAMP 3', [
    [-73.1, 16.8], [-54, -1.5], [-33, -21.5], [-14.26, -20.3],
  ]),
  route('kuz-2-ramp-3', 2, 12, 'Spot 2 → RAMP 3', [
    [-86.8, 17], [-76, 8], [-33, -21.5], [-14.26, -20.3],
  ]),
  route('kuz-1-ramp-3', 1, 12, 'Spot 1 → RAMP 3', [
    [-101.3, 14.3], [-90.5, 8.5], [-33, -21.5], [-14.26, -20.3],
  ]),
];

// GT.TaxiForTORoutes from Essex_Class_Carrier_1944_RunwaysAndRoutes.lua. All
// seventeen spawn spots taxi to the same deck-run start at (-35, -3).
const ESSEX_DECK_RUN: [number, number] = [-35, -3];
export const ESSEX_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('essex-18-run', 18, 35, 'Spot 18 → DECK RUN', [[-60, -5.5], [-50, -5.5], [-45, -3], ESSEX_DECK_RUN]),
  route('essex-19-run', 19, 35, 'Spot 19 → DECK RUN', [[-60, 3], [-50, 3], [-45, 0], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-20-run', 20, 35, 'Spot 20 → DECK RUN', [[-60, -14], [-55, -14], [-48, -9], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-21-run', 21, 35, 'Spot 21 → DECK RUN', [[-60, 11.5], [-55, 11.5], [-48, 4.5], [-45, -3], ESSEX_DECK_RUN]),
  route('essex-22-run', 22, 35, 'Spot 22 → DECK RUN', [[-75, -5.5], [-60, -5.5], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-23-run', 23, 35, 'Spot 23 → DECK RUN', [[-75, 3], [-60, 3], [-50, 0], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-24-run', 24, 35, 'Spot 24 → DECK RUN', [[-75, -14], [-60, -14], [-50, -8], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-25-run', 25, 35, 'Spot 25 → DECK RUN', [[-75, 11.5], [-60, 11.5], [-50, 4], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-26-run', 26, 35, 'Spot 26 → DECK RUN', [[-90, 0], [-80, 0], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-27-run', 27, 35, 'Spot 27 → DECK RUN', [[-90, -11], [-80, -11], [-60, -7], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-28-run', 28, 35, 'Spot 28 → DECK RUN', [[-90, 11], [-80, 11], [-60, 4], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-29-run', 29, 35, 'Spot 29 → DECK RUN', [[-105, 0], [-90, 0], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-30-run', 30, 35, 'Spot 30 → DECK RUN', [[-105, -11], [-90, -11], [-60, -7], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-31-run', 31, 35, 'Spot 31 → DECK RUN', [[-105, 11], [-90, 11], [-60, 4], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-32-run', 32, 35, 'Spot 32 → DECK RUN', [[-120, 0], [-110, 0], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-33-run', 33, 35, 'Spot 33 → DECK RUN', [[-120, -11], [-110, -11], [-60, -7], [-40, -3], ESSEX_DECK_RUN]),
  route('essex-34-run', 34, 35, 'Spot 34 → DECK RUN', [[-120, 11], [-110, 11], [-60, 4], [-40, -3], ESSEX_DECK_RUN]),
];

// GT.TaxiForTORoutes from hms_invincibleRunwaysAndRoutes.lua. Four starboard
// spawn spots aft of the island feed the single ski-jump run.
export const INVINCIBLE_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('inv-2-stovl-1', 2, 7, 'Spot 2 → STOVL 1', [
    [-98.8, 10.5], [-98.8, 2], [-98.8, -5.8], [-96.3, -9.5], [-88.5, -9.536],
  ]),
  route('inv-3-stovl-1', 3, 7, 'Spot 3 → STOVL 1', [
    [-83.9, 9.9], [-89.5, 2], [-98.8, 2], [-98.8, -5.8], [-96.3, -9.5], [-88.5, -9.536],
  ]),
  route('inv-4-stovl-1', 4, 7, 'Spot 4 → STOVL 1', [
    [-71.7, 10], [-77.4, 2], [-89.5, 2], [-98.8, 2], [-98.8, -5.8], [-96.3, -9.5], [-88.5, -9.536],
  ]),
  route('inv-5-stovl-1', 5, 7, 'Spot 5 → STOVL 1', [
    [-60, 9.6], [-65.3, 2], [-77.4, 2], [-89.5, 2], [-98.8, 2], [-98.8, -5.8], [-96.3, -9.5], [-88.5, -9.536],
  ]),
];

// GT.TaxiForTORoutes from ara_vdm_RunwaysAndRoutes.lua. The DCS routes end at
// (20.634, -11.65); the last leg to the catapult head is added so the drawn
// route reaches the launch spot.
const ARA_CAT_APPROACH: [number, number] = [20.634, -11.65];
const ARA_CAT_HEAD: [number, number] = [55.621, -8.41];
export const ARA_VDM_LAUNCH_ROUTES: DeckLaunchRoute[] = [
  route('ara-2-cat-1', 2, 12, 'Spot 2 → CAT 1', [
    [3.831, 11.525], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-1-cat-1', 1, 12, 'Spot 1 → CAT 1', [
    [-9.576, 11.154], [-4.992, 4.685], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-6-cat-1', 6, 12, 'Spot 6 → CAT 1', [
    [-2.195, -11.932], [0.921, -7.89], [7.255, -5.437], [10.631, -9.772], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-7-cat-1', 7, 12, 'Spot 7 → CAT 1', [
    [-15.032, -10.423], [-11.38, -5.745], [0.921, -7.89], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-8-cat-1', 8, 12, 'Spot 8 → CAT 1', [
    [-28.628, -9.389], [-24.105, -3.815], [-4.992, 4.685], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-9-cat-1', 9, 12, 'Spot 9 → CAT 1', [
    [-42.022, -8.061], [-37.09, -1.939], [-4.992, 4.685], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-10-cat-1', 10, 12, 'Spot 10 → CAT 1', [
    [-55.454, -6.095], [-50.57, -0.001], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
  route('ara-11-cat-1', 11, 12, 'Spot 11 → CAT 1', [
    [-72.392, 5.292], [-63.326, 4.024], [4.987, 5.445], [15.376, -12.069], ARA_CAT_APPROACH, ARA_CAT_HEAD,
  ]),
];

function indexRoutes(
  routes: DeckLaunchRoute[],
  key: 'id' | 'startTermIndex',
): Readonly<Record<string, DeckLaunchRoute>> {
  return Object.fromEntries(routes.map((item) => [String(item[key]), item]));
}

function indexRoutesByLaunch(
  routes: DeckLaunchRoute[],
): Readonly<Record<string, DeckLaunchRoute[]>> {
  const routesByLaunch: Record<string, DeckLaunchRoute[]> = {};
  for (const item of routes) {
    const launchKey = String(item.launchTermIndex);
    routesByLaunch[launchKey] = [...(routesByLaunch[launchKey] ?? []), item];
  }
  return routesByLaunch;
}

export const NIMITZ_ROUTE_BY_ID = indexRoutes(NIMITZ_LAUNCH_ROUTES, 'id');
export const NIMITZ_ROUTE_BY_START = indexRoutes(NIMITZ_LAUNCH_ROUTES, 'startTermIndex');
export const NIMITZ_ROUTES_BY_LAUNCH = indexRoutesByLaunch(NIMITZ_LAUNCH_ROUTES);
export const TARAWA_ROUTE_BY_ID = indexRoutes(TARAWA_LAUNCH_ROUTES, 'id');
export const TARAWA_ROUTE_BY_START = indexRoutes(TARAWA_LAUNCH_ROUTES, 'startTermIndex');
export const TARAWA_ROUTES_BY_LAUNCH = indexRoutesByLaunch(TARAWA_LAUNCH_ROUTES);

/** All three lookups for one deck's route table. */
export interface DeckRouteIndex {
  launchRoutes: DeckLaunchRoute[];
  routeById: Readonly<Record<string, DeckLaunchRoute>>;
  routeByStart: Readonly<Record<string, DeckLaunchRoute>>;
  routesByLaunch: Readonly<Record<string, DeckLaunchRoute[]>>;
}

export function indexDeckRoutes(routes: DeckLaunchRoute[]): DeckRouteIndex {
  return {
    launchRoutes: routes,
    routeById: indexRoutes(routes, 'id'),
    routeByStart: indexRoutes(routes, 'startTermIndex'),
    routesByLaunch: indexRoutesByLaunch(routes),
  };
}

export function nearestLaunchRoute(
  routes: DeckLaunchRoute[],
  position: DeckPosition,
  maximumDistanceMeters: number,
): DeckLaunchRoute | null {
  let nearestRoute: DeckLaunchRoute | null = null;
  let nearestDistance = maximumDistanceMeters;

  for (const candidate of routes) {
    for (let index = 1; index < candidate.points.length; index += 1) {
      const distance = distanceToSegment(position, candidate.points[index - 1], candidate.points[index]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestRoute = candidate;
      }
    }
  }

  return nearestRoute;
}

export function deckRoutePointAtProgress(
  route: DeckLaunchRoute,
  progress: number,
): DeckPosition | null {
  if (route.points.length === 0) return null;
  if (route.points.length === 1) return route.points[0];

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const length = Math.hypot(end.fwd - start.fwd, end.right - start.right);
    segmentLengths.push(length);
    totalLength += length;
  }
  if (totalLength === 0) return route.points[0];

  const targetDistance = Math.min(1, Math.max(0, progress)) * totalLength;
  let traversedDistance = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const segmentLength = segmentLengths[index];
    if (targetDistance <= traversedDistance + segmentLength || index === segmentLengths.length - 1) {
      const start = route.points[index];
      const end = route.points[index + 1];
      const segmentProgress = segmentLength === 0
        ? 0
        : (targetDistance - traversedDistance) / segmentLength;
      return {
        fwd: start.fwd + (end.fwd - start.fwd) * segmentProgress,
        right: start.right + (end.right - start.right) * segmentProgress,
      };
    }
    traversedDistance += segmentLength;
  }

  return route.points.at(-1) ?? null;
}

function distanceToSegment(
  point: DeckPosition,
  start: DeckPosition,
  end: DeckPosition,
): number {
  const segmentFwd = end.fwd - start.fwd;
  const segmentRight = end.right - start.right;
  const lengthSquared = segmentFwd ** 2 + segmentRight ** 2;
  if (lengthSquared === 0) return Math.hypot(point.fwd - start.fwd, point.right - start.right);

  const projection = Math.min(1, Math.max(0,
    ((point.fwd - start.fwd) * segmentFwd + (point.right - start.right) * segmentRight)
      / lengthSquared,
  ));
  return Math.hypot(
    point.fwd - (start.fwd + projection * segmentFwd),
    point.right - (start.right + projection * segmentRight),
  );
}
