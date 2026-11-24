import type { Look } from '../shared/look.js';
import type { FakeTellKind, Phase } from '../game/state';
import { drawHead2D, outlined, type FaceExpr } from '../face2d';

// She is a flat cartoon cut-out. The character is painted once per pose onto her own canvas
// (bold outlines are costly, so that only happens when her pose actually changes), and the
// stage draws that canvas every frame with a jelly squash-and-stretch transform on top.

/** egg height in world units at look.height = 1 */
const H = 2.2;
const LEG = 0.2;
/** canvas size in world units */
const VIEW_W = 3.3;
const VIEW_H = 3.5;
/** world units of room under the soles for the outline */
const PAD_U = 0.16;

export interface EggFrame {
  dt: number;
  time: number;
  phase: Phase;
  tension: number;
  holding: boolean;
  fakeTell: FakeTellKind | null;
  idleMs: number;
  /** seconds since the pop, or -1 */
  popAge: number;
  reduced: boolean;
  /** seconds since the last bank, or -1 */
  bankAge: number;
}

/** Where to draw her this frame, in world units (y up, floor at 0). */
export interface EggTransform {
  /** her centre */
  x: number;
  y: number;
  /** radians, counter-clockwise */
  rot: number;
  sx: number;
  sy: number;
  /** sweat drop offset from her centre, or null */
  sweat: { x: number; y: number } | null;
}

interface Pose {
  ex: FaceExpr;
  /** arm angle from hanging straight down, positive = away from her body */
  arms: [number, number];
  /** leg angle, positive = away from her body */
  legs: [number, number];
  /** how far the tapping foot is lifted, 0..1 */
  tap: number;
  puff: number;
  cracks: number;
  popped: boolean;
}

