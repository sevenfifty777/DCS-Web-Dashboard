"use client";

// The manual planner: today's sliders and wheel, without a ship. Kept as a
// separate panel so the planning workflow does not change.

import { useEffect, useRef, useState } from 'react';
import { REGIME_LABELS, SHIP_DEFAULTS, apparentWind, compassStr, solveIntoWind } from './windSolver';
import { NIMITZ_PROFILE } from './deckProfiles';
import { drawWindWheel } from './wheelRenderer';

const WHEEL_SIZE_PX = 480;

interface PlannerPanelProps {
  images: Record<string, HTMLImageElement>;
  onClose: () => void;
}

export function PlannerPanel({ images, onClose }: PlannerPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [twDir, setTwDir] = useState(51);
  const [twSpd, setTwSpd] = useState(6.8);
  const [targetWod, setTargetWod] = useState(25.0);
  const [offset, setOffset] = useState(9);

  const carrierImage = NIMITZ_PROFILE.imageSrc ? images[NIMITZ_PROFILE.imageSrc] ?? null : null;

  const calc = solveIntoWind({
    windFromDeg: twDir,
    windSpeedKt: twSpd,
    targetWodKt: targetWod,
    deckOffsetDeg: offset,
    minSpeedKt: SHIP_DEFAULTS.minSpeedKt,
    maxSpeedKt: SHIP_DEFAULTS.maxSpeedKt,
    angledDeckMinWindKt: SHIP_DEFAULTS.angledDeckMinWindKt,
  });
  const apparent = apparentWind(twDir, twSpd, calc.headingDeg, calc.speedKt, offset);
  const deckHdg = (calc.headingDeg - offset + 360) % 360;

  useEffect(() => {
    drawWindWheel(canvasRef.current, {
      carrierImage,
      imageBowHeadingDeg: NIMITZ_PROFILE.imageBowHeadingDeg,
      windFromDeg: twDir,
      windSpeedKt: twSpd,
      plannedHeadingDeg: calc.headingDeg,
      plannedSpeedKt: calc.speedKt,
      deckHeadingDeg: deckHdg,
      apparentFromDeg: apparent.fromDeg,
      apparentSpeedKt: apparent.speedKt,
      actualHeadingDeg: null,
      actualSpeedKt: null,
    });
  }, [carrierImage, twDir, twSpd, calc.headingDeg, calc.speedKt, deckHdg, apparent.fromDeg, apparent.speedKt]);

  return (
    <section className="ab-panel planner" aria-label="Manual planner panel">
      <header className="ab-panel-header">
        <div className="ab-panel-title-row">
          <span className="ab-panel-title">Manual Planner</span>
          <button className="ab-panel-dismiss" onClick={onClose} title="Hide the manual planner">Hide</button>
        </div>
        <div className="ab-panel-badges">
          <span className="ab-badge">REVERSE WOD CALCULATION</span>
          <span className={`ab-badge${calc.regime === 'optimal' ? ' ok' : ' warn'}`}>{REGIME_LABELS[calc.regime]}</span>
        </div>
      </header>

      <canvas ref={canvasRef} className="ab-wheel" width={WHEEL_SIZE_PX} height={WHEEL_SIZE_PX} />

      <div className="ab-planner-controls">
        <div className="ab-sec-hdr">Wind Parameters</div>
        <div className="ab-ctrl-block">
          <div className="ab-ctrl-row">
            <span className="ab-ctrl-label">True Wind Dir</span>
            <span className="ab-ctrl-val">{String(Math.round(twDir)).padStart(3, '0')}°</span>
          </div>
          <input type="range" min="0" max="359" value={twDir} onChange={(e) => setTwDir(parseFloat(e.target.value))} />
        </div>
        <div className="ab-ctrl-block">
          <div className="ab-ctrl-row">
            <span className="ab-ctrl-label">True Wind Speed</span>
            <span className="ab-ctrl-val">{twSpd.toFixed(1)} kts</span>
          </div>
          <input type="range" min="0" max="40" step="0.1" value={twSpd} onChange={(e) => setTwSpd(parseFloat(e.target.value))} />
        </div>

        <div className="ab-sec-hdr mt">Target Constraints</div>
        <div className="ab-ctrl-block">
          <div className="ab-ctrl-row">
            <span className="ab-ctrl-label" style={{ color: 'var(--red)' }}>Target WOD Speed</span>
            <span className="ab-ctrl-val" style={{ color: 'var(--red)' }}>{targetWod.toFixed(1)} kts</span>
          </div>
          <input type="range" className="target" min="0" max="40" step="0.1" value={targetWod} onChange={(e) => setTargetWod(parseFloat(e.target.value))} />
        </div>
        <div className="ab-ctrl-block">
          <div className="ab-ctrl-row">
            <span className="ab-ctrl-label">Deck Offset</span>
            <span className="ab-ctrl-val">{offset}° L</span>
          </div>
          <input type="range" min="0" max="15" value={offset} onChange={(e) => setOffset(parseFloat(e.target.value))} />
        </div>

        <div className="ab-sec-hdr mt">Calculated Ship Parameters</div>
        <div className="ab-results">
          <div className="ab-res-row">
            <span className="ab-res-label">Req. Ship Heading (BRC)</span>
            <span className="ab-res-val" style={{ color: 'var(--grn)' }}>{compassStr(calc.headingDeg)}</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Req. Ship Speed</span>
            <span className="ab-res-val" style={{ color: 'var(--grn)' }}>{calc.speedKt.toFixed(1)} kts</span>
          </div>
        </div>

        <div className="ab-sec-hdr mt">Resulting Wind</div>
        <div className="ab-results">
          <div className="ab-res-row">
            <span className="ab-res-label">Angled Deck Hdg</span>
            <span className="ab-res-val deck">{compassStr(deckHdg)}</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">WOD Direction</span>
            <span className="ab-res-val wod-dir">{compassStr(apparent.fromDeg)}</span>
          </div>
          <div className="ab-res-row">
            <span className="ab-res-label">Actual WOD Speed</span>
            <span className="ab-res-val wod-spd">{apparent.speedKt.toFixed(1)} kts</span>
          </div>
        </div>
      </div>
    </section>
  );
}
