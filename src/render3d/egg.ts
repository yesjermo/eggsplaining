import {
  CanvasTexture,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import type { Look } from '../shared/look.js';
import type { FakeTellKind, Phase } from '../game/state';
import { drawBangs, drawFace, shade, type FaceExpr } from '../face2d';

// Shape profiles (world units, inside `shape`, whose y = 0 sits at LEG above the floor).
// classic: the first design's tall egg. mii: a big round head on a small body.
export type Variant3D = 'classic' | 'mii';
interface Profile {
  y0: number;
  H: number;
  R: number;
  taper: number;
  faceY: number;
  hairline: number;
  faceS: number;
  mii: boolean;
}
const CLASSIC: Profile = { y0: 0, H: 2.2, R: 0.82, taper: 0.16, faceY: 2.2 * 0.63, hairline: 2.2 * 0.8, faceS: 0.66, mii: false };
const MII: Profile = { y0: 0.62, H: 1.8, R: 0.92, taper: 0.05, faceY: 0.62 + 1.8 * 0.46, hairline: 0.62 + 1.8 * 0.76, faceS: 0.72, mii: true };
/** the profile of the egg being built; only one stage exists at a time */
let P: Profile = CLASSIC;
const LEG = 0.22;
/** how much higher the Mii's body sits, to show her legs */
const MII_LIFT = 0.26;
const INK = '#2b2232';
/** a height on the head, as a fraction from its bottom (0) to its top (1) */
const Y = (f: number) => P.y0 + P.H * f;

// Face texture: the whole head is UV mapped; u = 0.5 faces the camera.
const TEX_W = 1024;
const TEX_H = 512;
const pxX = () => TEX_W / (2 * Math.PI * P.R * 0.98); // px per world unit around the face
const pxY = () => TEX_H / P.H;

function radiusAt(y: number): number {
  const u = MathUtils.clamp(((y - P.y0) / P.H) * 2 - 1, -1, 1);
  return P.R * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - P.taper * u);
}

function onSurface(theta: number, y: number, off = 0): Vector3 {
  const r = radiusAt(y) + off;
  return new Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
}

const lambert = (color: string) => new MeshLambertMaterial({ color });

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

export class Egg {
  readonly root = new Group();
  private body = new Group();
  private shape = new Group(); // scaled by the look's height/width
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private shellMat: MeshLambertMaterial;
  private limbMat = lambert('#ffe0c8');
  private shoeMat = lambert('#7e4a8c');
  private hairMat = lambert('#1c1719');
  private glassMat = lambert('#2b2440');
  private hair = new Group();
  private glasses = new Group();
  private frazzle = new Group();
  private sweat: Mesh;
  private arms: Group[] = [];
  private legs: Group[] = [];
  private headTop = new Object3D();
  private look!: Look;
  private faceKey = '';

  private blinkT = 0;
  private nextBlink = 2;
  private blinking = 0;
  private glance = 0;
  private glanceTimer = 0;
  private squash = 0;
  private shakeSeed = Math.random() * 100;

  constructor(look: Look, variant: Variant3D = 'classic') {
    P = variant === 'mii' ? MII : CLASSIC;
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.shellMat = new MeshLambertMaterial({ map: this.tex });

    this.root.add(this.body);
    // the Mii stands on visible little legs under her body
    this.body.position.y = LEG + (P.mii ? MII_LIFT : 0);
    this.body.add(this.shape);
    const pts: Vector2[] = [];
    for (let i = 0; i <= 32; i++) {
      const y = P.y0 + (i / 32) * P.H;
      pts.push(new Vector2(Math.max(0.0001, radiusAt(y)), y));
    }
    // phiStart = PI puts the UV seam at the back, so u = 0.5 is the front (+z)
    const shell = new Mesh(new LatheGeometry(pts, 48, Math.PI, Math.PI * 2), this.shellMat);
    this.shape.add(shell, this.hair, this.glasses, this.frazzle);
    if (P.mii) {
      // a small rounded body in her outfit colour, with a white collar, under the big head
      const torso = new Mesh(new CapsuleGeometry(0.44, 0.34, 6, 20), this.shoeMat);
      torso.position.y = 0.64;
      torso.scale.set(1.05, 1, 0.92);
      const collar = new Mesh(new TorusGeometry(0.4, 0.05, 8, 28), lambert('#ffffff'));
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.7;
      this.shape.add(torso, collar);
    }
    this.headTop.position.set(0, Y(1) + 0.4, 0);
    this.shape.add(this.headTop);

    this.buildArms();
    this.buildLegs();
    this.buildFrazzle();
    const sweatGeo = new SphereGeometry(0.06, 10, 8);
    sweatGeo.translate(0, 0.04, 0);
    sweatGeo.scale(1, 1.5, 0.7);
    this.sweat = new Mesh(sweatGeo, new MeshBasicMaterial({ color: '#9fe0ff' }));
    this.shape.add(this.sweat);
    this.applyLook(look);
  }

