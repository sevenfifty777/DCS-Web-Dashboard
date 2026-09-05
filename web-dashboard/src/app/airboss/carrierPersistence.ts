// Layout persistence for the Airboss page: which carriers are shown, which
// are synced and their target wind over deck, stored per mission name so
// reopening the page on the same mission restores the panels without a click.

export interface PanelSettings {
  show: boolean;
  sync: boolean;
  /** Target wind over deck chosen by the user, knots; null until the first report or a user change. */
  targetWod: number | null;
}

export interface PersistedLayout {
  version: 1;
  panels: Record<string, PanelSettings>;
  /** Carriers added by name because detection missed them. */
  manualNames: string[];
  showPlanner: boolean;
}

export const LAYOUT_STORAGE_PREFIX = 'airboss:layout:';

export const DEFAULT_PANEL_SETTINGS: PanelSettings = { show: true, sync: false, targetWod: null };

export function emptyLayout(): PersistedLayout {
  return { version: 1, panels: {}, manualNames: [], showPlanner: false };
}

export function layoutStorageKey(missionName: string | null | undefined): string {
  const mission = (missionName ?? '').trim() || 'unknown';
  return `${LAYOUT_STORAGE_PREFIX}${mission}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse a stored layout; anything malformed yields null rather than throwing. */
export function parseLayout(raw: string | null | undefined): PersistedLayout | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !record.panels || typeof record.panels !== 'object') return null;

  const panels: Record<string, PanelSettings> = {};
  for (const [name, value] of Object.entries(record.panels as Record<string, unknown>)) {
    if (!name.trim() || !value || typeof value !== 'object') continue;
    const settings = value as Record<string, unknown>;
    panels[name] = {
      show: settings.show !== false,
      sync: settings.sync === true,
      targetWod: isFiniteNumber(settings.targetWod) ? settings.targetWod : null,
    };
  }
  const manualNames = Array.isArray(record.manualNames)
    ? Array.from(new Set(
      record.manualNames.filter((item): item is string => typeof item === 'string' && item.trim() !== ''),
    ))
    : [];
  return {
    version: 1,
    panels,
    manualNames,
    showPlanner: record.showPlanner === true,
  };
}

export function serializeLayout(layout: PersistedLayout): string {
  return JSON.stringify(layout);
}

export function loadLayout(storage: Pick<Storage, 'getItem'> | null, missionName: string | null): PersistedLayout {
  if (!storage) return emptyLayout();
  try {
    return parseLayout(storage.getItem(layoutStorageKey(missionName))) ?? emptyLayout();
  } catch {
    return emptyLayout();
  }
}

export function saveLayout(storage: Pick<Storage, 'setItem'> | null, missionName: string | null, layout: PersistedLayout): void {
  if (!storage) return;
  try {
    storage.setItem(layoutStorageKey(missionName), serializeLayout(layout));
  } catch {
    // Storage may be unavailable (private mode, quota); the page still works.
  }
}
