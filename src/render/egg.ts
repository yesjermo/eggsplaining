import {
  CanvasTexture,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
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
  type BufferGeometry,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Look } from '../shared/look.js';
import type { FakeTellKind, Phase } from '../game/state';
import { drawBangs, drawSkinDetails, shade } from '../face2d';

// Matches tools/blender/build_head.py
const H = 2.2;
const R = 0.82;
const LEG = 0.22;
const FACE_Y = H * 0.63;
const HAIRLINE_Y = H * 0.8;
const FACE_S = 0.66;

const TEX_W = 1024;
const TEX_H = 512;
const PX_X = TEX_W / (2 * Math.PI * 0.8);
const PX_Y = TEX_H / H;

const g = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));

function radiusAt(y: number): number {
  const u = MathUtils.clamp((y / H) * 2 - 1, -1, 1);
  return R * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.16 * u);
}

/** Same sculpt as the Blender script, so face parts sit on her cheeks rather than in them. */
function sculpt(theta: number, h: number): number {
  let off = 0;
  for (const s of [-1, 1]) {
    off += 0.06 * g(theta - s * 0.62, 0.3) * g(h - 1.12, 0.26);
    off -= 0.012 * g(theta - s * 0.27, 0.11) * g(h - 1.43, 0.09);
  }
  off += 0.022 * g(theta, 0.75) * g(h - 0.92, 0.22);
  off += 0.008 * g(theta, 0.55) * g(h - 1.66, 0.07);
  return off;
}

function onSurface(theta: number, y: number, off = 0, sculpted = true): Vector3 {
  const r = radiusAt(y) + off + (sculpted ? sculpt(theta, y) : 0);
  return new Vector3(Math.sin(theta) * r, y, Math.cos(theta) * r);
}

const lambert = (color: string, extra: Partial<ConstructorParameters<typeof MeshLambertMaterial>[0]> = {}) =>
  new MeshLambertMaterial({ color, ...extra });

// ---------- the Blender head, loaded once ----------

type Parts = Record<'Body' | 'Sclera' | 'Iris' | 'Lid' | 'Brow' | 'MouthLine' | 'MouthOpen' | 'Nose' | 'HairLowbun' | 'BangsWispy', Mesh>;
let partsPromise: Promise<Parts> | null = null;

export function loadHead(url = `${import.meta.env.BASE_URL}models/egg-head.glb`): Promise<Parts> {
  partsPromise ??= new GLTFLoader().loadAsync(url).then((gltf) => {
    const parts = {} as Parts;
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      // multi-material meshes arrive as a Group of primitives; keep the group's first mesh name
      if (m.isMesh) {
        const key = (m.name || m.parent?.name || '').replace(/_\d+$/, '') as keyof Parts;
        if (!parts[key]) parts[key] = m;
      }
    });
    // collect multi-primitive meshes under their parent so every material comes along
    gltf.scene.traverse((o) => {
      if (o.children.length > 1 && o.children.every((c) => (c as Mesh).isMesh)) {
        parts[o.name as keyof Parts] = o as unknown as Mesh;
      }
    });
    return parts;
  });
  return partsPromise;
}

/** Clone a part (mesh or group of primitive meshes) and give each primitive its own material. */
function clonePart(src: Object3D, mats: (name: string) => Material): Object3D {
  const c = src.clone(true);
  c.position.set(0, 0, 0);
  c.rotation.set(0, 0, 0);
  c.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const name = (Array.isArray(m.material) ? m.material[0] : m.material).name;
    m.material = mats(name);
    if (m.morphTargetInfluences) m.morphTargetInfluences = m.morphTargetInfluences.slice();
  });
  return c;
}

/** Set a named morph on every primitive of a part. */
function setMorph(part: Object3D, name: string, value: number) {
  part.traverse((o) => {
    const m = o as Mesh;
    const i = m.morphTargetDictionary?.[name];
    if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = value;
  });
}

// ---------- animation frame input ----------

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

/** Every animated face channel, eased toward a target each frame. */
type Channel =
  | 'close'
  | 'sleepy'
  | 'wide'
  | 'worry'
  | 'angry'
  | 'raise'
  | 'flat'
  | 'frown'
  | 'wavy'
  | 'big'
  | 'small'
  | 'grin'
  | 'o'
  | 'puff'
  | 'lookX'
  | 'lookY';

