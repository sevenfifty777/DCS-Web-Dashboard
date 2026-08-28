"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import { AIRCRAFT_ICON_FILES, aircraftIconForType } from './aircraftIcons';
import {
  RADAR_BATCH_SETTLE_MS,
  appendToRadarBatch,
  applyRadarBatch,
  createRadarBatch,
  deckIconRotationRadians,
  findDeckShip,
  hasParkingPosition,
  isAircraftUnit,
  nearestShipId,
  parkingSpotSupportsUnit,
  relativeHorizontalSpeed,
  smoothingAlpha,
  synchronizedDeckPosition,
  unitsFromRadarSnapshot,
  worldToDeck,
  type RadarBatch,
  type ParkingSpot,
  type PositionedParkingSpot,
  type RadarSnapshot,
  type RadarStreamMessage,
  type RadarUnit,
  type RadarUnitSample,
} from './deckTracking';
import {
  DECK_SPOT_LEGEND,
  DECK_SPOT_STYLES,
  NIMITZ_SPOTS,
  TARAWA_SPOTS,
} from './deckSpots';
import {
  NIMITZ_LAUNCH_ROUTES,
  NIMITZ_ROUTE_BY_ID,
  NIMITZ_ROUTE_BY_START,
  NIMITZ_ROUTES_BY_LAUNCH,
  TARAWA_LAUNCH_ROUTES,
  TARAWA_ROUTE_BY_ID,
  TARAWA_ROUTE_BY_START,
  TARAWA_ROUTES_BY_LAUNCH,
  deckRoutePointAtProgress,
  deckRouteHitTargetAt,
  hasNoAssignedLaunchRoute,
  nearestLaunchRoute,
  type DeckId,
  type DeckLaunchRoute,
  type DeckRouteHitTarget,
} from './deckRoutes';
import './airboss.css';

const ROUTE_HIT_RADIUS_PX = 11;
const ROUTE_AIRCRAFT_PROXIMITY_METERS = 12;
const ROUTE_FLOW_CYCLE_MS = 2_800;
const ROUTE_SHIMMER_SEGMENTS = 14;
const ROUTE_SHIMMER_LENGTH = 0.075;
const ROUTE_INSTRUCTION = 'White dashed ring: no route assigned. Click a spot or aircraft to inspect routes.';

interface SelectedDeckRoutes {
  deckId: DeckId;
  selectionId: string;
  routeIds: string[];
}

