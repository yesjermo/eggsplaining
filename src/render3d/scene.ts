import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Egg, mulberry, type EggFrame, type Variant3D } from './egg';
import type { Look } from '../shared/look.js';
import { drawHead2D } from '../face2d';

const CONFETTI_COLORS = ['#ff9eb5', '#b9a4ff', '#7fd6c2', '#ffc46b', '#8cc8ff', '#ffffff', '#ff8a6b'];
const TUBE_R = 1.75;
const FLOOR_Y = 0.36;

interface Shard {
  mesh: Mesh;
  v: Vector3;
  spin: Vector3;
}

/** Lightweight Wii-style stage: Lambert lighting, no shadow maps, no environment maps. */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.1, 100);
  readonly egg: Egg;
  private lampMat: MeshLambertMaterial;
  private shards: Shard[] = [];
  private confetti: InstancedMesh;
  private confettiState: { p: Vector3; v: Vector3; r: Euler; spin: Vector3; landed: boolean }[] = [];
  private confettiCount = 0;
  private flash: Mesh;
  private flashMat: MeshBasicMaterial;
  private ghost: Sprite;
  private ghostCanvas = document.createElement('canvas');
  private ghostTex: CanvasTexture;
  private ghostAge = -1;
  private shake = 0;
  private baseDist = 10;
  private lookY = 1.55;
  private dummy = new Object3D();
  private tmp = new Vector3();
  private push = 0;
  private look: Look;

  static async create(canvas: HTMLCanvasElement, look: Look, variant: Variant3D = 'classic'): Promise<Stage> {
    return new Stage(canvas, look, variant);
  }

  constructor(canvas: HTMLCanvasElement, look: Look, variant: Variant3D = 'classic') {
    this.look = look;
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !lowEnd,
      alpha: true,
      powerPreference: 'default',
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowEnd ? 1.25 : 1.75));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.add(new HemisphereLight('#fbf8ff', '#ffd9c7', 2.1));
    const key = new DirectionalLight('#fff6ee', 1.6);
    key.position.set(4, 8, 6);
    const rim = new DirectionalLight('#c9b8ff', 1.0);
    rim.position.set(-5, 4, -6);
    this.scene.add(key, rim);

    this.lampMat = new MeshLambertMaterial({ color: '#ffb3c4', emissive: new Color('#ff6f91'), emissiveIntensity: 0.2 });
    this.buildChamber();

    this.egg = new Egg(look, variant);
    this.egg.root.position.y = FLOOR_Y;
    this.scene.add(this.egg.root);

    // soft blob shadow instead of a shadow map
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sctx = sc.getContext('2d')!;
    const grad = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(60,40,80,0.35)');
    grad.addColorStop(1, 'rgba(60,40,80,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);
    const blob = new Mesh(new PlaneGeometry(2.2, 1.4), new MeshBasicMaterial({ map: new CanvasTexture(sc), transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = FLOOR_Y + 0.004;
    this.scene.add(blob);

    // shell shards
    const shellMat = new MeshLambertMaterial({ color: '#fff3e2', side: DoubleSide });
    const rnd = mulberry(21);
    for (let i = 0; i < 14; i++) {
      const g = new SphereGeometry(0.9, 4, 3, 0, 0.35 + rnd() * 0.3, 0, 0.3 + rnd() * 0.3);
      g.translate(0, -0.9, 0);
      const m = new Mesh(g, shellMat);
      m.visible = false;
      this.scene.add(m);
      this.shards.push({ mesh: m, v: new Vector3(), spin: new Vector3() });
    }

    // confetti
    const N = 110;
    this.confetti = new InstancedMesh(new PlaneGeometry(0.11, 0.07), new MeshBasicMaterial({ side: DoubleSide }), N);
    this.confetti.instanceMatrix.setUsage(DynamicDrawUsage);
    const col = new Color();
    for (let i = 0; i < N; i++) {
      this.confetti.setColorAt(i, col.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
      this.confettiState.push({ p: new Vector3(), v: new Vector3(), r: new Euler(), spin: new Vector3(), landed: false });
    }
    this.confetti.count = 0;
    this.scene.add(this.confetti);

    this.flashMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    this.flash = new Mesh(new SphereGeometry(1, 16, 10), this.flashMat);
    this.flash.position.y = 2.2;
    this.scene.add(this.flash);

    // her soul, drawn in the same hand-drawn style as the splash
    this.ghostCanvas.width = 256;
    this.ghostCanvas.height = 320;
    this.ghostTex = new CanvasTexture(this.ghostCanvas);
    this.ghostTex.colorSpace = SRGBColorSpace;
    this.ghost = new Sprite(new SpriteMaterial({ map: this.ghostTex, transparent: true, depthWrite: false, opacity: 0 }));
    this.ghost.scale.set(1.6, 2.0, 1);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.drawGhost(0);

    this.resize();
  }

  private drawGhost(seed: number) {
    const c = this.ghostCanvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 320);
    drawHead2D(c, this.look, 128, 170, 70, { eyes: 'closed', mouth: 'o', worry: 0.2, lookX: 0, lookY: 0, flush: 0 }, { ghost: true, wobble: seed });
    this.ghostTex.needsUpdate = true;
  }

  private buildChamber() {
    const base = new MeshLambertMaterial({ color: '#f6f2ff' });
    const accent = new MeshLambertMaterial({ color: '#c8b8ff' });
    const metal = new MeshLambertMaterial({ color: '#e2dcf0' });

    const pedestal = new Mesh(new CylinderGeometry(2.05, 2.2, 0.36, 40), base);
    pedestal.position.y = 0.18;
    const ring = new Mesh(new TorusGeometry(2.06, 0.06, 8, 48), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.36;
    const floor = new Mesh(new CircleGeometry(TUBE_R, 40), new MeshLambertMaterial({ color: '#ffffff' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y + 0.002;

    const tubeH = 3.55;
    const glass = new Mesh(
      new CylinderGeometry(TUBE_R, TUBE_R, tubeH, 40, 1, true),
      new MeshBasicMaterial({ color: '#eef6ff', transparent: true, opacity: 0.13, side: DoubleSide, depthWrite: false }),
    );
    glass.position.y = FLOOR_Y + tubeH / 2;
    glass.renderOrder = 2;
    const streakMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.34, depthWrite: false, side: DoubleSide });
    const streak = new Mesh(new CylinderGeometry(TUBE_R + 0.005, TUBE_R + 0.005, tubeH * 0.86, 6, 1, true, 0.55, 0.12), streakMat);
    streak.position.y = glass.position.y;
    streak.renderOrder = 3;

    const topY = FLOOR_Y + tubeH;
    const cap = new Mesh(new CylinderGeometry(2.0, 2.05, 0.32, 40), base);
    cap.position.y = topY + 0.16;
    const capRing = new Mesh(new TorusGeometry(2.03, 0.06, 8, 48), accent);
    capRing.rotation.x = Math.PI / 2;
    capRing.position.y = topY;
    const dome = new Mesh(new SphereGeometry(0.7, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dome.scale.y = 0.45;
    dome.position.y = topY + 0.32;
    const lamp = new Mesh(new SphereGeometry(0.16, 12, 8), this.lampMat);
    lamp.position.set(0, topY + 0.68, 0);

    const hose = new Mesh(
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(-1.4, topY + 0.3, 0.2),
          new Vector3(-2.5, topY + 0.6, 0.3),
          new Vector3(-3.0, topY - 0.4, 0.5),
          new Vector3(-2.8, 2.3, 0.6),
        ]),
        28,
        0.09,
        8,
      ),
      accent,
    );
    // the gauge exists, but it is wearing a little cover: read her, not the dial
    const cover = new Mesh(new SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), new MeshLambertMaterial({ color: '#ffd6e0' }));
    cover.rotation.x = Math.PI / 2 - 0.15;
    cover.scale.set(1, 0.55, 1);
    cover.position.set(-2.8, 1.9, 0.64);
    const stand = new Mesh(new CylinderGeometry(0.05, 0.08, 1.55, 8), metal);
    stand.position.set(-2.8, 0.9, 0.6);
    const foot = new Mesh(new CylinderGeometry(0.35, 0.4, 0.08, 20), base);
    foot.position.set(-2.8, 0.08, 0.6);

    this.scene.add(pedestal, ring, floor, glass, streak, cap, capRing, dome, lamp, hose, cover, stand, foot);
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  setLook(look: Look) {
    this.look = look;
    this.egg.applyLook(look);
    this.drawGhost(0);
  }

  resize() {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const portrait = aspect < 0.8;
    const halfW = portrait ? 2.1 : 3.1;
    const tanV = Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    this.baseDist = Math.max(halfW / (tanV * aspect), 2.75 / tanV);
    this.lookY = portrait ? 1.6 : 1.75;
    this.camera.updateProjectionMatrix();
  }

  headScreen(): { x: number; y: number } {
    this.egg.headWorld(this.tmp);
    this.tmp.project(this.camera);
    const c = this.renderer.domElement;
    return { x: ((this.tmp.x + 1) / 2) * c.clientWidth, y: ((1 - this.tmp.y) / 2) * c.clientHeight };
  }

  /** big = run-ending pop; small = blitz pop */
  pop(reduced: boolean, big = true) {
    const rnd = Math.random;
    this.shake = reduced ? 0 : big ? 0.35 : 0.2;
    this.flashMat.opacity = reduced ? 0.3 : 0.8;
    this.flash.scale.setScalar(0.6);
    for (const s of this.shards) {
      const a = rnd() * Math.PI * 2;
      s.mesh.visible = true;
      s.mesh.position.set(Math.sin(a) * 0.6, FLOOR_Y + 1.4 + rnd() * 1.1, Math.cos(a) * 0.6);
      s.mesh.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
      s.mesh.scale.setScalar(0.5 + rnd() * 0.5);
      const sp = reduced ? 2 : 5;
      s.v.set(Math.sin(a) * sp * (0.5 + rnd()), 3 + rnd() * (reduced ? 2 : 5), Math.cos(a) * sp * (0.5 + rnd()));
      s.spin.set(rnd() * 12 - 6, rnd() * 12 - 6, rnd() * 12 - 6);
    }
    this.confettiCount = reduced ? 40 : big ? this.confettiState.length : 60;
    this.confetti.count = this.confettiCount;
    for (let i = 0; i < this.confettiCount; i++) {
      const c = this.confettiState[i];
      const a = rnd() * Math.PI * 2;
      const r = rnd() * 0.5;
      c.p.set(Math.sin(a) * r, FLOOR_Y + 2.0 + rnd() * 0.6, Math.cos(a) * r);
      const sp = (reduced ? 1.5 : 3.5) * (0.4 + rnd());
      c.v.set(Math.sin(a) * sp, (reduced ? 2 : 5) + rnd() * 4, Math.cos(a) * sp);
      c.r.set(rnd() * 6, rnd() * 6, rnd() * 6);
      c.spin.set(rnd() * 14 - 7, rnd() * 14 - 7, rnd() * 14 - 7);
      c.landed = false;
    }
    if (big) this.ghostAge = 0;
  }

  reset() {
    for (const s of this.shards) s.mesh.visible = false;
    this.confettiCount = 0;
    this.confetti.count = 0;
    this.ghostAge = -1;
    this.ghost.visible = false;
  }

  frame(f: EggFrame) {
    const dt = f.dt;
    this.egg.update(f);
    this.lampMat.emissiveIntensity = f.holding ? 0.8 + Math.sin(f.time * 10) * 0.4 : 0.15;

    for (const s of this.shards) {
      if (!s.mesh.visible) continue;
      s.v.y -= 16 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      contain(s.mesh.position, s.v, 0.4);
      if (s.mesh.position.y < FLOOR_Y + 0.03) {
        s.mesh.position.y = FLOOR_Y + 0.03;
        s.v.multiplyScalar(0.3);
        s.v.y = Math.abs(s.v.y) * 0.3;
        s.spin.multiplyScalar(0.5);
      }
    }

    for (let i = 0; i < this.confettiCount; i++) {
      const c = this.confettiState[i];
      if (!c.landed) {
        c.v.y -= 7 * dt;
        c.v.multiplyScalar(1 - 1.6 * dt);
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.spin.x * dt;
        c.r.y += c.spin.y * dt;
        c.r.z += c.spin.z * dt;
        contain(c.p, c.v, 0.2);
        if (c.p.y > FLOOR_Y + 3.4) {
          c.p.y = FLOOR_Y + 3.4;
          c.v.y = -Math.abs(c.v.y) * 0.3;
        }
        if (c.p.y <= FLOOR_Y + 0.01) {
          c.p.y = FLOOR_Y + 0.01 + (i % 5) * 0.002;
          c.r.set(-Math.PI / 2, 0, c.r.z);
          c.landed = true;
        }
      }
      this.dummy.position.copy(c.p);
      this.dummy.rotation.copy(c.r);
      this.dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this.dummy.matrix);
    }
    if (this.confettiCount) this.confetti.instanceMatrix.needsUpdate = true;

    if (this.flashMat.opacity > 0) {
      this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 4);
      this.flash.scale.multiplyScalar(1 + dt * 9);
    }

    // soul drifts up out of her after a run-ending pop, swaying like the splash
    if (this.ghostAge >= 0) {
      this.ghostAge += dt;
      const a = this.ghostAge;
      const rise = Math.min(1, Math.max(0, (a - 0.25) / 1.2));
      const ease = 1 - Math.pow(1 - rise, 3);
      this.ghost.visible = rise > 0;
      (this.ghost.material as SpriteMaterial).opacity = Math.min(0.85, rise * 1.5);
      this.ghost.position.set(Math.sin(a * 2.2) * 0.25 * (f.reduced ? 0.3 : 1), FLOOR_Y + 2.1 + ease * 1.1, 0.4);
      this.ghost.material.rotation = Math.sin(a * 1.7) * 0.12 * (f.reduced ? 0.3 : 1);
      // hand-drawn line boil at ~8 fps
      const seed = Math.floor(a * 8);
      if (seed !== Math.floor((a - dt) * 8) && !f.reduced) this.drawGhost(seed);
    }

    const pushTarget = f.holding && !f.reduced ? f.tension * 0.9 : 0;
    this.push += (pushTarget - this.push) * Math.min(1, dt * 2);
    this.shake = Math.max(0, this.shake - dt);
    const sk = this.shake * this.shake * 0.9;
    this.camera.position.set(
      Math.sin(f.time * 0.25) * (f.reduced ? 0 : 0.25) + (Math.random() - 0.5) * sk,
      this.lookY + 0.9 + (Math.random() - 0.5) * sk,
      this.baseDist - this.push,
    );
    this.camera.lookAt(0, this.lookY, 0);
    this.renderer.render(this.scene, this.camera);
  }
}

function contain(p: Vector3, v: Vector3, bounce: number) {
  const r = Math.hypot(p.x, p.z);
  const max = TUBE_R - 0.08;
  if (r > max) {
    const nx = p.x / r;
    const nz = p.z / r;
    p.x = nx * max;
    p.z = nz * max;
    const dot = v.x * nx + v.z * nz;
    if (dot > 0) {
      v.x -= (1 + bounce) * dot * nx;
      v.z -= (1 + bounce) * dot * nz;
    }
  }
}
