"use client";

// Airboss page: a sidebar with the detected carrier list and a scrollable row
// of per-carrier panels (wheel + deck), plus the manual planner. The page owns
// what is shared: the radar stream, the carrier list, the batched telemetry
// poll for synced ships, image preloading and per-mission persistence.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { AIRCRAFT_ICON_FILES } from './aircraftIcons';
import {
  RADAR_BATCH_SETTLE_MS,
  appendToRadarBatch,
  applyRadarBatch,
  createRadarBatch,
  unitsFromRadarSnapshot,
  type RadarBatch,
  type RadarSnapshot,
  type RadarStreamMessage,
} from './deckTracking';
import { DECK_PROFILE_IMAGES } from './deckProfiles';
import { useCarrierList } from './useCarrierList';
import { coalitionLabel, deckClassLabel } from './carrierDetection';
import {
  DEFAULT_PANEL_SETTINGS,
  emptyLayout,
  loadLayout,
  saveLayout,
  type PanelSettings,
  type PersistedLayout,
} from './carrierPersistence';
import {
  AIRBOSS_POLL_INTERVAL_MS,
  isRecoveryPhase,
  isReportError,
  phaseLabel,
  type AirbossReport,
  type AirbossReportEntry,
} from './airbossApi';
import { CarrierPanel, type CarrierPanelCarrier } from './CarrierPanel';
import { PlannerPanel } from './PlannerPanel';
import './airboss.css';

/** Same character set the backend accepts for a group name. */
const GROUP_NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/;

