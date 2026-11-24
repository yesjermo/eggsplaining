// Splash animation: she lies collapsed face-down while her soul floats up out of her,
// in a hand-drawn, line-boiling style. Pure 2D canvas so it shows before Three.js loads,
// and the same frames export to a GIF.

import type { Look } from './shared/look.js';
import { drawHead2D, eggPath } from './face2d';

const LOOP = 3.2; // seconds
const INK = '#2b2232';

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Draw one frame. (w, h) is the canvas size in px, `t` seconds since start.
 * `bg` paints an opaque background (needed for GIFs).
 */
export function drawSplashFrame(ctx: CanvasRenderingContext2D, look: Look, w: number, h: number, t: number, reduced = false, bg?: string) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (bg) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#f4efff');
    g.addColorStop(0.55, '#efe9fb');
    g.addColorStop(1, '#ffe7dc');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  const u = Math.min(w, h);
  const p = (t % LOOP) / LOOP;
  const seed = reduced ? 1 : Math.floor(t * 8); // line boil at 8 fps
  const bodyX = w * 0.46;
  const floorY = h * 0.86;
  const s = u * 0.14;

  // floor shadow
  ctx.fillStyle = 'rgba(70,50,90,0.12)';
  ctx.beginPath();
  ctx.ellipse(bodyX + s * 0.2, floorY + s * 0.08, s * 2.1, s * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // --- the collapsed body: tipped forward onto her face, sneakers in the air
  const slump = p > 0.86 ? Math.sin(((p - 0.86) / 0.14) * Math.PI) * 0.06 : 0; // tiny bonk when the soul snaps back
  ctx.save();
  ctx.translate(bodyX, floorY - s * 0.85);
  ctx.rotate(Math.PI / 2 - 0.12);
  ctx.scale(1 + slump, 1 - slump);
  // sneakers (behind the body, sticking up at the back end)
  for (const [dx, dy] of [
    [-0.45, 1.55],
    [0.25, 1.62],
  ] as const) {
    ctx.save();
    ctx.translate(dx * s, dy * s);
    ctx.rotate(-0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.3, s * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = look.outfit;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.stroke();
    ctx.restore();
  }
  drawHead2D(ctx, look, 0, 0, s, undefined, { back: true, ink: INK, wobble: seed });
  ctx.restore();

  // --- the soul
  // emerge 0-0.3, drift and sway 0.3-0.86, snap back 0.86-1
  let rise: number;
  if (p < 0.3) rise = ease(p / 0.3) * 0.75;
  else if (p < 0.86) rise = 0.75 + ease((p - 0.3) / 0.56) * 0.25;
  else rise = 1 - ease((p - 0.86) / 0.14);
  const alpha = p < 0.08 ? p / 0.08 : p > 0.94 ? (1 - p) / 0.06 : 1;
  const sway = reduced ? 0 : Math.sin(t * 2.4) * s * 0.35 * rise;
  const headX = bodyX + s * 1.2; // her head end (right side after the tip)
  const baseY = floorY - s * 1.3;
  const gx = headX - s * 0.7 * rise + sway;
  const gy = baseY - s * 2.7 * rise;
  if (rise > 0.02) {
    ctx.globalAlpha = 0.9 * alpha;
    // taffy tail from the body to the soul
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.strokeStyle = 'rgba(90,86,100,0.55)';
    ctx.lineWidth = Math.max(1.5, s * 0.04);
    ctx.beginPath();
    ctx.moveTo(headX - s * 0.25, baseY + s * 0.2);
    ctx.quadraticCurveTo(headX + (gx - headX) * 0.2 - s * 0.3, (baseY + gy) / 2, gx - s * 0.35, gy + s * 1.0);
    ctx.lineTo(gx + s * 0.35, gy + s * 1.0);
    ctx.quadraticCurveTo(headX + (gx - headX) * 0.2 + s * 0.5, (baseY + gy) / 2 + s * 0.3, headX + s * 0.35, baseY + s * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // floppy soul arms
    const flap = reduced ? 0 : Math.sin(t * 5) * 0.35;
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.lineCap = 'round';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(gx + sx * s * 0.78, gy + s * 0.25);
      ctx.quadraticCurveTo(gx + sx * s * 1.25, gy - s * (0.1 + flap * sx), gx + sx * s * 1.45, gy - s * (0.55 + flap * sx));
      ctx.strokeStyle = 'rgba(90,86,100,0.5)';
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(reduced ? 0 : Math.sin(t * 1.7) * 0.12);
    drawHead2D(ctx, look, 0, 0, s * 0.78, { eyes: 'closed', mouth: 'o', worry: 0.15, lookX: 0, lookY: 0, flush: 0 }, { ghost: true, wobble: seed });
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // little "z" marks / sparkles near the soul
  if (!reduced && rise > 0.5) {
    ctx.strokeStyle = 'rgba(90,86,100,0.5)';
    ctx.lineWidth = Math.max(1.5, s * 0.035);
    for (let i = 0; i < 3; i++) {
      const a = t * 1.3 + i * 2.1;
      const x = gx + Math.cos(a) * s * 1.6;
      const y = gy - s * 0.6 + Math.sin(a) * s * 0.7;
      const r = s * 0.08;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
    }
  }
  ctx.restore();
  void eggPath;
}

export class Splash {
  private raf = 0;
  private t0 = performance.now();
  constructor(
    private canvas: HTMLCanvasElement,
    private look: Look,
    private reduced: () => boolean,
  ) {}

  setLook(look: Look) {
    this.look = look;
  }

  start() {
    if (this.raf) return;
    const loop = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      const ctx = this.canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSplashFrame(ctx, this.look, w, h, (now - this.t0) / 1000, this.reduced());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/** Render the loop to an animated GIF (one full loop, 12.5 fps). */
export async function splashGif(look: Look, size = 480): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const fps = 12.5;
  const frames = Math.round(LOOP * fps);
  for (let i = 0; i < frames; i++) {
    drawSplashFrame(ctx, look, size, size, i / fps, false, 'bg');
    const { data } = ctx.getImageData(0, 0, size, size);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), size, size, { palette, delay: 1000 / fps });
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
