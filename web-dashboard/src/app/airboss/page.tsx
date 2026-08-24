"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import {
  RADAR_BATCH_SETTLE_MS,
  appendToRadarBatch,
  applyRadarBatch,
  createRadarBatch,
  findDeckShip,
  hasParkingPosition,
  isAircraftUnit,
  nearestShipId,
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
import './airboss.css';

export default function AirbossPlanner() {
  const [twDir, setTwDir] = useState(51);
  const [twSpd, setTwSpd] = useState(6.8);
  const [targetWod, setTargetWod] = useState(25.0);
  const [offset, setOffset] = useState(9);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deckCanvasRef = useRef<HTMLCanvasElement>(null);
  const tarawaCanvasRef = useRef<HTMLCanvasElement>(null);
  const [carrierImg, setCarrierImg] = useState<HTMLImageElement | null>(null);
  const [tarawaImg, setTarawaImg] = useState<HTMLImageElement | null>(null);
  const [planeIcons, setPlaneIcons] = useState<Record<string, HTMLImageElement>>({});

  // Hardcoded local parking spots for Nimitz-class carriers (CVN-71, 72, 73, 74)
  // because DCS Airbase.getParking() only works for land bases.
  // Source: CoreMods/tech/USS_Nimitz/scripts/USS_Nimitz_RunwaysAndRoutes.lua (LCS coords: x=fwd, z=lateral)
  const NIMITZ_SPOTS = useMemo<ParkingSpot[]>(() => [
    // Routes 1-15 parking spots (verified against DCS Lua)
    {'u': -141.15, 'v': 24.2},   // 1  - parking 1 * (stern, stbd)
    {'u': -129.2,  'v': 26.2},   // 2  - parking 2 *
    {'u': -118.0,  'v': 28.0},   // 3  - parking 3 *
    {'u': -103.5,  'v': 34.0},   // 4  - lift3 p1 *
    {'u': -92.0,   'v': 34.0},   // 5  - lift3 p2 *
    {'u': -79.0,   'v': 26.5},   // 6  - after island *
    {'u': -65.8,   'v': 18.8},   // 7  - island 1 *
    {'u': -52.0,   'v': 17.0},   // 8  - island 2 *
    {'u': -37.0,   'v': 16.0},   // 9  - island 3 *
    {'u': -23.0,   'v': 34.0},   // 10 - lift2 p1 *
    {'u': -11.0,   'v': 34.0},   // 11 - lift2 p2 *
    {'u': 6.0,     'v': 32.5},   // 12 - between lift1 & lift2 *
    {'u': 69.6,    'v': 33.0},   // 13 - before lift1 1 *
    {'u': 53.0,    'v': 34.5},   // 14 - before lift1 2 *
    {'u': 23.0,    'v': 34.0},   // 15 - lift1 p1 *
    {'u': 35.0,    'v': 34.0},   // 16 - lift1 p2 *
    // 6pack spots (commented-out in DCS taxi routes but physically valid)
    {'u': 24.5,    'v': 9.5},    // 17 - 6pack 1 {'u': -28.0,   'v': 12.0}
    {'u': 7.6,     'v': 10.5},   // 18 - 6pack 2 {'u': -10.0,   'v': 9.0}
    {'u': -9.9,    'v': 10.8},   // 19 - 6pack 3 {'u': 4.0,     'v': 8.0}
    {'u': -26.0,   'v': 12.0},   // 20 - 6pack 4 
    {'u': -96.0,   'v': -34.0},  // 21 - lift4 p1 * (port stern, on-deck) {'u': -80.0,   'v': -5.0}
    {'u': -108,    'v': -34.0},  // 22 - lift4 p2 * (port stern, on-deck) {'u': -115.0,  'v': -5.0}
    // Catapult end-positions (aircraft waiting for launch)
    {'u': 55.0,    'v': 18.54},  // 23 - Cat 1 (bow stbd) {'u': 55.0,    'v': 18.54}
    {'u': 55.9,    'v': -3.68},  // 24 - Cat 2 (bow port) {'u': 55.9,    'v': -3.68}
    {'u': -39.4,   'v': -19.92}, // 25 - Cat 3 (waist port)  {'u': -39.4,   'v': -19.92}
    {'u': -58.5,   'v': -32.8},  // 26 - Cat 4 (waist port) {'u': -58.5,   'v': -32.8}
  ].map((p, i) => ({ term_index: i + 1, position: p, isLocal: true })), []);

  // Tarawa LHA parking spots
  // Source: CoreMods/aircraft/AV8BNA/TarawaRunwaysAndRoutes.lua (LCS coords: x=fwd, z=lateral)
  const TARAWA_SPOTS = useMemo<ParkingSpot[]>(() => [
    // GT.TaxiRoutes parking spots (last waypoint = spawn position)
    {'u': 90.0,    'v': 14.0},    // 1  - bow stbd parking
    {'u': 75.0,    'v': 14.0},    // 2  - bow stbd parking
    {'u': 60.0,    'v': 14.0},    // 3  - bow stbd parking
    {'u': 45.0,    'v': 14.0},    // 4  - bow stbd parking
    {'u': -115.0,  'v': 14.0},    // 5  - stern stbd parking
    {'u': -100.0,  'v': 14.0},    // 6  - stern stbd parking
    {'u': -85.0,   'v': 14.0},    // 7  - stern stbd parking
    {'u': -70.0,   'v': 14.0},    // 8  - mid stbd parking
    // Helicopter spawn positions
    {'u': 102.3,   'v': 0.5},     // 9  - helo bow center
    {'u': 78.2,    'v': 13.65},   // 10 - helo bow stbd
    {'u': 78.2,    'v': -14.0},   // 11 - helo bow port
    {'u': 47.2,    'v': -14.0},   // 12 - helo mid port
    {'u': 15.8,    'v': -14.0},   // 13 - helo mid port
    {'u': -15.0,   'v': -14.0},   // 14 - helo mid port
    {'u': -46.5,   'v': -14.0},   // 15 - helo mid-stern port
    {'u': -91.0,   'v': -14.0},   // 16 - helo stern port
    // STOVL launch positions (where aircraft wait before takeoff run)
    {'u': -35.0,   'v': -5.5},    // 17 - STOVL launch 1
    {'u': -60.0,   'v': -6.2},    // 18 - STOVL launch 2
    {'u': -65.0,   'v': -6.5},    // 19 - STOVL launch 3
    {'u': -110.0,  'v': -7.5},    // 20 - STOVL launch 4
  ].map((p, i) => ({ term_index: i + 1, position: p, isLocal: true })), []);
  
  const [autoSync, setAutoSync] = useState(false);
  const [actualBrc, setActualBrc] = useState<number | null>(null);
  const [actualShipSpd, setActualShipSpd] = useState<number | null>(null);

  const [carrierNameInput, setCarrierNameInput] = useState("CVN-72");
  const [carrierName, setCarrierName] = useState<string | null>(null);
  const [carrierPos, setCarrierPos] = useState<{u: number, v: number} | null>(null);
  const [parkingSpots, setParkingSpots] = useState<ParkingSpot[]>([]);
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

  // Preload plane icons
  useEffect(() => {
    const iconNames = ['f-14_icon_park.png', 'F-18_icon_park.png', 'f-14_icon_cat.png', 'F-18_icon_cat.png', 'AV88_icon.park.png'];
    iconNames.forEach(name => {
      const img = new Image();
      img.onload = () => {
          setPlaneIcons(prev => ({ ...prev, [name]: img }));
      };
      img.src = `/icon/${name}`;
    });
  }, []);

  const [actionStatus, setActionStatus] = useState<string | null>(null);

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

  useEffect(() => {
    if (!autoSync || !carrierName) return;
    const fetchParking = async () => {
      try {
         const res = await apiFetch(`/api/world/airbases/${carrierName}/parking`);
         if (res.ok) {
             const data = await res.json();
             if (data.parking && data.parking.length > 0) {
                 setParkingSpots(data.parking);
             } else {
                 setParkingSpots(NIMITZ_SPOTS);
             }
         } else {
             setParkingSpots(NIMITZ_SPOTS);
         }
      } catch (err) {
         console.error('Failed to fetch parking:', err);
         setParkingSpots(NIMITZ_SPOTS);
      }
    };
    fetchParking();
  }, [autoSync, carrierName, NIMITZ_SPOTS]);

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
    ) {
      if (!canvas) return;
      const dctx = canvas.getContext('2d');
      if (!dctx) return;

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
        return;
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
          if (!hasParkingPosition(spot)) continue;
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

        dctx.beginPath();
        dctx.arc(px, py, 2.5, 0, 2 * Math.PI);
        dctx.fillStyle = 'rgba(13, 163, 68, 0.9)';
        dctx.fill();
        dctx.font = "10px 'Share Tech Mono', monospace";
        dctx.fillStyle = 'rgba(13, 163, 68, 0.9)';
        dctx.textAlign = 'center';
        dctx.textBaseline = 'middle';
        dctx.fillText(`${spot.term_index || idx}`, px, py + 12);
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

        const pType = (occ.player.type || "").toLowerCase();
        let iconToDraw: HTMLImageElement | null = null;
        let planeLengthMeters = 18; // Default F-14/F-18 size

        if (pType.includes("f-14")) {
          iconToDraw = planeIcons['f-14_icon_park.png'];
          planeLengthMeters = 19;
        } else if (pType.includes("f-18") || pType.includes("fa-18") || pType.includes("hornet")) {
          iconToDraw = planeIcons['F-18_icon_park.png'];
          planeLengthMeters = 17;
        } else if (pType.includes("av8") || pType.includes("av-8") || pType.includes("harrier")) {
          iconToDraw = planeIcons['AV88_icon.park.png'];
          planeLengthMeters = 14; // Harrier is significantly smaller
        }

        if (iconToDraw) {
          const drawLen = planeLengthMeters * pixelsPerMeter;
          const drawWid = (iconToDraw.width / iconToDraw.height) * drawLen;
          if (facingUp) {
            dctx.rotate(-Math.PI / 2); // Icons face right natively, rotate to face up
          }
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
      });

      dctx.restore();
    }

    // Draw Nimitz deck view
    // Nimitz image natively faces West (Left). Rotate by PI/2 (90deg) to face UP.
    drawDeckView(
      deckCanvasRef.current, carrierImg, 332, Math.PI / 2, true,
      carrierPos, actualBrc, parkingSpots,
      carrierUnitId, smoothedPositions,
      (id) => setCarrierUnitId(id),
      carrierName ?? carrierNameInput,
    );

    // Draw Tarawa deck view
    // Tarawa image natively faces North (Up). Rotation 0 to face UP.
    drawDeckView(
      tarawaCanvasRef.current, tarawaImg, 254, 0, true,
      tarawaPos, tarawaBrc, tarawaParkingSpots,
      tarawaUnitId, tarawaSmoothedPositions,
      (id) => setTarawaUnitId(id),
      tarawaName ?? tarawaNameInput,
    );

  }, [twDir, twSpd, brc, shipSpd, deckHdg, wodDir, wodSpd, carrierImg, tarawaImg, autoSync, actualBrc, actualShipSpd, carrierPos, carrierName, carrierNameInput, radarSnapshot.samples, radarUnits, parkingSpots, carrierUnitId, planeIcons, tarawaPos, tarawaBrc, tarawaName, tarawaNameInput, tarawaParkingSpots, tarawaUnitId]);

  return (
    <div className="airboss-container">
      <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
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
          <div style={{ display: 'flex', flexDirection: 'row', gap: '40px', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '2px' }}>CARRIER DECK (CVN)</div>
              <canvas ref={deckCanvasRef} width="500" height="1100" style={{ borderRadius: '8px', boxShadow: '0 0 0 1px rgba(0,212,255,.2)', background: '#060a0f' }}></canvas>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: '15px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '2px' }}>TARAWA DECK (LHA)</div>
              <canvas ref={tarawaCanvasRef} width="400" height="1100" style={{ borderRadius: '8px', boxShadow: '0 0 0 1px rgba(0,212,255,.2)', background: '#060a0f' }}></canvas>
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