export class Egg {
  readonly root = new Group();
  private body = new Group();
  private shape = new Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private skinMat: MeshLambertMaterial;
  private limbMat = lambert('#ffe0c8');
  private shoeMat = lambert('#7e4a8c');
  private hairMat = lambert('#1c1719', { side: DoubleSide });
  private glassMat = lambert('#2b2440');
  private browMat = lambert('#1c1719');
  private lipMat = lambert('#c9786f');
  private tieMat = lambert('#7e4a8c');
  private faceSkin = lambert('#f6d3b8');
  private shell: Mesh;
  private hair = new Group();
  private glasses = new Group();
  private face = new Group();
  private frazzle = new Group();
  private sweat: Mesh;
  private arms: Group[] = [];
  private legs: Group[] = [];
  private eyes: { root: Group; sclera: Object3D; iris: Object3D; lid: Object3D }[] = [];
  private brows: Object3D[] = [];
  private mouthLine!: Object3D;
  private mouthOpen!: Object3D;
  private nose!: Object3D;
  private headTop = new Object3D();
  private mouthBaseZ = 0;
  private noseBaseZ = 0;
  private look!: Look;
  private faceKey = '';
  private parts: Parts;
  private ch: Record<Channel, number> = {
    close: 0, sleepy: 0, wide: 0, worry: 0, angry: 0, raise: 0, flat: 0, frown: 0, wavy: 0, big: 0, small: 0, grin: 0, o: 0, puff: 0, lookX: 0, lookY: 0,
  };

  private blinkT = 0;
  private nextBlink = 2;
  private blinking = 0;
  private glance = 0;
  private glanceTimer = 0;
  private dart = { x: 0, y: 0, t: 0 };
  private squash = 0;
  private shakeSeed = Math.random() * 100;

  static async create(look: Look): Promise<Egg> {
    return new Egg(look, await loadHead());
  }

