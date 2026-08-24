export const RADAR_BATCH_SETTLE_MS = 20;

const MAX_SHIP_ACQUISITION_DISTANCE_METERS = 2_000;
const MAX_SAMPLE_PROJECTION_SECONDS = 2;
const MIN_SMOOTHING_ALPHA = 0.05;
const MAX_SMOOTHING_ALPHA = 0.5;
const FULL_RESPONSE_RELATIVE_SPEED_MPS = 3;

export interface WorldPosition {
  /** Easting in DCS-gRPC local coordinates. */
  u: number;
  /** Northing in DCS-gRPC local coordinates. */
  v: number;
}

interface Vector {
  /** North component. */
  x: number;
  /** Vertical component. */
  y: number;
  /** East component. */
  z: number;
}

export interface RadarUnit {
  id: number | string;
  name?: string;
  type?: string;
  player_name?: string;
  position?: WorldPosition;
  orientation?: {
    heading?: number;
  };
  velocity?: {
    heading?: number;
    speed?: number;
    velocity?: Partial<Vector>;
  };
  group?: {
    name?: string;
    category?: string | number;
  };
}

export interface RadarStreamMessage {
  time?: number | string;
  update?: string;
  unit?: RadarUnit;
  gone?: {
    id: number | string;
  };
}

export interface RadarUnitSample {
  time: number | null;
  unit: RadarUnit;
}

export interface RadarBatch {
  sampleUpdates: Record<string, RadarUnitSample>;
  goneIds: string[];
}

export interface RadarSnapshot {
  samples: Record<string, RadarUnitSample>;
}

export interface DeckPosition {
  fwd: number;
  right: number;
}

export interface ParkingSpot {
  term_index?: number | string;
  position?: WorldPosition | null;
  isLocal?: boolean;
  kind?: 'fixed-wing' | 'helicopter' | 'catapult' | 'stovl';
  /** Clockwise heading relative to the ship bow; starboard is +90 degrees. */
  deckHeadingDegrees?: number;
}

export interface PositionedParkingSpot extends ParkingSpot {
  position: WorldPosition;
}

export function hasParkingPosition(spot: ParkingSpot): spot is PositionedParkingSpot {
  return spot.position !== null && spot.position !== undefined;
}

export function createRadarBatch(message: RadarStreamMessage): RadarBatch | null {
  const time = parseFrameTime(message.time);

  if (message.update === 'unit' && message.unit?.id !== undefined) {
    return {
      sampleUpdates: { [String(message.unit.id)]: { time, unit: message.unit } },
      goneIds: [],
    };
  }

  if (message.update === 'gone' && message.gone?.id !== undefined) {
    return {
      sampleUpdates: {},
      goneIds: [String(message.gone.id)],
    };
  }

  return null;
}

export function appendToRadarBatch(batch: RadarBatch, message: RadarStreamMessage): boolean {
  const addition = createRadarBatch(message);
  if (!addition) return false;

  for (const [id, sample] of Object.entries(addition.sampleUpdates)) {
    batch.sampleUpdates[id] = sample;
    batch.goneIds = batch.goneIds.filter((goneId) => goneId !== id);
  }
  for (const id of addition.goneIds) {
    delete batch.sampleUpdates[id];
    if (!batch.goneIds.includes(id)) batch.goneIds.push(id);
  }
  return true;
}

export function applyRadarBatch(snapshot: RadarSnapshot, batch: RadarBatch): RadarSnapshot {
  const samples = { ...snapshot.samples, ...batch.sampleUpdates };
  for (const id of batch.goneIds) delete samples[id];

  return { samples };
}

export function unitsFromRadarSnapshot(snapshot: RadarSnapshot): Record<string, RadarUnit> {
  return Object.fromEntries(
    Object.entries(snapshot.samples).map(([id, sample]) => [id, sample.unit]),
  );
}

export function findDeckShip(
  units: Record<string, RadarUnit>,
  expectedName: string,
  lockedUnitId: string | null,
  fallbackPosition: WorldPosition | null,
): RadarUnit | null {
  const candidates = Object.values(units).filter((unit) => unit.position);
  const expected = normalizeName(expectedName);

  const exactMatch = candidates.find((unit) => {
    const nameMatches = normalizeName(unit.name) === expected;
    const groupMatches = normalizeName(unit.group?.name) === expected;
    const categoryKnown = unit.group?.category !== undefined;
    return (nameMatches || groupMatches) && (isShipUnit(unit) || !categoryKnown);
  });
  if (exactMatch) return exactMatch;

  if (lockedUnitId !== null) {
    const locked = units[lockedUnitId];
    if (locked?.position && isShipUnit(locked)) return locked;
  }

  if (!fallbackPosition) return null;

  let nearestShip: RadarUnit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const unit of candidates) {
    if (!isShipUnit(unit) || !unit.position) continue;
    const distance = Math.hypot(
      unit.position.u - fallbackPosition.u,
      unit.position.v - fallbackPosition.v,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestShip = unit;
    }
  }

  return nearestDistance < MAX_SHIP_ACQUISITION_DISTANCE_METERS ? nearestShip : null;
}

export function worldToDeck(
  position: WorldPosition,
  shipPosition: WorldPosition,
  shipHeadingDegrees: number,
): DeckPosition {
  const headingRadians = shipHeadingDegrees * Math.PI / 180;
  const north = position.v - shipPosition.v;
  const east = position.u - shipPosition.u;

  return {
    fwd: north * Math.cos(headingRadians) + east * Math.sin(headingRadians),
    right: -north * Math.sin(headingRadians) + east * Math.cos(headingRadians),
  };
}

