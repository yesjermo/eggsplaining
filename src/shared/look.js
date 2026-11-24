// Mii-style look schema. Plain JS so the leaderboard server can validate avatars with the same rules.

/** @typedef {{ id: string, label: string }} Opt */

export const SKINS = ['#ffe3cf', '#f6d3b8', '#ecbf98', '#d49d74', '#a8714c', '#6f4630'];
export const HAIR_COLORS = ['#1c1719', '#3b2a24', '#6d4630', '#a8763f', '#d9b36c', '#c94f5d', '#5b4bd1', '#e9e3d9'];
export const OUTFITS = ['#7e4a8c', '#c9b6d9', '#ff9eb5', '#e8505b', '#ffb347', '#ffd86b', '#7fd6c2', '#3fa37a', '#8cc8ff', '#2f6fbf', '#3a3a4a', '#f4f1ea'];
export const LIPS = ['#d9897f', '#e46a72', '#c45a6a', '#b8735e', '#9c4f4f'];
export const GLASS_COLORS = ['#2b2440', '#b04a5a', '#d4a24c', '#3d7fd6', '#c9c4d6'];

/** @type {Opt[]} */
export const HAIRS = [
  { id: 'lowbun', label: 'Low bun' },
  { id: 'bun', label: 'Top bun' },
  { id: 'long', label: 'Long' },
  { id: 'bob', label: 'Bob' },
  { id: 'ponytail', label: 'Side pony' },
  { id: 'curls', label: 'Curls' },
  { id: 'pixie', label: 'Pixie' },
  { id: 'spikes', label: 'Spikes' },
  { id: 'buzz', label: 'Buzz' },
];
/** @type {Opt[]} */
export const BANGS = [
  { id: 'wispy', label: 'Wispy' },
  { id: 'curtain', label: 'Curtain' },
  { id: 'blunt', label: 'Blunt' },
  { id: 'side', label: 'Side' },
  { id: 'none', label: 'None' },
];
/** @type {Opt[]} */
export const BROWS = [
  { id: 'soft', label: 'Soft' },
  { id: 'straight', label: 'Straight' },
  { id: 'arched', label: 'Arched' },
  { id: 'thick', label: 'Thick' },
  { id: 'thin', label: 'Thin' },
];
/** @type {Opt[]} */
export const EYES = [
  { id: 'sleepy', label: 'Sleepy' },
  { id: 'round', label: 'Round' },
  { id: 'almond', label: 'Almond' },
  { id: 'dot', label: 'Dot' },
  { id: 'lashes', label: 'Lashes' },
];
/** @type {Opt[]} */
export const NOSES = [
  { id: 'button', label: 'Button' },
  { id: 'round', label: 'Round' },
  { id: 'dot', label: 'Dot' },
  { id: 'line', label: 'Line' },
  { id: 'none', label: 'None' },
];
/** @type {Opt[]} */
export const MOUTHS = [
  { id: 'soft', label: 'Soft smile' },
  { id: 'grin', label: 'Big grin' },
  { id: 'small', label: 'Small' },
  { id: 'pout', label: 'Pout' },
  { id: 'cat', label: 'Cat' },
];
/** @type {Opt[]} */
export const MOLES = [
  { id: 'none', label: 'None' },
  { id: 'chinL', label: 'Chin left' },
  { id: 'chinR', label: 'Chin right' },
  { id: 'cheekL', label: 'Cheek left' },
  { id: 'cheekR', label: 'Cheek right' },
  { id: 'lipL', label: 'By lip' },
];
/** @type {Opt[]} */
export const GLASSES = [
  { id: 'none', label: 'None' },
  { id: 'round', label: 'Round' },
  { id: 'square', label: 'Square' },
  { id: 'star', label: 'Star' },
];

/**
 * @typedef {{
 *   nickname: string, popLine: string,
 *   skin: string, height: number, width: number,
 *   hair: string, bangs: string, hairColor: string,
 *   brows: string, eyes: string, eyeSize: number, eyeGap: number,
 *   nose: string, mouth: string, lip: string,
 *   mole: string, blush: boolean, freckles: boolean,
 *   glasses: string, glassesColor: string, outfit: string,
 * }} Look
 */

/**
 * Default star, drawn from the reference photos: black hair tied back low with wispy
 * curtain bangs, sleepy monolid eyes, round full cheeks, soft closed smile, a little mole
 * on the chin, purple top.
 * @type {Look}
 */
