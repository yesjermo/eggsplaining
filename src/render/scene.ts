import { Egg, type EggFrame } from './egg';
import type { Look } from '../shared/look.js';
import { drawHead2D } from '../face2d';

// A flat, cartoon test chamber in plain Canvas 2D. No WebGL, no 3D library: the static parts
// are painted once per resize into two cached layers (behind her and in front of her), and
// each frame only draws those, her cut-out and a few particles.

const CONFETTI_COLORS = ['#ff9eb5', '#b9a4ff', '#7fd6c2', '#ffc46b', '#8cc8ff', '#ffffff', '#ff8a6b'];
const TUBE_R = 1.75;
const TUBE_H = 3.55;
/** soft outline for the chamber, so she stays the boldest thing on screen */
const LINE = '#8a78b8';
const INK = '#2b2232';

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  /** confetti flips: phase of the paper turning over */
  flip: number;
  color: string;
  size: number;
  landed: boolean;
  /** shell shard outline, unit polygon */
  poly?: [number, number][];
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly egg: Egg;
  private ctx: CanvasRenderingContext2D;
  private back = document.createElement('canvas');
  private front = document.createElement('canvas');
  private ghostCanvas = document.createElement('canvas');
  private ghostAge = -1;
  private ghostSeed = -1;
  private shards: Bit[] = [];
  private confetti: Bit[] = [];
  private flash = 0;
  private shake = 0;
  private push = 0;
  private lamp = 0;
  private look: Look;
  /** screen mapping */
  private dpr = 1;
  private ppu = 100;
  private lookY = 1.5;
  private W = 1;
  private H = 1;

  static async create(canvas: HTMLCanvasElement, look: Look): Promise<Stage> {
    return new Stage(canvas, look);
  }

  private constructor(canvas: HTMLCanvasElement, look: Look) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.look = look;
    this.egg = new Egg(look);
    this.ghostCanvas.width = 256;
    this.ghostCanvas.height = 320;
    this.drawGhost(0);
    this.resize();
  }

  private drawGhost(seed: number) {
    const c = this.ghostCanvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 320);
    drawHead2D(c, this.look, 128, 170, 70, { eyes: 'closed', mouth: 'o', worry: 0.2, lookX: 0, lookY: 0, flush: 0 }, { ghost: true, wobble: seed });
  }

  setLook(look: Look) {
    this.look = look;
    this.egg.applyLook(look);
    this.drawGhost(0);
  }

  // ---------- mapping ----------

  private sx(x: number) {
    return this.W / 2 + x * this.ppu;
  }
  private sy(y: number) {
    return this.H / 2 - (y - this.lookY) * this.ppu;
  }

  resize() {
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
    this.dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    // a hidden or minimised window can report 0x0; never make zero-size layers
    if (!cw || !ch) return;
    this.W = Math.round(cw * this.dpr);
    this.H = Math.round(ch * this.dpr);
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    const portrait = cw / ch < 0.8;
    // fit the whole chamber, lamp to pedestal, between the score and the Hold button
    const halfW = portrait ? 2.45 : 3.4;
    this.ppu = Math.min(this.W / (2 * halfW), this.H / 7.1);
    this.lookY = portrait ? 1.35 : 1.45;
    // paint her at about the size she appears, so outlines stay crisp without wasting pixels
    this.egg.setResolution(this.ppu * 1.05);
    for (const c of [this.back, this.front]) {
      c.width = this.W;
      c.height = this.H;
    }
    this.paintChamber();
  }

  headScreen(): { x: number; y: number } {
    const p = this.egg.headTop();
    return { x: this.sx(p.x) / this.dpr, y: this.sy(p.y) / this.dpr };
  }

  // ---------- the chamber, cached ----------

  private paintChamber() {
    const u = this.ppu;
    const X = (x: number) => this.sx(x);
    const Y = (y: number) => this.sy(y);
    const lw = Math.max(1.5, u * 0.035);
    const line = (c: CanvasRenderingContext2D, w = lw, color = LINE) => {
      c.lineWidth = w;
      c.strokeStyle = color;
      c.stroke();
    };
    const ell = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2) => {
      c.beginPath();
      c.ellipse(X(x), Y(y), rx * u, ry * u, 0, a0, a1);
    };
    const RY = 0.3; // how squashed the circles look from slightly above

    // ---- behind her
    const b = this.back.getContext('2d')!;
    b.clearRect(0, 0, this.W, this.H);
    b.lineJoin = b.lineCap = 'round';

    // gauge on a stand, wearing a little cover: read her, not the dial
    const gx = -2.85;
    b.beginPath();
    b.moveTo(X(gx), Y(0.05));
    b.lineTo(X(gx), Y(1.6));
    line(b, u * 0.12, LINE);
    line(b, u * 0.07, '#e6e0f2');
    ell(b, gx, 0.04, 0.38, 0.11);
    b.fillStyle = '#f6f2ff';
    b.fill();
    line(b);
    b.beginPath();
    b.moveTo(X(gx - 0.5), Y(1.62));
    b.ellipse(X(gx), Y(1.62), 0.5 * u, 0.5 * u, 0, Math.PI, Math.PI * 2);
    b.closePath();
    b.fillStyle = '#ffd6e0';
    b.fill();
    line(b);
    // a tiny bow on the cover, because of course
    b.fillStyle = '#ff9eb5';
    for (const s of [-1, 1]) {
      b.beginPath();
      b.moveTo(X(gx), Y(2.12));
      b.lineTo(X(gx + s * 0.2), Y(2.24));
      b.lineTo(X(gx + s * 0.2), Y(2.02));
      b.closePath();
      b.fill();
      line(b, lw * 0.8);
    }
    // hose from the cap to the gauge
    b.beginPath();
    b.moveTo(X(-1.3), Y(TUBE_H + 0.32));
    b.bezierCurveTo(X(-2.4), Y(TUBE_H + 0.9), X(-3.15), Y(TUBE_H + 0.2), X(gx), Y(2.2));
    line(b, u * 0.2, LINE);
    line(b, u * 0.13, '#cfc1ff');

    // pedestal
    b.beginPath();
    b.moveTo(X(-2.15), Y(0));
    b.lineTo(X(-2.3), Y(-0.42));
    b.ellipse(X(0), Y(-0.42), 2.3 * u, 2.3 * RY * u, 0, Math.PI, 0, true);
    b.lineTo(X(2.15), Y(0));
    b.closePath();
    b.fillStyle = '#efe9fb';
    b.fill();
    line(b);
    ell(b, 0, 0, 2.15, 2.15 * RY);
    b.fillStyle = '#f8f5ff';
    b.fill();
    line(b);
    ell(b, 0, 0, 2.0, 2.0 * RY);
    line(b, u * 0.07, '#c8b8ff');
    ell(b, 0, 0, TUBE_R * 0.93, TUBE_R * 0.93 * RY);
    b.fillStyle = '#ffffff';
    b.fill();

    // back of the glass
    b.beginPath();
    b.rect(X(-TUBE_R), Y(TUBE_H), 2 * TUBE_R * u, TUBE_H * u);
    b.fillStyle = 'rgba(232,240,255,0.32)';
    b.fill();
    ell(b, 0, TUBE_H, TUBE_R, TUBE_R * RY, Math.PI, Math.PI * 2);
    line(b, lw * 0.7, 'rgba(138,120,184,0.5)');

    // ---- in front of her
    const f = this.front.getContext('2d')!;
    f.clearRect(0, 0, this.W, this.H);
    f.lineJoin = f.lineCap = 'round';
    // front of the glass: sides, a front rim and two cartoon shine streaks
    f.beginPath();
    f.moveTo(X(-TUBE_R), Y(0));
    f.lineTo(X(-TUBE_R), Y(TUBE_H));
    f.moveTo(X(TUBE_R), Y(0));
    f.lineTo(X(TUBE_R), Y(TUBE_H));
    line(f, lw, 'rgba(138,120,184,0.7)');
    ell(f, 0, 0, TUBE_R, TUBE_R * RY, 0, Math.PI);
    line(f, lw * 0.8, 'rgba(138,120,184,0.55)');
    f.fillStyle = 'rgba(255,255,255,0.55)';
    f.beginPath();
    f.roundRect(X(1.12), Y(TUBE_H - 0.3), 0.16 * u, (TUBE_H - 0.9) * u, 0.08 * u);
    f.fill();
    f.beginPath();
    f.roundRect(X(1.36), Y(TUBE_H - 0.5), 0.07 * u, 1.2 * u, 0.04 * u);
    f.fill();
    // cap with its rim, dome and lamp socket
    f.beginPath();
    f.moveTo(X(-2.05), Y(TUBE_H));
    f.lineTo(X(-2.0), Y(TUBE_H + 0.32));
    f.ellipse(X(0), Y(TUBE_H + 0.32), 2.0 * u, 2.0 * RY * u, 0, Math.PI, 0);
    f.lineTo(X(2.05), Y(TUBE_H));
    f.ellipse(X(0), Y(TUBE_H), 2.05 * u, 2.05 * RY * u, 0, 0, Math.PI);
    f.closePath();
    f.fillStyle = '#efe9fb';
    f.fill();
    line(f);
    ell(f, 0, TUBE_H, 2.05, 2.05 * RY, 0, Math.PI);
    line(f, u * 0.07, '#c8b8ff');
    ell(f, 0, TUBE_H + 0.32, 2.0, 2.0 * RY);
    f.fillStyle = '#f8f5ff';
    f.fill();
    line(f);
    f.beginPath();
    f.ellipse(X(0), Y(TUBE_H + 0.36), 0.7 * u, 0.4 * u, 0, Math.PI, Math.PI * 2);
    f.closePath();
    f.fillStyle = '#e6e0f2';
    f.fill();
    line(f);
  }

  // ---------- effects ----------

  /** big = run-ending pop; small = blitz pop */
  pop(reduced: boolean, big = true) {
    const rnd = Math.random;
    this.shake = reduced ? 0 : big ? 0.35 : 0.2;
    this.flash = reduced ? 0.3 : 0.8;
    const eggY = this.egg.centerY;
    this.shards = [];
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = reduced ? 1.5 : 4;
      const n = 3 + Math.floor(rnd() * 2);
      const poly: [number, number][] = [];
      for (let j = 0; j < n; j++) {
        const ang = (j / n) * Math.PI * 2 + rnd() * 0.6;
        const r = 0.6 + rnd() * 0.4;
        poly.push([Math.cos(ang) * r, Math.sin(ang) * r]);
      }
      this.shards.push({
        x: Math.cos(a) * 0.5,
        y: eggY + 0.4 + rnd() * 0.6,
        vx: Math.cos(a) * sp * (0.5 + rnd()),
        vy: 2.5 + rnd() * (reduced ? 2 : 4),
        rot: rnd() * 6,
        spin: rnd() * 12 - 6,
        flip: 0,
        color: '#fff6e8',
        size: 0.1 + rnd() * 0.1,
        landed: false,
        poly,
      });
    }
    const count = reduced ? 30 : big ? 90 : 45;
    this.confetti = [];
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = (reduced ? 1.2 : 3) * (0.4 + rnd());
      this.confetti.push({
        x: Math.cos(a) * rnd() * 0.5,
        y: eggY + 0.6 + rnd() * 0.5,
        vx: Math.cos(a) * sp,
        vy: (reduced ? 2 : 4.5) + rnd() * 3.5,
        rot: rnd() * 6,
        spin: rnd() * 10 - 5,
        flip: rnd() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 0.05 + rnd() * 0.04,
        landed: false,
      });
    }
    if (big) this.ghostAge = 0;
  }

  reset() {
    this.shards = [];
    this.confetti = [];
    this.ghostAge = -1;
  }

  private step(bits: Bit[], dt: number, g: number, drag: number) {
    const max = TUBE_R - 0.1;
    for (const p of bits) {
      if (p.landed) continue;
      p.vy -= g * dt;
      p.vx *= 1 - drag * dt;
      p.vy *= 1 - drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += dt * 9;
      if (Math.abs(p.x) > max) {
        p.x = Math.sign(p.x) * max;
        p.vx *= -0.4;
      }
      if (p.y > TUBE_H - 0.1) {
        p.y = TUBE_H - 0.1;
        p.vy = -Math.abs(p.vy) * 0.3;
      }
      if (p.y <= 0.02) {
        p.y = 0.02;
        if (Math.abs(p.vy) < 1.2) {
          p.landed = true;
          p.flip = Math.PI / 2.4;
        }
        p.vy = Math.abs(p.vy) * 0.3;
        p.vx *= 0.5;
        p.spin *= 0.5;
      }
    }
  }

  // ---------- per frame ----------

  frame(f: EggFrame) {
    const dt = Math.min(f.dt, 0.05);
    this.egg.update(f);
    this.step(this.shards, dt, 14, 0.3);
    this.step(this.confetti, dt, 6, 1.6);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shake = Math.max(0, this.shake - dt);
    const pushTarget = f.holding && !f.reduced ? f.tension : 0;
    this.push += (pushTarget - this.push) * Math.min(1, dt * 2);
    this.lamp += ((f.holding ? 1 : 0) - this.lamp) * Math.min(1, dt * 8);

    if (!this.back.width) this.resize();
    if (!this.back.width) return;
    const c = this.ctx;
    const u = this.ppu;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.W, this.H);
    // camera: lean in on long holds, shake on a pop, drift a touch
    const sk = this.shake * this.shake * 0.9 * u;
    const zoom = 1 + this.push * 0.07;
    const fx = this.sx(0);
    const fy = this.sy(this.egg.centerY);
    c.translate(fx + (Math.random() - 0.5) * sk + Math.sin(f.time * 0.25) * (f.reduced ? 0 : 0.05 * u), fy + (Math.random() - 0.5) * sk);
    c.scale(zoom, zoom);
    c.translate(-fx, -fy);

    c.drawImage(this.back, 0, 0);

    // soft blob shadow that shrinks as she hops
    const T = this.egg.t;
    const lift = Math.max(0, T.y - this.egg.centerY * T.sy);
    const sh = Math.max(0.4, 1 - lift * 0.8);
    c.fillStyle = 'rgba(70,45,100,0.16)';
    c.beginPath();
    c.ellipse(this.sx(T.x), this.sy(0.01), 1.0 * u * sh * T.sx, 0.2 * u * sh, 0, 0, Math.PI * 2);
    c.fill();

    this.drawBits(c, this.confetti.filter((p) => p.landed));
    this.drawEgg(c);
    this.drawBits(c, this.shards);
    this.drawBits(c, this.confetti.filter((p) => !p.landed));

    c.drawImage(this.front, 0, 0);

    // her soul drifts up after a run-ending pop, swaying like the splash
    if (this.ghostAge >= 0) {
      this.ghostAge += dt;
      const a = this.ghostAge;
      const rise = Math.min(1, Math.max(0, (a - 0.25) / 1.2));
      const e = 1 - Math.pow(1 - rise, 3);
      const seed = f.reduced ? 0 : Math.floor(a * 8);
      if (seed !== this.ghostSeed) {
        this.ghostSeed = seed;
        this.drawGhost(seed);
      }
      if (rise > 0) {
        c.save();
        c.globalAlpha = Math.min(0.85, rise * 1.5);
        c.translate(this.sx(Math.sin(a * 2.2) * 0.25 * (f.reduced ? 0.3 : 1)), this.sy(2.1 + e * 0.9));
        c.rotate(Math.sin(a * 1.7) * 0.12 * (f.reduced ? 0.3 : 1));
        const gw = 1.6 * u;
        c.drawImage(this.ghostCanvas, -gw / 2, -gw * 0.625, gw, gw * 1.25);
        c.restore();
      }
    }


    // the lamp on top glows while you hold
    const lx = this.sx(0);
    const ly = this.sy(TUBE_H + 0.86);
    const pulse = this.lamp * (0.8 + Math.sin(f.time * 10) * 0.2);
    if (pulse > 0.02) {
      const g = c.createRadialGradient(lx, ly, 0, lx, ly, u * 0.7);
      g.addColorStop(0, `rgba(255,111,145,${0.45 * pulse})`);
      g.addColorStop(1, 'rgba(255,111,145,0)');
      c.fillStyle = g;
      c.fillRect(lx - u, ly - u, 2 * u, 2 * u);
    }
    c.beginPath();
    c.arc(lx, ly, 0.17 * u, 0, Math.PI * 2);
    c.fillStyle = pulse > 0.02 ? `rgb(255,${Math.round(179 - 60 * pulse)},${Math.round(196 - 50 * pulse)})` : '#ffb3c4';
    c.fill();
    c.lineWidth = Math.max(1.5, u * 0.035);
    c.strokeStyle = LINE;
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath();
    c.arc(lx - 0.05 * u, ly - 0.05 * u, 0.05 * u, 0, Math.PI * 2);
    c.fill();

    if (this.flash > 0) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      const r = (1 - this.flash) * 4 * u + u;
      const g = c.createRadialGradient(fx, fy, 0, fx, fy, r);
      g.addColorStop(0, `rgba(255,255,255,${this.flash})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, this.W, this.H);
    }
  }

  private drawEgg(c: CanvasRenderingContext2D) {
    const e = this.egg;
    const T = e.t;
    const k = this.ppu / e.ppu;
    const a = e.anchor;
    c.save();
    c.translate(this.sx(T.x), this.sy(T.y));
    c.rotate(-T.rot);
    c.scale(T.sx * k, T.sy * k);
    // canvas pixel of her centre, relative to the anchor on the floor
    c.drawImage(e.canvas, -a.x, -(a.y - e.centerY * e.ppu));
    if (T.sweat) {
      // a cartoon sweat drop sliding down beside her head
      const U = e.ppu;
      const x = T.sweat.x * U;
      const y = -T.sweat.y * U;
      const r = 0.07 * U;
      c.beginPath();
      c.moveTo(x, y - r * 2.2);
      c.quadraticCurveTo(x + r * 1.1, y - r * 0.4, x + r, y);
      c.arc(x, y, r, 0, Math.PI);
      c.quadraticCurveTo(x - r * 1.1, y - r * 0.4, x, y - r * 2.2);
      c.fillStyle = '#9fe0ff';
      c.fill();
      c.lineWidth = r * 0.45;
      c.strokeStyle = INK;
      c.stroke();
    }
    c.restore();
  }

  private drawBits(c: CanvasRenderingContext2D, bits: Bit[]) {
    const u = this.ppu;
    for (const p of bits) {
      c.save();
      c.translate(this.sx(p.x), this.sy(p.y));
      c.rotate(p.rot);
      const s = p.size * u;
      if (p.poly) {
        c.beginPath();
        p.poly.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)));
        c.closePath();
        c.fillStyle = p.color;
        c.fill();
        c.lineWidth = Math.max(1.2, s * 0.25);
        c.strokeStyle = INK;
        c.lineJoin = 'round';
        c.stroke();
      } else {
        // paper turning over: squash one axis
        c.scale(1, Math.max(0.15, Math.abs(Math.cos(p.flip))));
        c.fillStyle = p.color;
        c.fillRect(-s, -s * 0.6, s * 2, s * 1.2);
      }
      c.restore();
    }
  }
}

