"use client";

// One panel per carrier: header, Sync + Carrier Actions, Target WOD control,
// the wind wheel drawn from this ship's telemetry, and its deck view fed by
// the shared radar snapshot. Owns every piece of per-ship state so the page
// only coordinates the list, the batched poll and persistence.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import {
  REGIME_LABELS,
  SHIP_DEFAULTS,
  apparentWind,
  compassStr,
  solveIntoWind,
} from './windSolver';
import {
  findDeckShip,
  unitsFromRadarSnapshot,
  type DeckPosition,
  type RadarSnapshot,
  type RadarUnit,
  type WorldPosition,
} from './deckTracking';
import { deckRouteHitTargetAt, type DeckLaunchRoute, type DeckRouteHitTarget } from './deckRoutes';
import { deckProfileForType, type DeckClass } from './deckProfiles';
import { ROUTE_FLOW_CYCLE_MS, drawDeckRouteFlow, drawDeckView } from './deckRenderer';
import { drawWindWheel } from './wheelRenderer';
import { coalitionLabel, deckClassLabel } from './carrierDetection';
import type { PanelSettings } from './carrierPersistence';
import {
  TARGET_WOD_MAX_KT,
  TARGET_WOD_MIN_KT,
  TARGET_WOD_PRESETS,
  TARGET_WOD_STEP_KT,
  formatRemaining,
  isRecoveryPhase,
  phaseLabel,
  type AirbossReport,
  type CarrierAction,
  type RecoveryStatus,
} from './airbossApi';
import { DeckSpotLegend } from './DeckSpotLegend';

const KNOTS_PER_MPS = 1.94384449;
const WHEEL_SIZE_PX = 480;
const TARGET_SEND_DEBOUNCE_MS = 400;
export const ROUTE_INSTRUCTION = 'White dashed ring: no route assigned. Click a spot or aircraft to inspect routes.';

/** What the page knows about a carrier before (or without) any telemetry. */
export interface CarrierPanelCarrier {
  group: string;
  type: string | null;
  coalition: number | null;
  deckClass: DeckClass | null;
  backend: string | null;
  deckOffset: number | null;
  /** Added by name rather than detected. */
  manual: boolean;
}

interface CarrierPanelProps {
  carrier: CarrierPanelCarrier;
  settings: PanelSettings;
  onSettingsChange: (patch: Partial<PanelSettings>) => void;
  /** Hide (detected) or remove (manual) this panel. */
  onDismiss: () => void;
  /** Last good report from the batched poll, kept by the page while unsynced. */
  report: AirbossReport | null;
  /** Error from the last poll for this ship, if any. */
  reportError: string | null;
  radarSnapshot: RadarSnapshot;
  images: Record<string, HTMLImageElement>;
  planeIcons: Record<string, HTMLImageElement>;
}

