import type { DeckPosition, ParkingSpot } from './deckTracking';

export type DeckId = 'carrier' | 'tarawa';

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
