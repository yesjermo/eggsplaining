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
      // parted in the middle, so a sliver of forehead shows between the two sides
      const xs = [-0.95, -0.74, -0.54, -0.36, 0.36, 0.54, 0.74, 0.95];
      xs.forEach((x, i) => {
        const side = x < 0 ? -1 : 1;
        const len = 0.25 + Math.abs(x) * 0.22 + (i % 3) * 0.05;
        // wide enough to overlap at the root, so the fringe reads as one jagged shape
        strand(x, len, side * (0.05 + Math.abs(x) * 0.12), 0.13, i);
      });
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = fill;
      ctx.lineCap = 'round';
      // one face-framing tendril each side
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * 1.0, 0);
        ctx.quadraticCurveTo(sx * 1.1, 0.45, sx * (0.98 + jit(W, sx + 20, 0.03)), 0.9);
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

// ---------- bold cartoon outlines ----------

let scratchA: HTMLCanvasElement | null = null;
let scratchB: HTMLCanvasElement | null = null;
function sized(c: HTMLCanvasElement | null, w: number, h: number): HTMLCanvasElement {
  const s = c ?? document.createElement('canvas');
  if (s.width !== w || s.height !== h) {
    s.width = w;
    s.height = h;
  }
  return s;
}

/**
 * Draws one flat layer, then rings its whole silhouette with a thick ink outline, like a
 * cartoon cel. `lw` is the outline width in the caller's units (the current transform applies).
 */
export function outlined(ctx: CanvasRenderingContext2D, lw: number, draw: (c: CanvasRenderingContext2D) => void, ink = INK): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  scratchA = sized(scratchA, W, H);
  scratchB = sized(scratchB, W, H);
  const a = scratchA.getContext('2d')!;
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, W, H);
  a.setTransform(ctx.getTransform());
  a.lineJoin = 'round';
  a.lineCap = 'round';
  a.globalAlpha = 1;
  draw(a);
  const b = scratchB.getContext('2d')!;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, W, H);
  b.drawImage(scratchA, 0, 0);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = ink;
  b.fillRect(0, 0, W, H);
  b.globalCompositeOperation = 'source-over';
  const m = ctx.getTransform();
  const r = lw * Math.hypot(m.a, m.b);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const steps = r > 4 ? 20 : 12;
  for (const k of r > 2 ? [1, 0.55] : [1])
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      ctx.drawImage(scratchB, Math.cos(t) * r * k, Math.sin(t) * r * k);
    }
  ctx.drawImage(scratchA, 0, 0);
  ctx.restore();
}

export interface HeadExtras {
  /** 0..1 puffed cheeks: the egg widens a little */
  puff?: number;
  /** 0..5 hairline cracks across the shell */
  cracks?: number;
  /** soot smudges after a pop */
  sooty?: boolean;
  /** hair standing on end after a pop */
  frazzle?: boolean;
}

/**
 * A front-facing egg Mii: back hair, egg body with outfit band, face, front hair and bangs.
 * (cx, cy) is the egg centre, `s` its half-width before the look's width scale.
 * Drawn as flat cartoon cels with bold ink outlines, except for the sketchy ghost and ink styles.
 */
