// Refined Mii-style face. Like a real Mii, the features are flat 2D parts on a 3D head, but
// every part is driven by continuous values, so expressions can ease smoothly between states
// (blinks close gradually, a smile widens into a grin, brows lift by degrees).

import type { Look } from './shared/look.js';

/** Continuous face pose. Values are 0..1 unless noted. */
export interface MiiPose {
  /** eye openness: 0 shut, 1 the style's normal opening */
  open: number;
  /** ^ ^ happy eyes */
  happy: number;
  /** eyes wider than normal */
  wide: number;
  /** -1 angry (inner ends down) .. 1 worried (inner ends up) */
  worry: number;
  /** -1 frown .. 1 big smile */
  smile: number;
  /** mouth opening */
  mouthOpen: number;
  /** how round the opening is (gasp) */
  round: number;
  /** wobbly nervous lips */
  wavy: number;
  /** pupils, -1..1 */
  lookX: number;
  lookY: number;
  /** extra cheek flush */
  flush: number;
  /** heavy deadpan lid */
  deadpan: number;
}

export const REST: MiiPose = { open: 1, happy: 0, wide: 0, worry: 0, smile: 0.55, mouthOpen: 0, round: 0, wavy: 0, lookX: 0, lookY: 0, flush: 0, deadpan: 0 };

export interface MiiOpts {
  ghost?: boolean;
  wobble?: number;
  /** skip blush/freckles/mole */
  noSkin?: boolean;
}

const INK = '#2a1e24';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function jit(seed: number | undefined, i: number, amp: number): number {
  if (seed === undefined) return 0;
  const x = Math.sin((seed * 13.37 + i) * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amp;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The look's resting mouth as pose values. */
export function restMouth(look: Look): Pick<MiiPose, 'smile' | 'mouthOpen' | 'round'> {
  switch (look.mouth) {
    case 'grin':
      return { smile: 0.85, mouthOpen: 0.55, round: 0 };
    case 'small':
      return { smile: 0.4, mouthOpen: 0, round: 0 };
    case 'pout':
      return { smile: 0.05, mouthOpen: 0, round: 0 };
    default:
      return { smile: 0.55, mouthOpen: 0, round: 0 };
  }
}

/**
 * Draw the face centred at (cx, cy). `s` is the face half-width in px; parts are laid out in
 * face units (-1..1), the same layout the 3D head's glasses and nose use.
 */
export function drawMiiFace(ctx: CanvasRenderingContext2D, look: Look, p: MiiPose, cx: number, cy: number, s: number, o: MiiOpts = {}) {
  const ghost = !!o.ghost;
  const ink = ghost ? 'rgba(90,86,100,0.75)' : INK;
  const W = o.wobble;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (!ghost && !o.noSkin) drawCheeks(ctx, look, p.flush);

  const gap = 0.4 * look.eyeGap;
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * gap + jit(W, sx, 0.01), -0.05 + jit(W, sx + 3, 0.01));
    drawEye(ctx, look, p, ink, ghost);
    ctx.restore();
  }

  const browColor = ghost ? ink : look.hairColor === '#e9e3d9' ? '#8a7f70' : shade(look.hairColor, 0.05);
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * (gap + 0.02), -0.4 - Math.max(0, p.worry) * 0.03 - p.wide * 0.03);
    ctx.scale(sx, 1);
    ctx.rotate(p.worry * 0.42);
    drawBrow(ctx, look.brows, browColor);
    ctx.restore();
  }

  drawNose(ctx, look, ghost);
  drawMouth(ctx, look, p, ink, ghost);
  if (!ghost && !o.noSkin) drawMarks(ctx, look);
  ctx.restore();
}