export const PRESET = {
  nickname: 'Peggy',
  popLine: 'Why are you like this?',
  skin: '#f6d3b8',
  height: 1,
  width: 1.08,
  hair: 'lowbun',
  bangs: 'wispy',
  hairColor: '#1c1719',
  brows: 'soft',
  eyes: 'sleepy',
  eyeSize: 0.95,
  eyeGap: 1.05,
  nose: 'button',
  mouth: 'soft',
  lip: '#d9897f',
  mole: 'chinL',
  blush: true,
  freckles: false,
  glasses: 'none',
  glassesColor: '#2b2440',
  outfit: '#7e4a8c',
};

const HEX = /^#[0-9a-f]{6}$/i;
const ids = (/** @type {Opt[]} */ list) => new Set(list.map((o) => o.id));
const CHOICES = {
  hair: ids(HAIRS),
  bangs: ids(BANGS),
  brows: ids(BROWS),
  eyes: ids(EYES),
  nose: ids(NOSES),
  mouth: ids(MOUTHS),
  mole: ids(MOLES),
  glasses: ids(GLASSES),
};

/**
 * Trim, strip control/markup characters, cap length.
 * @param {unknown} v @param {string} fallback @param {number} max @returns {string}
 */
export function cleanText(v, fallback, max) {
  if (typeof v !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || fallback;
}

/** @param {unknown} v @param {number} lo @param {number} hi @param {number} d */
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
/** @param {unknown} v @param {string} d */
const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
/** @param {keyof typeof CHOICES} key @param {unknown} v @param {string} d */
const pick = (key, v, d) => (typeof v === 'string' && CHOICES[key].has(v) ? v : d);

/**
 * Coerce anything into a valid Look, falling back to the preset field by field.
 * @param {any} raw
 * @returns {Look}
 */
export function sanitizeLook(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const P = PRESET;
  return {
    nickname: cleanText(r.nickname, P.nickname, 16),
    popLine: cleanText(r.popLine, P.popLine, 40),
    skin: hex(r.skin, P.skin),
    height: num(r.height, 0.85, 1.15, P.height),
    width: num(r.width, 0.85, 1.2, P.width),
    hair: pick('hair', r.hair, P.hair),
    bangs: pick('bangs', r.bangs, P.bangs),
    hairColor: hex(r.hairColor, P.hairColor),
    brows: pick('brows', r.brows, P.brows),
    eyes: pick('eyes', r.eyes, P.eyes),
    eyeSize: num(r.eyeSize, 0.75, 1.3, P.eyeSize),
    eyeGap: num(r.eyeGap, 0.8, 1.25, P.eyeGap),
    nose: pick('nose', r.nose, P.nose),
    mouth: pick('mouth', r.mouth, P.mouth),
    lip: hex(r.lip, P.lip),
    mole: pick('mole', r.mole, P.mole),
    blush: typeof r.blush === 'boolean' ? r.blush : P.blush,
    freckles: typeof r.freckles === 'boolean' ? r.freckles : P.freckles,
    glasses: pick('glasses', r.glasses, P.glasses),
    glassesColor: hex(r.glassesColor, P.glassesColor),
    outfit: hex(r.outfit, P.outfit),
  };
}

/**
 * @param {() => number} [rnd]
 * @returns {Look}
 */
export function randomLook(rnd = Math.random) {
  /** @template T @param {T[]} arr @returns {T} */
  const one = (arr) => arr[Math.floor(rnd() * arr.length)];
  return sanitizeLook({
    ...PRESET,
    skin: one(SKINS),
    height: 0.9 + rnd() * 0.2,
    width: 0.9 + rnd() * 0.25,
    hair: one(HAIRS).id,
    bangs: one(BANGS).id,
    hairColor: one(HAIR_COLORS),
    brows: one(BROWS).id,
    eyes: one(EYES).id,
    eyeSize: 0.85 + rnd() * 0.35,
    eyeGap: 0.9 + rnd() * 0.25,
    nose: one(NOSES).id,
    mouth: one(MOUTHS).id,
    lip: one(LIPS),
    mole: rnd() < 0.4 ? one(MOLES).id : 'none',
    blush: rnd() < 0.6,
    freckles: rnd() < 0.25,
    glasses: rnd() < 0.35 ? one(GLASSES.slice(1)).id : 'none',
    glassesColor: one(GLASS_COLORS),
    outfit: one(OUTFITS),
  });
}

/**
 * Two-letter region from a BCP-47 locale like "en-US", or "" if there is none.
 * @param {unknown} locale @returns {string}
 */
export function regionFromLocale(locale) {
  if (typeof locale !== 'string') return '';
  const m = locale.match(/[-_]([A-Za-z]{2})(?:[-_]|$)/);
  return m ? m[1].toUpperCase() : '';
}

/** @param {unknown} v @returns {string} */
export function cleanCountry(v) {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : '';
}