  headWorld(target: Vector3): Vector3 {
    return this.headTop.getWorldPosition(target);
  }

  applyLook(look: Look): void {
    this.look = look;
    this.shape.scale.set(look.width, look.height, look.width);
    this.limbMat.color.set(look.skin);
    this.shoeMat.color.set(look.outfit);
    this.hairMat.color.set(look.hairColor);
    this.glassMat.color.set(look.glassesColor);
    this.setHair(look);
    this.setGlasses(look);
    this.faceKey = '';
  }

  // ---------- face texture ----------

  private paint(ex: FaceExpr, cracks: number, sooty: boolean) {
    const key = `${ex.eyes}|${ex.mouth}|${ex.worry.toFixed(1)}|${ex.lookX.toFixed(1)}|${ex.lookY.toFixed(1)}|${ex.flush.toFixed(1)}|${cracks}|${sooty}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    const c = this.ctx;
    const look = this.look;
    const cx = TEX_W / 2;
    const toY = (y: number) => (1 - (y - P.y0) / P.H) * TEX_H;
    c.fillStyle = look.skin;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // soft top highlight, darker toward the base
    const g = c.createLinearGradient(0, 0, 0, TEX_H);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(80,40,60,0.10)');
    c.fillStyle = g;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // hair-coloured crown so the 3D cap edge never shows skin
    if (look.hair !== 'buzz') {
      c.fillStyle = look.hairColor;
      c.fillRect(0, 0, TEX_W, toY(P.hairline) + 2);
    } else {
      c.fillStyle = look.hairColor;
      c.globalAlpha = 0.85;
      c.fillRect(0, 0, TEX_W, toY(Y(0.78)));
      c.globalAlpha = 1;
    }
    // outfit band + trim (the Mii wears her outfit on her body instead)
    const bandTop = P.mii ? TEX_H + 10 : toY(0.62);
    c.fillStyle = look.outfit;
    c.fillRect(0, bandTop, TEX_W, TEX_H - bandTop);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(0, bandTop - 4, TEX_W, 8);
    // bib + buttons on the front
    if (!P.mii) {
    c.fillStyle = look.outfit;
    c.beginPath();
    c.roundRect(cx - 90, toY(0.84), 180, bandTop - toY(0.84) + 4, 18);
    c.fill();
    c.fillStyle = shade(look.outfit, 0.6);
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.arc(cx + sx * 58, toY(0.77), 9, 0, Math.PI * 2);
      c.fill();
    }
    }

    // face, laid out in world units then mapped to texture px
    c.save();
    c.translate(cx, toY(P.faceY));
    c.scale(1, pxY() / pxX());
    // classic keeps the first design's face; the Mii gets the cute sparkly-eyed one
    const faceOpts = P.mii ? {} : { ink: INK };
    drawFace(c, look, ex, 0, 0, P.faceS * pxX(), faceOpts);
    drawBangs(c, look, P.faceS * pxX() * 1.05, 0, (P.faceY - P.hairline) * pxX() - 6, faceOpts);
    c.restore();

    if (sooty) {
      c.fillStyle = 'rgba(70,60,66,0.35)';
      for (const [x, y, r] of [
        [-150, 0.43, 40],
        [170, 0.73, 30],
        [60, 0.42, 22],
      ] as const) {
        c.beginPath();
        c.arc(cx + x, toY(Y(y)), r, 0, Math.PI * 2);
        c.fill();
      }
    }
    // cracks: zigzags from the crown, the strong tell
    if (cracks > 0) {
      c.strokeStyle = '#6b3f3f';
      c.lineWidth = 5;
      c.lineJoin = 'round';
      const starts = [cx + 40, cx - 230, cx + 260, cx - 60, cx + 420];
      for (let i = 0; i < cracks; i++) {
        let x = starts[i];
        let y = toY(Y(0.97));
        c.beginPath();
        c.moveTo(x, y);
        for (let k = 0; k < 6; k++) {
          y += 22 + ((i * 7 + k * 13) % 9) * 3;
          x += (k % 2 ? 1 : -1) * (14 + ((i + k) % 3) * 8);
          c.lineTo(x, y);
        }
        c.stroke();
      }
    }
    this.tex.needsUpdate = true;
  }

  // ---------- construction ----------

  private lathePart(y0: number, y1: number, off: number, material: Material, phiStart = 0, phiLength = Math.PI * 2, segs = 36) {
    const pts: Vector2[] = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const y = y0 + ((y1 - y0) * i) / N;
      pts.push(new Vector2(radiusAt(y) + off, y));
    }
    return new Mesh(new LatheGeometry(pts, segs, phiStart, phiLength), material);
  }

  private buildArms() {
    const mitt = lambert('#ffffff');
    for (const s of [-1, 1]) {
      const pivot = new Group();
      const y = P.mii ? 0.82 : Y(0.42);
      pivot.position.set(s * (P.mii ? 0.47 : radiusAt(y) - 0.04), y, 0.05);
      // the Mii has short stubby arms
      const len = P.mii ? 0.18 : 0.34;
      const arm = new Mesh(new CapsuleGeometry(0.085, len, 4, 8), this.limbMat);
      arm.position.y = -0.07 - len / 2;
      const hand = new Mesh(new SphereGeometry(0.12, 12, 10), mitt);
      hand.position.y = -0.12 - len;
      pivot.add(arm, hand);
      this.shape.add(pivot);
      this.arms.push(pivot);
    }
  }

  private buildLegs() {
    const sole = lambert('#ffffff');
    for (const s of [-1, 1]) {
      const pivot = new Group();
      const lift = P.mii ? MII_LIFT : 0;
      pivot.position.set(s * (P.mii ? 0.22 : 0.3), LEG + 0.12 + lift, 0);
      const leg = new Mesh(new CapsuleGeometry(0.07, 0.18 + lift, 4, 8), this.limbMat);
      leg.position.y = -0.14 - lift / 2;
      const shoe = new Group();
      shoe.position.set(0, -0.3 - lift, 0.08);
      const upper = new Mesh(new SphereGeometry(0.2, 14, 10), this.shoeMat);
      upper.scale.set(0.85, 0.62, 1.25);
      upper.position.y = 0.06;
      const soleM = new Mesh(new CylinderGeometry(0.2, 0.2, 0.07, 16), sole);
      soleM.scale.set(0.9, 1, 1.35);
      soleM.position.y = -0.03;
      const lace = new Mesh(new CapsuleGeometry(0.025, 0.12, 2, 6), sole);
      lace.rotation.z = Math.PI / 2;
      lace.position.set(0, 0.17, 0.1);
      shoe.add(upper, soleM, lace);
      pivot.add(leg, shoe);
      this.root.add(pivot);
      this.legs.push(pivot);
    }
  }

  private buildFrazzle() {
    const fm = lambert('#4a3a3a');
    for (let i = 0; i < 12; i++) {
      const c = new Mesh(new ConeGeometry(0.05, 0.45 + (i % 3) * 0.1, 5), fm);
      const theta = (i / 12) * Math.PI * 2;
      const lean = 0.55 + (i % 2) * 0.4;
      c.position.copy(onSurface(theta, Y(0.88), 0));
      c.position.y += 0.14;
      c.rotation.set(Math.cos(theta) * lean, 0, -Math.sin(theta) * lean);
      this.frazzle.add(c);
    }
    this.frazzle.visible = false;
  }

  private setHair(look: Look) {
    disposeChildren(this.hair);
    const m = this.hairMat;
    const capFrom = look.hair === 'buzz' ? Y(0.8) : P.hairline;
    const cap = this.lathePart(capFrom, Y(1), look.hair === 'buzz' ? 0.006 : 0.035, m);
    this.hair.add(cap);
    const ball = (r: number, x: number, y: number, z: number) => {
      const s = new Mesh(new SphereGeometry(r, 14, 10), m);
      s.position.set(x, y, z);
      this.hair.add(s);
      return s;
    };
    const backSheet = (y0: number) =>
      this.hair.add(this.lathePart(y0, Y(0.82), 0.06, m, Math.PI * 0.36, Math.PI * 1.28, 28));
    switch (look.hair) {
      case 'lowbun': {
        ball(0.3, 0, Y(0.5), -P.R);
        const tie = new Mesh(new TorusGeometry(0.17, 0.04, 6, 16), lambert(look.outfit));
        tie.position.set(0, Y(0.5), -P.R + 0.2);
        this.hair.add(tie);
        // a few loose strands at the nape and sides
        for (const sx of [-1, 1]) {
          const strand = new Mesh(new CapsuleGeometry(0.025, 0.42, 2, 6), m);
          strand.position.copy(onSurface(sx * 1.05, Y(0.66), 0.03));
          strand.rotation.z = sx * 0.12;
          this.hair.add(strand);
        }
        break;
      }
      case 'bun':
        ball(0.34, 0, Y(1) + 0.2, 0);
        break;
      case 'long':
        backSheet(Y(0.12));
        break;
      case 'bob':
        backSheet(Y(0.46));
        break;
      case 'ponytail':
        [
          [0.68, Y(1) - 0.16, -0.2, 0.21],
          [0.9, Y(1) - 0.32, -0.18, 0.2],
          [1.04, Y(1) - 0.56, -0.16, 0.17],
          [1.06, Y(1) - 0.8, -0.14, 0.12],
        ].forEach(([x, y, z, r]) => ball(r, x, y, z));
        break;
      case 'curls':
        for (let i = 0; i < 18; i++) {
          const th = Math.PI * 0.35 + (i / 18) * Math.PI * 1.3;
          const y = Y(0.8 + (i % 3) * 0.07);
          const p = onSurface(th, y, 0.05);
          ball(0.17, p.x, p.y, p.z);
        }
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ball(0.18, Math.sin(a) * 0.18, Y(1) + 0.02, Math.cos(a) * 0.18);
        }
        break;
      case 'pixie': {
        const swoop = ball(0.3, 0.2, Y(0.95), 0.25);
        swoop.scale.set(1.6, 0.6, 1);
        break;
      }
      case 'spikes':
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2;
          const lean = i % 2 ? 0.45 : 0.75;
          const c = new Mesh(new ConeGeometry(0.13, 0.55, 6), m);
          c.position.set(Math.sin(ang) * 0.3, Y(1) + 0.08, Math.cos(ang) * 0.3);
          c.rotation.set(Math.cos(ang) * lean, 0, -Math.sin(ang) * lean);
          this.hair.add(c);
        }
        break;
    }
  }

  private setGlasses(look: Look) {
    disposeChildren(this.glasses);
    if (look.glasses === 'none') return;
    const ex = 0.4 * look.eyeGap * P.faceS;
    const ey = P.faceY + 0.05 * P.faceS;
    const r = 0.27 * P.faceS * (P.mii ? 1.2 : 1);
    for (const s of [-1, 1]) {
      const theta = Math.asin((s * ex) / radiusAt(ey));
      let ring: Mesh;
      if (look.glasses === 'square') {
        ring = new Mesh(new TorusGeometry(r * 1.2, 0.022, 4, 4), this.glassMat);
        ring.rotation.z = Math.PI / 4;
      } else if (look.glasses === 'star') {
        ring = new Mesh(new TorusGeometry(r * 1.05, 0.024, 4, 5), lambert('#ffb547'));
        ring.rotation.z = Math.PI / 2;
      } else ring = new Mesh(new TorusGeometry(r, 0.022, 6, 24), this.glassMat);
      const g = new Group();
      g.add(ring);
      g.position.copy(onSurface(theta, ey, 0.07));
      g.rotation.set(0, theta, 0);
      this.glasses.add(g);
    }
    const bridge = new Mesh(new TorusGeometry(0.06, 0.018, 4, 10, Math.PI), this.glassMat);
    bridge.position.copy(onSurface(0, ey + 0.02, 0.08));
    this.glasses.add(bridge);
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
        ex.worry = Math.min(1, tens * 1.1);
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
    ex.flush = Math.max(ex.flush, Math.round(Math.pow(tens, 1.5) * 10) / 10);

    // glance at the covered gauge (screen-left) when the hold runs long
    this.glanceTimer -= f.dt;
    if (f.holding && tens > 0.5 && this.glanceTimer <= 0 && !f.fakeTell) {
      this.glance = this.glance > 0.5 ? 0 : 1;
      this.glanceTimer = this.glance ? 0.6 : 0.9 + Math.random() * 0.8;
    }
    if (!f.holding || popped) this.glance = 0;
    ex.lookX = -this.glance;
    ex.lookY = -this.glance * 0.6;

    const cracks = popped ? 5 : tens > 0.72 ? Math.min(5, 1 + Math.floor((tens - 0.72) / 0.05)) : 0;
    this.paint(ex, cracks, popped);

    const sweatOn = !popped && tens > 0.6 && f.fakeTell !== 'serene';
    this.sweat.visible = sweatOn;
    if (sweatOn) this.sweat.position.copy(onSurface(0.8, Y(0.8) - ((t * 0.9) % 1) * 0.4, 0.03));

    const target = f.holding ? 1 : 0;
    this.squash += (target - this.squash) * Math.min(1, f.dt * 10);
    const wob = (0.03 + tens * tens * 0.1) * k;
    const freq = 2 + tens * 7;
    const jitter = shake * 0.035 * k;
    const n1 = Math.sin(t * 61 + this.shakeSeed) * Math.sin(t * 37);
    const n2 = Math.sin(t * 53 + 2.1) * Math.cos(t * 29);

    if (popped) {
      const a = Math.min(1, f.popAge / 0.3);
      const ease = 1 - Math.pow(1 - a, 3);
      this.root.position.y = -0.3 * ease;
      this.body.rotation.set(-0.14 * ease, 0, 0.05 * ease);
      this.body.position.x = 0;
      const thump = f.popAge < 0.45 ? Math.sin((f.popAge / 0.45) * Math.PI) * 0.12 * k : 0;
      this.body.scale.set(1 + thump, 1 - thump, 1 + thump);
      this.legs.forEach((l, i) => {
        l.rotation.x = -1.45 * ease;
        l.rotation.z = (i ? -1 : 1) * 0.25 * ease;
      });
      this.arms.forEach((arm, i) => arm.rotation.set(0, 0, (i ? 1 : -1) * 0.95 * ease));
      this.frazzle.visible = true;
      return;
    }

    this.frazzle.visible = false;
    this.root.position.y = 0;
    const breathe = Math.sin(t * 2.2) * 0.012;
    const sq = this.squash * (0.05 + tens * 0.05);
    this.body.scale.set(1 + sq + breathe, 1 - sq * 1.2 - breathe + tens * 0.06, 1 + sq + breathe);
    this.body.rotation.set(0, 0, Math.sin(t * freq) * wob + n2 * jitter);
    this.body.position.x = n1 * jitter;

    const cheer = f.bankAge >= 0 && f.bankAge < 0.6 ? 1 - f.bankAge / 0.6 : 0;
    const tense = f.holding ? MathUtils.smoothstep(tens, 0.5, 0.85) : 0;
    this.arms.forEach((arm, i) => {
      const s = i ? 1 : -1;
      arm.rotation.z = s * (0.25 + Math.sin(t * 2 + i) * 0.05 * k + cheer * 2.2 + tense * 2.3);
      arm.rotation.x = -tense * 0.9 - cheer * 0.3;
    });

    const tapping = f.phase === 'ready' && f.idleMs > 1800;
    this.legs.forEach((l, i) => {
      l.rotation.x = tapping && i === 1 ? -Math.max(0, Math.sin(t * 13)) * 0.45 * (f.reduced ? 0.5 : 1) : 0;
      l.rotation.z = 0;
    });
  }
}

function disposeChildren(g: Group) {
  for (const c of [...g.children]) {
    c.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    g.remove(c);
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

export const EGG_HEIGHT = 2.2 + LEG;