interface SelectedRoutes {
  selectionId: string;
  routeIds: string[];
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

export function CarrierPanel({
  carrier, settings, onSettingsChange, onDismiss, report, reportError,
  radarSnapshot, images, planeIcons,
}: CarrierPanelProps) {
  const wheelCanvasRef = useRef<HTMLCanvasElement>(null);
  const deckCanvasRef = useRef<HTMLCanvasElement>(null);
  const routeEffectCanvasRef = useRef<HTMLCanvasElement>(null);
  const hitTargetsRef = useRef<DeckRouteHitTarget[]>([]);
  const smoothedRef = useRef<Record<string, DeckPosition>>({});
  const lockedUnitIdRef = useRef<string | null>(null);
  const lastSentTargetRef = useRef<number | null>(null);

  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoutes | null>(null);
  const [routeMessage, setRouteMessage] = useState(ROUTE_INSTRUCTION);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus | null>(null);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [everSeen, setEverSeen] = useState(false);
  const [lostAt, setLostAt] = useState<number | null>(null);

  const radarUnits = useMemo(() => unitsFromRadarSnapshot(radarSnapshot), [radarSnapshot]);

  const typeName = report?.type_name ?? carrier.type;
  const deckClass = report?.deck_class ?? carrier.deckClass;
  const profile = useMemo(() => deckProfileForType(typeName, deckClass), [typeName, deckClass]);
  const shipImage = profile.imageSrc ? images[profile.imageSrc] ?? null : null;
  const backend = report?.backend ?? carrier.backend;
  const coalition = report?.coalition ?? carrier.coalition;
  const phase = report?.recovery_phase ?? null;

  // The controller reports DCS map coordinates (u = x north, z east); the
  // radar stream uses easting/northing, so swap for the fallback position.
  const reportNorth = report?.carrier_u;
  const reportEast = report?.carrier_v;
  const fallbackPosition: WorldPosition | null = useMemo(
    () => (reportNorth !== undefined && reportEast !== undefined ? { u: reportEast, v: reportNorth } : null),
    [reportNorth, reportEast],
  );

  const streamShip: RadarUnit | null = useMemo(
    () => findDeckShip(radarUnits, carrier.group, null, fallbackPosition),
    [radarUnits, carrier.group, fallbackPosition],
  );
  const streamFound = streamShip !== null;
  const streamHeading = streamShip?.orientation?.heading;
  const streamSpeed = streamShip?.velocity?.speed;
  const actualHeading = typeof streamHeading === 'number' && Number.isFinite(streamHeading)
    ? streamHeading
    : report?.brc ?? null;
  const actualSpeedKt = typeof streamSpeed === 'number' && Number.isFinite(streamSpeed)
    ? streamSpeed * KNOTS_PER_MPS
    : report?.ship_spd ?? null;

  const radarHasShips = useMemo(
    () => Object.values(radarUnits).some((unit) => String(unit.group?.category ?? '').toUpperCase().includes('SHIP')),
    [radarUnits],
  );
  // The radar stream only carries units that changed since the page connected,
  // so a stationary ship may never appear in it. While synced, the controller
  // poll is the authority: the ship is lost when the poll says it is gone.
  // Unsynced, it is lost when the stream had it before and dropped it.
  const goneFromMission = reportError !== null && /is not available/i.test(reportError);
  const lost = !streamFound && radarHasShips && (settings.sync ? goneFromMission : everSeen);
  const headingFromController = !streamFound && report !== null && !lost;

  useEffect(() => {
    if (!streamFound) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot transitions when the ship (re)appears in the stream.
    setEverSeen(true);
    setLostAt(null);
  }, [streamFound]);

  useEffect(() => {
    if (!lost) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- records when the ship left the stream for the LOST tag.
    setLostAt((previous) => previous ?? Date.now());
  }, [lost]);

  // --- Target wind over deck -------------------------------------------------

  const classDefaultTarget = deckClass === 'vstol' ? 20 : SHIP_DEFAULTS.targetWodKt;
  const targetWod = settings.targetWod ?? report?.target_wod ?? classDefaultTarget;

  useEffect(() => {
    const target = settings.targetWod;
    if (target === null || target === lastSentTargetRef.current) return;
    const handle = setTimeout(async () => {
      try {
        const res = await apiFetch('/api/airboss/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carrier: carrier.group, target_wod: target }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          lastSentTargetRef.current = target;
          setTargetStatus(`Ship target ${Number(data.target_wod ?? target).toFixed(1)} kt`);
        } else {
          setTargetStatus(`Failed: ${data.error || `HTTP ${res.status}`}`);
        }
      } catch (err) {
        setTargetStatus(`Error: ${err}`);
      }
    }, TARGET_SEND_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [settings.targetWod, carrier.group]);

  const setTarget = (value: number) => {
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(TARGET_WOD_MAX_KT, Math.max(TARGET_WOD_MIN_KT, value));
    onSettingsChange({ targetWod: Math.round(clamped / TARGET_WOD_STEP_KT) * TARGET_WOD_STEP_KT });
  };

  // --- Wind solution for the wheel ---------------------------------------------

  const windFromDeg = report?.tw_dir ?? 0;
  const windSpeedKt = report?.tw_spd ?? 0;
  const deckOffset = report?.deck_offset ?? carrier.deckOffset ?? profile.deckOffsetDeg;
  const limits = {
    minSpeedKt: report?.min_speed ?? SHIP_DEFAULTS.minSpeedKt,
    maxSpeedKt: report?.max_speed ?? SHIP_DEFAULTS.maxSpeedKt,
    angledDeckMinWindKt: report?.angled_deck_min_wind ?? SHIP_DEFAULTS.angledDeckMinWindKt,
  };
  const planned = solveIntoWind({
    windFromDeg,
    windSpeedKt,
    targetWodKt: targetWod,
    deckOffsetDeg: deckOffset,
    ...limits,
    headingDeg: actualHeading ?? undefined,
  });
  const apparent = apparentWind(windFromDeg, windSpeedKt, planned.headingDeg, planned.speedKt, deckOffset);
  const deckHeading = (planned.headingDeg - deckOffset + 360) % 360;
  const wheelTag = lost
    ? `LOST${lostAt ? ` · SINCE ${formatClock(lostAt)}` : ''}`
    : !settings.sync
      ? (report ? 'NOT SYNCED · LAST WIND' : 'NOT SYNCED · NO WIND DATA')
      : reportError
        ? 'POLL ERROR'
        : report
          ? (headingFromController ? 'STATIC · HEADING FROM CONTROLLER' : null)
          : 'WAITING FOR TELEMETRY';

  // --- Actions ----------------------------------------------------------------

  const handleAction = async (action: CarrierAction) => {
    setActionStatus('Sending command...');
    try {
      const res = await apiFetch('/api/airboss/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, carrier: carrier.group }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (action === 'status') {
          setRecoveryStatus(data as RecoveryStatus);
          setActionStatus(null);
        } else {
          setRecoveryStatus(null);
          setActionStatus(action === 'start'
            ? `Turn into wind ordered for ${carrier.group}`
            : `${carrier.group} is resuming its normal circuit`);
          setTimeout(() => setActionStatus(null), 8000);
        }
      } else {
        // 409 (already active / not active) and 422 (unsafe leg) are the
        // controller declining, not a failure of the dashboard.
        const prefix = res.status === 409 || res.status === 422 ? 'Refused' : 'Failed';
        setActionStatus(`${prefix}: ${data.error || `HTTP ${res.status}`}`);
        setTimeout(() => setActionStatus(null), 10000);
      }
    } catch (e) {
      setActionStatus(`Error: ${e}`);
      setTimeout(() => setActionStatus(null), 8000);
    }
  };

  function handleDeckClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
    const hitTarget = deckRouteHitTargetAt(hitTargetsRef.current, x, y);

    if (!hitTarget) {
      setSelectedRoutes(null);
      setRouteMessage(ROUTE_INSTRUCTION);
      return;
    }
    if (!hitTarget.selectionId) {
      setSelectedRoutes(null);
      setRouteMessage(hitTarget.message);
      return;
    }
    const isAlreadySelected = selectedRoutes?.selectionId === hitTarget.selectionId;
    setSelectedRoutes(isAlreadySelected ? null : {
      selectionId: hitTarget.selectionId,
      routeIds: hitTarget.routeIds,
    });
    setRouteMessage(isAlreadySelected ? ROUTE_INSTRUCTION : hitTarget.message);
  }

  // --- Drawing ----------------------------------------------------------------

  useEffect(() => {
    drawWindWheel(wheelCanvasRef.current, {
      carrierImage: shipImage,
      imageBowHeadingDeg: profile.imageBowHeadingDeg,
      windFromDeg,
      windSpeedKt,
      plannedHeadingDeg: planned.headingDeg,
      plannedSpeedKt: planned.speedKt,
      deckHeadingDeg: deckHeading,
      apparentFromDeg: apparent.fromDeg,
      apparentSpeedKt: apparent.speedKt,
      actualHeadingDeg: actualHeading,
      actualSpeedKt,
      dimmed: lost || !settings.sync,
      tag: wheelTag,
    });
  }, [
    shipImage, profile.imageBowHeadingDeg, windFromDeg, windSpeedKt, planned.headingDeg, planned.speedKt,
    deckHeading, apparent.fromDeg, apparent.speedKt, actualHeading, actualSpeedKt, lost, settings.sync, wheelTag,
  ]);

  useEffect(() => {
    const result = drawDeckView(deckCanvasRef.current, {
      profile,
      shipImage,
      shipName: carrier.group,
      fallbackPosition,
      fallbackHeading: report?.brc ?? null,
      lockedUnitId: lockedUnitIdRef.current,
      smoothed: smoothedRef.current,
      radarSnapshot,
      radarUnits,
      selectedSelectionId: selectedRoutes?.selectionId ?? null,
      selectedRouteIds: selectedRoutes?.routeIds ?? [],
      planeIcons,
      dimmed: lost,
    });
    hitTargetsRef.current = result.hitTargets;
    if (result.shipUnitId !== null) lockedUnitIdRef.current = result.shipUnitId;
  }, [profile, shipImage, carrier.group, fallbackPosition, report?.brc, radarSnapshot, radarUnits, selectedRoutes, planeIcons, lost]);

  useEffect(() => {
    const routes = (selectedRoutes?.routeIds ?? [])
      .map((routeId) => profile.routeById[routeId])
      .filter((route): route is DeckLaunchRoute => route !== undefined);
    const canvas = routeEffectCanvasRef.current;
    const length = profile.lengthMeters;

    let animationFrameId: number | null = null;
    let animationStart: number | null = null;
    const animateRouteFlow = (timestamp: number) => {
      animationStart ??= timestamp;
      const elapsed = timestamp - animationStart;
      if (elapsed >= ROUTE_FLOW_CYCLE_MS) {
        drawDeckRouteFlow(canvas, [], length, 0);
        animationFrameId = null;
        return;
      }
      drawDeckRouteFlow(canvas, routes, length, elapsed);
      animationFrameId = window.requestAnimationFrame(animateRouteFlow);
    };

    if (routes.length) {
      animationFrameId = window.requestAnimationFrame(animateRouteFlow);
    } else {
      drawDeckRouteFlow(canvas, [], length, 0);
    }
    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, [selectedRoutes, profile]);

  // --- Render -----------------------------------------------------------------

  const coalitionClass = coalition === 1 ? 'red' : coalition === 2 ? 'blue' : 'neutral';

  return (
    <section className={`ab-panel${lost ? ' lost' : ''}${settings.sync ? ' synced' : ''}`} aria-label={`${carrier.group} panel`}>
      <header className="ab-panel-header">
        <div className="ab-panel-title-row">
          <span className="ab-panel-title">{carrier.group}</span>
          <button className="ab-panel-dismiss" onClick={onDismiss} title={carrier.manual ? 'Remove this carrier' : 'Hide this carrier'}>
            {carrier.manual ? 'Remove' : 'Hide'}
          </button>
        </div>
        <div className="ab-panel-badges">
          <span className={`ab-badge ${coalitionClass}`}>{coalitionLabel(coalition)}</span>
          <span className="ab-badge">{typeName || 'UNKNOWN TYPE'}</span>
          <span className="ab-badge">{deckClassLabel(deckClass)}</span>
          {backend && <span className="ab-badge dim">{backend.toUpperCase()}</span>}
          {isRecoveryPhase(phase) && <span className="ab-badge active">{phaseLabel(phase)}</span>}
          {lost && <span className="ab-badge warn">LOST</span>}
        </div>
        <div className="ab-panel-profile">{profile.label}</div>
      </header>

      <div className="ab-panel-controls">
        <label className={`ab-sync-toggle${settings.sync ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={settings.sync}
            onChange={(event) => onSettingsChange({ sync: event.target.checked })}
          />
          <span className="ab-autosync-indicator" />
          Sync
        </label>
        <button className="ab-autosync-btn ab-action" onClick={() => handleAction('start')}>
          Turn into Wind
        </button>
        <button className="ab-autosync-btn ab-action resume" onClick={() => handleAction('resume')}>
          Resume Circuit
        </button>
        <button className="ab-autosync-btn ab-action status" onClick={() => handleAction('status')}>
          Check Status
        </button>
      </div>
      {actionStatus && (
        <div className={`ab-panel-message${actionStatus.startsWith('Failed') || actionStatus.startsWith('Error') ? ' error' : ''}`}>
          {actionStatus}
        </div>
      )}
      {reportError && settings.sync && (
        <div className="ab-panel-message error">{reportError}</div>
      )}
      {recoveryStatus && (
        <div className="ab-results ab-panel-status">
          <div className="ab-res-row">
            <span className="ab-res-label">{recoveryStatus.carrier_name}</span>
            <span className="ab-res-val" style={{ color: recoveryStatus.phase === 'normal' ? 'var(--txt-dim)' : 'var(--yel)' }}>{recoveryStatus.state}</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Controller</span>
            <span className="ab-res-val">{recoveryStatus.backend}</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Course · Speed</span>
            <span className="ab-res-val">{compassStr(recoveryStatus.course)} · {recoveryStatus.ship_speed.toFixed(1)} kts</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Natural Wind</span>
            <span className="ab-res-val">{compassStr(recoveryStatus.wind_from)} · {recoveryStatus.wind_speed.toFixed(1)} kts</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Headwind · WOD</span>
            <span className="ab-res-val">{recoveryStatus.headwind.toFixed(1)} · {recoveryStatus.wod.toFixed(1)} kts</span>
          </div>
          {typeof recoveryStatus.target_wod === 'number' && (
            <div className="ab-res-row">
              <span className="ab-res-label">Target WOD</span>
              <span className="ab-res-val" style={{ color: 'var(--red)' }}>{recoveryStatus.target_wod.toFixed(1)} kts</span>
            </div>
          )}
          <div className="ab-res-row">
            <span className="ab-res-label">Will Steer</span>
            <span className="ab-res-val" style={{ color: 'var(--grn)' }}>{compassStr(recoveryStatus.recovery_heading)} · {recoveryStatus.recovery_speed.toFixed(0)} kts</span>
          </div>
          {recoveryStatus.remaining_sec > 0 && (
            <div className="ab-res-row">
              <span className="ab-res-label">Window Remaining</span>
              <span className="ab-res-val">{formatRemaining(recoveryStatus.remaining_sec)}</span>
            </div>
          )}
          <button
            className="ab-autosync-btn"
            style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
            onClick={() => setRecoveryStatus(null)}
          >
            Close
          </button>
        </div>
      )}

      <div className="ab-panel-target">
        <div className="ab-ctrl-row">
          <span className="ab-ctrl-label" style={{ color: 'var(--red)' }}>Target WOD</span>
          <span className="ab-target-input">
            <input
              type="number"
              min={TARGET_WOD_MIN_KT}
              max={TARGET_WOD_MAX_KT}
              step={TARGET_WOD_STEP_KT}
              value={targetWod}
              onChange={(event) => setTarget(parseFloat(event.target.value))}
              aria-label={`${carrier.group} target wind over deck`}
            />
            <span className="ab-ctrl-val" style={{ color: 'var(--red)' }}>kts</span>
          </span>
        </div>
        <input
          type="range"
          className="target"
          min={TARGET_WOD_MIN_KT}
          max={TARGET_WOD_MAX_KT}
          step={TARGET_WOD_STEP_KT}
          value={targetWod}
          onChange={(event) => setTarget(parseFloat(event.target.value))}
          aria-label={`${carrier.group} target wind over deck slider`}
        />
        <div className="ab-target-presets">
          {TARGET_WOD_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={`ab-preset${targetWod === preset.value ? ' active' : ''}`}
              onClick={() => setTarget(preset.value)}
            >
              {preset.label}
            </button>
          ))}
          <span className="ab-target-status">
            {targetStatus ?? (report ? `Ship uses ${report.target_wod.toFixed(1)} kt` : '')}
          </span>
        </div>
      </div>

      <canvas ref={wheelCanvasRef} className="ab-wheel" width={WHEEL_SIZE_PX} height={WHEEL_SIZE_PX} />

      <div className="ab-results ab-panel-readout">
        <div className="ab-res-row">
          <span className="ab-res-label">Natural Wind</span>
          <span className="ab-res-val" style={{ color: 'var(--acc)' }}>
            {report ? `${compassStr(report.tw_dir)} · ${report.tw_spd.toFixed(1)} kts` : '—'}
          </span>
        </div>
        <div className="ab-res-row">
          <span className="ab-res-label">Actual Course · Speed</span>
          <span className="ab-res-val">
            {actualHeading !== null ? compassStr(actualHeading) : '—'}
            {actualSpeedKt !== null ? ` · ${actualSpeedKt.toFixed(1)} kts` : ''}
          </span>
        </div>
        <div className="ab-res-row" title={REGIME_LABELS[planned.regime]}>
          <span className="ab-res-label">Page Plan (BRC · Speed)</span>
          <span className="ab-res-val" style={{ color: 'var(--grn)' }}>{compassStr(planned.headingDeg)} · {planned.speedKt.toFixed(1)} kts</span>
        </div>
        {report && (
          <div className="ab-res-row" title={`In-game controller (${report.backend}), ${REGIME_LABELS[report.regime] ?? report.regime}`}>
            <span className="ab-res-label">Controller Would Steer</span>
            <span className="ab-res-val">{compassStr(report.recovery_heading)} · {report.recovery_speed.toFixed(0)} kts</span>
          </div>
        )}
        <div className="ab-res-row">
          <span className="ab-res-label">Angled Deck · WOD</span>
          <span className="ab-res-val"><span className="deck">{compassStr(deckHeading)}</span> · <span className="wod-spd">{apparent.speedKt.toFixed(1)} kts</span></span>
        </div>
      </div>

      <div className={`ab-route-status${selectedRoutes ? ' active' : ''}`}>
        <span className="ab-route-status-line" />
        {routeMessage}
      </div>
      <DeckSpotLegend />
      <div className="ab-deck-canvas-stack">
        <canvas
          ref={deckCanvasRef}
          width={profile.deckCanvasWidth}
          height={profile.deckCanvasHeight}
          onClick={handleDeckClick}
          className="ab-interactive-deck"
        />
        <canvas
          ref={routeEffectCanvasRef}
          width={profile.deckCanvasWidth}
          height={profile.deckCanvasHeight}
          className="ab-deck-route-effects"
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