  private constructor(look: Look, parts: Parts) {
    this.parts = parts;
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.flipY = false; // glTF UV convention
    this.skinMat = new MeshLambertMaterial({ map: this.tex });

    this.root.add(this.body);
    this.body.position.y = LEG;
    this.body.add(this.shape);

    const bodySrc = parts.Body;
    this.shell = new Mesh(bodySrc.geometry as BufferGeometry, this.skinMat);
    if (bodySrc.morphTargetInfluences) {
      this.shell.morphTargetDictionary = bodySrc.morphTargetDictionary;
      this.shell.morphTargetInfluences = bodySrc.morphTargetInfluences.slice();
    }
    this.shape.add(this.shell, this.face, this.hair, this.glasses, this.frazzle);
    this.headTop.position.set(0, H + 0.4, 0);
    this.shape.add(this.headTop);

    this.buildFace();
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

  private mat = (name: string): Material => {
    switch (name) {
      case 'white':
        return lambert('#ffffff');
      case 'iris':
        return lambert('#3a2620');
      case 'pupil':
        return lambert('#120c0e');
      case 'glint':
        return new MeshBasicMaterial({ color: '#ffffff' });
      case 'ink':
        return lambert('#241c22');
      case 'lip':
        return this.lipMat;
      case 'mouth':
        return lambert('#5e1f30');
      case 'teeth':
        return lambert('#fbf7f2');
      case 'hair':
        return this.hairMat;
      case 'tie':
        return this.tieMat;
      case 'brow':
        return this.browMat;
      case 'skin':
      default:
        return this.faceSkin;
    }
  };

  private buildFace() {
    for (let i = 0; i < 2; i++) {
      const root = new Group();
      const sclera = clonePart(this.parts.Sclera, this.mat);
      const iris = clonePart(this.parts.Iris, this.mat);
      const lid = clonePart(this.parts.Lid, this.mat);
      root.add(sclera, iris, lid);
      this.face.add(root);
      this.eyes.push({ root, sclera, iris, lid });
      const brow = clonePart(this.parts.Brow, this.mat);
      this.face.add(brow);
      this.brows.push(brow);
    }
    this.mouthLine = clonePart(this.parts.MouthLine, this.mat);
    this.mouthOpen = clonePart(this.parts.MouthOpen, this.mat);
    this.nose = clonePart(this.parts.Nose, this.mat);
    this.face.add(this.mouthLine, this.mouthOpen, this.nose);
  }

  /** Put the face parts on her sculpted surface for this look's eye spacing and size. */
  private layoutFace(look: Look) {
    const ex = 0.4 * look.eyeGap * FACE_S;
    const ey = FACE_Y + 0.05 * FACE_S;
    this.eyes.forEach((e, i) => {
      const s = i ? 1 : -1;
      const th = Math.asin((s * ex) / (radiusAt(ey) + sculpt(0.3, ey)));
      e.root.position.copy(onSurface(th, ey, -0.01));
      e.root.rotation.set(0, th, 0);
      e.root.scale.setScalar(look.eyeSize);
      const dot = look.eyes === 'dot';
      e.sclera.visible = !dot;
      e.lid.visible = !dot;
      e.iris.scale.setScalar(dot ? 0.62 : 1);
    });
    const by = FACE_Y + 0.36 * FACE_S;
    this.brows.forEach((b, i) => {
      const s = i ? 1 : -1;
      const th = Math.asin((s * (ex + 0.02)) / radiusAt(by));
      b.position.copy(onSurface(th, by, 0.006));
      b.rotation.set(0, th, 0);
      const thick = look.brows === 'thick' ? 1.8 : look.brows === 'thin' ? 0.6 : 1;
      b.scale.set(s, thick, 1); // mirror the left brow
    });
    const ny = FACE_Y - 0.24 * FACE_S;
    this.nose.position.copy(onSurface(0, ny, 0));
    this.nose.visible = look.nose === 'button' || look.nose === 'round';
    this.nose.scale.setScalar(look.nose === 'round' ? 1.45 : 1);
    const my = FACE_Y - 0.52 * FACE_S;
    this.mouthLine.position.copy(onSurface(0, my, 0.006));
    this.mouthOpen.position.copy(onSurface(0, my, 0.003));
    this.mouthBaseZ = this.mouthLine.position.z;
    this.noseBaseZ = this.nose.position.z;
    this.lipMat.color.set(shade(look.lip, -0.15));
  }

  applyLook(look: Look): void {
    this.look = look;
    this.shape.scale.set(look.width, look.height, look.width);
    this.limbMat.color.set(look.skin);
    this.faceSkin.color.set(look.skin);
    this.shoeMat.color.set(look.outfit);
    this.tieMat.color.set(look.outfit);
    this.hairMat.color.set(look.hairColor);
    this.browMat.color.set(look.hairColor === '#e9e3d9' ? '#8a7f70' : look.hairColor);
    this.glassMat.color.set(look.glassesColor);
    this.layoutFace(look);
    this.setHair(look);
    this.setGlasses(look);
    this.faceKey = '';
  }

  // ---------- skin texture: colour, blush, mole, outfit, painted bangs, cracks ----------

  private paint(flush: number, cracks: number, sooty: boolean) {
    const key = `${flush.toFixed(1)}|${cracks}|${sooty}`;
    if (key === this.faceKey) return;
    this.faceKey = key;
    const c = this.ctx;
    const look = this.look;
    const cx = TEX_W / 2;
    const toY = (y: number) => (1 - y / H) * TEX_H;
    c.fillStyle = look.skin;
    c.fillRect(0, 0, TEX_W, TEX_H);
    const grad = c.createLinearGradient(0, 0, 0, TEX_H);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(80,40,60,0.10)');
    c.fillStyle = grad;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // crown under the hair
    c.fillStyle = look.hairColor;
    c.globalAlpha = look.hair === 'buzz' ? 0.85 : 1;
    c.fillRect(0, 0, TEX_W, toY(look.hair === 'buzz' ? H * 0.78 : HAIRLINE_Y) + 2);
    c.globalAlpha = 1;
    // outfit band, trim, bib, buttons
    const bandTop = toY(0.56);
    c.fillStyle = look.outfit;
    c.fillRect(0, bandTop, TEX_W, TEX_H - bandTop);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillRect(0, bandTop - 4, TEX_W, 8);
    c.fillStyle = look.outfit;
    c.beginPath();
    c.roundRect(cx - 90, toY(0.74), 180, bandTop - toY(0.74) + 4, 18);
    c.fill();
    c.fillStyle = shade(look.outfit, 0.6);
    for (const sx of [-1, 1]) {
      c.beginPath();
      c.arc(cx + sx * 58, toY(0.68), 9, 0, Math.PI * 2);
      c.fill();
    }
    // face details (the eyes, brows, nose and mouth are 3D)
    c.save();
    c.translate(cx, toY(FACE_Y));
    c.scale(1, PX_Y / PX_X);
    drawSkinDetails(c, look, flush, 0, 0, FACE_S * PX_X);
    if (!(look.bangs === 'wispy' && look.hair !== 'buzz')) drawBangs(c, look, FACE_S * PX_X * 1.05, 0, (FACE_Y - HAIRLINE_Y) * PX_X - 6);
    c.restore();
    if (sooty) {
      c.fillStyle = 'rgba(70,60,66,0.35)';
      for (const [x, y, r] of [
        [-150, 0.95, 40],
        [170, 1.6, 30],
        [60, 0.92, 22],
      ] as const) {
        c.beginPath();
        c.arc(cx + x, toY(y), r, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (cracks > 0) {
      c.strokeStyle = '#6b3f3f';
      c.lineWidth = 5;
      c.lineJoin = 'round';
      const starts = [cx + 40, cx - 230, cx + 260, cx - 60, cx + 420];
      for (let i = 0; i < cracks; i++) {
        let x = starts[i];
        let y = toY(H * 0.97);
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
      const y = H * 0.42;
      pivot.position.set(s * (radiusAt(y) + 0.02), y, 0.05);
      const arm = new Mesh(new CapsuleGeometry(0.085, 0.34, 4, 8), this.limbMat);
      arm.position.y = -0.24;
      const hand = new Mesh(new SphereGeometry(0.12, 12, 10), mitt);
      hand.position.y = -0.46;
      pivot.add(arm, hand);
      this.shape.add(pivot);
      this.arms.push(pivot);
    }
  }

  private buildLegs() {
    const sole = lambert('#ffffff');
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(s * 0.3, LEG + 0.12, 0);
      const leg = new Mesh(new CapsuleGeometry(0.07, 0.18, 4, 8), this.limbMat);
      leg.position.y = -0.14;
      const shoe = new Group();
      shoe.position.set(0, -0.3, 0.08);
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
      c.position.copy(onSurface(theta, H * 0.88, 0, false));
      c.position.y += 0.14;
      c.rotation.set(Math.cos(theta) * lean, 0, -Math.sin(theta) * lean);
      this.frazzle.add(c);
    }
    this.frazzle.visible = false;
  }

  private setHair(look: Look) {
    disposeChildren(this.hair);
    const m = this.hairMat;
    if (look.bangs === 'wispy' && look.hair !== 'buzz') this.hair.add(clonePart(this.parts.BangsWispy, this.mat));
    if (look.hair === 'lowbun') {
      // the sculpted Blender hair: cap, low bun with tie, face-framing strands
      this.hair.add(clonePart(this.parts.HairLowbun, this.mat));
      return;
    }
    const capFrom = look.hair === 'buzz' ? H * 0.8 : HAIRLINE_Y;
    this.hair.add(this.lathePart(capFrom, H, look.hair === 'buzz' ? 0.006 : 0.045, m));
    const ball = (r: number, x: number, y: number, z: number) => {
      const s = new Mesh(new SphereGeometry(r, 14, 10), m);
      s.position.set(x, y, z);
      this.hair.add(s);
      return s;
    };
    const backSheet = (y0: number) => this.hair.add(this.lathePart(y0, H * 0.82, 0.07, m, Math.PI * 0.36, Math.PI * 1.28, 28));
    switch (look.hair) {
      case 'bun':
        ball(0.34, 0, H + 0.2, 0);
        break;
      case 'long':
        backSheet(H * 0.12);
        break;
      case 'bob':
        backSheet(H * 0.46);
        break;
      case 'ponytail':
        [
          [0.68, H - 0.16, -0.2, 0.21],
          [0.9, H - 0.32, -0.18, 0.2],
          [1.04, H - 0.56, -0.16, 0.17],
          [1.06, H - 0.8, -0.14, 0.12],
        ].forEach(([x, y, z, r]) => ball(r, x, y, z));
        break;
      case 'curls':
        for (let i = 0; i < 18; i++) {
          const th = Math.PI * 0.35 + (i / 18) * Math.PI * 1.3;
          const p = onSurface(th, H * (0.8 + (i % 3) * 0.07), 0.06, false);
          ball(0.17, p.x, p.y, p.z);
        }
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          ball(0.18, Math.sin(a) * 0.18, H + 0.02, Math.cos(a) * 0.18);
        }
        break;
      case 'pixie':
        ball(0.3, 0.2, H * 0.95, 0.25).scale.set(1.6, 0.6, 1);
        break;
      case 'spikes':
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2;
          const lean = i % 2 ? 0.45 : 0.75;
          const c = new Mesh(new ConeGeometry(0.13, 0.55, 6), m);
          c.position.set(Math.sin(ang) * 0.3, H + 0.08, Math.cos(ang) * 0.3);
          c.rotation.set(Math.cos(ang) * lean, 0, -Math.sin(ang) * lean);
          this.hair.add(c);
        }
        break;
    }
  }

  private setGlasses(look: Look) {
    disposeChildren(this.glasses);
    if (look.glasses === 'none') return;
    const ex = 0.4 * look.eyeGap * FACE_S;
    const ey = FACE_Y + 0.05 * FACE_S;
    const r = 0.3 * FACE_S * look.eyeSize;
    for (const s of [-1, 1]) {
      const theta = Math.asin((s * ex) / (radiusAt(ey) + sculpt(0.3, ey)));
      let ring: Mesh;
      if (look.glasses === 'square') {
        ring = new Mesh(new TorusGeometry(r * 1.15, 0.022, 4, 4), this.glassMat);
        ring.rotation.z = Math.PI / 4;
      } else if (look.glasses === 'star') {
        ring = new Mesh(new TorusGeometry(r * 1.05, 0.024, 4, 5), lambert('#ffb547'));
        ring.rotation.z = Math.PI / 2;
      } else ring = new Mesh(new TorusGeometry(r, 0.022, 6, 24), this.glassMat);
      const grp = new Group();
      grp.add(ring);
      grp.position.copy(onSurface(theta, ey, 0.08));
      grp.rotation.set(0, theta, 0);
      this.glasses.add(grp);
    }
    const bridge = new Mesh(new TorusGeometry(0.06, 0.018, 4, 10, Math.PI), this.glassMat);
    bridge.position.copy(onSurface(0, ey + 0.02, 0.09));
    this.glasses.add(bridge);
  }

  // ---------- animation ----------

  private ease(name: Channel, target: number, rate: number, dt: number) {
    this.ch[name] += (target - this.ch[name]) * Math.min(1, dt * rate);
  }

  update(f: EggFrame): void {
    const k = f.reduced ? 0.3 : 1;
    const t = f.time;
    const tens = f.tension;
    const popped = f.popAge >= 0;
    const look = this.look;

    // Blink rate is the most reliable tell: ~3s apart when calm, ~0.3s near the edge.
    this.blinkT += f.dt;
    if (this.blinking > 0) this.blinking = Math.max(0, this.blinking - f.dt);
    if (this.blinkT >= this.nextBlink) {
      this.blinkT = 0;
      this.nextBlink = (3.2 + (0.28 - 3.2) * Math.pow(tens, 1.2)) * (0.8 + Math.random() * 0.4);
      this.blinking = 0.13;
    }

    // ---- expression targets
    const base = { sleepy: look.eyes === 'sleepy' ? 1 : look.eyes === 'almond' ? 0.55 : 0.2, wide: look.eyes === 'round' || look.eyes === 'lashes' ? 0.25 : 0 };
    const T: Record<Channel, number> = {
      close: 0, sleepy: base.sleepy, wide: base.wide, worry: 0, angry: 0, raise: 0, flat: 0, frown: 0, wavy: 0, big: 0, small: 0, grin: 0, o: 0, puff: 0, lookX: 0, lookY: 0,
    };
    if (look.brows === 'straight') T.flat = 0;
    if (look.mouth === 'small') T.small = 1;
    if (look.mouth === 'pout') T.small = 1;
    if (look.mouth === 'grin') T.big = 0.6;
    if (look.mouth === 'cat') T.wavy = 0.35;
    let shake = 0;
    if (popped) {
      T.sleepy = 1;
      T.close = 0.3;
      T.flat = 1;
      T.small = 0;
      T.angry = 0.4;
    } else if (f.fakeTell === 'serene') {
      T.close = 0.95;
      T.grin = 1;
      T.raise = 0.6;
      shake = Math.max(0, tens - 0.6) * 0.35;
    } else if (f.fakeTell === 'panic') {
      T.wide = 1;
      T.sleepy = 0;
      T.o = 1;
      T.worry = 1;
      shake = 0.6;
    } else {
      if (tens > 0.72) {
        T.wavy = 1;
        T.small = 0;
      } else if (tens > 0.45) T.flat = 1;
      if (f.holding) {
        T.worry = Math.min(1, tens * 1.15);
        T.puff = MathUtils.smoothstep(tens, 0.3, 0.9) * 0.9;
        if (tens > 0.6) {
          T.wide = 0.8;
          T.sleepy = base.sleepy * 0.3;
        }
      }
      shake = Math.max(0, tens - 0.55) / 0.45;
      if (f.bankAge >= 0 && f.bankAge < 0.7) {
        T.grin = 1;
        T.close = 0.85;
        T.raise = 0.7;
        T.flat = T.wavy = 0;
      }
    }
    if (this.blinking > 0) T.close = 1;

    // look around: glance at the gauge on long holds, little idle darts otherwise
    this.glanceTimer -= f.dt;
    if (f.holding && tens > 0.5 && this.glanceTimer <= 0 && !f.fakeTell) {
      this.glance = this.glance > 0.5 ? 0 : 1;
      this.glanceTimer = this.glance ? 0.6 : 0.9 + Math.random() * 0.8;
    }
    if (!f.holding || popped) this.glance = 0;
    this.dart.t -= f.dt;
    if (this.dart.t <= 0) {
      this.dart = { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.3, t: 1.2 + Math.random() * 2.2 };
    }
    T.lookX = this.glance ? -1 : popped ? 0 : this.dart.x * k;
    T.lookY = this.glance ? 0.6 : popped ? 0 : this.dart.y * k;

    // ---- ease every channel (this is the "animated" part: no snapping between faces)
    const dt = f.dt;
    this.ease('close', T.close, T.close > this.ch.close ? 40 : 18, dt);
    for (const c of ['sleepy', 'wide', 'worry', 'angry', 'raise', 'flat', 'frown', 'wavy', 'big', 'small', 'grin', 'o'] as Channel[]) this.ease(c, T[c], 12, dt);
    this.ease('puff', T.puff, 6, dt);
    this.ease('lookX', T.lookX, 14, dt);
    this.ease('lookY', T.lookY, 14, dt);

    // ---- apply to the meshes
    const ch = this.ch;
    for (const e of this.eyes) {
      setMorph(e.lid, 'Close', ch.close);
      setMorph(e.lid, 'Sleepy', Math.max(0, ch.sleepy * (1 - ch.close)));
      setMorph(e.lid, 'Wide', ch.wide * (1 - ch.close));
      e.iris.position.set(ch.lookX * 0.03, ch.lookY * 0.02, 0);
      if (look.eyes === 'dot') e.iris.scale.set(0.62, 0.62 * (1 - ch.close * 0.9), 0.62);
    }
    for (const b of this.brows) {
      setMorph(b, 'Worry', ch.worry);
      setMorph(b, 'Angry', ch.angry);
      setMorph(b, 'Raise', ch.raise);
      setMorph(b, 'Flat', look.brows === 'straight' ? 1 : 0);
      setMorph(b, 'Arch', look.brows === 'arched' ? 1 : 0);
    }
    const open = Math.max(ch.grin, ch.o);
    setMorph(this.mouthOpen, 'Grin', ch.grin);
    setMorph(this.mouthOpen, 'O', ch.o);
    this.mouthOpen.visible = open > 0.04;
    this.mouthLine.visible = open < 0.55;
    setMorph(this.mouthLine, 'Flat', ch.flat);
    setMorph(this.mouthLine, 'Wavy', ch.wavy);
    setMorph(this.mouthLine, 'Big', ch.big);
    setMorph(this.mouthLine, 'Small', ch.small);
    setMorph(this.mouthLine, 'Frown', ch.frown);
    // the cheek puff pushes the lower face forward; keep the mouth and nose riding on top
    const puffNow = ch.puff + (popped ? 0.3 : 0);
    this.mouthLine.position.z = this.mouthBaseZ + puffNow * 0.028;
    this.mouthOpen.position.z = this.mouthBaseZ - 0.003 + puffNow * 0.028;
    this.nose.position.z = this.noseBaseZ + puffNow * 0.012;
    const i = this.shell.morphTargetDictionary?.Puff;
    if (i !== undefined && this.shell.morphTargetInfluences) this.shell.morphTargetInfluences[i] = ch.puff + (popped ? 0.3 : 0);

    // skin: flush, cracks (never faked), soot after the pop
    const flush = popped ? 0.6 : Math.round(Math.pow(tens, 1.5) * 10) / 10;
    const cracks = popped ? 5 : tens > 0.72 ? Math.min(5, 1 + Math.floor((tens - 0.72) / 0.05)) : 0;
    this.paint(flush, cracks, popped);

    const sweatOn = !popped && tens > 0.6 && f.fakeTell !== 'serene';
    this.sweat.visible = sweatOn;
    if (sweatOn) this.sweat.position.copy(onSurface(0.8, H * 0.8 - ((t * 0.9) % 1) * 0.4, 0.03));

    // ---- body motion
    this.squash += ((f.holding ? 1 : 0) - this.squash) * Math.min(1, dt * 10);
    const wob = (0.03 + tens * tens * 0.1) * k;
    const freq = 2 + tens * 7;
    const jitter = shake * 0.035 * k;
    const n1 = Math.sin(t * 61 + this.shakeSeed) * Math.sin(t * 37);
    const n2 = Math.sin(t * 53 + 2.1) * Math.cos(t * 29);

    if (popped) {
      const a = Math.min(1, f.popAge / 0.3);
      const e = 1 - Math.pow(1 - a, 3);
      this.root.position.y = -0.3 * e;
      this.body.rotation.set(-0.14 * e, 0, 0.05 * e);
      this.body.position.x = 0;
      const thump = f.popAge < 0.45 ? Math.sin((f.popAge / 0.45) * Math.PI) * 0.12 * k : 0;
      this.body.scale.set(1 + thump, 1 - thump, 1 + thump);
      this.legs.forEach((l, li) => {
        l.rotation.x = -1.45 * e;
        l.rotation.z = (li ? -1 : 1) * 0.25 * e;
      });
      this.arms.forEach((arm, ai) => arm.rotation.set(0, 0, (ai ? 1 : -1) * 0.95 * e));
      this.frazzle.visible = true;
      return;
    }

    this.frazzle.visible = false;
    this.root.position.y = 0;
    const breathe = Math.sin(t * 2.2) * 0.012;
    const sq = this.squash * (0.05 + tens * 0.05);
    this.body.scale.set(1 + sq + breathe, 1 - sq * 1.2 - breathe + tens * 0.06, 1 + sq + breathe);
    this.body.rotation.set(0, Math.sin(t * 0.7) * 0.05 * k, Math.sin(t * freq) * wob + n2 * jitter);
    this.body.position.x = n1 * jitter;

    const cheer = f.bankAge >= 0 && f.bankAge < 0.6 ? 1 - f.bankAge / 0.6 : 0;
    const tense = f.holding ? MathUtils.smoothstep(tens, 0.5, 0.85) : 0;
    this.arms.forEach((arm, ai) => {
      const s = ai ? 1 : -1;
      arm.rotation.z = s * (0.25 + Math.sin(t * 2 + ai) * 0.05 * k + cheer * 2.2 + tense * 2.3);
      arm.rotation.x = -tense * 0.9 - cheer * 0.3;
    });

    const tapping = f.phase === 'ready' && f.idleMs > 1800;
    this.legs.forEach((l, li) => {
      l.rotation.x = tapping && li === 1 ? -Math.max(0, Math.sin(t * 13)) * 0.45 * (f.reduced ? 0.5 : 1) : 0;
      l.rotation.z = 0;
    });
  }
}

function disposeChildren(g: Group) {
  for (const c of [...g.children]) {
    c.traverse((o) => {
      const m = o as Mesh;
      // shared GLB geometry is reused across clones, only free what we built here
      if (m.isMesh && !m.morphTargetDictionary && m.geometry.type !== 'BufferGeometry') m.geometry.dispose();
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

export const EGG_HEIGHT = H + LEG;