function drawDeckRouteFlow(
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

  const pixelsPerMeter = canvas.height * 0.92 / shipLengthMeters;
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

function DeckSpotLegend() {
  return (
    <div className="ab-deck-spot-legend" aria-label="Deck spot color legend">
      {DECK_SPOT_LEGEND.map((legendItem) => (
        <span className="ab-deck-spot-legend-item" key={legendItem.legendLabel}>
          <span
            className="ab-deck-spot-legend-marker"
            style={{ backgroundColor: legendItem.color }}
          />
          {legendItem.legendLabel}
        </span>
      ))}
    </div>
  );
}

export default function AirbossPlanner() {
  const [twDir, setTwDir] = useState(51);
  const [twSpd, setTwSpd] = useState(6.8);
  const [targetWod, setTargetWod] = useState(25.0);
  const [offset, setOffset] = useState(9);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckCanvasRef = useRef<HTMLCanvasElement>(null);
  const tarawaCanvasRef = useRef<HTMLCanvasElement>(null);
  const carrierRouteEffectCanvasRef = useRef<HTMLCanvasElement>(null);
  const tarawaRouteEffectCanvasRef = useRef<HTMLCanvasElement>(null);
  const carrierHitTargetsRef = useRef<DeckRouteHitTarget[]>([]);
  const tarawaHitTargetsRef = useRef<DeckRouteHitTarget[]>([]);
  const [carrierImg, setCarrierImg] = useState<HTMLImageElement | null>(null);
  const [tarawaImg, setTarawaImg] = useState<HTMLImageElement | null>(null);
  const [planeIcons, setPlaneIcons] = useState<Record<string, HTMLImageElement>>({});
  const [selectedDeckRoutes, setSelectedDeckRoutes] = useState<SelectedDeckRoutes | null>(null);
  const [routeMessage, setRouteMessage] = useState(ROUTE_INSTRUCTION);

  const [autoSync, setAutoSync] = useState(false);
  const [actualBrc, setActualBrc] = useState<number | null>(null);
  const [actualShipSpd, setActualShipSpd] = useState<number | null>(null);

  const [carrierNameInput, setCarrierNameInput] = useState("CVN-72");
  const [carrierName, setCarrierName] = useState<string | null>(null);
  const [carrierPos, setCarrierPos] = useState<{u: number, v: number} | null>(null);
  const parkingSpots = NIMITZ_SPOTS;
  const [radarSnapshot, setRadarSnapshot] = useState<RadarSnapshot>({ samples: {} });
  const pendingRadarBatch = useRef<RadarBatch | null>(null);
  const radarFrameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const radarUnits = useMemo(() => unitsFromRadarSnapshot(radarSnapshot), [radarSnapshot]);
  const [carrierUnitId, setCarrierUnitId] = useState<string | null>(null);
  const smoothedPositions = useRef<Record<string, { fwd: number; right: number }>>({});

  // Tarawa state
  const [tarawaNameInput, setTarawaNameInput] = useState("Tarawa");
  const [tarawaName, setTarawaName] = useState<string | null>(null);
  const [tarawaPos, setTarawaPos] = useState<{u: number, v: number} | null>(null);
  const [tarawaBrc, setTarawaBrc] = useState<number | null>(null);
  const tarawaParkingSpots = TARAWA_SPOTS;
  const [tarawaUnitId, setTarawaUnitId] = useState<string | null>(null);
  const tarawaSmoothedPositions = useRef<Record<string, { fwd: number; right: number }>>({});

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => setCarrierImg(img);
    img.src = '/img/carrier-top-full-transp.png';
    const img2 = new window.Image();
    img2.onload = () => setTarawaImg(img2);
    img2.src = '/img/tarawa-top-full-transp.png';
  }, []);

  // Preload all dedicated aircraft and helicopter deck icons.
  useEffect(() => {
    AIRCRAFT_ICON_FILES.forEach(name => {
      const img = new Image();
      img.onload = () => {
          setPlaneIcons(prev => ({ ...prev, [name]: img }));
      };
      img.src = `/icon/${name}`;
    });
  }, []);

  const [actionStatus, setActionStatus] = useState<string | null>(null);

  function handleDeckClick(
    event: React.MouseEvent<HTMLCanvasElement>,
    deckId: DeckId,
  ) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
    const targets = deckId === 'carrier'
      ? carrierHitTargetsRef.current
      : tarawaHitTargetsRef.current;

    const hitTarget = deckRouteHitTargetAt(targets, x, y);

    if (!hitTarget) {
      setSelectedDeckRoutes(null);
      setRouteMessage(ROUTE_INSTRUCTION);
      return;
    }
    if (!hitTarget.selectionId) {
      setSelectedDeckRoutes(null);
      setRouteMessage(hitTarget.message);
      return;
    }

    const isAlreadySelected = selectedDeckRoutes?.deckId === deckId
      && selectedDeckRoutes.selectionId === hitTarget.selectionId;
    setSelectedDeckRoutes(isAlreadySelected ? null : {
      deckId,
      selectionId: hitTarget.selectionId,
      routeIds: hitTarget.routeIds,
    });
    setRouteMessage(isAlreadySelected ? ROUTE_INSTRUCTION : hitTarget.message);
  }

  useEffect(() => {
    if (!autoSync || !carrierNameInput) return;
    
    const fetchData = async () => {
      try {
        const res = await apiFetch(`/api/airboss?name=${encodeURIComponent(carrierNameInput)}&coalition=3`);
        if (res.ok) {
          const data = await res.json();
          if (data.carrier_name) setCarrierName(data.carrier_name);
          if (data.carrier_u !== undefined && data.carrier_v !== undefined) {
             setCarrierPos({ u: data.carrier_u, v: data.carrier_v });
          }
          setTwDir(data.tw_dir);
          setTwSpd(data.tw_spd);
          setTargetWod(data.target_wod);
          setActualBrc(data.brc);
          setActualShipSpd(data.ship_spd);
        }

      } catch (err) {
        console.error("Failed to fetch airboss data", err);
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 2000);
    return () => clearInterval(intervalId);
  }, [autoSync, carrierNameInput]);

  // Tarawa data fetching (deck view only — no recovery scripts)
  useEffect(() => {
    if (!autoSync || !tarawaNameInput) return;
    const fetchData = async () => {
      try {
        const res = await apiFetch(`/api/airboss?name=${encodeURIComponent(tarawaNameInput)}&coalition=3`);
        if (res.ok) {
          const data = await res.json();
          if (data.carrier_name) setTarawaName(data.carrier_name);
          if (data.carrier_u !== undefined && data.carrier_v !== undefined) {
             setTarawaPos({ u: data.carrier_u, v: data.carrier_v });
          }
          setTarawaBrc(data.brc);
        }
      } catch (err) {
        console.error("Failed to fetch tarawa data", err);
      }
    };
    fetchData();
    const intervalId = setInterval(fetchData, 2000);
    return () => clearInterval(intervalId);
  }, [autoSync, tarawaNameInput]);

  // Subscribe to live radar stream for all unit positions
  useEffect(() => {
    const source = new EventSource('/api/radar/stream');

    const commitPendingBatch = () => {
      const batch = pendingRadarBatch.current;
      if (!batch) return;
      pendingRadarBatch.current = null;
      setRadarSnapshot((previous) => applyRadarBatch(previous, batch));
      for (const goneId of batch.goneIds) {
        delete smoothedPositions.current[goneId];
        delete tarawaSmoothedPositions.current[goneId];
      }
      if (batch.goneIds.length > 0) {
        setCarrierUnitId((previous) => previous && batch.goneIds.includes(previous) ? null : previous);
        setTarawaUnitId((previous) => previous && batch.goneIds.includes(previous) ? null : previous);
      }
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

  const handleAction = async (actionStr: string) => {
    setActionStatus('Sending command...');
    try {
      const res = await apiFetch('/api/airboss/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionStr }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setActionStatus(`${data.message}`);
          setTimeout(() => setActionStatus(null), 15000);
        } else {
          setActionStatus(`Command successful: ${actionStr}`);
          setTimeout(() => setActionStatus(null), 5000);
        }
      } else {
        const err = await res.json();
        setActionStatus(`Failed: ${err.error || 'Unknown error'}`);
        setTimeout(() => setActionStatus(null), 8000);
      }
    } catch (e) {
      setActionStatus(`Error: ${e}`);
      setTimeout(() => setActionStatus(null), 8000);
    }
  };

  function toRad(deg: number) { return deg * Math.PI / 180; }
  function toDeg(rad: number) { return rad * 180 / Math.PI; }
  function compassStr(deg: number) { return deg.toFixed(1).padStart(5, '0') + '°'; }

  // --- AIRBOSS GET HEADING INTO WIND NEW ---
  function getHeadingIntoWind(twDir: number, twSpd: number, vdeck: number, offset: number) {
    const Vmin = 4;
    const Vmax = 33; // Carrier max speed constraint

    if (twSpd < 0.1) {
      return { brc: twDir, shipSpd: Math.min(vdeck, Vmax), status: 'NO WIND' };
    }

    const windto = (twDir + 180) % 360;
    const alpha = toRad(offset); // positive offset for port angle

    const C = Math.sqrt(Math.pow(Math.cos(alpha), 2) / Math.pow(Math.sin(alpha), 2) + 1);

    const vdeckMax = twSpd + Math.cos(alpha) * Vmax;
    const vdeckMin = twSpd + Math.cos(alpha) * Vmin;

    let v = 0;
    let theta = 0;
    let status = 'OPTIMAL';

    if (vdeck > vdeckMax) {
      v = Vmax;
      let arg = v / (twSpd * C);
      if (arg > 1) arg = 1; if (arg < -1) arg = -1;
      theta = Math.asin(arg) - Math.asin(-1 / C);
      status = 'VMAX LIMITED';
    } else if (vdeck < vdeckMin) {
      v = Vmin;
      let arg = v / (twSpd * C);
      if (arg > 1) arg = 1; if (arg < -1) arg = -1;
      theta = Math.asin(arg) - Math.asin(-1 / C);
      status = 'VMIN LIMITED';
    } else if (vdeck * Math.sin(alpha) > twSpd) {
      theta = Math.PI / 2;
      const sq = vdeck * vdeck - twSpd * twSpd;
      v = Math.sqrt(sq > 0 ? sq : 0);
      status = 'LOW WIND';
    } else {
      theta = Math.asin((vdeck * Math.sin(alpha)) / twSpd);
      v = vdeck * Math.cos(alpha) - twSpd * Math.cos(theta);
    }

    const brc = (540 + windto + toDeg(theta)) % 360;
    return { brc, shipSpd: v, status };
  }

  const calc = getHeadingIntoWind(twDir, twSpd, targetWod, offset);
  const brc = calc.brc;
  const shipSpd = calc.shipSpd;

  // ── FORWARD CALCULATION TO VERIFY ──
  const xTw = twSpd   * Math.sin(toRad(twDir));
  const yTw = twSpd   * Math.cos(toRad(twDir));
  const xSh = shipSpd * Math.sin(toRad(brc));
  const ySh = shipSpd * Math.cos(toRad(brc));

  const xWod  = xTw + xSh;
  const yWod  = yTw + ySh;
  const wodSpd = Math.sqrt(xWod * xWod + yWod * yWod);
  let wodDir   = toDeg(Math.atan2(xWod, yWod));
  if (wodDir < 0) wodDir += 360;

  const deckHdg = (brc - offset + 360) % 360;

  // DRAWING
  /* eslint-disable react-hooks/immutability -- Canvas rendering intentionally mutates 2D contexts and click-target refs inside this effect. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    function getXY(angleDeg: number, length: number) {
      const r = toRad(angleDeg - 90);
      return { x: cx + length * Math.cos(r), y: cy + length * Math.sin(r) };
    }

    function drawArrow(angleDeg: number, length: number, color: string, lineWidth: number) {
      if (length <= 0.5) return;
      const end = getXY(angleDeg, length);
      ctx!.save();
      ctx!.strokeStyle = color;
      ctx!.lineWidth   = lineWidth;
      ctx!.beginPath();
      ctx!.moveTo(cx, cy);
      ctx!.lineTo(end.x, end.y);
      ctx!.stroke();
      const r = toRad(angleDeg - 90);
      ctx!.fillStyle = color;
      ctx!.beginPath();
      ctx!.moveTo(end.x, end.y);
      ctx!.lineTo(end.x - 13 * Math.cos(r - Math.PI / 6), end.y - 13 * Math.sin(r - Math.PI / 6));
      ctx!.lineTo(end.x - 13 * Math.cos(r + Math.PI / 6), end.y - 13 * Math.sin(r + Math.PI / 6));
      ctx!.closePath();
      ctx!.fill();
      ctx!.restore();
    }

    function drawDashedLine(angleDeg: number, color: string, alpha: number) {
      const end   = getXY(angleDeg,       cx - 22);
      const start = getXY(angleDeg + 180, cx - 22);
      ctx!.save();
      ctx!.globalAlpha   = alpha;
      ctx!.strokeStyle   = color;
      ctx!.lineWidth     = 1.5;
      ctx!.setLineDash([7, 7]);
      ctx!.beginPath();
      ctx!.moveTo(start.x, start.y);
      ctx!.lineTo(end.x,   end.y);
      ctx!.stroke();
      ctx!.restore();
    }

    function drawCarrier(brcAngle: number, isActual: boolean = true) {
      if (!carrierImg || !carrierImg.complete || !carrierImg.naturalWidth) return;
      const targetW = canvas!.width * 0.60;
      const scale   = targetW / carrierImg.naturalWidth;
      const dw = carrierImg.naturalWidth  * scale;
      const dh = carrierImg.naturalHeight * scale;
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(toRad(brcAngle - 270));
      if (!isActual) {
        ctx!.globalAlpha = 0.3;
      }
      ctx!.drawImage(carrierImg, -dw / 2, -dh / 2, dw, dh);
      ctx!.restore();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    bgGrad.addColorStop(0, '#0c1a26');
    bgGrad.addColorStop(1, '#050b12');
    ctx.beginPath();
    ctx.arc(cx, cy, cx, 0, 2 * Math.PI);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, cx - 2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,212,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, cx - 62, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(0,212,255,.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (let i = 0; i < 360; i += 10) {
      const isCardinal = (i % 90 === 0);
      const isMajor    = (i % 30 === 0);
      const outerR = cx - 4;
      const innerR = outerR - (isCardinal ? 22 : isMajor ? 14 : 7);
      const a = toRad(i - 90);
      ctx.beginPath();
      ctx.moveTo(cx + outerR * Math.cos(a), cy + outerR * Math.sin(a));
      ctx.lineTo(cx + innerR * Math.cos(a), cy + innerR * Math.sin(a));
      ctx.strokeStyle = isCardinal ? 'rgba(0,212,255,.85)' : isMajor ? 'rgba(0,212,255,.45)' : 'rgba(0,212,255,.18)';
      ctx.lineWidth = isCardinal ? 2 : 1;
      ctx.stroke();
    }

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = "9px 'Share Tech Mono', monospace";
    ctx.fillStyle    = 'rgba(0,212,255,.5)';
    for (let i = 30; i < 360; i += 30) {
      if (i % 90 === 0) continue;
      const a = toRad(i - 90);
      const r = cx - 34;
      ctx.fillText(String(i).padStart(3, '0'), cx + r * Math.cos(a), cy + r * Math.sin(a));
    }

    ctx.font = "bold 13px 'Share Tech Mono', monospace";
    [{ d: 0, l: 'N' }, { d: 90, l: 'E' }, { d: 180, l: 'S' }, { d: 270, l: 'W' }].forEach(({ d, l }) => {
      const a = toRad(d - 90);
      const r = cx - 30;
      ctx.fillStyle = (l === 'N') ? '#ffd600' : 'rgba(0,212,255,.9)';
      ctx.fillText(l, cx + r * Math.cos(a), cy + r * Math.sin(a));
    });

    if (autoSync && actualBrc !== null) {
      drawCarrier(actualBrc, true);
      drawCarrier(brc, false);
    } else {
      drawCarrier(brc, true);
    }

    const maxSpd = Math.max(wodSpd, twSpd, shipSpd, 10);
    const vScale = (cx - 80) / maxSpd;

    drawDashedLine(brc,     '#ffffff', 0.22);  // BRC white
    drawDashedLine(deckHdg, '#ffd600', 0.55);  // Angled deck yellow

    ctx.save();
    ctx.shadowBlur  = 10;
    ctx.shadowColor = '#00d4ff';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#00d4ff';
    ctx.fill();
    ctx.restore();

    drawArrow(brc,    shipSpd * vScale, '#39d353', 2.5);  // ship headwind (green)
    if (autoSync && actualBrc !== null && actualShipSpd !== null) {
      drawArrow(actualBrc, actualShipSpd * vScale, 'rgba(57, 211, 83, 0.5)', 2.5);
    }
    drawArrow(twDir,  twSpd   * vScale, '#00d4ff', 3.5);  // true wind (cyan)
    drawArrow(wodDir, wodSpd  * vScale, '#ff3b3b', 5);    // WOD (red)

    // --- REUSABLE DECK VIEW DRAWING FUNCTION ---
    function drawDeckView(
      canvas: HTMLCanvasElement | null,
      shipImg: HTMLImageElement | null,
      shipLengthM: number,
      imgRotation: number, // radians to rotate natural image
      facingUp: boolean,
      shipPos: {u: number, v: number} | null,
      shipBrc: number | null,
      spots: ParkingSpot[],
      lockedUnitId: string | null,
      smoothedRef: React.MutableRefObject<Record<string, {fwd: number, right: number}>>,
      setLockedId: (id: string | null) => void,
      shipNameStr: string,
      deckId: DeckId,
      routeByStart: Readonly<Record<string, DeckLaunchRoute>>,
      routeById: Readonly<Record<string, DeckLaunchRoute>>,
      routesByLaunch: Readonly<Record<string, DeckLaunchRoute[]>>,
    ): DeckRouteHitTarget[] {
      const hitTargets: DeckRouteHitTarget[] = [];
      const noRouteSpotHalos: Array<{ x: number; y: number; color: string }> = [];
      const selectedSpotHalos: Array<{ x: number; y: number; color: string }> = [];
      const launchRoutes = deckId === 'carrier' ? NIMITZ_LAUNCH_ROUTES : TARAWA_LAUNCH_ROUTES;
      if (!canvas) return hitTargets;
      const dctx = canvas.getContext('2d');
      if (!dctx) return hitTargets;

      const fallbackShipPosition = shipPos ? { u: shipPos.v, v: shipPos.u } : null;
      const shipUnit = findDeckShip(radarUnits, shipNameStr, lockedUnitId, fallbackShipPosition);
      const shipUnitId = shipUnit ? String(shipUnit.id) : null;
      const shipSample = shipUnitId ? radarSnapshot.samples[shipUnitId] : null;
      const syncShipPos = shipUnit?.position ?? fallbackShipPosition;
      const streamHeading = shipUnit?.orientation?.heading;
      const resolvedShipHeading = typeof streamHeading === 'number' && Number.isFinite(streamHeading)
        ? streamHeading
        : shipBrc;

      if (!syncShipPos || resolvedShipHeading === null || !shipImg || !shipImg.complete || !shipImg.naturalWidth) {
        dctx.clearRect(0, 0, canvas.width, canvas.height);
        dctx.fillStyle = '#060a0f';
        dctx.fillRect(0, 0, canvas.width, canvas.height);
        dctx.font = "14px 'Share Tech Mono', monospace";
        dctx.fillStyle = 'rgba(255,255,255,0.4)';
        dctx.textAlign = 'center';
        dctx.textBaseline = 'middle';
        dctx.fillText(`Waiting for ${shipNameStr} data...`, canvas.width / 2, canvas.height / 2);
        return hitTargets;
      }

      dctx.clearRect(0, 0, canvas.width, canvas.height);
      dctx.fillStyle = '#060a0f';
      dctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx2 = canvas.width / 2;
      const cy2 = canvas.height / 2;

      const targetLen = facingUp ? canvas.height * 0.92 : canvas.width * 0.90;
      
      // If the natural image is tall (Tarawa), length is naturalHeight. If wide (Nimitz), naturalWidth.
      const isNaturallyTall = shipImg.naturalHeight > shipImg.naturalWidth;
      const shipImgLength = isNaturallyTall ? shipImg.naturalHeight : shipImg.naturalWidth;
      const scale = targetLen / shipImgLength;
      
      const dw = shipImg.naturalWidth * scale;
      const dh = shipImg.naturalHeight * scale;
      const pixelsPerMeter = targetLen / shipLengthM;

      dctx.save();
      dctx.translate(cx2, cy2);

      // Draw ship image facing RIGHT
      dctx.save();
      dctx.rotate(imgRotation);
      dctx.drawImage(shipImg, -dw / 2, -dh / 2, dw, dh);
      dctx.restore();

      const activeRoutes = selectedDeckRoutes?.deckId === deckId
        ? selectedDeckRoutes.routeIds
          .map((routeId) => routeById[routeId])
          .filter((item): item is DeckLaunchRoute => item !== undefined)
        : [];
      const activeRouteIds = new Set(activeRoutes.map((item) => item.id));
      for (const activeRoute of activeRoutes) {
        if (activeRoute.points.length) {
          dctx.beginPath();
          for (let index = 0; index < activeRoute.points.length; index += 1) {
            const point = activeRoute.points[index];
            const routeX = (facingUp ? point.right : point.fwd) * pixelsPerMeter;
            const routeY = (facingUp ? -point.fwd : point.right) * pixelsPerMeter;
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
            const routeX = (facingUp ? point.right : point.fwd) * pixelsPerMeter;
            const routeY = (facingUp ? -point.fwd : point.right) * pixelsPerMeter;
            dctx.beginPath();
            dctx.arc(routeX, routeY, 3, 0, 2 * Math.PI);
            dctx.fillStyle = '#fff';
            dctx.fill();
          }
        }
      }

      if (shipUnit && String(shipUnit.id) !== lockedUnitId) {
        setLockedId(String(shipUnit.id));
      }

      // Match players to parking spots
      const occupiedSpots: Array<{
        player: RadarUnit;
        spot: PositionedParkingSpot | null;
        uLocalFwd: number;
        uLocalRight: number;
        minDst: number;
        relativeSpeed: number;
      }> = [];
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
        const prev = smoothedRef.current[unitId];
        const smoothFwd = prev ? alpha * uLocalFwd + (1 - alpha) * prev.fwd : uLocalFwd;
        const smoothRight = prev ? alpha * uLocalRight + (1 - alpha) * prev.right : uLocalRight;
        smoothedRef.current[unitId] = { fwd: smoothFwd, right: smoothRight };

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
        let sfwd, sright;
        if (spot.isLocal) {
          sfwd = spot.position.u;
          sright = spot.position.v;
        } else {
          const deckPosition = worldToDeck(spot.position, syncShipPos, resolvedShipHeading);
          sfwd = deckPosition.fwd;
          sright = deckPosition.right;
        }

        let px, py;
        if (facingUp) {
          px = sright * pixelsPerMeter;
          py = -sfwd * pixelsPerMeter;
        } else {
          px = sfwd * pixelsPerMeter;
          py = sright * pixelsPerMeter;
        }

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
        const isDirectlySelected = selectedDeckRoutes?.deckId === deckId
          && selectedDeckRoutes.selectionId === spotSelectionId;
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
            message: spotRoute ? `${deckId === 'carrier' ? 'Carrier' : 'Tarawa'}: ${spotRoute.label}` : unavailableMessage,
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
              ? `${deckId === 'carrier' ? 'Carrier' : 'Tarawa'}: ${launchName} → parking spots ${startLabels} (${launchSpotRoutes.length} route${launchSpotRoutes.length === 1 ? '' : 's'})`
              : `No DCS parking routes are defined for ${launchName}.`,
          });
        }
      });

      // Draw occupied aircraft
      occupiedSpots.forEach(occ => {
        const parkedSpot = occ.spot?.isLocal && occ.minDst < 15 && occ.relativeSpeed < 1
          ? occ.spot
          : null;
        const sfwd = parkedSpot ? parkedSpot.position.u : occ.uLocalFwd;
        const sright = parkedSpot ? parkedSpot.position.v : occ.uLocalRight;

        let px, py;
        if (facingUp) {
          px = sright * pixelsPerMeter;
          py = -sfwd * pixelsPerMeter;
        } else {
          px = sfwd * pixelsPerMeter;
          py = sright * pixelsPerMeter;
        }

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
          dctx.rotate(deckIconRotationRadians(occ.player, parkedSpot, facingUp));
          dctx.drawImage(iconToDraw, -drawWid / 2, -drawLen / 2, drawWid, drawLen);
        } else {
          if (!facingUp) dctx.rotate(Math.PI / 2);
          dctx.font = "20px Arial";
          dctx.fillStyle = "white";
          dctx.textAlign = 'center';
          dctx.textBaseline = 'middle';
          dctx.fillText("✈️", 0, 0);
        }
        dctx.restore();

        const pName = occ.player.player_name || occ.player.type || "Unknown";
        dctx.font = "12px 'Share Tech Mono', monospace";
        const textWidth = dctx.measureText(pName).width;
        dctx.fillStyle = "rgba(0, 0, 0, 0.65)";
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
            ? `${deckId === 'carrier' ? 'Carrier' : 'Tarawa'}: ${aircraftRoute.label} (${pName})`
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
      return hitTargets;
    }

    // Draw Nimitz deck view
    // Nimitz image natively faces West (Left). Rotate by PI/2 (90deg) to face UP.
    carrierHitTargetsRef.current = drawDeckView(
      deckCanvasRef.current, carrierImg, 332, Math.PI / 2, true,
      carrierPos, actualBrc, parkingSpots,
      carrierUnitId, smoothedPositions,
      (id) => setCarrierUnitId(id),
      carrierName ?? carrierNameInput,
      'carrier', NIMITZ_ROUTE_BY_START, NIMITZ_ROUTE_BY_ID, NIMITZ_ROUTES_BY_LAUNCH,
    );

    // Draw Tarawa deck view
    // Tarawa image natively faces North (Up). Rotation 0 to face UP.
    tarawaHitTargetsRef.current = drawDeckView(
      tarawaCanvasRef.current, tarawaImg, 254, 0, true,
      tarawaPos, tarawaBrc, tarawaParkingSpots,
      tarawaUnitId, tarawaSmoothedPositions,
      (id) => setTarawaUnitId(id),
      tarawaName ?? tarawaNameInput,
      'tarawa', TARAWA_ROUTE_BY_START, TARAWA_ROUTE_BY_ID, TARAWA_ROUTES_BY_LAUNCH,
    );

  }, [twDir, twSpd, brc, shipSpd, deckHdg, wodDir, wodSpd, carrierImg, tarawaImg, autoSync, actualBrc, actualShipSpd, carrierPos, carrierName, carrierNameInput, radarSnapshot.samples, radarUnits, parkingSpots, carrierUnitId, planeIcons, tarawaPos, tarawaBrc, tarawaName, tarawaNameInput, tarawaParkingSpots, tarawaUnitId, selectedDeckRoutes]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    const carrierRoutes = selectedDeckRoutes?.deckId === 'carrier'
      ? selectedDeckRoutes.routeIds
        .map((routeId) => NIMITZ_ROUTE_BY_ID[routeId])
        .filter((route): route is DeckLaunchRoute => route !== undefined)
      : [];
    const tarawaRoutes = selectedDeckRoutes?.deckId === 'tarawa'
      ? selectedDeckRoutes.routeIds
        .map((routeId) => TARAWA_ROUTE_BY_ID[routeId])
        .filter((route): route is DeckLaunchRoute => route !== undefined)
      : [];

    let animationFrameId: number | null = null;
    let animationStart: number | null = null;
    const animateRouteFlow = (timestamp: number) => {
      animationStart ??= timestamp;
      const elapsed = timestamp - animationStart;
      if (elapsed >= ROUTE_FLOW_CYCLE_MS) {
        drawDeckRouteFlow(carrierRouteEffectCanvasRef.current, [], 332, 0);
        drawDeckRouteFlow(tarawaRouteEffectCanvasRef.current, [], 254, 0);
        animationFrameId = null;
        return;
      }
      drawDeckRouteFlow(carrierRouteEffectCanvasRef.current, carrierRoutes, 332, elapsed);
      drawDeckRouteFlow(tarawaRouteEffectCanvasRef.current, tarawaRoutes, 254, elapsed);
      animationFrameId = window.requestAnimationFrame(animateRouteFlow);
    };

    if (carrierRoutes.length || tarawaRoutes.length) {
      animationFrameId = window.requestAnimationFrame(animateRouteFlow);
    } else {
      drawDeckRouteFlow(carrierRouteEffectCanvasRef.current, [], 332, 0);
      drawDeckRouteFlow(tarawaRouteEffectCanvasRef.current, [], 254, 0);
    }

    return () => {
      if (animationFrameId !== null) window.cancelAnimationFrame(animationFrameId);
    };
  }, [selectedDeckRoutes]);

  return (
    <div className="airboss-container">
      
      <div className="ab-topbar">
        <div className="ab-tb-title">Airboss Planner</div>
        <div className="ab-tb-sep"></div>
        <div className="ab-tb-sub">REVERSE WOD CALCULATION</div>
        <div className="ab-tb-sep"></div>
        <div className="ab-tb-sub">DCS NAVAL OPS</div>
        <button 
          className={`ab-autosync-btn ${autoSync ? 'active' : ''}`}
          onClick={() => setAutoSync(!autoSync)}
        >
          <div className="ab-autosync-indicator"></div>
          AUTO-SYNC
        </button>
      </div>

      <div className="ab-main">
        <div className="ab-sidebar">
          <div className="ab-sec-hdr">Carrier Actions</div>
          <div className="ab-ctrl-block" style={{ flexDirection: 'row', gap: '8px', alignItems: 'center' }}>
            <span className="ab-ctrl-label" style={{ flex: 1 }}>Nimitz Name</span>
            <input 
              type="text" 
              value={carrierNameInput} 
              onChange={e => setCarrierNameInput(e.target.value)}
              style={{ width: '80px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 6px', fontFamily: 'var(--mono)', borderRadius: '3px' }}
            />
          </div>
          <div className="ab-ctrl-block" style={{ flexDirection: 'row', gap: '8px', alignItems: 'center', marginTop: '-8px' }}>
            <span className="ab-ctrl-label" style={{ flex: 1 }}>Tarawa Name</span>
            <input 
              type="text" 
              value={tarawaNameInput} 
              onChange={e => setTarawaNameInput(e.target.value)}
              style={{ width: '80px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '2px 6px', fontFamily: 'var(--mono)', borderRadius: '3px' }}
            />
          </div>
          <div className="ab-ctrl-block" style={{ flexDirection: 'row', gap: '8px', marginTop: '-8px' }}>
            <button 
              className="ab-autosync-btn" 
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => handleAction('start')}
            >
              Turn into Wind
            </button>
            <button 
              className="ab-autosync-btn" 
              style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,214,0,0.1)', borderColor: 'rgba(255,214,0,0.3)', color: '#ffd600' }}
              onClick={() => handleAction('resume')}
            >
              Resume Circuit
            </button>
          </div>
          <div className="ab-ctrl-block" style={{ flexDirection: 'row', gap: '8px', marginTop: '-8px' }}>
            <button 
              className="ab-autosync-btn" 
              style={{ flex: 1, justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--txt-dim)' }}
              onClick={() => handleAction('status')}
            >
              Check Recovery Status
            </button>
          </div>
          {actionStatus && (
            <div style={{ fontSize: '11px', color: 'var(--yel)', marginTop: '-2px', marginBottom: '10px', textAlign: 'center', fontFamily: 'var(--mono)', padding: '0 10px', whiteSpace: 'pre-wrap' }}>
              {actionStatus}
            </div>
          )}

          <div className="ab-sec-hdr mt">Wind Parameters</div>

          <div className="ab-ctrl-block">
            <div className="ab-ctrl-row">
              <span className="ab-ctrl-label">True Wind Dir</span>
              <span className="ab-ctrl-val">{String(Math.round(twDir)).padStart(3, '0')}°</span>
            </div>
            <input type="range" min="0" max="359" value={twDir} disabled={autoSync} onChange={e => setTwDir(parseFloat(e.target.value))} />
          </div>
          
          <div className="ab-ctrl-block">
            <div className="ab-ctrl-row">
              <span className="ab-ctrl-label">True Wind Speed</span>
              <span className="ab-ctrl-val">{twSpd.toFixed(1)} kts</span>
            </div>
            <input type="range" min="0" max="40" step="0.1" value={twSpd} disabled={autoSync} onChange={e => setTwSpd(parseFloat(e.target.value))} />
          </div>

          <div className="ab-sec-hdr mt">Target Constraints</div>

          <div className="ab-ctrl-block">
            <div className="ab-ctrl-row">
              <span className="ab-ctrl-label" style={{color: 'var(--red)'}}>Target WOD Speed</span>
              <span className="ab-ctrl-val" style={{color: 'var(--red)'}}>{targetWod.toFixed(1)} kts</span>
            </div>
            <input type="range" className="target" min="0" max="40" step="0.1" value={targetWod} disabled={autoSync} onChange={e => setTargetWod(parseFloat(e.target.value))} />
          </div>
          
          <div className="ab-ctrl-block">
            <div className="ab-ctrl-row">
              <span className="ab-ctrl-label">Deck Offset</span>
              <span className="ab-ctrl-val">{offset}° L</span>
            </div>
            <input type="range" min="0" max="15" value={offset} disabled={autoSync} onChange={e => setOffset(parseFloat(e.target.value))} />
          </div>

          <div className="ab-sec-hdr mt">Calculated Ship Parameters</div>
          <div className="ab-results">
            <div className="ab-res-row">
              <span className="ab-res-label">Req. Ship Heading (BRC)</span>
              <span className="ab-res-val" style={{color: 'var(--grn)'}}>{compassStr(brc)}</span>
            </div>
            {autoSync && actualBrc !== null && (
              <div className="ab-res-row" style={{opacity: 0.7}}>
                <span className="ab-res-label">Actual Heading</span>
                <span className="ab-res-val">{compassStr(actualBrc)}</span>
              </div>
            )}
            <div className="ab-res-row">
              <span className="ab-res-label">Req. Ship Speed</span>
              <span className="ab-res-val" style={{color: 'var(--grn)'}}>{shipSpd.toFixed(1)} kts</span>
            </div>
            {autoSync && actualShipSpd !== null && (
              <div className="ab-res-row" style={{opacity: 0.7}}>
                <span className="ab-res-label">Actual Speed</span>
                <span className="ab-res-val">{actualShipSpd.toFixed(1)} kts</span>
              </div>
            )}
          </div>

          <div className="ab-sec-hdr mt">Resulting Wind</div>
          <div className="ab-results">
            <div className="ab-res-row">
              <span className="ab-res-label">Angled Deck Hdg</span>
              <span className="ab-res-val deck">{compassStr(deckHdg)}</span>
            </div>
            <div className="ab-res-row">
              <span className="ab-res-label">WOD Direction</span>
              <span className="ab-res-val wod-dir">{compassStr(wodDir)}</span>
            </div>
            <div className="ab-res-row">
              <span className="ab-res-label">Actual WOD Speed</span>
              <span className="ab-res-val wod-spd">{wodSpd.toFixed(1)} kts</span>
            </div>
          </div>

          <div className="ab-sec-hdr mt">Legend</div>
          <div className="ab-legend">
            <div className="ab-legend-item"><div className="ab-legend-line" style={{background: '#fff'}}></div>Req. BRC</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{background: '#ffd600'}}></div>Angled Deck Centerline</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{background: '#00d4ff'}}></div>True Wind Vector</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{background: '#39d353'}}></div>Req. Ship Velocity</div>
            <div className="ab-legend-item"><div className="ab-legend-line" style={{background: '#ff3b3b'}}></div>Apparent Wind (WOD)</div>
            <div className="ab-legend-tip">Red (WOD) is calculated to align perfectly with Yellow (Deck Hdg) using Airboss math.</div>
          </div>
        </div>

        <div className="ab-canvas-wrap" style={{ flexDirection: 'column', gap: '40px', overflowY: 'auto', padding: '40px 0' }}>
          <canvas ref={canvasRef} width="660" height="660"></canvas>
          <div className={`ab-route-status${selectedDeckRoutes ? ' active' : ''}`}>
            <span className="ab-route-status-line" />
            {routeMessage}
          </div>
          <div style={{ display: 'flex', flexDirection: 'row', gap: '40px', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '2px' }}>CARRIER DECK (CVN)</div>
              <DeckSpotLegend />
              <div className="ab-deck-canvas-stack">
                <canvas
                  ref={deckCanvasRef}
                  width="500"
                  height="1100"
                  onClick={(event) => handleDeckClick(event, 'carrier')}
                  className="ab-interactive-deck"
                  style={{ borderRadius: '8px', boxShadow: '0 0 0 1px rgba(0,212,255,.2)', background: '#060a0f' }}
                />
                <canvas
                  ref={carrierRouteEffectCanvasRef}
                  width="500"
                  height="1100"
                  className="ab-deck-route-effects"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '2px' }}>TARAWA DECK (LHA)</div>
              <DeckSpotLegend />
              <div className="ab-deck-canvas-stack">
                <canvas
                  ref={tarawaCanvasRef}
                  width="400"
                  height="1100"
                  onClick={(event) => handleDeckClick(event, 'tarawa')}
                  className="ab-interactive-deck"
                  style={{ borderRadius: '8px', boxShadow: '0 0 0 1px rgba(0,212,255,.2)', background: '#060a0f' }}
                />
                <canvas
                  ref={tarawaRouteEffectCanvasRef}
                  width="400"
                  height="1100"
                  className="ab-deck-route-effects"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="ab-sbar">
        STATUS:&nbsp;<span className="ab-sbar-ok" style={{color: calc.status === 'OPTIMAL' ? 'var(--grn)' : 'var(--yel)'}}>{calc.status}</span>
        &nbsp;·&nbsp; REVERSE WOD CALCULATION &nbsp;·&nbsp; DCS CARRIER OPS
      </div>
    </div>
  );
}
