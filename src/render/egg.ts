import { CanvasTexture, Group, MathUtils, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { Look } from '../shared/look.js';
import type { FakeTellKind, Phase } from '../game/state';
import { drawHead2D, outlined, type FaceExpr } from '../face2d';

// She is a flat cartoon cut-out standing in the 3D chamber: the whole character is painted
// onto one canvas with bold outlines, and the plane it sits on squashes, wobbles and topples.

/** egg height and half-width in world units at look.height = look.width = 1 */
const H = 2.2;
const LEG = 0.22;
/** canvas pixels per world unit */
const PPU = 256;
const CW = 736;
const CH = 864;
/** room under the soles for the outline */
const PAD = 22;
const VIEW_W = CW / PPU;
const VIEW_H = CH / PPU;
/** drawHead2D's `s` that makes the egg H tall at look.height = 1 */
const S = (H / 2.64) * PPU;

const px = (x: number) => CW / 2 + x * PPU;
const py = (y: number) => CH - PAD - y * PPU;

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

export class Egg {
  readonly root = new Group();
  /** pivots at the egg's centre so she squashes and topples around it */
  private body = new Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private cutout: Mesh;
  private sweat: Mesh;
  private headTop = new Object3D();
  private look!: Look;
  private paintKey = '';
  private centerY = LEG + H / 2;

  private blinkT = 0;
  private nextBlink = 2;
  private blinking = 0;
  private glance = 0;
  private glanceTimer = 0;
  private dart = { x: 0, y: 0, t: 0 };
  private squash = 0;
  private shakeSeed = Math.random() * 100;

  static async create(look: Look): Promise<Egg> {
    return new Egg(look);
  }

  private constructor(look: Look) {
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    const flat = (map: CanvasTexture) =>
      new MeshBasicMaterial({ map, alphaTest: 0.35, alphaToCoverage: true, toneMapped: false });
    this.cutout = new Mesh(new PlaneGeometry(VIEW_W, VIEW_H), flat(this.tex));
    this.root.add(this.body);
    this.body.add(this.cutout, this.headTop);

    // a cartoon sweat drop, its own little sprite so it can slide without repainting her
    const dc = document.createElement('canvas');
    dc.width = 48;
    dc.height = 64;
    const d = dc.getContext('2d')!;
    outlined(d, 4, (c) => {
      c.fillStyle = '#9fe0ff';
      c.beginPath();
      c.moveTo(24, 8);
      c.quadraticCurveTo(40, 34, 36, 44);
      c.arc(24, 44, 12, 0, Math.PI);
      c.quadraticCurveTo(8, 34, 24, 8);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.ellipse(19, 42, 3, 5, 0.3, 0, Math.PI * 2);
      c.fill();
    });
    this.sweat = new Mesh(new PlaneGeometry(48 / PPU, 64 / PPU), flat(new CanvasTexture(dc)));
    (this.sweat.material as MeshBasicMaterial).map!.colorSpace = SRGBColorSpace;
    this.sweat.position.z = 0.02;
    this.body.add(this.sweat);
    this.applyLook(look);
  }

  headWorld(target: Vector3): Vector3 {
    return this.headTop.getWorldPosition(target);
  }

  applyLook(look: Look): void {
    this.look = look;
    const eggH = H * look.height;
    this.centerY = LEG + eggH / 2;
    // the canvas's floor line sits on y = 0; the group pivots at her centre
    this.cutout.position.set(0, VIEW_H / 2 - PAD / PPU - this.centerY, 0);
    this.headTop.position.set(0, eggH / 2 + 0.4, 0);
    this.paintKey = '';
  }

  // ---------- painting ----------

  private paint(p: Pose) {
    const key = JSON.stringify(p);
    if (key === this.paintKey) return;
    this.paintKey = key;
    const c = this.ctx;
    const look = this.look;
    const w = S * look.width * (1 + p.puff * 0.07);
    const h = S * 1.32 * look.height;
    const cx = px(0);
    const cy = py(LEG) - h;
    c.clearRect(0, 0, CW, CH);

    // arms and legs, behind the body
    outlined(c, S * 0.06, (g) => {
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
        // legs end in chunky sneakers in her outfit colour
        const lift = i === 1 ? p.tap * 0.1 * PPU : 0;
        const [fx, fy] = limb(cx + sx * 0.3 * PPU, py(LEG + 0.16) - lift, sx * p.legs[i], 0.24 * PPU, 0.15 * PPU);
        g.save();
        g.translate(fx, fy);
        g.rotate(-sx * p.legs[i] * 0.7);
        g.fillStyle = look.outfit;
        g.beginPath();
        g.ellipse(sx * 0.05 * PPU, 0, 0.19 * PPU, 0.12 * PPU, 0, Math.PI, 0);
        g.lineTo(sx * 0.05 * PPU + 0.19 * PPU, 0.04 * PPU);
        g.lineTo(sx * 0.05 * PPU - 0.19 * PPU, 0.04 * PPU);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffffff';
        g.fillRect(sx * 0.05 * PPU - 0.2 * PPU, 0.01 * PPU, 0.4 * PPU, 0.06 * PPU);
        g.restore();
        // arms with round white mitts
        const sy = cy + h * 0.16;
        const [hx, hy] = limb(cx + sx * w * 0.94, sy, sx * p.arms[i], 0.42 * PPU, 0.16 * PPU);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(hx, hy, 0.12 * PPU, 0, Math.PI * 2);
        g.fill();
      });
    });

    drawHead2D(c, look, cx, cy, S, p.ex, {
      puff: p.puff,
      cracks: p.cracks,
      sooty: p.popped,
      frazzle: p.popped,
    });
    this.tex.needsUpdate = true;
  }

  // ---------- animation ----------

  update(f: EggFrame): void {
    const k = f.reduced ? 0.3 : 1;
    const t = f.time;
    const tens = f.tension;
    const popped = f.popAge >= 0;

    // Blink rate is the most reliable tell: ~3s apart when calm, ~0.3s near the edge.
    this.blinkT += f.dt;
    if (this.blinking > 0) this.blinking = Math.max(0, this.blinking - f.dt);
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
    this.glanceTimer -= f.dt;
    if (f.holding && tens > 0.5 && this.glanceTimer <= 0 && !f.fakeTell) {
      this.glance = this.glance > 0.5 ? 0 : 1;
      this.glanceTimer = this.glance ? 0.6 : 0.9 + Math.random() * 0.8;
    }
    if (!f.holding || popped) this.glance = 0;
    this.dart.t -= f.dt;
    if (this.dart.t <= 0) this.dart = { x: q((Math.random() - 0.5) * 0.7, 0.1), y: q((Math.random() - 0.5) * 0.4, 0.1), t: 1.2 + Math.random() * 2.2 };
    ex.lookX = this.glance ? -1 : popped || f.reduced ? 0 : this.dart.x;
    ex.lookY = this.glance ? -0.6 : popped || f.reduced ? 0 : this.dart.y;

    const cracks = popped ? 5 : tens > 0.72 ? Math.min(5, 1 + Math.floor((tens - 0.72) / 0.05)) : 0;
    const puff = popped ? 0 : f.holding ? q(MathUtils.smoothstep(tens, 0.3, 0.9), 0.1) : 0;

    // limbs: cheer on a bank, brace on a long hold, splay when she goes down
    const popE = popped ? 1 - Math.pow(1 - Math.min(1, f.popAge / 0.3), 3) : 0;
    const cheer = f.bankAge >= 0 && f.bankAge < 0.6 ? 1 - f.bankAge / 0.6 : 0;
    const tense = f.holding ? MathUtils.smoothstep(tens, 0.5, 0.85) : 0;
    const arms: [number, number] = [0, 1].map((i) =>
      popped ? q(0.4 + popE * 1.1, 0.05) : q(0.55 + Math.sin(t * 2 + i) * 0.06 * k + cheer * 2.3 + tense * 1.1, 0.05),
    ) as [number, number];
    const tapping = !popped && f.phase === 'ready' && f.idleMs > 1800;
    const tap = tapping ? q(Math.max(0, Math.sin(t * 13)) * (f.reduced ? 0.5 : 1), 0.25) : 0;
    const legs: [number, number] = popped ? [q(popE * 1.5, 0.05), q(-popE * 0.6, 0.05)] : [0.06, 0.06];

    this.paint({ ex, arms, legs, tap, puff, cracks, popped });

    const sweatOn = !popped && tens > 0.6 && f.fakeTell !== 'serene';
    this.sweat.visible = sweatOn;
    if (sweatOn) {
      const eggH = H * this.look.height;
      this.sweat.position.set(0.72 * this.look.width, eggH * 0.32 - ((t * 0.9) % 1) * 0.4, 0.02);
    }

    // ---- body motion: the cut-out itself squashes, wobbles and jitters
    this.squash += ((f.holding ? 1 : 0) - this.squash) * Math.min(1, f.dt * 10);
    const wob = (0.03 + tens * tens * 0.1) * k;
    const freq = 2 + tens * 7;
    const jitter = shake * 0.035 * k;
    const n1 = Math.sin(t * 61 + this.shakeSeed) * Math.sin(t * 37);
    const n2 = Math.sin(t * 53 + 2.1) * Math.cos(t * 29);

    if (popped) {
      // she keels over onto her side, with a thump
      const thump = f.popAge < 0.45 ? Math.sin((f.popAge / 0.45) * Math.PI) * 0.12 * k : 0;
      const lieY = H * 0.5 * this.look.width * 0.86;
      this.body.rotation.set(0, 0, -1.45 * popE);
      this.body.scale.set(1 + thump, 1 - thump, 1);
      this.body.position.set(0.15 * popE, MathUtils.lerp(this.centerY, lieY, popE), 0);
      return;
    }

    const breathe = Math.sin(t * 2.2) * 0.012;
    const sq = this.squash * (0.05 + tens * 0.05);
    const sx = 1 + sq + breathe;
    const sy = 1 - sq * 1.2 - breathe + tens * 0.06;
    this.body.scale.set(sx, sy, 1);
    this.body.rotation.set(0, 0, Math.sin(t * freq) * wob + n2 * jitter);
    // keep her feet on the floor while she squashes around her centre
    this.body.position.set(n1 * jitter, this.centerY * sy, 0);
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
