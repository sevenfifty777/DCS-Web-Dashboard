"use client";

import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api';
import './airboss.css';

export default function AirbossPlanner() {
  const [twDir, setTwDir] = useState(51);
  const [twSpd, setTwSpd] = useState(6.8);
  const [targetWod, setTargetWod] = useState(25.0);
  const [offset, setOffset] = useState(9);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [carrierImg, setCarrierImg] = useState<HTMLImageElement | null>(null);
  
  const [autoSync, setAutoSync] = useState(false);
  const [actualBrc, setActualBrc] = useState<number | null>(null);
  const [actualShipSpd, setActualShipSpd] = useState<number | null>(null);

  useEffect(() => {
    const img = new window.Image();
    img.src = '/img/carrier-top-full-transp.png';
    img.onload = () => {
      setCarrierImg(img);
    };
  }, []);

  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!autoSync) return;
    
    const fetchData = async () => {
      try {
        const res = await apiFetch('/api/airboss');
        if (res.ok) {
          const data = await res.json();
          setTwDir(data.tw_dir);
          setTwSpd(data.tw_spd);
          setTargetWod(data.target_wod);
          setActualBrc(data.brc);
          setActualShipSpd(data.ship_spd);
        }
      } catch (err) {
        console.error('Failed to fetch airboss data:', err);
      }
    };

    fetchData();
    const intervalId = setInterval(fetchData, 2000);
    return () => clearInterval(intervalId);
  }, [autoSync]);

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
  }, [twDir, twSpd, brc, shipSpd, deckHdg, wodDir, wodSpd, carrierImg, autoSync, actualBrc, actualShipSpd]);

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
          <div className="ab-ctrl-block" style={{ flexDirection: 'row', gap: '8px' }}>
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

        <div className="ab-canvas-wrap">
          <canvas ref={canvasRef} width="660" height="660"></canvas>
        </div>
      </div>

      <div className="ab-sbar">
        STATUS:&nbsp;<span className="ab-sbar-ok" style={{color: calc.status === 'OPTIMAL' ? 'var(--grn)' : 'var(--yel)'}}>{calc.status}</span>
        &nbsp;·&nbsp; REVERSE WOD CALCULATION &nbsp;·&nbsp; DCS CARRIER OPS
      </div>
    </div>
  );
}
