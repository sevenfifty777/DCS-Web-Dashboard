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
  /** Shorthand as Discord shows it; null for rows older than LSO migration 8. */
  lso_notation: string | null;
  lso_notes: string | null;
  /** `dcs` or `measured` (LSO wrote the notation because DCS wrote none). */
  lso_notes_source: string | null;
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
  /** Case ED's Marshal orders: `I`, `II`, `III` or `indeterminate`; null before LSO migration 9. */
  ordered_case: string | null;
  /** Case from NATOPS minima; diagnostic only. */
  natops_case: string | null;
  /** NATOPS night window at the carrier; null when unknown. */
  night: boolean | null;
  /** `overhead_pattern`, `straight_in` or `unknown`; null for V/STOL. */
  flown_approach: string | null;
}

export interface LsoPassesResponse {
  passes: LsoPass[];
  total: number;
}

/** One pilot's slice of `/api/lso/pilots`; mirrors `LsoPilot` in `rust-web-dashboard/src/lso.rs`. */
export interface LsoPilot {
  /** Name on the pilot's newest pass. Pilots are grouped by UCID server-side; the UCID is never sent. */
  pilot_name: string;
  /** Other names seen on earlier passes of the same pilot. */
  aliases: string[];
  total_passes: number;
  graded_passes: number;
  avg_points: number | null;
  last_pass_at: string;
  /** Newest first, truncated to the requested per-pilot limit. */
  passes: LsoPass[];
}

export interface LsoPilotsResponse {
  pilots: LsoPilot[];
  per_pilot_limit: number | null;
  total_passes: number;
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

/**
 * Readable form of the pass file stem `LSO-YYYYMMDD-HHMMSS-<pilot>-<recovery-id>`:
 * `YYYY-MM-DD HH:MM:SS`. Anything that does not follow that shape (test rows,
 * older clients) is returned unchanged so nothing is hidden.
 */
export function shortTimestamp(stem: string): string {
  const m = /^LSO-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/.exec(stem);
  if (!m) return stem;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

/** Which LSO community graded the pass: STOVL Harriers recover on Tarawa under USMC LSOs. */
export type ServiceBranch = 'usmc' | 'usn';

export function serviceBranch(aircraftType: string | null | undefined): ServiceBranch {
  return /av-?8b|harrier/i.test(aircraftType ?? '') ? 'usmc' : 'usn';
}

/** Patch image and label for a service branch (served from `/icon`). */
export const SERVICE_BADGE: Record<ServiceBranch, { src: string; label: string }> = {
  usmc: { src: '/icon/lso-usmc.png', label: 'USMC STOVL LSO (AV-8B, Tarawa)' },
  usn: { src: '/icon/lso-usn.png', label: 'US Navy LSO (carrier, arrested)' },
};

/** Cell text for nullable fields, matching the old page's `esc()` fallback. */
export function cell(value: string | number | null | undefined): string {
  return value == null ? '-' : String(value);
}

/** Label Discord appends when LSO, not DCS, wrote the notation. */
export const MEASURED_LABEL = '(measured by LSO, not a DCS comment)';

/**
 * The grading-comment cell, as the Discord embed shows it: the DCS comment, or
 * LSO's measured notation, labelled as such, when DCS wrote none.
 */
export function gradeNotation(
  pass: Pick<LsoPass, 'dcs_grading' | 'lso_notation' | 'lso_notes_source'>,
): string {
  if (pass.dcs_grading != null) return pass.dcs_grading;
  if (pass.lso_notation != null) {
    return pass.lso_notes_source === 'measured'
      ? `${pass.lso_notation} ${MEASURED_LABEL}`
      : pass.lso_notation;
  }
  return '-';
}

/** The notes cell; measured notes carry the same label as in Discord. */
export function notesText(pass: Pick<LsoPass, 'lso_notes' | 'lso_notes_source'>): string {
  if (pass.lso_notes == null) return '-';
  return pass.lso_notes_source === 'measured'
    ? `${pass.lso_notes} ${MEASURED_LABEL}`
    : pass.lso_notes;
}

type CaseFields = Pick<LsoPass, 'ordered_case' | 'natops_case' | 'night' | 'flown_approach'>;

const KNOWN_CASES = new Set(['I', 'II', 'III']);

/**
 * Recovery case as the Discord "Recovery" field shows it, e.g. `Case III (night)`;
 * `-` when the case is indeterminate or was not assessed (rows before LSO migration 9).
 */
export function recoveryCase(pass: Pick<LsoPass, 'ordered_case' | 'night'>): string {
  if (!pass.ordered_case || !KNOWN_CASES.has(pass.ordered_case)) return '-';
  const label = `Case ${pass.ordered_case}`;
  return pass.night === true ? `${label} (night)` : label;
}

const FLOWN_LABELS: Record<string, string> = {
  overhead_pattern: 'overhead pattern',
  straight_in: 'straight-in',
  unknown: 'unknown',
};

/**
 * Whether the flown approach contradicts the ordered case (LSO's
 * `approach_does_not_match_ordered_case` diagnostic, never a penalty):
 * a break in Case III, or a straight-in in Case I/II.
 */
export function approachMismatch(pass: Pick<LsoPass, 'ordered_case' | 'flown_approach'>): boolean {
  if (pass.ordered_case === 'III') return pass.flown_approach === 'overhead_pattern';
  if (pass.ordered_case === 'I' || pass.ordered_case === 'II') {
    return pass.flown_approach === 'straight_in';
  }
  return false;
}

/** Tooltip for the case cell: ordered case, NATOPS diagnostic and flown approach. */
export function recoveryCaseDetail(pass: CaseFields): string {
  if (pass.ordered_case == null) return 'Recovery case not assessed (pass recorded before LSO migration 9)';
  const lines = [`Ordered (ED weather rule): ${pass.ordered_case}`];
  if (pass.natops_case) lines.push(`NATOPS minima: ${pass.natops_case}`);
  if (pass.night != null) lines.push(pass.night ? 'Night (NATOPS window)' : 'Day');
  if (pass.flown_approach) {
    lines.push(`Flown: ${FLOWN_LABELS[pass.flown_approach] ?? pass.flown_approach}`);
  }
  if (approachMismatch(pass)) lines.push('Flown approach does not match the ordered case (not a penalty)');
  return lines.join('\n');
}

/** Best to worst as a greenie board reads: `_OK_` highest, cut pass lowest. */
const GRADE_RANK: Record<string, number> = {
  '_OK_': 6,
  'OK': 5,
  '(OK)': 4,
  '--': 3,
  'B': 2,
  'WO': 1,
  'C': 0,
};

/** Sort key for the grade column; null for grades outside the NAVAIR set. */
export function gradeRank(grade: string | null | undefined): number | null {
  if (!grade) return null;
  return GRADE_RANK[grade] ?? null;
}

const CASE_RANK: Record<string, number> = { I: 1, II: 2, III: 3 };

/** Sort key for the case column: I < II < III, a night pass just after its day case. */
export function caseRank(pass: Pick<LsoPass, 'ordered_case' | 'night'>): number | null {
  const rank = pass.ordered_case ? CASE_RANK[pass.ordered_case] : undefined;
  if (rank === undefined) return null;
  return rank * 2 + (pass.night === true ? 1 : 0);
}

/** Case-insensitive pilot filter; a pilot's aliases match too. */
export function matchesPilot(
  pass: Pick<LsoPass, 'pilot_name'> & { aliases?: string[] },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (pass.pilot_name.toLowerCase().includes(needle)) return true;
  return (pass.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
}