export function drawHead2D(
  ctx: CanvasRenderingContext2D,
  look: Look,
  cx: number,
  cy: number,
  s: number,
  ex: FaceExpr = NEUTRAL,
  o: DrawOpts & HeadExtras = {},
) {
  const w = s * look.width * (1 + (o.puff ?? 0) * 0.07);
  const h = s * 1.32 * look.height;
  const ghost = o.ghost === true;
  const toon = !ghost && !o.ink;
  const hairFill = ghost ? 'rgba(150,146,160,0.28)' : look.hairColor;
  const W = o.wobble;
  const top = cy - h;
  const capY = top + h * 0.42;
  const lw = Math.max(1, s * 0.075);
  const layer = (draw: (c: CanvasRenderingContext2D) => void) => {
    if (toon) outlined(ctx, lw, draw);
    else {
      ctx.save();
      draw(ctx);
      ctx.restore();
    }
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // hair behind the head
  if (!o.back && (look.hair === 'long' || look.hair === 'bob' || look.hair === 'lowbun'))
    layer((c) => {
      c.fillStyle = hairFill;
      c.beginPath();
      if (look.hair === 'long') c.ellipse(cx, cy - h * 0.05, w * 1.12, h * 0.98, 0, 0, Math.PI * 2);
      else if (look.hair === 'bob') c.ellipse(cx, cy - h * 0.32, w * 1.12, h * 0.72, 0, 0, Math.PI * 2);
      else c.arc(cx + w * 0.8, cy - h * 0.08, w * 0.26, 0, Math.PI * 2);
      c.fill();
      if (toon && look.hair === 'lowbun') {
        // scrunchie where the bun meets her head
        c.fillStyle = look.outfit;
        c.beginPath();
        c.ellipse(cx + w * 0.66, cy - h * 0.08, w * 0.07, w * 0.17, 0.2, 0, Math.PI * 2);
        c.fill();
      }
    });

  // the egg body
  layer((c) => {
    eggPath(c, cx, cy, w, h, W);
    c.fillStyle = ghost ? 'rgba(255,255,255,0.5)' : look.skin;
    c.fill();
    if (ghost) return;
    c.save();
    eggPath(c, cx, cy, w, h);
    c.clip();
    c.fillStyle = look.outfit;
    c.fillRect(cx - w * 1.5, cy + h * 0.38, w * 3, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillRect(cx - w * 1.5, cy + h * 0.38, w * 3, h * 0.04);
    if (toon) {
      // flat cel shading: one shadow crescent and one shine, no gradients
      c.fillStyle = 'rgba(70,30,70,0.12)';
      c.beginPath();
      // everything outside an ellipse nudged up-left: a crescent on the lower right
      c.rect(cx - w * 2, cy - h * 2, w * 4, h * 4);
      c.ellipse(cx - w * 0.12, cy - h * 0.07, w * 1.0, h * 1.02, 0, 0, Math.PI * 2);
      c.fill('evenodd');
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.beginPath();
      c.ellipse(cx - w * 0.58, cy - h * 0.2, w * 0.09, h * 0.16, 0.35, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = lw * 0.55;
      c.beginPath();
      c.moveTo(cx - w * 1.5, cy + h * 0.38);
      c.lineTo(cx + w * 1.5, cy + h * 0.38);
      c.stroke();
    } else {
      const g = c.createRadialGradient(cx - w * 0.35, cy - h * 0.45, w * 0.1, cx, cy, w * 1.6);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(0.6, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(60,30,60,0.18)');
      c.fillStyle = g;
      c.fillRect(cx - w * 1.5, cy - h * 1.2, w * 3, h * 2.4);
    }
    if (o.sooty) {
      c.fillStyle = 'rgba(70,60,66,0.35)';
      for (const [x, y, r] of [
        [-0.55, 0.15, 0.2],
        [0.6, -0.35, 0.15],
        [0.2, 0.25, 0.11],
      ] as const) {
        c.beginPath();
        c.arc(cx + x * w, cy + y * h, r * w, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (o.cracks) {
      c.strokeStyle = INK;
      c.lineWidth = lw * 0.6;
      // they start below the fringe, where you can actually see them, and run down her cheeks
      const starts: [number, number][] = [
        [-0.66, 0.24],
        [0.64, 0.2],
        [-0.84, 0.36],
        [0.84, 0.32],
        [0.02, 0.02],
      ];
      for (let i = 0; i < Math.min(5, o.cracks); i++) {
        let x = cx + starts[i][0] * w;
        let y = capY + h * starts[i][1];
        c.beginPath();
        c.moveTo(x, y);
        for (let k = 0; k < 5; k++) {
          y += h * (0.07 + ((i * 7 + k * 13) % 9) * 0.006);
          x += (k % 2 ? 1 : -1) * w * (0.06 + ((i + k) % 3) * 0.03);
          c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    c.restore();
  });

  const faceS = w * 0.62;
  const faceY = cy - h * 0.1;
  if (!o.back) drawFace(ctx, look, ex, cx, faceY, faceS, o);

  // hair on top: cap, style, bangs
  layer((c) => {
    c.fillStyle = hairFill;
    if (o.frazzle) {
      // standing on end after the pop
      c.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 1.12 + (i / 8) * Math.PI * 0.76;
        const bx = cx + Math.cos(a) * w * 0.8;
        const by = capY + Math.sin(a) * h * 0.4;
        const len = h * (0.32 + (i % 3) * 0.08);
        c.moveTo(bx - Math.sin(a) * w * 0.12, by + Math.cos(a) * w * 0.12);
        c.lineTo(bx + Math.cos(a) * len, by + Math.sin(a) * len);
        c.lineTo(bx + Math.sin(a) * w * 0.12, by - Math.cos(a) * w * 0.12);
      }
      c.fill();
    }
    if (look.hair !== 'buzz') {
      c.beginPath();
      c.ellipse(cx, capY, w * 0.97, h * 0.47, 0, Math.PI, Math.PI * 2);
      c.closePath();
      c.fill();
    } else {
      c.save();
      c.globalAlpha = ghost ? 0.4 : 0.85;
      eggPath(c, cx, cy, w, h);
      c.clip();
      c.fillRect(cx - w * 1.2, top - 10, w * 2.4, h * 0.42 + 10);
      c.restore();
    }
    switch (look.hair) {
      case 'bun':
        c.beginPath();
        c.arc(cx, top - w * 0.1, w * 0.38, 0, Math.PI * 2);
        c.fill();
        break;
      case 'ponytail':
        for (const [dx, dy, r] of [
          [0.95, 0.15, 0.26],
          [1.2, 0.35, 0.22],
          [1.32, 0.62, 0.17],
        ] as const) {
          c.beginPath();
          c.arc(cx + w * dx, top + h * dy, w * r, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'curls':
        for (let i = 0; i < 9; i++) {
          const a = Math.PI + (i / 8) * Math.PI;
          c.beginPath();
          c.arc(cx + Math.cos(a) * w * 0.92, capY + Math.sin(a) * h * 0.47, w * 0.24, 0, Math.PI * 2);
          c.fill();
        }
        break;
      case 'spikes':
        c.beginPath();
        for (let i = 0; i < 7; i++) {
          const x0 = cx - w * 0.9 + (i / 6) * w * 1.8;
          c.moveTo(x0 - w * 0.18, capY - h * 0.25);
          c.lineTo(x0 + (i - 3) * w * 0.05, top - h * (0.18 + (i % 2) * 0.08));
          c.lineTo(x0 + w * 0.18, capY - h * 0.25);
        }
        c.fill();
        break;
      case 'pixie':
        c.beginPath();
        c.moveTo(cx - w * 0.95, capY);
        c.quadraticCurveTo(cx - w * 0.2, top - h * 0.16, cx + w * 1.02, capY - h * 0.05);
        c.lineTo(cx + w * 0.98, capY + h * 0.05);
        c.closePath();
        c.fill();
        break;
      case 'long':
      case 'bob':
        for (const sx of [-1, 1]) {
          const deep = look.hair === 'long';
          c.beginPath();
          c.moveTo(cx + sx * w * 0.98, capY);
          c.quadraticCurveTo(cx + sx * w * 1.08, cy + h * (deep ? 0.5 : 0.05), cx + sx * w * 0.82, cy + h * (deep ? 0.75 : 0.15));
          c.lineTo(cx + sx * w * 0.72, capY);
          c.closePath();
          c.fill();
        }
        break;
    }
    if (o.back) {
      // back of the head: hair down to the nape, bun in the middle
      c.save();
      eggPath(c, cx, cy, w, h);
      c.clip();
      c.fillStyle = hairFill;
      c.beginPath();
      c.ellipse(cx, top + h * 0.2, w * 1.3, h * 0.95, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      if (look.hair === 'lowbun' || look.hair === 'bun') {
        c.fillStyle = hairFill;
        c.beginPath();
        c.arc(cx, look.hair === 'bun' ? top - w * 0.1 : cy - h * 0.05, w * 0.32, 0, Math.PI * 2);
        c.fill();
      }
    } else drawBangs(c, look, faceS * 1.3, cx, capY, o);
  });

  if (!o.back && look.glasses !== 'none') drawGlasses2D(ctx, look, cx, faceY - faceS * 0.05, faceS, ghost);

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
