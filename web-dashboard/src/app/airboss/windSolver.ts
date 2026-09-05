// Turn-into-wind solver for the Airboss planner.
//
// This is a line-for-line port of `CarrierRecovery.solve` in
// `rust-web-dashboard/lua/carrier_recovery.lua`, the controller that actually
// steers the ship. Both implementations are pinned to the same fixture,
// `docs/src/fixtures/wind_solver_cases.json`, so the page prediction and the
// in-game behaviour cannot drift apart silently.

export type SolverRegime = 'optimal' | 'vmax_limited' | 'vmin_limited' | 'low_wind' | 'weak_wind';

export interface SolverInput {
  /** Natural wind direction the wind blows FROM, degrees true. */
  windFromDeg: number;
  windSpeedKt: number;
  /** Wanted wind over the angled deck. */
  targetWodKt: number;
  /** Angled-deck offset to port, degrees (0 for a straight deck). */
  deckOffsetDeg: number;
  minSpeedKt: number;
  maxSpeedKt: number;
  /** Below this wind speed the ship keeps its course and only adjusts speed. */
  angledDeckMinWindKt: number;
  /** Current ship course, used by the weak-wind rule. Defaults to the wind direction. */
  headingDeg?: number;
  /** Headwind component on the current course, used by the weak-wind rule. */
  naturalHeadwindKt?: number;
}

export interface SolverResult {
  headingDeg: number;
  speedKt: number;
  regime: SolverRegime;
}

/** Ship limits used by the controller when the mission does not override them. */
export const SHIP_DEFAULTS = {
  targetWodKt: 24,
  deckOffsetDeg: 9.14,
  minSpeedKt: 10,
  maxSpeedKt: 30,
  angledDeckMinWindKt: 3,
} as const;

export const REGIME_LABELS: Record<SolverRegime, string> = {
  optimal: 'OPTIMAL',
  vmax_limited: 'VMAX LIMITED',
  vmin_limited: 'VMIN LIMITED',
  low_wind: 'LOW WIND',
  weak_wind: 'WEAK WIND',
};

export function toRad(deg: number): number { return deg * Math.PI / 180; }
export function toDeg(rad: number): number { return rad * 180 / Math.PI; }
export function compassStr(deg: number): string { return deg.toFixed(1).padStart(5, '0') + '°'; }

/** Floored modulo, matching Lua's `%` for a positive divisor. */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function normalizeHeadingDeg(heading: number): number {
  return mod(heading, 360);
}

/** Smallest absolute difference between two headings, degrees. */
export function headingDiff(a: number, b: number): number {
  return Math.abs(mod(a - b + 180, 360) - 180);
}

export function solveIntoWind(input: SolverInput): SolverResult {
  const windFromDeg = normalizeHeadingDeg(input.windFromDeg);
  const windSpeedKt = input.windSpeedKt;
  const targetWod = input.targetWodKt;
  const minSpeed = input.minSpeedKt;
  const maxSpeed = input.maxSpeedKt;
  const angledDeckMinWindKt = input.angledDeckMinWindKt;
  const offset = input.deckOffsetDeg;
  const headingDeg = input.headingDeg === undefined ? windFromDeg : normalizeHeadingDeg(input.headingDeg);
  const naturalHeadwindKt = input.naturalHeadwindKt ?? windSpeedKt * Math.cos(toRad(windFromDeg - headingDeg));

  let recoveryHeadingDeg = windFromDeg;
  let recoverySpeedKt = targetWod - windSpeedKt;
  let regime: SolverRegime = 'optimal';

  if (windSpeedKt >= angledDeckMinWindKt) {
    const windto = mod(windFromDeg + 180, 360);
    const alpha = toRad(offset);

    const C = Math.sqrt(Math.pow(Math.cos(alpha), 2) / Math.pow(Math.sin(alpha), 2) + 1);
    const vdeckMax = windSpeedKt + Math.cos(alpha) * maxSpeed;
    const vdeckMin = windSpeedKt + Math.cos(alpha) * minSpeed;

    let v = 0;
    let theta = 0;

    if (targetWod > vdeckMax) {
      v = maxSpeed;
      let arg = v / (windSpeedKt * C);
      if (arg > 1) arg = 1; else if (arg < -1) arg = -1;
      theta = Math.asin(arg) - Math.asin(-1 / C);
      regime = 'vmax_limited';
    } else if (targetWod < vdeckMin) {
      v = minSpeed;
      let arg = v / (windSpeedKt * C);
      if (arg > 1) arg = 1; else if (arg < -1) arg = -1;
      theta = Math.asin(arg) - Math.asin(-1 / C);
      regime = 'vmin_limited';
    } else if (targetWod * Math.sin(alpha) > windSpeedKt) {
      theta = Math.PI / 2;
      const sq = targetWod * targetWod - windSpeedKt * windSpeedKt;
      v = Math.sqrt(sq > 0 ? sq : 0);
      regime = 'low_wind';
    } else {
      theta = Math.asin((targetWod * Math.sin(alpha)) / windSpeedKt);
      v = targetWod * Math.cos(alpha) - windSpeedKt * Math.cos(theta);
      regime = 'optimal';
    }

    recoveryHeadingDeg = mod(540 + windto + toDeg(theta), 360);
    recoverySpeedKt = v;
  } else {
    // With weak wind, aligning the relative airflow with the angled deck can
    // demand a large, pointless course change. Keep the course and compensate
    // with ship speed using the actual headwind component.
    recoveryHeadingDeg = headingDeg;
    recoverySpeedKt = targetWod - naturalHeadwindKt;
    regime = 'weak_wind';
  }
  if (recoverySpeedKt < minSpeed) recoverySpeedKt = minSpeed;
  if (recoverySpeedKt > maxSpeed) recoverySpeedKt = maxSpeed;

  return { headingDeg: normalizeHeadingDeg(recoveryHeadingDeg), speedKt: recoverySpeedKt, regime };
}

export interface ApparentWind {
  /** Direction the apparent wind comes FROM, degrees. */
  fromDeg: number;
  speedKt: number;
  /** Angle between the apparent wind and the angled-deck axis (0 = straight down the deck). */
  deckAngleDeg: number;
}

/** Apparent wind produced by a ship course and speed in a natural wind. */
export function apparentWind(
  windFromDeg: number,
  windSpeedKt: number,
  shipHeadingDeg: number,
  shipSpeedKt: number,
  deckOffsetDeg: number,
): ApparentWind {
  const wx = windSpeedKt * Math.sin(toRad(windFromDeg));
  const wy = windSpeedKt * Math.cos(toRad(windFromDeg));
  const sx = shipSpeedKt * Math.sin(toRad(shipHeadingDeg));
  const sy = shipSpeedKt * Math.cos(toRad(shipHeadingDeg));
  const ax = wx + sx;
  const ay = wy + sy;
  const speedKt = Math.sqrt(ax * ax + ay * ay);
  const fromDeg = normalizeHeadingDeg(toDeg(Math.atan2(ax, ay)));
  const deckHeading = normalizeHeadingDeg(shipHeadingDeg - deckOffsetDeg);
  const deckAngleDeg = mod(fromDeg - deckHeading + 540, 360) - 180;
  return { fromDeg, speedKt, deckAngleDeg };
}
