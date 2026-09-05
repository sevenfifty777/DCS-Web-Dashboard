// Deck view renderer, extracted from the page effect so one function serves
// every carrier panel. Pure with respect to React: it takes a profile and a
// radar snapshot, draws into the canvas, and returns the clickable targets
// plus the ship unit it resolved (the caller stores that as the locked id).

import { aircraftIconForType } from './aircraftIcons.ts';
import {
  deckIconRotationRadians,
  findDeckShip,
  hasParkingPosition,
  isAircraftUnit,
  nearestShipId,
  parkingSpotSupportsUnit,
  relativeHorizontalSpeed,
  smoothingAlpha,
  synchronizedDeckPosition,
  worldToDeck,
  type DeckPosition,
  type PositionedParkingSpot,
  type RadarSnapshot,
  type RadarUnit,
  type RadarUnitSample,
  type WorldPosition,
} from './deckTracking.ts';
import { DECK_SPOT_STYLES } from './deckSpots.ts';
import {
  deckRoutePointAtProgress,
  hasNoAssignedLaunchRoute,
  nearestLaunchRoute,
  type DeckLaunchRoute,
  type DeckRouteHitTarget,
} from './deckRoutes.ts';
import type { DeckProfile } from './deckProfiles.ts';

export const ROUTE_HIT_RADIUS_PX = 11;
export const ROUTE_AIRCRAFT_PROXIMITY_METERS = 12;
export const ROUTE_FLOW_CYCLE_MS = 2_800;
const ROUTE_SHIMMER_SEGMENTS = 14;
const ROUTE_SHIMMER_LENGTH = 0.075;
/** Fraction of the canvas height the ship length occupies (bow up). */
const DECK_LENGTH_FRACTION = 0.92;

export interface DeckRenderInput {
  profile: DeckProfile;
  /** Loaded deck image for `profile.imageSrc`, or null (not loaded yet, or generic profile). */
  shipImage: HTMLImageElement | null;
  /** Group name used to find the ship in the radar stream and in messages. */
  shipName: string;
  /** Last known ship position from the controller poll (easting u, northing v), if any. */
  fallbackPosition: WorldPosition | null;
  /** Last known ship heading from the controller poll, degrees true, if any. */
  fallbackHeading: number | null;
  lockedUnitId: string | null;
  /** Per-panel smoothing state, mutated in place. */
  smoothed: Record<string, DeckPosition>;
  radarSnapshot: RadarSnapshot;
  radarUnits: Record<string, RadarUnit>;
  /** Selection for this deck: the toggled selection id and the routes it lights up. */
  selectedSelectionId: string | null;
  selectedRouteIds: readonly string[];
  planeIcons: Record<string, HTMLImageElement>;
  /** Grey the whole deck (ship lost from the stream). */
  dimmed?: boolean;
}

export interface DeckRenderResult {
  hitTargets: DeckRouteHitTarget[];
  /** Radar unit id of the ship drawn, or null when it was not found. */
  shipUnitId: string | null;
}

interface OccupiedSpot {
  player: RadarUnit;
  spot: PositionedParkingSpot | null;
  uLocalFwd: number;
  uLocalRight: number;
  minDst: number;
  relativeSpeed: number;
}