export function drawCheeks(ctx: CanvasRenderingContext2D, look: Look, flush: number) {
  const a = (look.blush ? 0.3 : 0) + flush * 0.55;
  if (a <= 0) return;
  for (const sx of [-1, 1]) {
    const g = ctx.createRadialGradient(sx * 0.6, 0.32, 0.01, sx * 0.6, 0.32, 0.24);
    g.addColorStop(0, `rgba(255,112,140,${Math.min(0.85, a)})`);
    g.addColorStop(1, 'rgba(255,112,140,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(sx * 0.6, 0.32, 0.26, 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawMarks(ctx: CanvasRenderingContext2D, look: Look) {
  if (look.freckles) {
    ctx.fillStyle = 'rgba(150,90,60,0.5)';
    for (const sx of [-1, 1])
      for (const [x, y, r] of [
        [0.36, 0.17, 0.022],
        [0.47, 0.23, 0.026],
        [0.41, 0.31, 0.02],
        [0.55, 0.15, 0.018],
      ]) {
        ctx.beginPath();
        ctx.arc(sx * x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  const mp: Record<string, [number, number]> = {
    chinL: [-0.2, 0.74],
    chinR: [0.2, 0.74],
    cheekL: [-0.55, 0.44],
    cheekR: [0.55, 0.44],
    lipL: [-0.36, 0.58],
  };
  if (mp[look.mole]) {
    const [x, y] = mp[look.mole];
    ctx.fillStyle = '#3a2628';
    ctx.beginPath();
    ctx.arc(x, y, 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- eyes ----------

function eyeShape(style: string) {
  switch (style) {
    case 'sleepy':
      return { w: 0.2, h: 0.085, low: 0.75, iris: 0.72, heavy: 1 };
    case 'almond':
      return { w: 0.19, h: 0.12, low: 0.7, iris: 0.66, heavy: 0.6 };
    case 'dot':
      return { w: 0.07, h: 0.09, low: 1, iris: 1, heavy: 0 };
    default:
      return { w: 0.16, h: 0.18, low: 0.92, iris: 0.6, heavy: 0.45 };
  }
}

function drawEye(ctx: CanvasRenderingContext2D, look: Look, p: MiiPose, ink: string, ghost: boolean) {
  const e = eyeShape(look.eyes);
  const k = look.eyeSize;
  const w = e.w * k * (1 + p.wide * 0.08);
  const open = clamp01(p.open) * (1 - clamp01(p.happy)) * (1 - p.deadpan * 0.45);
  const hTop = e.h * k * (1 + p.wide * 0.55) * open;
  const hLow = e.h * k * e.low * (1 + p.wide * 0.35) * Math.max(open, 0.001);

  if (p.happy > 0.02) {
    ctx.save();
    ctx.globalAlpha *= clamp01(p.happy * 1.6);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.055;
    ctx.beginPath();
    ctx.moveTo(-w, 0.03);
    ctx.quadraticCurveTo(0, -e.h * k * 1.6, w, 0.03);
    ctx.stroke();
    ctx.restore();
  }
  if (open < 0.12) {
    if (p.happy < 0.5) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(0, e.h * k * 0.7, w, 0);
      ctx.stroke();
    }
    return;
  }

  if (look.eyes === 'dot') {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(p.lookX * 0.02, p.lookY * 0.015, w, hTop + 0.01, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!ghost) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(w * 0.3, -hTop * 0.35, w * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.bezierCurveTo(-w * 0.6, -hTop * 1.33, w * 0.6, -hTop * 1.33, w, 0);
    ctx.bezierCurveTo(w * 0.6, hLow * 1.33, -w * 0.6, hLow * 1.33, -w, 0);
    ctx.closePath();
  };
  shape();
  ctx.fillStyle = ghost ? 'rgba(255,255,255,0.55)' : '#fffdfb';
  ctx.fill();
  ctx.save();
  shape();
  ctx.clip();
  const ir = w * e.iris;
  const ix = p.lookX * w * 0.32;
  const iy = p.lookY * hLow * 0.25 + (look.eyes === 'sleepy' ? hLow * 0.25 : 0);
  if (ghost) {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const g = ctx.createLinearGradient(0, iy - ir, 0, iy + ir);
    g.addColorStop(0, '#1d1214');
    g.addColorStop(1, '#5b3a2f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f0a0b';
    ctx.beginPath();
    ctx.arc(ix, iy, ir * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ix + ir * 0.38, iy - ir * 0.4, ir * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(ix - ir * 0.32, iy + ir * 0.36, ir * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    const sh = ctx.createLinearGradient(0, -hTop, 0, 0);
    sh.addColorStop(0, 'rgba(60,30,40,0.22)');
    sh.addColorStop(1, 'rgba(60,30,40,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(-w, -hTop * 1.4, w * 2, hTop * 1.4);
  }
  ctx.restore();

  // upper lash line: tapered, heavier for monolids
  const heavy = e.heavy + p.deadpan * 0.6;
  const lw = 0.03 + 0.03 * heavy;
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(-w * 1.04, 0.004);
  ctx.bezierCurveTo(-w * 0.6, -hTop * 1.33 - lw, w * 0.6, -hTop * 1.33 - lw, w * 1.08, -0.004 - lw * 0.3);
  ctx.bezierCurveTo(w * 0.6, -hTop * 1.33 + lw * 0.2, -w * 0.6, -hTop * 1.33 + lw * 0.2, -w * 1.04, 0.004);
  ctx.closePath();
  ctx.fill();
  if (look.eyes === 'lashes' || look.eyes === 'almond') {
    ctx.beginPath();
    ctx.moveTo(w * 0.85, -hTop * 0.55);
    ctx.quadraticCurveTo(w * 1.2, -hTop * 0.9 - 0.02, w * 1.32, -hTop * 1.1 - 0.04);
    ctx.lineTo(w * 1.05, -hTop * 0.2);
    ctx.closePath();
    ctx.fill();
  }
  if (look.eyes === 'lashes') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.022;
    for (const t of [0.15, 0.45]) {
      const x = lerp(-w * 0.3, w * 0.8, t);
      ctx.beginPath();
      ctx.moveTo(x, -hTop * 1.2);
      ctx.lineTo(x + 0.03, -hTop * 1.2 - 0.05);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = ghost ? ink : 'rgba(60,30,40,0.28)';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(-w * 0.75, hLow * 0.75);
  ctx.quadraticCurveTo(0, hLow * 1.38, w * 0.75, hLow * 0.75);
  ctx.stroke();
}

// ---------- brows ----------

function drawBrow(ctx: CanvasRenderingContext2D, style: string, color: string) {
  // inner end at -x (toward the nose); a filled tapered shape
  const t = style === 'thick' ? 0.085 : style === 'thin' ? 0.026 : style === 'straight' ? 0.05 : 0.046;
  const arch = style === 'arched' ? 0.075 : style === 'straight' ? 0.0 : 0.035;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-0.17, t * 0.5);
  ctx.quadraticCurveTo(0, -arch - t * 0.55, 0.18, 0.015);
  ctx.quadraticCurveTo(0.02, -arch + t * 0.5, -0.17, t * 0.5 + t * 0.9);
  ctx.closePath();
  ctx.fill();
}

// ---------- nose ----------

function drawNose(ctx: CanvasRenderingContext2D, look: Look, ghost: boolean) {
  const y = 0.24;
  ctx.strokeStyle = ctx.fillStyle = ghost ? 'rgba(90,86,100,0.6)' : shade(look.skin, -0.34);
  ctx.lineWidth = 0.042;
  ctx.beginPath();
  switch (look.nose) {
    case 'round':
      ctx.arc(0, y, 0.085, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      break;
    case 'dot':
      ctx.arc(-0.045, y + 0.03, 0.022, 0, Math.PI * 2);
      ctx.arc(0.045, y + 0.03, 0.022, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'line':
      ctx.moveTo(0.02, y - 0.1);
      ctx.quadraticCurveTo(0.075, y, 0.0, y + 0.045);
      ctx.stroke();
      break;
    case 'none':
      break;
    default:
      ctx.moveTo(-0.065, y + 0.02);
      ctx.quadraticCurveTo(0, y + 0.075, 0.065, y + 0.02);
      ctx.stroke();
  }
}

// ---------- mouth ----------

function drawMouth(ctx: CanvasRenderingContext2D, look: Look, p: MiiPose, ink: string, ghost: boolean) {
  const y0 = 0.52;
  const widthByStyle = look.mouth === 'small' ? 0.6 : look.mouth === 'pout' ? 0.5 : look.mouth === 'grin' ? 1.15 : 1;
  const open = clamp01(p.mouthOpen);
  const round = clamp01(p.round);
  const mw = lerp(0.22 * widthByStyle * (1 + Math.max(0, p.smile) * 0.25 + open * 0.15), 0.085, round);
  // canvas y points down: a positive smile drops the middle below the corners
  const curve = p.smile * 0.075;
  const N = 18;
  const topY = (u: number) => y0 + curve * (1 - u * u) - curve * 0.6 + Math.sin(u * Math.PI * 3.5) * 0.028 * p.wavy;
  const lipDark = ghost ? ink : shade(look.lip, -0.38);

  if (open > 0.03) {
    const depth = open * lerp(0.17, 0.12, round);
    const pts: [number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      pts.push([u * mw, lerp(topY(u), y0 - Math.sqrt(Math.max(0, 1 - u * u)) * depth * 0.6, round)]);
    }
    for (let i = N; i >= 0; i--) {
      const u = -1 + (2 * i) / N;
      pts.push([u * mw, lerp(topY(u) + depth * Math.pow(1 - u * u, 0.85), y0 + Math.sqrt(Math.max(0, 1 - u * u)) * depth * 0.6, round)]);
    }
    const path = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    path();
    ctx.fillStyle = ghost ? 'rgba(90,86,100,0.3)' : '#5a1c2c';
    ctx.fill();
    if (!ghost) {
      ctx.save();
      path();
      ctx.clip();
      ctx.fillStyle = '#fffaf4';
      ctx.beginPath();
      ctx.moveTo(-mw, pts[0][1] - 0.05);
      for (let i = 0; i <= N; i++) ctx.lineTo(pts[i][0], pts[i][1] + depth * 0.32 * (1 - round));
      ctx.lineTo(mw, pts[N][1] - 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#e26d80';
      ctx.beginPath();
      ctx.ellipse(0, y0 + depth * 0.85 - curve * 0.3, mw * 0.55, depth * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    path();
    ctx.strokeStyle = lipDark;
    ctx.lineWidth = 0.028;
    ctx.stroke();
    return;
  }

  if (!ghost) {
    ctx.fillStyle = look.lip;
    ctx.globalAlpha = look.mouth === 'pout' ? 0.95 : 0.6;
    ctx.beginPath();
    ctx.ellipse(0, topY(0) + 0.035, mw * 0.62, look.mouth === 'pout' ? 0.06 : 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (look.mouth === 'cat' && p.wavy < 0.3) {
    ctx.strokeStyle = lipDark;
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(-mw, y0 - 0.02);
    ctx.quadraticCurveTo(-mw * 0.5, y0 + 0.08 * (0.5 + p.smile * 0.5), 0, y0);
    ctx.quadraticCurveTo(mw * 0.5, y0 + 0.08 * (0.5 + p.smile * 0.5), mw, y0 - 0.02);
    ctx.stroke();
    return;
  }
  // tapered closed-lip line
  ctx.fillStyle = lipDark;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const u = -1 + (2 * i) / N;
    const th = 0.012 + 0.024 * Math.cos((u * Math.PI) / 2);
    if (i === 0) ctx.moveTo(u * mw, topY(u) - th * 0.5);
    else ctx.lineTo(u * mw, topY(u) - th * 0.5);
  }
  for (let i = N; i >= 0; i--) {
    const u = -1 + (2 * i) / N;
    const th = 0.012 + 0.024 * Math.cos((u * Math.PI) / 2);
    ctx.lineTo(u * mw, topY(u) + th * 0.5);
  }
  ctx.closePath();
  ctx.fill();
}
