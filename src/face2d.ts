// Mii-style 2D face drawing. One renderer feeds the 3D egg's face texture, the Mii Maker
// option previews, leaderboard avatars and the hand-drawn splash ghost.

import type { Look } from './shared/look.js';

export interface FaceExpr {
  eyes: 'open' | 'closed' | 'happy' | 'wide' | 'deadpan' | 'blink';
  /** 'default' uses the look's own mouth */
  mouth: 'default' | 'flat' | 'wavy' | 'o' | 'grin';
  /** 0..1, inner brow ends lift */
  worry: number;
  /** pupil offset, -1..1 */
  lookX: number;
  lookY: number;
  /** 0..1 extra blush */
  flush: number;
}

export const NEUTRAL: FaceExpr = { eyes: 'open', mouth: 'default', worry: 0, lookX: 0, lookY: 0, flush: 0 };

export interface DrawOpts {
  /** line colour */
  ink?: string;
  /** pale sketch style for the ghost */
  ghost?: boolean;
  /** hand-drawn line boil: a seed that changes a few times a second */
  wobble?: number;
  /** draw the back of the head (no face) */
  back?: boolean;
}

const INK = '#2b2232';

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Jitter a point slightly, stable for a given seed. */
function jit(seed: number | undefined, i: number, amp: number): number {
  if (seed === undefined) return 0;
  return (hash(seed * 13.37 + i) - 0.5) * 2 * amp;
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------- the face ----------

/**
 * Draws eyes, brows, nose, mouth, mole, blush and freckles centred at (cx, cy).
 * `s` is the face half-width in pixels; everything is laid out in face units (-1..1).
 */
/**
 * Only the painted skin details (blush, freckles, mole, and flat nose styles) for the 3D head,
 * whose eyes, brows, nose and mouth are real geometry.
 */
export function drawSkinDetails(ctx: CanvasRenderingContext2D, look: Look, flush: number, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  const a = (look.blush ? 0.24 : 0) + flush * 0.55;
  if (a > 0) {
    ctx.fillStyle = `rgba(255,105,140,${Math.min(0.8, a)})`;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * 0.6, 0.32, 0.2, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (look.freckles) {
    ctx.fillStyle = 'rgba(150,90,60,0.55)';
    for (const sx of [-1, 1])
      for (const [x, y] of [
        [0.38, 0.16],
        [0.48, 0.22],
        [0.42, 0.3],
        [0.55, 0.14],
      ]) {
        ctx.beginPath();
        ctx.arc(sx * x, y, 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  ctx.strokeStyle = ctx.fillStyle = shade(look.skin, -0.32);
  ctx.lineWidth = 0.055;
  ctx.lineCap = 'round';
  if (look.nose === 'dot' || look.nose === 'line') drawNose(ctx, look.nose);
  const mp: Record<string, [number, number]> = {
    chinL: [-0.2, 0.72],
    chinR: [0.2, 0.72],
    cheekL: [-0.55, 0.42],
    cheekR: [0.55, 0.42],
    lipL: [-0.36, 0.56],
  };
  if (mp[look.mole]) {
    const [x, y] = mp[look.mole];
    ctx.fillStyle = '#3a2a2a';
    ctx.beginPath();
    ctx.arc(x, y, 0.032, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawFace(ctx: CanvasRenderingContext2D, look: Look, ex: FaceExpr, cx: number, cy: number, s: number, o: DrawOpts = {}): void {
  const ink = o.ink ?? (o.ghost ? 'rgba(90,86,100,0.75)' : INK);
  const W = o.wobble;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lw = 0.065;

  if (!o.ghost && (look.blush || ex.flush > 0)) {
    const a = (look.blush ? 0.22 : 0) + ex.flush * 0.55;
    ctx.fillStyle = `rgba(255,105,140,${Math.min(0.8, a)})`;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * 0.62, 0.3, 0.2, 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!o.ghost && look.freckles) {
    ctx.fillStyle = 'rgba(150,90,60,0.55)';
    for (const sx of [-1, 1])
      for (const [x, y] of [
        [0.38, 0.16],
        [0.48, 0.22],
        [0.42, 0.3],
        [0.55, 0.14],
      ]) {
        ctx.beginPath();
        ctx.arc(sx * x, y, 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
  }

  const gap = 0.4 * look.eyeGap;
  const er = 0.16 * look.eyeSize;
  const ey = -0.05;
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * gap + jit(W, sx, 0.012), ey + jit(W, sx + 5, 0.012));
    drawEye(ctx, look.eyes, ex, er, sx, ink, lw, o.ghost === true);
    ctx.restore();
  }

  const by = -0.42 - ex.worry * 0.05;
  ctx.strokeStyle = o.ghost ? ink : look.hairColor === '#e9e3d9' ? '#8a7f70' : look.hairColor;
  for (const sx of [-1, 1]) {
    ctx.save();
    ctx.translate(sx * (gap + 0.02), by);
    ctx.scale(sx, 1);
    ctx.rotate(ex.worry * 0.45);
    drawBrow(ctx, look.brows, lw);
    ctx.restore();
  }

  ctx.strokeStyle = o.ghost ? ink : shade(look.skin, -0.32);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = lw * 0.85;
  drawNose(ctx, look.nose);

  drawMouth(ctx, look, ex, ink, lw, o.ghost === true);

  const mp: Record<string, [number, number]> = {
    chinL: [-0.2, 0.8],
    chinR: [0.2, 0.8],
    cheekL: [-0.55, 0.42],
    cheekR: [0.55, 0.42],
    lipL: [-0.34, 0.6],
  };
  if (!o.ghost && mp[look.mole]) {
    const [x, y] = mp[look.mole];
    ctx.fillStyle = '#3a2a2a';
    ctx.beginPath();
    ctx.arc(x, y, 0.032, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, style: string, ex: FaceExpr, r: number, sx: number, ink: string, lw: number, ghost: boolean) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = lw;
  const mode = ex.eyes;
  if (mode === 'blink' || mode === 'closed') {
    ctx.beginPath();
    ctx.arc(0, -r * 0.35, r * 0.95, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    return;
  }
  if (mode === 'happy') {
    ctx.beginPath();
    ctx.arc(0, r * 0.55, r, Math.PI * 1.18, Math.PI * 1.82);
    ctx.stroke();
    return;
  }
  const wide = mode === 'wide' ? 1.3 : 1;
  const px = ex.lookX * r * 0.35;
  const py = ex.lookY * r * 0.3;
  const whites = ghost ? 'rgba(255,255,255,0.6)' : '#ffffff';

  switch (style) {
    case 'sleepy': {
      const h = r * 0.48 * wide;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, h, 0, 0, Math.PI * 2);
      ctx.fillStyle = whites;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(px, py + h * 0.2, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      if (!ghost) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px + r * 0.22, py - h * 0.15, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      ctx.ellipse(0, h * 0.15, r * 1.08, h * 1.05, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      break;
    }
    case 'dot':
      ctx.beginPath();
      ctx.ellipse(px * 0.5, py * 0.5, r * 0.42 * wide, r * 0.55 * wide, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: {
      const ry = (style === 'almond' ? r * 0.72 : r * 1.12) * wide;
      const rx = (style === 'almond' ? r * 1.1 : r * 0.92) * wide;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = whites;
      ctx.fill();
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(px, py + ry * 0.12, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (!ghost) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px + r * 0.2, py - ry * 0.12, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      if (style === 'lashes') {
        ctx.lineWidth = lw * 0.8;
        for (const a of [-0.55, -0.15, 0.25]) {
          const ang = -Math.PI / 2 + a * sx;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * rx * 0.95, Math.sin(ang) * ry * 0.95);
          ctx.lineTo(Math.cos(ang) * rx * 1.35, Math.sin(ang) * ry * 1.35);
          ctx.stroke();
        }
      }
    }
  }
  if (mode === 'deadpan') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw * 1.3;
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, -r * 0.05);
    ctx.lineTo(r * 1.15, -r * 0.05);
    ctx.stroke();
  }
}

function drawBrow(ctx: CanvasRenderingContext2D, style: string, lw: number) {
  ctx.beginPath();
  switch (style) {
    case 'straight':
      ctx.lineWidth = lw * 1.3;
      ctx.moveTo(-0.15, 0);
      ctx.lineTo(0.15, 0);
      break;
    case 'arched':
      ctx.lineWidth = lw * 1.2;
      ctx.moveTo(-0.17, 0.04);
      ctx.quadraticCurveTo(0.02, -0.1, 0.17, 0.02);
      break;
    case 'thick':
      ctx.lineWidth = lw * 2.4;
      ctx.moveTo(-0.15, 0.01);
      ctx.quadraticCurveTo(0, -0.04, 0.15, 0.01);
      break;
    case 'thin':
      ctx.lineWidth = lw * 0.7;
      ctx.moveTo(-0.16, 0.02);
      ctx.quadraticCurveTo(0, -0.05, 0.16, 0.02);
      break;
    default:
      ctx.lineWidth = lw * 1.05;
      ctx.moveTo(-0.17, 0.02);
      ctx.quadraticCurveTo(0, -0.05, 0.16, 0.0);
  }
  ctx.stroke();
}

function drawNose(ctx: CanvasRenderingContext2D, style: string) {
  const y = 0.24;
  ctx.beginPath();
  switch (style) {
    case 'round':
      ctx.arc(0, y, 0.09, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      break;
    case 'dot':
      ctx.arc(-0.05, y + 0.03, 0.022, 0, Math.PI * 2);
      ctx.arc(0.05, y + 0.03, 0.022, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'line':
      ctx.moveTo(0.02, y - 0.1);
      ctx.quadraticCurveTo(0.08, y, 0.0, y + 0.05);
      ctx.stroke();
      break;
    case 'none':
      break;
    default:
      ctx.moveTo(-0.07, y + 0.01);
      ctx.quadraticCurveTo(0, y + 0.08, 0.07, y + 0.01);
      ctx.stroke();
  }
}

function drawMouth(ctx: CanvasRenderingContext2D, look: Look, ex: FaceExpr, ink: string, lw: number, ghost: boolean) {
  const y = 0.52;
  ctx.strokeStyle = ghost ? ink : shade(look.lip, -0.25);
  ctx.lineWidth = lw;
  const kind = ex.mouth === 'default' ? look.mouth : ex.mouth;
  ctx.beginPath();
  switch (kind) {
    case 'flat':
      ctx.moveTo(-0.16, y);
      ctx.lineTo(0.16, y);
      ctx.stroke();
      break;
    case 'wavy':
      ctx.moveTo(-0.22, y);
      for (let i = 1; i <= 8; i++) ctx.lineTo(-0.22 + i * 0.055, y + (i % 2 ? -0.035 : 0.035));
      ctx.stroke();
      break;
    case 'o':
      ctx.ellipse(0, y + 0.02, 0.08, 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = ghost ? 'rgba(90,86,100,0.35)' : '#5a2236';
      ctx.fill();
      ctx.stroke();
      break;
    case 'grin':
      ctx.moveTo(-0.26, y - 0.04);
      ctx.quadraticCurveTo(0, y + 0.34, 0.26, y - 0.04);
      ctx.quadraticCurveTo(0, y + 0.02, -0.26, y - 0.04);
      ctx.fillStyle = ghost ? 'rgba(255,255,255,0.5)' : '#6b2438';
      ctx.fill();
      if (!ghost) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-0.3, y - 0.06, 0.6, 0.1);
        ctx.restore();
      }
      ctx.stroke();
      break;
    case 'small':
      ctx.moveTo(-0.08, y);
      ctx.quadraticCurveTo(0, y + 0.06, 0.08, y);
      ctx.stroke();
      break;
    case 'pout':
      ctx.ellipse(0, y + 0.01, 0.09, 0.055, 0, 0, Math.PI * 2);
      ctx.fillStyle = ghost ? 'rgba(255,255,255,0.4)' : look.lip;
      ctx.fill();
      ctx.lineWidth = lw * 0.7;
      ctx.stroke();
      break;
    case 'cat':
      ctx.moveTo(-0.18, y - 0.02);
      ctx.quadraticCurveTo(-0.09, y + 0.09, 0, y);
      ctx.quadraticCurveTo(0.09, y + 0.09, 0.18, y - 0.02);
      ctx.stroke();
      break;
    default:
      if (!ghost) {
        ctx.fillStyle = look.lip;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.ellipse(0, y + 0.03, 0.17, 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.moveTo(-0.2, y - 0.01);
      ctx.quadraticCurveTo(0, y + 0.09, 0.2, y - 0.01);
      ctx.stroke();
  }
}

// ---------- bangs (painted on the 3D texture and on 2D heads) ----------

/** Paints the fringe hanging from a hairline at `hairlineY` down over the forehead. */
export function drawBangs(ctx: CanvasRenderingContext2D, look: Look, s: number, cx: number, hairlineY: number, o: DrawOpts = {}) {
  if (look.hair === 'buzz' || look.bangs === 'none') return;
  const W = o.wobble;
  ctx.save();
  ctx.translate(cx, hairlineY);
  ctx.scale(s, s);
  const fill = o.ghost ? 'rgba(120,116,130,0.35)' : look.hairColor;
  ctx.fillStyle = fill;
  const strand = (x: number, len: number, bend: number, wdt: number, i: number) => {
    const j = jit(W, i, 0.02);
    ctx.beginPath();
    ctx.moveTo(x - wdt, -0.02);
    ctx.quadraticCurveTo(x + bend * 0.5 - wdt * 0.4, len * 0.6, x + bend + j, len);
    ctx.quadraticCurveTo(x + bend * 0.5 + wdt * 0.4, len * 0.55, x + wdt, -0.02);
    ctx.closePath();
    ctx.fill();
  };
  switch (look.bangs) {
    case 'wispy': {
      const xs = [-0.95, -0.72, -0.5, -0.3, -0.12, 0.12, 0.3, 0.5, 0.72, 0.95];
      xs.forEach((x, i) => {
        const side = x < 0 ? -1 : 1;
        const len = 0.25 + Math.abs(x) * 0.22 + (i % 3) * 0.05;
        strand(x, len, side * (0.05 + Math.abs(x) * 0.12), 0.09, i);
      });
      ctx.lineWidth = 0.035;
      ctx.strokeStyle = fill;
      ctx.lineCap = 'round';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 1.02, 0);
        ctx.quadraticCurveTo(sx * 1.12, 0.45, sx * (0.98 + jit(W, sx + 20, 0.03)), 0.95);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx * 0.9, 0.02);
        ctx.quadraticCurveTo(sx * 1.0, 0.35, sx * 0.92, 0.7);
        ctx.stroke();
      }
      break;
    }
    case 'curtain':
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 0.04, -0.02);
        ctx.quadraticCurveTo(sx * 0.15, 0.38, sx * 0.95, 0.5);
        ctx.lineTo(sx * 1.15, 0.5);
        ctx.lineTo(sx * 1.15, -0.02);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'blunt':
      ctx.beginPath();
      ctx.moveTo(-1.1, -0.05);
      ctx.lineTo(-1.05, 0.3);
      ctx.quadraticCurveTo(0, 0.36, 1.05, 0.3);
      ctx.lineTo(1.1, -0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'side':
      ctx.beginPath();
      ctx.moveTo(-1.15, -0.05);
      ctx.quadraticCurveTo(-0.6, 0.15, 0.2, 0.42);
      ctx.quadraticCurveTo(0.7, 0.5, 1.12, 0.3);
      ctx.lineTo(1.15, -0.05);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

// ---------- egg-shaped 2D head (thumbnails, avatars, splash) ----------

/** Egg outline, wider at the bottom. Centre (cx, cy), half-width w, half-height h. */
export function eggPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, wob?: number) {
  const N = 40;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const y = -Math.cos(t);
    // ellipse, a touch wider toward the bottom
    const r = 1 + 0.12 * y;
    const x = cx + Math.sin(t) * r * w + jit(wob, i % N, 0.012 * w);
    const yy = cy + y * h + jit(wob, (i % N) + 99, 0.012 * h);
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  }
  ctx.closePath();
}

/**
 * A front-facing egg Mii: back hair, egg body with outfit band, front hair, bangs and face.
 * (cx, cy) is the egg centre, `s` its half-width before the look's width scale.
 */
export function drawHead2D(ctx: CanvasRenderingContext2D, look: Look, cx: number, cy: number, s: number, ex: FaceExpr = NEUTRAL, o: DrawOpts = {}) {
  const w = s * look.width;
  const h = s * 1.32 * look.height;
  const ghost = o.ghost === true;
  const hairFill = ghost ? 'rgba(150,146,160,0.28)' : look.hairColor;
  const W = o.wobble;
  const top = cy - h;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.fillStyle = hairFill;
  if (look.hair === 'long') {
    ctx.beginPath();
    ctx.ellipse(cx, cy - h * 0.05, w * 1.12, h * 0.98, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.hair === 'bob') {
    ctx.beginPath();
    ctx.ellipse(cx, cy - h * 0.32, w * 1.12, h * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.hair === 'lowbun') {
    ctx.beginPath();
    ctx.arc(cx + w * 0.8, cy - h * 0.08, w * 0.26, 0, Math.PI * 2);
    ctx.fill();
  }

  eggPath(ctx, cx, cy, w, h, W);
  ctx.fillStyle = ghost ? 'rgba(255,255,255,0.5)' : look.skin;
  ctx.fill();
  if (!ghost) {
    ctx.save();
    eggPath(ctx, cx, cy, w, h);
    ctx.clip();
    ctx.fillStyle = look.outfit;
    ctx.fillRect(cx - w * 1.5, cy + h * 0.38, w * 3, h);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(cx - w * 1.5, cy + h * 0.38, w * 3, h * 0.04);
    const g = ctx.createRadialGradient(cx - w * 0.35, cy - h * 0.45, w * 0.1, cx, cy, w * 1.6);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.6, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(60,30,60,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - w * 1.5, cy - h * 1.2, w * 3, h * 2.4);
    ctx.restore();
  }

  const capY = top + h * 0.42;
  ctx.save();
  ctx.fillStyle = hairFill;
  if (look.hair !== 'buzz') {
    ctx.beginPath();
    ctx.ellipse(cx, capY, w * 0.97, h * 0.47, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.globalAlpha = ghost ? 0.4 : 0.85;
    eggPath(ctx, cx, cy, w, h);
    ctx.clip();
    ctx.fillRect(cx - w * 1.2, top - 10, w * 2.4, h * 0.42 + 10);
  }
  ctx.restore();

  ctx.fillStyle = hairFill;
  switch (look.hair) {
    case 'bun':
      ctx.beginPath();
      ctx.arc(cx, top - w * 0.1, w * 0.38, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ponytail':
      for (const [dx, dy, r] of [
        [0.95, 0.15, 0.26],
        [1.2, 0.35, 0.22],
        [1.32, 0.62, 0.17],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + w * dx, top + h * dy, w * r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'curls':
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.92, capY + Math.sin(a) * h * 0.47, w * 0.24, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'spikes':
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const x0 = cx - w * 0.9 + (i / 6) * w * 1.8;
        ctx.moveTo(x0 - w * 0.18, capY - h * 0.25);
        ctx.lineTo(x0 + (i - 3) * w * 0.05, top - h * (0.18 + (i % 2) * 0.08));
        ctx.lineTo(x0 + w * 0.18, capY - h * 0.25);
      }
      ctx.fill();
      break;
    case 'pixie':
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.95, capY);
      ctx.quadraticCurveTo(cx - w * 0.2, top - h * 0.16, cx + w * 1.02, capY - h * 0.05);
      ctx.lineTo(cx + w * 0.98, capY + h * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'long':
    case 'bob':
      for (const sx of [-1, 1]) {
        const deep = look.hair === 'long';
        ctx.beginPath();
        ctx.moveTo(cx + sx * w * 0.98, capY);
        ctx.quadraticCurveTo(cx + sx * w * 1.08, cy + h * (deep ? 0.5 : 0.05), cx + sx * w * 0.82, cy + h * (deep ? 0.75 : 0.15));
        ctx.lineTo(cx + sx * w * 0.72, capY);
        ctx.closePath();
        ctx.fill();
      }
      break;
  }

  if (o.back) {
    // back of the head: hair down to the nape, bun in the middle
    ctx.save();
    eggPath(ctx, cx, cy, w, h);
    ctx.clip();
    ctx.fillStyle = hairFill;
    ctx.beginPath();
    ctx.ellipse(cx, top + h * 0.2, w * 1.3, h * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (look.hair === 'lowbun' || look.hair === 'bun') {
      ctx.fillStyle = hairFill;
      ctx.beginPath();
      ctx.arc(cx, look.hair === 'bun' ? top - w * 0.1 : cy - h * 0.05, w * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const faceS = w * 0.62;
    const faceY = cy - h * 0.1;
    drawFace(ctx, look, ex, cx, faceY, faceS, o);
    drawBangs(ctx, look, faceS * 1.3, cx, capY, o);
    if (look.glasses !== 'none') drawGlasses2D(ctx, look, cx, faceY - faceS * 0.05, faceS, ghost);
  }

  if (ghost || o.ink) {
    eggPath(ctx, cx, cy, w, h, W);
    ctx.strokeStyle = o.ink ?? 'rgba(90,86,100,0.7)';
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGlasses2D(ctx: CanvasRenderingContext2D, look: Look, cx: number, cy: number, s: number, ghost: boolean) {
  const gap = 0.4 * look.eyeGap * s;
  const r = 0.27 * s;
  ctx.save();
  ctx.strokeStyle = ghost ? 'rgba(90,86,100,0.6)' : look.glassesColor;
  ctx.lineWidth = Math.max(1.2, s * 0.06);
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (look.glasses === 'square') ctx.roundRect(cx + sx * gap - r, cy - r * 0.8, r * 2, r * 1.6, r * 0.25);
    else if (look.glasses === 'star') starPath(ctx, cx + sx * gap, cy, r * 1.15, r * 0.55);
    else ctx.arc(cx + sx * gap, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - gap + r * 0.95, cy - r * 0.15);
  ctx.quadraticCurveTo(cx, cy - r * 0.45, cx + gap - r * 0.95, cy - r * 0.15);
  ctx.stroke();
  ctx.restore();
}

function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number) {
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

/** Small square avatar for lists. */
export function avatarDataUrl(look: Look, size = 96, ex: FaceExpr = NEUTRAL): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  drawHead2D(ctx, look, size / 2, size * 0.57, size * 0.29, ex);
  return c.toDataURL('image/png');
}