export function synchronizedDeckPosition(
  unitSample: RadarUnitSample,
  shipSample: RadarUnitSample,
  shipHeadingDegrees: number,
): DeckPosition | null {
  const targetTime = latestSampleTime(unitSample.time, shipSample.time);
  const unitPosition = projectSamplePosition(unitSample, targetTime);
  const shipPosition = projectSamplePosition(shipSample, targetTime);
  if (!unitPosition || !shipPosition) return null;
  return worldToDeck(unitPosition, shipPosition, shipHeadingDegrees);
}

export function nearestShipId(
  unitSample: RadarUnitSample,
  samples: Record<string, RadarUnitSample>,
): string | null {
  let nearestId: string | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const [id, shipSample] of Object.entries(samples)) {
    if (!isShipUnit(shipSample.unit) || id === String(unitSample.unit.id)) continue;
    const targetTime = latestSampleTime(unitSample.time, shipSample.time);
    const unitPosition = projectSamplePosition(unitSample, targetTime);
    const shipPosition = projectSamplePosition(shipSample, targetTime);
    if (!unitPosition || !shipPosition) continue;
    const distance = Math.hypot(
      unitPosition.u - shipPosition.u,
      unitPosition.v - shipPosition.v,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = id;
    }
  }

  return nearestId;
}

export function isAircraftUnit(unit: RadarUnit): boolean {
  const category = String(unit.group?.category ?? '').toUpperCase();
  return category.includes('AIRPLANE') || category.includes('HELICOPTER');
}

export function isHelicopterUnit(unit: RadarUnit): boolean {
  const category = String(unit.group?.category ?? '').toUpperCase();
  return category.includes('HELICOPTER');
}

export function parkingSpotSupportsUnit(spot: ParkingSpot, unit: RadarUnit): boolean {
  if (!spot.kind) return true;
  return isHelicopterUnit(unit)
    ? spot.kind === 'helicopter'
    : spot.kind !== 'helicopter';
}

export function deckIconRotationRadians(
  unit: RadarUnit,
  parkedSpot: ParkingSpot | null,
  deckFacesUp: boolean,
): number {
  const canvasShipForward = deckFacesUp ? 0 : Math.PI / 2;
  const relativeHeadingDegrees = isHelicopterUnit(unit)
    ? 0
    : parkedSpot?.deckHeadingDegrees ?? -90;
  return canvasShipForward + relativeHeadingDegrees * Math.PI / 180;
}

export function relativeHorizontalSpeed(unit: RadarUnit, ship: RadarUnit): number {
  const unitVector = unit.velocity?.velocity;
  const shipVector = ship.velocity?.velocity;
  if (hasHorizontalComponents(unitVector) && hasHorizontalComponents(shipVector)) {
    return Math.hypot(unitVector.x - shipVector.x, unitVector.z - shipVector.z);
  }

  const unitVelocity = horizontalVectorFromHeading(unit.velocity);
  const shipVelocity = horizontalVectorFromHeading(ship.velocity);
  if (!unitVelocity || !shipVelocity) return 0;
  return Math.hypot(unitVelocity.north - shipVelocity.north, unitVelocity.east - shipVelocity.east);
}

export function smoothingAlpha(relativeSpeedMetersPerSecond: number): number {
  const speedRatio = Math.min(
    Math.max(relativeSpeedMetersPerSecond, 0) / FULL_RESPONSE_RELATIVE_SPEED_MPS,
    1,
  );
  return MIN_SMOOTHING_ALPHA
    + (MAX_SMOOTHING_ALPHA - MIN_SMOOTHING_ALPHA) * speedRatio;
}

function parseFrameTime(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function projectSamplePosition(
  sample: RadarUnitSample,
  targetTime: number | null,
): WorldPosition | null {
  const position = sample.unit.position;
  if (!position) return null;
  if (sample.time === null || targetTime === null) return position;

  const elapsedSeconds = Math.min(
    Math.max(targetTime - sample.time, 0),
    MAX_SAMPLE_PROJECTION_SECONDS,
  );
  const vector = horizontalVelocityVector(sample.unit);
  if (!vector || elapsedSeconds === 0) return position;

  return {
    u: position.u + vector.east * elapsedSeconds,
    v: position.v + vector.north * elapsedSeconds,
  };
}

function latestSampleTime(first: number | null, second: number | null): number | null {
  if (first === null) return second;
  if (second === null) return first;
  return Math.max(first, second);
}

function normalizeName(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}

function isShipUnit(unit: RadarUnit): boolean {
  const category = String(unit.group?.category ?? '').toLocaleUpperCase();
  return category.includes('SHIP');
}

function horizontalVelocityVector(unit: RadarUnit): { north: number; east: number } | null {
  const vector = unit.velocity?.velocity;
  if (hasHorizontalComponents(vector)) return { north: vector.x, east: vector.z };
  return horizontalVectorFromHeading(unit.velocity);
}

function hasHorizontalComponents(
  vector: Partial<Vector> | undefined,
): vector is Partial<Vector> & Pick<Vector, 'x' | 'z'> {
  return Number.isFinite(vector?.x) && Number.isFinite(vector?.z);
}

function horizontalVectorFromHeading(velocity: RadarUnit['velocity']): {
  north: number;
  east: number;
} | null {
  if (!Number.isFinite(velocity?.heading) || !Number.isFinite(velocity?.speed)) return null;
  const headingRadians = velocity!.heading! * Math.PI / 180;
  return {
    north: velocity!.speed! * Math.cos(headingRadians),
    east: velocity!.speed! * Math.sin(headingRadians),
  };
}