function drawWaiting(dctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, message: string) {
  dctx.clearRect(0, 0, canvas.width, canvas.height);
  dctx.fillStyle = '#060a0f';
  dctx.fillRect(0, 0, canvas.width, canvas.height);
  dctx.font = "14px 'Share Tech Mono', monospace";
  dctx.fillStyle = 'rgba(255,255,255,0.4)';
  dctx.textAlign = 'center';
  dctx.textBaseline = 'middle';
  dctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

/** Outline hull for profiles without a deck image. Drawn bow-up around the origin. */
function drawGenericHull(
  dctx: CanvasRenderingContext2D,
  profile: DeckProfile,
  pixelsPerMeter: number,
) {
  const halfLength = profile.lengthMeters / 2 * pixelsPerMeter;
  const halfBeam = profile.beamMeters / 2 * pixelsPerMeter;
  const bowTaper = halfLength * 0.22;
  dctx.save();
  dctx.beginPath();
  dctx.moveTo(0, -halfLength);
  dctx.lineTo(halfBeam, -halfLength + bowTaper);
  dctx.lineTo(halfBeam, halfLength - halfBeam * 0.3);
  dctx.quadraticCurveTo(halfBeam, halfLength, halfBeam * 0.6, halfLength);
  dctx.lineTo(-halfBeam * 0.6, halfLength);
  dctx.quadraticCurveTo(-halfBeam, halfLength, -halfBeam, halfLength - halfBeam * 0.3);
  dctx.lineTo(-halfBeam, -halfLength + bowTaper);
  dctx.closePath();
  dctx.fillStyle = 'rgba(60, 74, 88, 0.55)';
  dctx.fill();
  dctx.strokeStyle = 'rgba(0, 212, 255, 0.45)';
  dctx.lineWidth = 2;
  dctx.stroke();
  // Deck centreline.
  dctx.setLineDash([8, 8]);
  dctx.strokeStyle = 'rgba(255, 214, 0, 0.35)';
  dctx.lineWidth = 1.5;
  dctx.beginPath();
  dctx.moveTo(0, -halfLength + bowTaper);
  dctx.lineTo(0, halfLength - halfBeam * 0.3);
  dctx.stroke();
  dctx.setLineDash([]);
  dctx.font = "11px 'Share Tech Mono', monospace";
  dctx.fillStyle = 'rgba(255,255,255,0.35)';
  dctx.textAlign = 'center';
  dctx.textBaseline = 'middle';
  dctx.fillText('NO DECK DATA FOR THIS HULL', 0, halfLength + 18);
  dctx.restore();
}

export function drawDeckView(canvas: HTMLCanvasElement | null, input: DeckRenderInput): DeckRenderResult {
  const hitTargets: DeckRouteHitTarget[] = [];
  const noRouteSpotHalos: Array<{ x: number; y: number; color: string }> = [];
  const selectedSpotHalos: Array<{ x: number; y: number; color: string }> = [];
  const {
    profile, shipImage, shipName, fallbackPosition, fallbackHeading, lockedUnitId, smoothed,
    radarSnapshot, radarUnits, selectedSelectionId, selectedRouteIds, planeIcons,
  } = input;
  const { spots, launchRoutes, routeByStart, routeById, routesByLaunch } = profile;
  const shipLengthM = profile.lengthMeters;

  if (!canvas) return { hitTargets, shipUnitId: null };
  const dctx = canvas.getContext('2d');
  if (!dctx) return { hitTargets, shipUnitId: null };

  const shipUnit = findDeckShip(radarUnits, shipName, lockedUnitId, fallbackPosition);
  const shipUnitId = shipUnit ? String(shipUnit.id) : null;
  const shipSample = shipUnitId ? radarSnapshot.samples[shipUnitId] : null;
  const syncShipPos = shipUnit?.position ?? fallbackPosition;
  const streamHeading = shipUnit?.orientation?.heading;
  const resolvedShipHeading = typeof streamHeading === 'number' && Number.isFinite(streamHeading)
    ? streamHeading
    : fallbackHeading;

  const imageReady = shipImage !== null && shipImage.complete && shipImage.naturalWidth > 0;
  const needsImage = profile.imageSrc !== null;
  if (!syncShipPos || resolvedShipHeading === null || (needsImage && !imageReady)) {
    drawWaiting(dctx, canvas, `Waiting for ${shipName} data...`);
    return { hitTargets, shipUnitId };
  }

  dctx.clearRect(0, 0, canvas.width, canvas.height);
  dctx.fillStyle = '#060a0f';
  dctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx2 = canvas.width / 2;
  const cy2 = canvas.height / 2;

  const targetLen = canvas.height * DECK_LENGTH_FRACTION;
  const pixelsPerMeter = targetLen / shipLengthM;

  dctx.save();
  dctx.translate(cx2, cy2);
  if (input.dimmed) dctx.globalAlpha = 0.45;

  if (needsImage && shipImage) {
    // If the natural image is tall (Tarawa), length is naturalHeight. If wide (Nimitz), naturalWidth.
    const isNaturallyTall = shipImage.naturalHeight > shipImage.naturalWidth;
    const shipImgLength = isNaturallyTall ? shipImage.naturalHeight : shipImage.naturalWidth;
    const scale = targetLen / shipImgLength;
    const dw = shipImage.naturalWidth * scale;
    const dh = shipImage.naturalHeight * scale;
    dctx.save();
    dctx.rotate(profile.imageRotation);
    dctx.drawImage(shipImage, -dw / 2, -dh / 2, dw, dh);
    dctx.restore();
  } else {
    drawGenericHull(dctx, profile, pixelsPerMeter);
  }

  const activeRoutes = selectedRouteIds
    .map((routeId) => routeById[routeId])
    .filter((item): item is DeckLaunchRoute => item !== undefined);
  const activeRouteIds = new Set(activeRoutes.map((item) => item.id));
  for (const activeRoute of activeRoutes) {
    if (activeRoute.points.length) {
      dctx.beginPath();
      for (let index = 0; index < activeRoute.points.length; index += 1) {
        const point = activeRoute.points[index];
        const routeX = point.right * pixelsPerMeter;
        const routeY = -point.fwd * pixelsPerMeter;
        if (index === 0) dctx.moveTo(routeX, routeY);
        else dctx.lineTo(routeX, routeY);
      }
      dctx.lineCap = 'round';
      dctx.lineJoin = 'round';
      dctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
      dctx.lineWidth = 10;
      dctx.stroke();
      dctx.strokeStyle = '#ff4b32';
      dctx.lineWidth = 5;
      dctx.stroke();

      for (const point of activeRoute.points) {
        const routeX = point.right * pixelsPerMeter;
        const routeY = -point.fwd * pixelsPerMeter;
        dctx.beginPath();
        dctx.arc(routeX, routeY, 3, 0, 2 * Math.PI);
        dctx.fillStyle = '#fff';
        dctx.fill();
      }
    }
  }

  // Match players to parking spots
  const occupiedSpots: OccupiedSpot[] = [];
  Object.values(radarUnits).forEach((u: RadarUnit) => {
    if (!shipUnit || !shipSample || !isAircraftUnit(u)) return;
    const unitId = String(u.id);
    const unitSample: RadarUnitSample | undefined = radarSnapshot.samples[unitId];
    if (!unitSample || nearestShipId(unitSample, radarSnapshot.samples) !== shipUnitId) return;

    const deckPosition = synchronizedDeckPosition(unitSample, shipSample, resolvedShipHeading);
    if (!deckPosition) return;
    const uLocalFwd = deckPosition.fwd;
    const uLocalRight = deckPosition.right;
    if (Math.abs(uLocalFwd) > shipLengthM / 2 + 20 || Math.abs(uLocalRight) > 50) return;

    let closestSpot: PositionedParkingSpot | null = null;
    let minDst = Infinity;

    for (const spot of spots) {
      if (!hasParkingPosition(spot) || !parkingSpotSupportsUnit(spot, u)) continue;
      const spotDeckPosition = spot.isLocal
        ? { fwd: spot.position.u, right: spot.position.v }
        : worldToDeck(spot.position, syncShipPos, resolvedShipHeading);
      const dx = uLocalFwd - spotDeckPosition.fwd;
      const dy = uLocalRight - spotDeckPosition.right;
      const dst = Math.sqrt(dx * dx + dy * dy);
      if (dst < minDst) {
        minDst = dst;
        closestSpot = spot;
      }
    }

    const relativeSpeed = relativeHorizontalSpeed(u, shipUnit);
    const alpha = smoothingAlpha(relativeSpeed);
    const prev = smoothed[unitId];
    const smoothFwd = prev ? alpha * uLocalFwd + (1 - alpha) * prev.fwd : uLocalFwd;
    const smoothRight = prev ? alpha * uLocalRight + (1 - alpha) * prev.right : uLocalRight;
    smoothed[unitId] = { fwd: smoothFwd, right: smoothRight };

    let smoothMinDst = minDst;
    if (closestSpot?.isLocal) {
      const sdx = smoothFwd - closestSpot.position.u;
      const sdy = smoothRight - closestSpot.position.v;
      smoothMinDst = Math.sqrt(sdx * sdx + sdy * sdy);
    }
    occupiedSpots.push({
      player: u,
      spot: closestSpot,
      uLocalFwd: smoothFwd,
      uLocalRight: smoothRight,
      minDst: smoothMinDst,
      relativeSpeed,
    });
  });

  // Draw Parking Spots
  spots.forEach((spot, idx) => {
    if (!spot.position) return;
    let sfwd: number;
    let sright: number;
    if (spot.isLocal) {
      sfwd = spot.position.u;
      sright = spot.position.v;
    } else {
      const deckPosition = worldToDeck(spot.position, syncShipPos, resolvedShipHeading);
      sfwd = deckPosition.fwd;
      sright = deckPosition.right;
    }

    const px = sright * pixelsPerMeter;
    const py = -sfwd * pixelsPerMeter;

    const spotStyle = DECK_SPOT_STYLES[spot.kind ?? 'fixed-wing'];
    const spotLabel = `${spot.term_index ?? idx}`;
    const spotRoute = spot.term_index === undefined
      ? undefined
      : routeByStart[String(spot.term_index)];
    const launchSpotRoutes = spot.term_index === undefined
      ? []
      : routesByLaunch[String(spot.term_index)] ?? [];
    const spotSelectionId = spot.kind === 'catapult' || spot.kind === 'stovl'
      ? `launch:${spotLabel}`
      : spotRoute?.id ?? `spot:${spotLabel}`;
    const isDirectlySelected = selectedSelectionId === spotSelectionId;
    const isSelectedRouteEndpoint = Boolean(
      isDirectlySelected
      || (spotRoute && activeRouteIds.has(spotRoute.id))
      || launchSpotRoutes.some((route) => activeRouteIds.has(route.id)),
    );
    dctx.beginPath();
    dctx.arc(px, py, 6, 0, 2 * Math.PI);
    dctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    dctx.fill();
    dctx.beginPath();
    dctx.arc(px, py, 4.25, 0, 2 * Math.PI);
    dctx.fillStyle = spotStyle.color;
    dctx.fill();
    dctx.font = "bold 12px 'Share Tech Mono', monospace";
    dctx.textAlign = 'center';
    dctx.textBaseline = 'middle';
    dctx.fillStyle = 'rgba(0, 0, 0, 0.95)';
    dctx.fillText(spotLabel, px + 1, py + 16);
    dctx.fillStyle = spotStyle.color;
    dctx.fillText(spotLabel, px, py + 15);

    if (isSelectedRouteEndpoint) {
      selectedSpotHalos.push({ x: px, y: py, color: spotStyle.color });
    }
    if (hasNoAssignedLaunchRoute(spot, routeByStart)) {
      noRouteSpotHalos.push({ x: px, y: py, color: spotStyle.color });
    }

    if (spot.kind === 'fixed-wing' || spot.kind === 'helicopter') {
      const unavailableMessage = spot.kind === 'helicopter'
        ? `Helicopter spot ${spotLabel} launches vertically; no taxi route is required.`
        : `No DCS launch route is defined for parking spot ${spotLabel}.`;
      hitTargets.push({
        x: cx2 + px,
        y: cy2 + py,
        radius: ROUTE_HIT_RADIUS_PX,
        selectionId: spotSelectionId,
        routeIds: spotRoute ? [spotRoute.id] : [],
        message: spotRoute ? `${shipName}: ${spotRoute.label}` : unavailableMessage,
      });
    } else if (spot.kind === 'catapult' || spot.kind === 'stovl') {
      const startLabels = launchSpotRoutes
        .map((route) => route.startTermIndex)
        .sort((first, second) => first - second)
        .join(', ');
      const launchName = spot.kind === 'catapult'
        ? `CAT ${Number(spot.term_index) - 22}`
        : `STOVL ${Number(spot.term_index) - 16}`;
      hitTargets.push({
        x: cx2 + px,
        y: cy2 + py,
        radius: ROUTE_HIT_RADIUS_PX,
        selectionId: spotSelectionId,
        routeIds: launchSpotRoutes.map((route) => route.id),
        message: launchSpotRoutes.length
          ? `${shipName}: ${launchName} → parking spots ${startLabels} (${launchSpotRoutes.length} route${launchSpotRoutes.length === 1 ? '' : 's'})`
          : `No DCS parking routes are defined for ${launchName}.`,
      });
    }
  });

  // Draw occupied aircraft
  occupiedSpots.forEach((occ) => {
    const parkedSpot = occ.spot?.isLocal && occ.minDst < 15 && occ.relativeSpeed < 1
      ? occ.spot
      : null;
    const sfwd = parkedSpot ? parkedSpot.position.u : occ.uLocalFwd;
    const sright = parkedSpot ? parkedSpot.position.v : occ.uLocalRight;

    const px = sright * pixelsPerMeter;
    const py = -sfwd * pixelsPerMeter;

    dctx.save();
    dctx.translate(px, py);

    const useCatapultVariant = parkedSpot?.kind === 'catapult';
    const iconSpec = aircraftIconForType(occ.player.type, useCatapultVariant);
    const iconToDraw = iconSpec ? planeIcons[iconSpec.fileName] : null;

    if (iconToDraw && iconSpec) {
      const drawLen = iconSpec.lengthMeters * pixelsPerMeter;
      const drawWid = (iconToDraw.width / iconToDraw.height) * drawLen;
      // Source icons point up. Parked fixed-wing aircraft face inward;
      // helicopters always point ship-forward.
      dctx.rotate(deckIconRotationRadians(occ.player, parkedSpot, true));
      dctx.drawImage(iconToDraw, -drawWid / 2, -drawLen / 2, drawWid, drawLen);
    } else {
      dctx.font = '20px Arial';
      dctx.fillStyle = 'white';
      dctx.textAlign = 'center';
      dctx.textBaseline = 'middle';
      dctx.fillText('✈️', 0, 0);
    }
    dctx.restore();

    const pName = occ.player.player_name || occ.player.type || 'Unknown';
    dctx.font = "12px 'Share Tech Mono', monospace";
    const textWidth = dctx.measureText(pName).width;
    dctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    dctx.fillRect(px - textWidth / 2 - 4, py + 15, textWidth + 8, 16);
    dctx.fillStyle = '#00ffcc';
    dctx.textAlign = 'center';
    dctx.textBaseline = 'top';
    dctx.fillText(pName, px, py + 17);

    const aircraftRouteFromSpot = occ.spot?.term_index === undefined
      ? undefined
      : routeByStart[String(occ.spot.term_index)];
    const aircraftRoute = aircraftRouteFromSpot ?? nearestLaunchRoute(
      launchRoutes,
      { fwd: occ.uLocalFwd, right: occ.uLocalRight },
      ROUTE_AIRCRAFT_PROXIMITY_METERS,
    );
    const unavailableMessage = occ.spot?.kind === 'helicopter'
      ? `${pName} is a helicopter and launches vertically; no taxi route is required.`
      : `No DCS launch route is defined for ${pName} at its current deck position.`;
    const aircraftSelectionId = aircraftRoute?.id
      ?? (parkedSpot?.term_index === undefined ? null : `spot:${parkedSpot.term_index}`);
    hitTargets.push({
      x: cx2 + px,
      y: cy2 + py,
      radius: Math.max(14, (iconSpec?.lengthMeters ?? 0) * pixelsPerMeter / 2),
      selectionId: aircraftSelectionId,
      routeIds: aircraftRoute ? [aircraftRoute.id] : [],
      message: aircraftRoute
        ? `${shipName}: ${aircraftRoute.label} (${pName})`
        : unavailableMessage,
    });
  });

  // No-route terminals are highlighted by default, before any interaction.
  for (const halo of noRouteSpotHalos) {
    dctx.save();
    dctx.beginPath();
    dctx.arc(halo.x, halo.y, 9, 0, 2 * Math.PI);
    dctx.setLineDash([3, 3]);
    dctx.strokeStyle = '#fff';
    dctx.lineWidth = 2;
    dctx.shadowColor = halo.color;
    dctx.shadowBlur = 6;
    dctx.stroke();
    dctx.restore();
  }

  // Keep the larger click-selection halo visible above aircraft icons.
  for (const halo of selectedSpotHalos) {
    dctx.save();
    dctx.beginPath();
    dctx.arc(halo.x, halo.y, 12, 0, 2 * Math.PI);
    dctx.strokeStyle = '#fff';
    dctx.lineWidth = 4;
    dctx.shadowColor = halo.color;
    dctx.shadowBlur = 12;
    dctx.stroke();
    dctx.restore();
  }

  dctx.restore();
  return { hitTargets, shipUnitId };
}

/** One-shot shimmer travelling along the selected routes (overlay canvas). */
export function drawDeckRouteFlow(
  canvas: HTMLCanvasElement | null,
  routes: DeckLaunchRoute[],
  shipLengthMeters: number,
  elapsedMilliseconds: number,
) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  if (routes.length === 0) return;

  const pixelsPerMeter = canvas.height * DECK_LENGTH_FRACTION / shipLengthMeters;
  const headProgress = (elapsedMilliseconds % ROUTE_FLOW_CYCLE_MS) / ROUTE_FLOW_CYCLE_MS;

  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  for (const route of routes) {
    const shimmerStart = headProgress - ROUTE_SHIMMER_LENGTH / 2;
    for (let segmentIndex = 0; segmentIndex < ROUTE_SHIMMER_SEGMENTS; segmentIndex += 1) {
      const startProgress = shimmerStart
        + ROUTE_SHIMMER_LENGTH * segmentIndex / ROUTE_SHIMMER_SEGMENTS;
      const endProgress = shimmerStart
        + ROUTE_SHIMMER_LENGTH * (segmentIndex + 1) / ROUTE_SHIMMER_SEGMENTS;
      if (endProgress < 0 || startProgress > 1) continue;
      const start = deckRoutePointAtProgress(route, Math.max(0, startProgress));
      const end = deckRoutePointAtProgress(route, Math.min(1, endProgress));
      if (!start || !end) continue;

      const bandPosition = (segmentIndex + 0.5) / ROUTE_SHIMMER_SEGMENTS;
      const strength = Math.sin(Math.PI * bandPosition);
      context.save();
      context.globalAlpha = 0.08 + strength * 0.48;
      context.strokeStyle = '#fff4dc';
      context.lineWidth = 1.5 + strength * 1.5;
      context.lineCap = 'round';
      context.shadowColor = '#ffe1a3';
      context.shadowBlur = 2 + strength * 4;
      context.beginPath();
      context.moveTo(start.right * pixelsPerMeter, -start.fwd * pixelsPerMeter);
      context.lineTo(end.right * pixelsPerMeter, -end.fwd * pixelsPerMeter);
      context.stroke();
      context.restore();
    }
  }
  context.restore();
}
