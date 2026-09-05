// Shapes returned by the airboss routes (`rust-web-dashboard/src/routes/dcs.rs`).

import type { DeckClass } from './deckProfiles';
import type { SolverRegime } from './windSolver';

/** Poll interval for the batched telemetry request while at least one panel is synced. */
export const AIRBOSS_POLL_INTERVAL_MS = 2_000;

/** Bounds of the per-carrier target WOD control (the backend rejects 10 to 45 kt exclusive). */
export const TARGET_WOD_MIN_KT = 15;
export const TARGET_WOD_MAX_KT = 40;
export const TARGET_WOD_STEP_KT = 0.5;

/** Placeholder presets until the VSTOL doctrine phase lands. */
export const TARGET_WOD_PRESETS = [
  { label: 'CATOBAR 24', value: 24 },
  { label: 'VSTOL 20', value: 20 },
] as const;

/** One report from `GET /api/airboss` (single name) or one entry of `reports` (batched). */
export interface AirbossReport {
  carrier_name: string;
  type_name: string;
  deck_class?: DeckClass | null;
  coalition: number;
  recovery_phase: string;
  /** Ship position, DCS map coordinates (x north, z east). */
  carrier_u: number;
  carrier_v: number;
  brc: number;
  ship_spd: number;
  tw_dir: number;
  tw_spd: number;
  headwind: number;
  wod: number;
  target_wod: number;
  recovery_heading: number;
  recovery_speed: number;
  regime: SolverRegime;
  deck_offset: number;
  min_speed: number;
  max_speed: number;
  angled_deck_min_wind: number;
  backend: string;
}

export interface AirbossReportError {
  error: string;
}

export type AirbossReportEntry = AirbossReport | AirbossReportError;

export function isReportError(entry: AirbossReportEntry | null | undefined): entry is AirbossReportError {
  return Boolean(entry) && typeof (entry as AirbossReportError).error === 'string';
}

/** Status table returned by POST /api/airboss/action with action=status. */
export interface RecoveryStatus {
  carrier_name: string;
  backend: string;
  phase: string;
  state: string;
  course: number;
  wind_from: number;
  wind_speed: number;
  headwind: number;
  wod: number;
  ship_speed: number;
  recovery_heading: number;
  recovery_speed: number;
  regime: string;
  target_wod?: number;
  deck_offset?: number;
  remaining_sec: number;
}

export type CarrierAction = 'start' | 'resume' | 'status';

export function formatRemaining(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case 'pending': return 'TURN PENDING';
    case 'aligning': return 'TURNING INTO WIND';
    case 'active': return 'RECOVERY ACTIVE';
    case 'normal': return 'NORMAL CIRCUIT';
    default: return '';
  }
}

export function isRecoveryPhase(phase: string | null | undefined): boolean {
  return phase === 'pending' || phase === 'aligning' || phase === 'active';
}
