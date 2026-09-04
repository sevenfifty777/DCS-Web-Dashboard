// Pure display helpers for the LSO greenie board.
//
// These port the inline JavaScript of the DCS-gRPC-lso client's former web
// page (`src/web.rs`, `DASHBOARD_HTML`) one to one so the dashboard page shows
// exactly the same cells for the same rows. Keep them free of React and DOM
// access so they stay testable with `node --test`.

/** One row of `/api/lso/passes`; mirrors `LsoPass` in `rust-web-dashboard/src/lso.rs`. */
export interface LsoPass {
  id: number;
  timestamp: string;
  pilot_name: string;
  aircraft_id: number | null;
  pass_grade: string;
  wire: number | null;
  spot: string | null;
  spot_grade: string | null;
  spot_distance_m: number | null;
  intended_spot: string | null;
  actual_nearest_spot: string | null;
  distance_to_intended_spot_m: number | null;
  dcs_grading: string | null;
  aircraft_type: string | null;
  map_name: string | null;
  lso_notes: string | null;
  grade_date: string;
  grade_points: number | null;
  points_awarded: boolean | null;
  mission_datetime: string;
  outcome: string;
  recovery_id: string | null;
  pilot_kind: string | null;
  carrier_id: number | null;
  carrier_name: string | null;
  carrier_type: string | null;
  recovery_mode: string | null;
  session_id: number | null;
  generation: number | null;
  completeness: string | null;
  max_sample_gap_ms: number | null;
  max_scoring_sample_gap_ms: number | null;
  max_skew_ms: number | null;
  telemetry_health: string | null;
  wire_estimated: number | null;
  wire_dcs: number | null;
  wire_divergent: boolean | null;
  confidence: string | null;
  cause: string | null;
  grading_version: string | null;
  wire_estimation_confidence: string | null;
  grading_availability: string | null;
  arrest_evidence: string | null;
  hook_state: string | null;
}

export interface LsoPassesResponse {
  passes: LsoPass[];
  total: number;
}

export interface LsoStatus {
  configured: boolean;
  db_present: boolean;
  db_path: string | null;
  pass_count: number;
  last_pass_at: string | null;
}

/** CSS-module key for a NAVAIR grade label; empty string for unknown grades. */
export type GradeClass = 'uni' | 'ok' | 'okp' | 'ng' | 'cut' | 'muted' | '';

const GRADE_CLASSES: Record<string, GradeClass> = {
  '_OK_': 'uni',
  'OK': 'ok',
  '(OK)': 'okp',
  '--': 'ng',
  'C': 'cut',
  'B': 'muted',
  'WO': 'muted',
};

/**
 * Legacy project points used only when a row carries no `grade_points`
 * (databases written before migration 3).
 */
const LEGACY_POINTS: Record<string, number> = {
  '_OK_': 5.0,
  'OK': 4.0,
  '(OK)': 3.0,
  '--': 2.0,
  'C': 0.0,
  'B': 2.5,
  'WO': 1.0,
};

export function gradeClass(grade: string | null | undefined): GradeClass {
  if (!grade) return '';
  return GRADE_CLASSES[grade] ?? '';
}

type PointsFields = Pick<LsoPass, 'pass_grade' | 'grade_points' | 'points_awarded'>;

/**
 * Points for a pass, or `undefined` when none were awarded.
 *
 * New rows say explicitly whether points were awarded (`points_awarded`), so an
 * incomplete pass stored with a zero is not shown as a real zero-point grade.
 * Older rows fall back to the stored value, then to the legacy grade table.
 */
export function points(pass: PointsFields): number | undefined {
  if (pass.points_awarded === false) return undefined;
  if (pass.grade_points !== undefined && pass.grade_points !== null) return pass.grade_points;
  return LEGACY_POINTS[pass.pass_grade];
}

/** Points column text: two decimals for V/STOL spot landings, one otherwise, `-` when none. */
export function formatPoints(pass: PointsFields & Pick<LsoPass, 'spot'>): string {
  const value = points(pass);
  if (value === undefined) return '-';
  return Number(value).toFixed(pass.spot != null ? 2 : 1);
}

/** Wire number for CATOBAR recoveries, landing spot for V/STOL, `-` when unknown. */
export function wireOrSpot(pass: Pick<LsoPass, 'wire' | 'spot'>): string {
  if (pass.spot != null) return pass.spot;
  if (pass.wire != null) return String(pass.wire);
  return '-';
}

/** Whether the technical grading was available for this pass. */
export function technicalStatus(pass: Pick<LsoPass, 'completeness'>): string {
  if (pass.completeness === 'complete') return 'Available';
  return `Unavailable — ${pass.completeness ?? '-'}`;
}

/** Cell text for nullable fields, matching the old page's `esc()` fallback. */
export function cell(value: string | number | null | undefined): string {
  return value == null ? '-' : String(value);
}

/** Case-insensitive pilot filter. */
export function matchesPilot(pass: Pick<LsoPass, 'pilot_name'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return pass.pilot_name.toLowerCase().includes(needle);
}
