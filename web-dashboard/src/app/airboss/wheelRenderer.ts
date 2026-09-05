// Wind "wheel" renderer, extracted from the page effect so every carrier
// panel (and the manual planner) draws the same compass rose, ship silhouette
// and wind vectors from plain numbers.

import { toRad } from './windSolver.ts';

export interface WheelRenderInput {
  /** Ship silhouette, or null to draw the vectors only. */
  carrierImage: HTMLImageElement | null;
  /** Compass heading the natural image's bow points to (270 for the Nimitz top view). */
  imageBowHeadingDeg: number;
  /** Natural wind: direction it blows from and speed. */
  windFromDeg: number;
  windSpeedKt: number;
  /** Planned recovery course and speed. */
  plannedHeadingDeg: number;
  plannedSpeedKt: number;
  /** Angled-deck centreline heading for the planned course. */
  deckHeadingDeg: number;
  /** Apparent wind produced by the planned course and speed. */
  apparentFromDeg: number;
  apparentSpeedKt: number;
  /** Live ship course and speed when known; the planned ship is then drawn as a ghost. */
  actualHeadingDeg: number | null;
  actualSpeedKt: number | null;
  /** Grey the wheel (telemetry not synced or ship lost). */
  dimmed?: boolean;
  /** Short tag drawn near the bottom ("NOT SYNCED", "LOST"). */
  tag?: string | null;
}

export function drawWindWheel(canvas: HTMLCanvasElement | null, input: WheelRenderInput): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const {
    carrierImage, imageBowHeadingDeg, windFromDeg, windSpeedKt, plannedHeadingDeg, plannedSpeedKt,
    deckHeadingDeg, apparentFromDeg, apparentSpeedKt, actualHeadingDeg, actualSpeedKt,
  } = input;

  function getXY(angleDeg: number, length: number) {
    const r = toRad(angleDeg - 90);
    return { x: cx + length * Math.cos(r), y: cy + length * Math.sin(r) };
  }

  function drawArrow(angleDeg: number, length: number, color: string, lineWidth: number) {
    if (length <= 0.5) return;
    const end = getXY(angleDeg, length);
    ctx!.save();
    ctx!.strokeStyle = color;
    ctx!.lineWidth = lineWidth;
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
    const end = getXY(angleDeg, cx - 22);
    const start = getXY(angleDeg + 180, cx - 22);
    ctx!.save();
    ctx!.globalAlpha = alpha;
    ctx!.strokeStyle = color;
    ctx!.lineWidth = 1.5;
    ctx!.setLineDash([7, 7]);
    ctx!.beginPath();
    ctx!.moveTo(start.x, start.y);
    ctx!.lineTo(end.x, end.y);
    ctx!.stroke();
    ctx!.restore();
  }

  function drawCarrier(headingDeg: number, isActual: boolean) {
    if (!carrierImage || !carrierImage.complete || !carrierImage.naturalWidth) return;
    const longAxis = Math.max(carrierImage.naturalWidth, carrierImage.naturalHeight);
    const scale = canvas!.width * 0.60 / longAxis;
    const dw = carrierImage.naturalWidth * scale;
    const dh = carrierImage.naturalHeight * scale;
    ctx!.save();
    ctx!.translate(cx, cy);
    ctx!.rotate(toRad(headingDeg - imageBowHeadingDeg));
    if (!isActual) ctx!.globalAlpha = 0.3;
    ctx!.drawImage(carrierImage, -dw / 2, -dh / 2, dw, dh);
    ctx!.restore();
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (input.dimmed) ctx.globalAlpha = 0.5;

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
    const isMajor = (i % 30 === 0);
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

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "9px 'Share Tech Mono', monospace";
  ctx.fillStyle = 'rgba(0,212,255,.5)';
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

  if (actualHeadingDeg !== null) {
    drawCarrier(actualHeadingDeg, true);
    drawCarrier(plannedHeadingDeg, false);
  } else {
    drawCarrier(plannedHeadingDeg, true);
  }

  const maxSpd = Math.max(apparentSpeedKt, windSpeedKt, plannedSpeedKt, actualSpeedKt ?? 0, 10);
  const vScale = (cx - 80) / maxSpd;

  drawDashedLine(plannedHeadingDeg, '#ffffff', 0.22);  // BRC white
  drawDashedLine(deckHeadingDeg, '#ffd600', 0.55);     // Angled deck yellow

  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#00d4ff';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
  ctx.fillStyle = '#00d4ff';
  ctx.fill();
  ctx.restore();

  drawArrow(plannedHeadingDeg, plannedSpeedKt * vScale, '#39d353', 2.5);  // planned ship velocity (green)
  if (actualHeadingDeg !== null && actualSpeedKt !== null) {
    drawArrow(actualHeadingDeg, actualSpeedKt * vScale, 'rgba(57, 211, 83, 0.5)', 2.5);
  }
  drawArrow(windFromDeg, windSpeedKt * vScale, '#00d4ff', 3.5);           // true wind (cyan)
  drawArrow(apparentFromDeg, apparentSpeedKt * vScale, '#ff3b3b', 5);     // WOD (red)

  ctx.restore();

  if (input.tag) {
    ctx.save();
    ctx.font = "bold 12px 'Share Tech Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(input.tag).width + 16;
    const y = canvas.height - 48;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(cx - width / 2, y - 10, width, 20);
    ctx.strokeStyle = 'rgba(255, 214, 0, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - width / 2, y - 10, width, 20);
    ctx.fillStyle = '#ffd600';
    ctx.fillText(input.tag, cx, y);
    ctx.restore();
  }
}