const q = (v: number, step: number) => Math.round(v / step) * step;
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Egg {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  /** canvas pixels per world unit, set to match the screen so she stays crisp but cheap */
  ppu = 160;
  private look!: Look;
  private paintKey = '';
  /** her centre height when standing */
  centerY = LEG + H / 2;
  readonly t: EggTransform = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, sweat: null };

  private blinkT = 0;
  private nextBlink = 2;
  private blinking = 0;
  private glance = 0;
  private glanceTimer = 0;
  private dart = { x: 0, y: 0, t: 0 };
  private shakeSeed = Math.random() * 100;
  // jelly physics: a hop height with gravity, and a springy vertical scale
  private hop = 0;
  private vy = 0;
  private sq = 1;
  private vsq = 0;
  private nextHop = 2.5;
  private lastBank = -1;

  constructor(look: Look) {
    this.ctx = this.canvas.getContext('2d')!;
    this.applyLook(look);
  }

  /** canvas pixel that sits on world (0, 0), before her transform */
  get anchor(): { x: number; y: number } {
    return { x: this.canvas.width / 2, y: this.canvas.height - PAD_U * this.ppu };
  }

  setResolution(ppu: number) {
    const p = Math.round(Math.min(260, Math.max(90, ppu)));
    if (p === this.ppu && this.canvas.width) return;
    this.ppu = p;
    this.canvas.width = Math.round(VIEW_W * p);
    this.canvas.height = Math.round(VIEW_H * p);
    this.paintKey = '';
  }

  headTop(): { x: number; y: number } {
    const t = this.t;
    const up = (H * this.look.height) / 2 + 0.35;
    return { x: t.x - Math.sin(t.rot) * up, y: t.y + Math.cos(t.rot) * up * t.sy };
  }

  applyLook(look: Look): void {
    this.look = look;
    this.centerY = LEG + (H * look.height) / 2;
    if (!this.canvas.width) this.setResolution(this.ppu);
    this.paintKey = '';
  }

  // ---------- painting ----------

  private paint(p: Pose) {
    const key = JSON.stringify(p);
    if (key === this.paintKey) return;
    this.paintKey = key;
    const c = this.ctx;
    const look = this.look;
    const U = this.ppu;
    const S = (H / 2.64) * U;
    const w = S * look.width * (1 + p.puff * 0.07);
    const h = S * 1.32 * look.height;
    const a = this.anchor;
    const cx = a.x;
    const cy = a.y - LEG * U - h;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // stubby arms and legs, behind the body
    outlined(c, S * 0.055, (g) => {
      g.lineCap = 'round';
      const limb = (x0: number, y0: number, ang: number, len: number, thick: number) => {
        const x1 = x0 + Math.sin(ang) * len;
        const y1 = y0 + Math.cos(ang) * len;
        g.strokeStyle = look.skin;
        g.lineWidth = thick;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        return [x1, y1] as const;
      };
      [-1, 1].forEach((sx, i) => {
        // round little sneakers in her outfit colour
        const lift = i === 1 ? p.tap * 0.08 * U : 0;
        const [fx, fy] = limb(cx + sx * 0.32 * U, a.y - (LEG + 0.12) * U - lift, sx * p.legs[i], 0.14 * U, 0.16 * U);
        g.save();
        g.translate(fx, fy);
        g.rotate(-sx * p.legs[i] * 0.7);
        g.fillStyle = look.outfit;
        g.beginPath();
        g.ellipse(sx * 0.05 * U, -0.01 * U, 0.18 * U, 0.12 * U, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(sx * 0.05 * U, 0.06 * U, 0.17 * U, 0.04 * U, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
        // nubby arms with round mitts
        const [hx, hy] = limb(cx + sx * w * 0.9, cy + h * 0.18, sx * p.arms[i], 0.26 * U, 0.17 * U);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(hx, hy, 0.12 * U, 0, Math.PI * 2);
        g.fill();
      });
    });

    drawHead2D(c, look, cx, cy, S, p.ex, {
      puff: p.puff,
      cracks: p.cracks,
      sooty: p.popped,
      frazzle: p.popped,
    });
  }

  // ---------- animation ----------

  update(f: EggFrame): void {
    const k = f.reduced ? 0.3 : 1;
    const t = f.time;
    const dt = Math.min(f.dt, 0.05);
    const tens = f.tension;
    const popped = f.popAge >= 0;

    // Blink rate is the most reliable tell: ~3s apart when calm, ~0.3s near the edge.
    this.blinkT += dt;
    if (this.blinking > 0) this.blinking = Math.max(0, this.blinking - dt);
    if (this.blinkT >= this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = (3.2 + (0.28 - 3.2) * Math.pow(tens, 1.2)) * (0.8 + Math.random() * 0.4);
      this.blinking = 0.11;
    }

    const ex: FaceExpr = { eyes: 'open', mouth: 'default', worry: 0, lookX: 0, lookY: 0, flush: 0 };
    let shake = 0;
    if (popped) {
      ex.eyes = 'deadpan';
      ex.mouth = 'flat';
      ex.flush = 0.5;
    } else if (f.fakeTell === 'serene') {
      ex.eyes = 'happy';
      ex.mouth = 'grin';
      shake = Math.max(0, tens - 0.6) * 0.35;
    } else if (f.fakeTell === 'panic') {
      ex.eyes = 'wide';
      ex.mouth = 'o';
      ex.worry = 0.9;
      shake = 0.6;
    } else {
      if (tens > 0.72) ex.mouth = 'wavy';
      else if (tens > 0.45) ex.mouth = 'flat';
      if (f.holding) {
        ex.worry = q(Math.min(1, tens * 1.1), 0.1);
        if (tens > 0.6) ex.eyes = 'wide';
      }
      shake = Math.max(0, tens - 0.55) / 0.45;
      if (f.bankAge >= 0 && f.bankAge < 0.6) {
        ex.mouth = 'grin';
        ex.eyes = 'happy';
      }
    }
    if (this.blinking > 0 && ex.eyes !== 'happy' && !popped) ex.eyes = 'blink';
    // flush: a slow, consistent cue
    ex.flush = Math.max(ex.flush, q(Math.pow(tens, 1.5), 0.1));

    // glance at the covered gauge (screen-left) on long holds, small idle darts otherwise
    this.glanceTimer -= dt;
    if (f.holding && tens > 0.5 && this.glanceTimer <= 0 && !f.fakeTell) {
      this.glance = this.glance > 0.5 ? 0 : 1;
      this.glanceTimer = this.glance ? 0.6 : 0.9 + Math.random() * 0.8;
    }
    if (!f.holding || popped) this.glance = 0;
    this.dart.t -= dt;
    if (this.dart.t <= 0) this.dart = { x: q((Math.random() - 0.5) * 0.7, 0.1), y: q((Math.random() - 0.5) * 0.4, 0.1), t: 1.2 + Math.random() * 2.2 };
    ex.lookX = this.glance ? -1 : popped || f.reduced ? 0 : this.dart.x;
    ex.lookY = this.glance ? -0.6 : popped || f.reduced ? 0 : this.dart.y;

    const cracks = popped ? 5 : tens > 0.72 ? Math.min(5, 1 + Math.floor((tens - 0.72) / 0.05)) : 0;
    const puff = popped ? 0 : f.holding ? q(smooth(tens, 0.3, 0.9), 0.1) : 0;

    // limbs: wave on a bank, brace on a long hold, splay when she goes down
    const popE = popped ? 1 - Math.pow(1 - Math.min(1, f.popAge / 0.3), 3) : 0;
    const cheer = f.bankAge >= 0 && f.bankAge < 0.7 ? 1 - f.bankAge / 0.7 : 0;
    const tense = f.holding ? smooth(tens, 0.5, 0.85) : 0;
    const arms = [0, 1].map((i) =>
      popped
        ? q(0.5 + popE * 1.1, 0.05)
        : q(0.5 + Math.sin(t * 2 + i) * 0.08 * k + cheer * (2.2 + Math.sin(t * 22 + i * 3) * 0.25) + tense * 1.1, 0.05),
    ) as [number, number];
    const tapping = !popped && f.phase === 'ready' && f.idleMs > 1800;
    const tap = tapping ? q(Math.max(0, Math.sin(t * 13)) * (f.reduced ? 0.5 : 1), 0.25) : 0;
    const legs: [number, number] = popped ? [q(popE * 1.5, 0.05), q(-popE * 0.6, 0.05)] : this.hop > 0.02 ? [0.25, 0.25] : [0.06, 0.06];

    this.paint({ ex, arms, legs, tap, puff, cracks, popped });

    // ---- jelly motion
    // a happy hop on every bank, and little idle hops while she waits
    const newBank = f.bankAge >= 0 && (this.lastBank < 0 || f.bankAge < this.lastBank);
    this.lastBank = f.bankAge;
    if (newBank) {
      if (this.hop <= 0.001) {
        this.vy = f.reduced ? 1.2 : 3.1;
        this.vsq -= 2.5 * k; // crouch first
      }
    }
    this.nextHop -= dt;
    if (!popped && !f.holding && f.phase === 'ready' && this.nextHop <= 0 && !tapping) {
      this.nextHop = 2.2 + Math.random() * 2.5;
      if (!f.reduced && this.hop <= 0.001) this.vy = 1.7;
    }
    if (f.holding || popped) this.nextHop = Math.max(this.nextHop, 1.5);

    if (this.hop > 0 || this.vy > 0) {
      this.vy -= 15 * dt;
      this.hop += this.vy * dt;
      if (this.hop <= 0) {
        // landing: a squishy splat
        this.vsq += Math.min(0, this.vy) * 0.9 * k;
        this.hop = 0;
        this.vy = 0;
      }
    }
    const air = this.hop > 0 ? Math.max(-0.12, Math.min(0.14, this.vy * 0.045)) : 0;
    const breathe = Math.sin(t * 2.4) * 0.018 * k;
    const sqTarget = popped ? 1 : f.holding ? 1 - (0.06 + tens * 0.07) : 1 + breathe + air;
    // under-damped spring, so she wobbles like jelly when anything changes
    this.vsq += ((sqTarget - this.sq) * 210 - this.vsq * 11) * dt;
    this.sq += this.vsq * dt;
    const sy = this.sq;
    const sx = 1 + (1 - sy) * 0.85;

    const wob = (0.035 + tens * tens * 0.1) * k;
    const freq = 2 + tens * 7;
    const jitter = shake * 0.035 * k;
    const n1 = Math.sin(t * 61 + this.shakeSeed) * Math.sin(t * 37);
    const n2 = Math.sin(t * 53 + 2.1) * Math.cos(t * 29);

    const T = this.t;
    if (popped) {
      // she keels over onto her side with a bounce
      const lieY = H * 0.5 * this.look.width * 0.86;
      const land = Math.max(0, f.popAge - 0.3);
      const bounce = Math.abs(Math.sin(land * 9)) * Math.exp(-land * 5) * 0.25 * k;
      T.rot = -1.45 * popE;
      T.x = 0.15 * popE;
      T.y = lerp(this.centerY, lieY, popE) + bounce;
      T.sx = 1 + bounce * 0.4;
      T.sy = 1 - bounce * 0.4;
      T.sweat = null;
      return;
    }
    T.rot = Math.sin(t * freq) * wob + n2 * jitter + Math.sin(t * 1.3) * 0.025 * k;
    T.x = n1 * jitter;
    // squash around her feet: the centre drops with the squash, plus the hop
    T.y = this.centerY * sy + this.hop;
    T.sx = sx;
    T.sy = sy;
    const sweatOn = tens > 0.6 && f.fakeTell !== 'serene';
    const eggH = H * this.look.height;
    T.sweat = sweatOn ? { x: 0.72 * this.look.width, y: eggH * 0.3 - ((t * 0.9) % 1) * 0.4 } : null;
  }
}

export function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const EGG_HEIGHT = H + LEG;