export default function AirbossPlanner() {
  // --- Shared assets ------------------------------------------------------------
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({});
  const [planeIcons, setPlaneIcons] = useState<Record<string, HTMLImageElement>>({});

  useEffect(() => {
    DECK_PROFILE_IMAGES.forEach((src) => {
      const img = new window.Image();
      img.onload = () => setImages((prev) => ({ ...prev, [src]: img }));
      img.src = src;
    });
  }, []);

  // Preload all dedicated aircraft and helicopter deck icons.
  useEffect(() => {
    AIRCRAFT_ICON_FILES.forEach((name) => {
      const img = new Image();
      img.onload = () => setPlaneIcons((prev) => ({ ...prev, [name]: img }));
      img.src = `/icon/${name}`;
    });
  }, []);

  // --- Radar stream (shared by every panel, always on while the page is open) ---
  const [radarSnapshot, setRadarSnapshot] = useState<RadarSnapshot>({ samples: {} });
  const pendingRadarBatch = useRef<RadarBatch | null>(null);
  const radarFrameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const radarUnits = useMemo(() => unitsFromRadarSnapshot(radarSnapshot), [radarSnapshot]);

  useEffect(() => {
    const source = new EventSource('/api/radar/stream');

    const commitPendingBatch = () => {
      const batch = pendingRadarBatch.current;
      if (!batch) return;
      pendingRadarBatch.current = null;
      setRadarSnapshot((previous) => applyRadarBatch(previous, batch));
    };

    const scheduleFrameCommit = () => {
      if (radarFrameTimer.current) clearTimeout(radarFrameTimer.current);
      radarFrameTimer.current = setTimeout(commitPendingBatch, RADAR_BATCH_SETTLE_MS);
    };

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as RadarStreamMessage;
        const nextBatch = createRadarBatch(data);
        if (!nextBatch) return;
        if (!pendingRadarBatch.current) {
          pendingRadarBatch.current = nextBatch;
        } else {
          appendToRadarBatch(pendingRadarBatch.current, data);
        }
        scheduleFrameCommit();
      } catch (err) {
        console.error('Radar stream parse error', err);
      }
    };

    return () => {
      if (radarFrameTimer.current) clearTimeout(radarFrameTimer.current);
      pendingRadarBatch.current = null;
      source.close();
    };
  }, []);

  // --- Carrier list -------------------------------------------------------------
  const { carriers, loading: carriersLoading, error: carriersError, refreshedAt, refresh } = useCarrierList(radarUnits);

  // --- Persistence (per mission) -------------------------------------------------
  const [missionName, setMissionName] = useState<string | null>(null);
  const [layout, setLayout] = useState<PersistedLayout>(emptyLayout);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let name = 'unknown';
      try {
        const res = await apiFetch('/api/mission');
        const data = await res.json();
        if (typeof data.currentMission === 'string' && data.currentMission && data.currentMission !== 'Unknown') {
          name = data.currentMission;
        }
      } catch (err) {
        console.error('Failed to read the mission name', err);
      }
      if (cancelled) return;
      setMissionName(name);
      setLayout(loadLayout(typeof window === 'undefined' ? null : window.localStorage, name));
      setLayoutReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!layoutReady) return;
    saveLayout(typeof window === 'undefined' ? null : window.localStorage, missionName, layout);
  }, [layout, layoutReady, missionName]);

  const settingsFor = useCallback(
    (group: string): PanelSettings => layout.panels[group] ?? DEFAULT_PANEL_SETTINGS,
    [layout.panels],
  );

  const updatePanel = useCallback((group: string, patch: Partial<PanelSettings>) => {
    setLayout((prev) => ({
      ...prev,
      panels: {
        ...prev.panels,
        [group]: { ...(prev.panels[group] ?? DEFAULT_PANEL_SETTINGS), ...patch },
      },
    }));
  }, []);

  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const addManualCarrier = () => {
    const name = addName.trim();
    if (!GROUP_NAME_PATTERN.test(name)) {
      setAddError('Use letters, digits, spaces, "_", "." or "-" (1 to 64 characters).');
      return;
    }
    setAddError(null);
    setAddName('');
    setLayout((prev) => ({
      ...prev,
      manualNames: prev.manualNames.includes(name) ? prev.manualNames : [...prev.manualNames, name],
      panels: { ...prev.panels, [name]: { ...(prev.panels[name] ?? DEFAULT_PANEL_SETTINGS), show: true } },
    }));
  };

  const removeManualCarrier = (name: string) => {
    setLayout((prev) => ({ ...prev, manualNames: prev.manualNames.filter((item) => item !== name) }));
  };

  // --- Panels ---------------------------------------------------------------------
  const panelCarriers: CarrierPanelCarrier[] = useMemo(() => {
    const detectedNames = new Set(carriers.map((carrier) => carrier.group));
    return [
      ...carriers.map((carrier): CarrierPanelCarrier => ({
        group: carrier.group,
        type: carrier.type,
        coalition: carrier.coalition,
        deckClass: carrier.deck_class,
        backend: carrier.backend,
        deckOffset: carrier.deck_offset,
        manual: false,
      })),
      ...layout.manualNames
        .filter((name) => !detectedNames.has(name))
        .map((name): CarrierPanelCarrier => ({
          group: name, type: null, coalition: null, deckClass: null, backend: null, deckOffset: null, manual: true,
        })),
    ];
  }, [carriers, layout.manualNames]);

  const visiblePanels = panelCarriers.filter((carrier) => settingsFor(carrier.group).show);
  const syncedNames = visiblePanels
    .filter((carrier) => settingsFor(carrier.group).sync)
    .map((carrier) => carrier.group);
  const syncedKey = syncedNames.join(',');

  // --- Batched telemetry poll: one request per interval for every synced ship ---
  const [reports, setReports] = useState<Record<string, AirbossReport>>({});
  const [reportErrors, setReportErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!syncedKey) return;
    const names = syncedKey.split(',');
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await apiFetch(`/api/airboss?names=${encodeURIComponent(syncedKey)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          const message: string = data.error || `HTTP ${res.status}`;
          setReportErrors((prev) => {
            const next = { ...prev };
            for (const name of names) next[name] = message;
            return next;
          });
          return;
        }
        const entries = (data.reports ?? {}) as Record<string, AirbossReportEntry>;
        setReports((prev) => {
          let next = prev;
          for (const [name, entry] of Object.entries(entries)) {
            if (isReportError(entry)) continue;
            if (next === prev) next = { ...prev };
            next[name] = entry;
          }
          return next;
        });
        setReportErrors((prev) => {
          const next = { ...prev };
          for (const name of names) {
            const entry = entries[name];
            if (!entry) next[name] = 'No report returned for this ship';
            else if (isReportError(entry)) next[name] = entry.error;
            else delete next[name];
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch airboss reports', err);
      }
    };

    void tick();
    const intervalId = setInterval(tick, AIRBOSS_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [syncedKey]);

  // --- Summary --------------------------------------------------------------------
  const phaseFor = (group: string): string | null => {
    const report = reports[group];
    if (report) return report.recovery_phase;
    return carriers.find((carrier) => carrier.group === group)?.recovery_phase ?? null;
  };
  const inRecovery = panelCarriers.filter((carrier) => isRecoveryPhase(phaseFor(carrier.group))).length;

  return (
    <div className="airboss-container">
      <div className="ab-topbar">
        <div className="ab-tb-title">Airboss Planner</div>
        <div className="ab-tb-sep"></div>
        <div className="ab-tb-sub">CARRIER OPERATIONS</div>
        <div className="ab-tb-sep"></div>
        <div className="ab-tb-sub">DCS NAVAL OPS</div>
        {missionName && (
          <div className="ab-tb-mission" title="Panel layout is remembered per mission">
            {missionName}
          </div>
        )}
      </div>

      <div className="ab-main">
        <div className="ab-sidebar">
          <div className="ab-sec-hdr ab-sec-hdr-row">
            <span>Carriers</span>
            <button className="ab-mini-btn" onClick={() => void refresh()} disabled={carriersLoading} title="Re-scan the mission for carrier groups (one Eval)">
              {carriersLoading ? 'Scanning…' : 'Refresh'}
            </button>
          </div>
          <div className="ab-summary">
            {carriers.length} detected · {syncedNames.length} synced · {inRecovery} in recovery
            {refreshedAt && <span className="ab-summary-time"> · scanned {new Date(refreshedAt).toLocaleTimeString([], { hour12: false })}</span>}
          </div>
          {carriersError && <div className="ab-panel-message error">{carriersError}</div>}
          {!carriersLoading && !carriersError && carriers.length === 0 && (
            <div className="ab-sidebar-hint">No carrier-type ship group found in the mission. Add one by name below if detection missed a hull.</div>
          )}
          <ul className="ab-carrier-list">
            {carriers.map((carrier) => {
              const settings = settingsFor(carrier.group);
              const phase = phaseFor(carrier.group);
              return (
                <li key={carrier.group} className={`ab-carrier-row${settings.show ? '' : ' hidden'}`}>
                  <label className="ab-carrier-show">
                    <input
                      type="checkbox"
                      checked={settings.show}
                      onChange={(event) => updatePanel(carrier.group, { show: event.target.checked })}
                    />
                    <span className="ab-carrier-name">{carrier.group}</span>
                  </label>
                  <div className="ab-carrier-meta">
                    <span className={`ab-badge ${carrier.coalition === 1 ? 'red' : carrier.coalition === 2 ? 'blue' : 'neutral'}`}>{coalitionLabel(carrier.coalition)}</span>
                    <span className="ab-badge dim">{carrier.type}</span>
                    <span className="ab-badge dim">{deckClassLabel(carrier.deck_class)}</span>
                    {settings.show && settings.sync && <span className="ab-badge ok">SYNC</span>}
                    {isRecoveryPhase(phase) && <span className="ab-badge active">{phaseLabel(phase)}</span>}
                  </div>
                </li>
              );
            })}
            {layout.manualNames
              .filter((name) => !carriers.some((carrier) => carrier.group === name))
              .map((name) => {
                const settings = settingsFor(name);
                return (
                  <li key={`manual:${name}`} className={`ab-carrier-row${settings.show ? '' : ' hidden'}`}>
                    <label className="ab-carrier-show">
                      <input
                        type="checkbox"
                        checked={settings.show}
                        onChange={(event) => updatePanel(name, { show: event.target.checked })}
                      />
                      <span className="ab-carrier-name">{name}</span>
                    </label>
                    <div className="ab-carrier-meta">
                      <span className="ab-badge dim">BY NAME</span>
                      {settings.show && settings.sync && <span className="ab-badge ok">SYNC</span>}
                      <button className="ab-mini-btn" onClick={() => removeManualCarrier(name)} title="Remove this name">×</button>
                    </div>
                  </li>
                );
              })}
          </ul>

          <div className="ab-sec-hdr mt">Add by name</div>
          <div className="ab-add-row">
            <input
              type="text"
              className="ab-text-input"
              placeholder="Group name, e.g. CVN-74"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') addManualCarrier(); }}
            />
            <button className="ab-mini-btn" onClick={addManualCarrier} disabled={!addName.trim()}>Add</button>
          </div>
          {addError && <div className="ab-panel-message error">{addError}</div>}
          <div className="ab-sidebar-hint">For hulls detection misses. The panel works the same; the deck falls back to a generic outline until the ship reports its type.</div>

          <div className="ab-sec-hdr mt">Tools</div>
          <label className="ab-carrier-show ab-planner-toggle">
            <input
              type="checkbox"
              checked={layout.showPlanner}
              onChange={(event) => setLayout((prev) => ({ ...prev, showPlanner: event.target.checked }))}
            />
            <span className="ab-carrier-name">Manual planner</span>
          </label>

          <div className="ab-sec-hdr mt">Legend</div>
          <div className="ab-legend">
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: '#fff' }}></div>Req. BRC</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: '#ffd600' }}></div>Angled Deck Centerline</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: '#00d4ff' }}></div>True Wind Vector</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: '#39d353' }}></div>Req. Ship Velocity</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: 'rgba(57,211,83,.5)' }}></div>Actual Ship Velocity</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{ background: '#ff3b3b' }}></div>Apparent Wind (WOD)</div>
            <div className="ab-legend-tip">Sync a panel to poll that ship&apos;s wind (one request per interval for all synced ships). Deck views and headings come from the radar stream at no extra cost.</div>
          </div>
        </div>

        <div className="ab-panels">
          {visiblePanels.map((carrier) => (
            <CarrierPanel
              key={carrier.group}
              carrier={carrier}
              settings={settingsFor(carrier.group)}
              onSettingsChange={(patch) => updatePanel(carrier.group, patch)}
              onDismiss={() => (carrier.manual ? removeManualCarrier(carrier.group) : updatePanel(carrier.group, { show: false }))}
              report={reports[carrier.group] ?? null}
              reportError={reportErrors[carrier.group] ?? null}
              radarSnapshot={radarSnapshot}
              images={images}
              planeIcons={planeIcons}
            />
          ))}
          {layout.showPlanner && (
            <PlannerPanel
              images={images}
              onClose={() => setLayout((prev) => ({ ...prev, showPlanner: false }))}
            />
          )}
          {visiblePanels.length === 0 && !layout.showPlanner && (
            <div className="ab-empty">
              {carriersLoading
                ? 'Scanning the mission for carriers…'
                : 'No carrier panel shown. Tick a carrier in the sidebar, add one by name, or open the manual planner.'}
            </div>
          )}
        </div>
      </div>

      <div className="ab-sbar">
        CARRIERS:&nbsp;<span className="ab-sbar-ok">{carriers.length} detected</span>
        &nbsp;·&nbsp; {syncedNames.length} synced &nbsp;·&nbsp; <span style={{ color: inRecovery ? 'var(--yel)' : 'inherit' }}>{inRecovery} in recovery</span>
        &nbsp;·&nbsp; DCS CARRIER OPS
      </div>
    </div>
  );
}
