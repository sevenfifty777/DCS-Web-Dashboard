// Carrier detection helpers shared by the page and its tests. The
// authoritative list comes from `GET /api/airboss/carriers` (the Lua
// controller reads DCS attributes); these helpers decide when the radar
// stream, which is free, suggests that list is stale.

import type { RadarUnit } from './deckTracking';
import type { DeckClass } from './deckProfiles';

/** One row of `GET /api/airboss/carriers`. */
export interface DetectedCarrier {
  group: string;
  unit: string;
  type: string;
  coalition: number;
  deck_class: DeckClass;
  attributes: string[];
  deck_offset: number;
  target_wod: number;
  backend: string;
  recovery_phase: string;
}

/**
 * Type-name fragments (case-insensitive) that mark a ship as a probable
 * carrier. Mirrors `CarrierRecovery.carrierTypeHints` in the Lua module.
 */
export const CARRIER_TYPE_HINTS = [
  'CVN', 'CV_', 'CV-', 'LHA', 'LHD', 'Carrier', 'Invincible', 'Essex', 'Ark',
  'Kuznetsov', 'KUZNECOW', '1143', 'Stennis', 'Forrestal', 'Tarawa', 'Juan_Carlos',
  'Type_071', 'Hermes', 'Clemenceau', 'Charles', 'Wasp', 'America',
] as const;

/** Minimum spacing between radar-triggered list refreshes. */
export const CARRIER_REFRESH_MIN_INTERVAL_MS = 30_000;

export function typeNameLooksLikeCarrier(typeName: string | null | undefined): boolean {
  const name = (typeName ?? '').toLowerCase();
  if (!name) return false;
  return CARRIER_TYPE_HINTS.some((hint) => name.includes(hint.toLowerCase()));
}

export function isShipUnit(unit: RadarUnit): boolean {
  return String(unit.group?.category ?? '').toUpperCase().includes('SHIP');
}

/**
 * Group names of ships in the radar snapshot whose type hints at a carrier
 * but that the detected list does not know. A non-empty result means a
 * carrier spawned since the last `GET /api/airboss/carriers`.
 */
export function unknownCarrierGroupsInRadar(
  units: Record<string, RadarUnit>,
  knownGroups: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const unit of Object.values(units)) {
    if (!isShipUnit(unit) || !typeNameLooksLikeCarrier(unit.type)) continue;
    const groupName = unit.group?.name?.trim();
    if (!groupName || knownGroups.has(groupName)) continue;
    found.add(groupName);
  }
  return Array.from(found).sort();
}

export function coalitionLabel(coalition: number | null | undefined): string {
  switch (coalition) {
    case 1: return 'RED';
    case 2: return 'BLUE';
    case 0: return 'NEUTRAL';
    default: return '—';
  }
}

export function deckClassLabel(deckClass: DeckClass | string | null | undefined): string {
  switch (deckClass) {
    case 'catobar': return 'CATOBAR';
    case 'stobar': return 'STOBAR';
    case 'vstol': return 'VSTOL';
    case 'unknown': return 'UNCLASSIFIED';
    default: return 'SHIP';
  }
}
