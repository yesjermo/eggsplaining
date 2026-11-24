import '@fontsource-variable/fredoka/wght.css';
import './style.css';
import { Game, type GameEvent, type Mode } from './game/state';
import { HoldInput } from './game/holdInput';
import { Sfx } from './audio';
import { Splash, splashGif } from './splash';
import { createMaker } from './ui/miimaker';
import { avatarDataUrl } from './face2d';
import { PRESET, randomLook, sanitizeLook, type Look } from './shared/look.js';
import { flag, loadSettings, saveSettings, type Settings, type Style } from './settings';
import type { EggFrame } from './render/egg';

/** What both renderers offer: the flat 2D cartoon stage and the 3D (first design / Mii) stage. */
interface Stage {
  reset(): void;
  resize(): void;
  setLook(look: Look): void;
  pop(reduced: boolean, big?: boolean): void;
  headScreen(): { x: number; y: number };
  frame(f: EggFrame): void;
  dispose?(): void;
}
import { backend } from './leaderboard';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const settings: Settings = loadSettings();
const game = new Game('classic');
const sfx = new Sfx();
sfx.muted = settings.muted;
let stage: Stage | null = null;
let stageLoading: Promise<Stage> | null = null;

// ---------- elements ----------
const splashEl = $('#splash');
const hudEl = $('#hud');
const scoreEl = $('#score');
const bestEl = $('#best');
const blitzEl = $('#blitz');
const timeEl = $('#time');
const timebar = $('#timebar');
const comboEl = $('#combo');
const gainEl = $('#gain');
const statusEl = $('#status');
const holdBtn = $<HTMLButtonElement>('#hold');
const holdLabel = $('.hold-label');
const bubble = $('#bubble');
const popups = $('#popups');
const resultEl = $('#result');
const resultTitle = $('#result-title');
const resultScore = $('#result-score');
const resultBest = $('#result-best');
const resultRank = $('#result-rank');
const postForm = $<HTMLFormElement>('#post-form');
const postName = $<HTMLInputElement>('#post-name');
const postFlag = $('#post-flag');
const postBtn = $<HTMLButtonElement>('#btn-post');
const boardEl = $('#board');
const boardRows = $('#board-rows');
const boardYou = $('#board-you');
const makerEl = $('#maker');
const muteBtn = $<HTMLButtonElement>('#btn-mute');
const motionBtn = $<HTMLButtonElement>('#btn-motion');

// ---------- state ----------
type Screen = 'splash' | 'game';
let screen: Screen = 'splash';
let popAge = -1;
let bankAge = -1;
let gainFlash: { text: string; cls: string; until: number } | null = null;
let fineClock = 0;
let swallowKey = false;
let openSheet: HTMLElement | null = null;
let runId: string | null = null;
let runOffline = false;
let posted = false;
let lastOver: { score: number; mode: Mode } | null = null;
let boardMode: Mode = 'classic';
let boardPeriod: 'today' | 'all' = 'today';

const save = () => saveSettings(settings);
const reduced = () => settings.reducedMotion;
const vibrate = (p: number | number[]) => {
  if (!reduced()) navigator.vibrate?.(p);
};

// ---------- splash ----------
const splash = new Splash($<HTMLCanvasElement>('#splash-art'), settings.look, reduced);
splash.start();

function showBests() {
  document.querySelectorAll<HTMLElement>('[data-best]').forEach((el) => {
    const b = settings.best[el.dataset.best as Mode];
    el.textContent = b ? `Your best: ${b}` : '';
  });
}
showBests();

function loadStage(): Promise<Stage> {
  if (stage) return Promise.resolve(stage);
  // the 3D renderer (and Three.js) only downloads when someone picks a 3D style
  const style = settings.style;
  const canvas = $<HTMLCanvasElement>('#stage');
  stageLoading ??= (
    style === 'cartoon'
      ? import('./render/scene').then(({ Stage }) => Stage.create(canvas, settings.look))
      : import('./render3d/scene').then(({ Stage }) => Stage.create(canvas, settings.look, style === '3d-mii' ? 'mii' : 'classic'))
  ).then((s) => {
    stage = s;
    return s;
  });
  return stageLoading;
}

/** Swap renderers. A canvas can't go from 2D to WebGL, so she gets a fresh one. */
async function setStyle(style: Style) {
  if (style === settings.style) return;
  settings.style = style;
  saveSettings(settings);
  syncStyleSeg();
  const old = stage ?? (stageLoading ? await stageLoading : null);
  old?.dispose?.();
  stage = null;
  stageLoading = null;
  const prev = $<HTMLCanvasElement>('#stage');
  prev.replaceWith(prev.cloneNode(false));
  const s = await loadStage();
  s.resize();
}

function syncStyleSeg() {
  document.querySelectorAll<HTMLButtonElement>('#style-seg button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.style === settings.style));
  });
}
document.querySelectorAll<HTMLButtonElement>('#style-seg button').forEach((b) =>
  b.addEventListener('click', () => void setStyle(b.dataset.style as Style)),
);
syncStyleSeg();
// warm up Three.js once the splash is on screen
(window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 600)))(() => void loadStage());

document.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) =>
  b.addEventListener('click', () => {
    sfx.unlock();
    void startGame(b.dataset.mode as Mode);
  }),
);

async function startGame(mode: Mode) {
  closeSheet();
  resultEl.hidden = true;
  const s = await loadStage();
  game.start(mode);
  s.reset();
  input.reset();
  popAge = bankAge = -1;
  gainFlash = null;
  posted = false;
  lastOver = null;
  screen = 'game';
  splash.stop();
  splashEl.hidden = true;
  hudEl.hidden = false;
  blitzEl.hidden = mode !== 'blitz';
  s.resize();
  requestRun(mode);
}

function goHome() {
  input.focusLost();
  closeSheet();
  resultEl.hidden = true;
  hudEl.hidden = true;
  splashEl.hidden = false;
  screen = 'splash';
  splash.setLook(settings.look);
  showBests();
  splash.start();
}

// ---------- leaderboard API ----------
function requestRun(mode: Mode) {
  runId = null;
  runOffline = !backend;
  backend
    ?.startRun(mode)
    .then((id) => (runId = id))
    .catch(() => (runOffline = true));
}

async function postScore() {
  if (!lastOver || posted) return;
  if (!backend) {
    resultRank.textContent = 'The world board isn’t switched on for this build yet. Your best is saved on this device.';
    postForm.hidden = true;
    return;
  }
  if (!runId) {
    resultRank.textContent = runOffline ? 'Couldn’t reach the world board, so this one stays on your device.' : 'Connecting…';
    return;
  }
  postBtn.disabled = true;
  resultRank.textContent = 'Posting…';
  try {
    const r = await backend.submit({
      runId,
      mode: lastOver.mode,
      score: lastOver.score,
      name: settings.playerName || 'Anonymous egg',
      country: settings.country,
      playerId: settings.playerId,
      look: settings.look,
    });
    posted = true;
    runId = null;
    postForm.hidden = true;
    const parts = [];
    if (r.rank.today) parts.push(`#${r.rank.today} in the world today`);
    if (r.rank.all) parts.push(`#${r.rank.all} all time`);
    resultRank.textContent = parts.join(' · ') || 'Posted.';
  } catch (e) {
    resultRank.textContent = (e as Error).message || 'Couldn’t reach the world board. Try again.';
  } finally {
    postBtn.disabled = false;
  }
}

postForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const n = postName.value.trim().slice(0, 16);
  if (n) {
    settings.playerName = n;
    save();
  }
  postName.blur();
  void postScore();
});

// ---------- leaderboard sheet ----------
const avatarCache = new Map<string, string>();
function avatar(look: Look): string {
  const key = JSON.stringify(look);
  let url = avatarCache.get(key);
  if (!url) {
    url = avatarDataUrl(sanitizeLook(look), 88);
    if (avatarCache.size > 300) avatarCache.clear();
    avatarCache.set(key, url);
  }
  return url;
}

function setTabs(host: string, value: string) {
  document.querySelectorAll<HTMLButtonElement>(`${host} button`).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === value)));
}

async function loadBoard() {
  setTabs('#board-mode', boardMode);
  setTabs('#board-period', boardPeriod);
  boardRows.replaceChildren(emptyRow('Loading…'));
  boardYou.textContent = '';
  if (!backend) {
    boardRows.replaceChildren(emptyRow('The world board isn’t switched on for this build yet.'));
    return;
  }
  try {
    const r = await backend.board(boardMode, boardPeriod, settings.playerId);
    if (!r.rows.length) {
      boardRows.replaceChildren(emptyRow(boardPeriod === 'today' ? 'No scores yet today. Be the first egg on the board.' : 'No scores yet. Be the first egg on the board.'));
    } else {
      boardRows.replaceChildren(
        ...r.rows.map((row) => {
          const li = document.createElement('li');
          if (r.you && row.rank === r.you.rank) li.className = 'me';
          const rank = document.createElement('span');
          rank.className = 'r';
          rank.textContent = String(row.rank);
          const img = document.createElement('img');
          img.src = avatar(row.look);
          img.alt = '';
          const name = document.createElement('span');
          name.className = 'n';
          name.textContent = `${flag(row.country)} ${row.name}`.trim();
          const score = document.createElement('span');
          score.className = 's';
          score.textContent = String(row.score);
          li.append(rank, img, name, score);
          return li;
        }),
      );
    }
    boardYou.textContent = r.you
      ? `You’re #${r.you.rank} of ${r.total} with ${r.you.score}.`
      : settings.best[boardMode]
        ? 'Post a run to get on this board.'
        : '';
  } catch {
    boardRows.replaceChildren(emptyRow('Couldn’t reach the world board. Check your connection and try again.'));
  }
}

function emptyRow(text: string) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  return li;
}

document.querySelectorAll<HTMLButtonElement>('#board-mode button').forEach((b) =>
  b.addEventListener('click', () => {
    boardMode = b.dataset.v as Mode;
    void loadBoard();
  }),
);
document.querySelectorAll<HTMLButtonElement>('#board-period button').forEach((b) =>
  b.addEventListener('click', () => {
    boardPeriod = b.dataset.v as 'today' | 'all';
    void loadBoard();
  }),
);

// ---------- sheets ----------
const maker = createMaker({
  getLook: () => settings.look,
  setLook: (next) => {
    settings.look = sanitizeLook(next);
    save();
    stage?.setLook(settings.look);
    splash.setLook(settings.look);
  },
  getProfile: () => ({ playerName: settings.playerName, country: settings.country }),
  setProfile: (p) => {
    settings.playerName = p.playerName;
    settings.country = p.country;
    save();
  },
});

function open(sheet: HTMLElement) {
  input.focusLost();
  closeSheet();
  openSheet = sheet;
  sheet.hidden = false;
  document.body.classList.add('sheet-open');
  if (sheet === makerEl) maker.open();
  if (sheet === boardEl) {
    if (lastOver) boardMode = lastOver.mode;
    void loadBoard();
  }
}

function closeSheet() {
  if (!openSheet) return;
  if (openSheet === makerEl) maker.close();
  openSheet.hidden = true;
  openSheet = null;
  document.body.classList.remove('sheet-open');
  (document.activeElement as HTMLElement | null)?.blur();
}

document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
$('#btn-board').addEventListener('click', () => open(boardEl));
$('#btn-make').addEventListener('click', () => open(makerEl));
$('#btn-result-board').addEventListener('click', () => open(boardEl));
$('#btn-done').addEventListener('click', closeSheet);
$('#btn-random').addEventListener('click', () => {
  settings.look = { ...randomLook(), nickname: settings.look.nickname, popLine: settings.look.popLine };
  save();
  stage?.setLook(settings.look);
  splash.setLook(settings.look);
  maker.open();
});
$('#btn-reset').addEventListener('click', () => {
  settings.look = { ...PRESET };
  save();
  stage?.setLook(settings.look);
  splash.setLook(settings.look);
  maker.open();
});
$('#btn-again').addEventListener('click', () => void startGame(game.state.mode));
$('#btn-result-home').addEventListener('click', goHome);
$('#btn-home').addEventListener('click', goHome);

// ---------- toggles ----------
function applyToggles() {
  muteBtn.setAttribute('aria-pressed', String(settings.muted));
  muteBtn.setAttribute('aria-label', settings.muted ? 'Unmute sound' : 'Mute sound');
  motionBtn.setAttribute('aria-pressed', String(settings.reducedMotion));
  motionBtn.setAttribute('aria-label', settings.reducedMotion ? 'Allow full motion' : 'Reduce motion');
  document.documentElement.classList.toggle('reduced', settings.reducedMotion);
  sfx.setMuted(settings.muted);
}
muteBtn.addEventListener('click', () => {
  sfx.unlock();
  settings.muted = !settings.muted;
  applyToggles();
  save();
  muteBtn.blur();
});
motionBtn.addEventListener('click', () => {
  settings.reducedMotion = !settings.reducedMotion;
  applyToggles();
  save();
  motionBtn.blur();
});
applyToggles();

// ---------- input ----------
const input = new HoldInput({
  press: () => {
    sfx.unlock();
    game.press();
  },
  release: (r) => game.release(r),
});

const isTyping = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheet) {
    closeSheet();
    return;
  }
  if (e.code !== 'Space') return;
  if (openSheet || isTyping(e.target) || screen !== 'game') return;
  e.preventDefault();
  if (game.state.phase === 'over') {
    if (!e.repeat && game.state.phaseMs > 700) {
      swallowKey = true;
      void startGame(game.state.mode);
    }
    return;
  }
  if (!swallowKey) input.keyDown(e.repeat);
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || isTyping(e.target)) return;
  e.preventDefault();
  if (swallowKey) {
    swallowKey = false;
    return;
  }
  input.keyUp();
});

holdBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try {
    holdBtn.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic events */
  }
  input.pointerDown(e.pointerId);
});
holdBtn.addEventListener('pointerup', (e) => input.pointerUp(e.pointerId));
holdBtn.addEventListener('pointercancel', (e) => input.pointerCancel(e.pointerId));
holdBtn.addEventListener('lostpointercapture', (e) => input.pointerCancel(e.pointerId));
holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
holdBtn.addEventListener('click', (e) => e.preventDefault());
window.addEventListener('blur', () => input.focusLost());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.focusLost();
});
window.addEventListener('pagehide', () => input.focusLost());

// ---------- events ----------
function popup(text: string, cls = '') {
  if (reduced()) return;
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.setProperty('--r', `${(Math.random() - 0.5) * 12}deg`);
  popups.append(el);
  setTimeout(() => el.remove(), 950);
}

function handle(e: GameEvent, now: number) {
  const blitz = game.state.mode === 'blitz';
  switch (e.type) {
    case 'tooEarly':
      sfx.tooEarly();
      break;
    case 'bank':
      bankAge = 0;
      vibrate(18);
      if (blitz) {
        sfx.combo(game.state.combo);
        popup(e.mult > 1 ? `+${e.points} ×${e.mult}` : `+${e.points}`);
        comboEl.classList.remove('bump');
        void comboEl.offsetWidth;
        comboEl.classList.add('bump');
        document.body.classList.remove('pulse');
        void document.body.offsetWidth;
        if (!reduced()) document.body.classList.add('pulse');
      } else {
        sfx.bank();
        gainFlash = { text: `+${e.points}`, cls: 'show', until: now + 700 };
      }
      break;
    case 'pop':
      sfx.pop();
      vibrate([60, 40, 90]);
      stage?.pop(reduced(), e.endsRun);
      if (e.endsRun) {
        popAge = 0;
        setTimeout(() => sfx.soul(), 300);
        gainFlash = e.lost > 0 ? { text: `+${e.lost}`, cls: 'show lost', until: now + 1100 } : null;
      } else {
        popup('−3s', 'minus');
        stage && setTimeout(() => stage?.reset(), 900);
      }
      break;
    case 'timeWarn':
      sfx.tick();
      break;
    case 'over':
      onOver(e.score, e.mode);
      break;
  }
}

function onOver(score: number, mode: Mode) {
  const prev = settings.best[mode];
  if (score > prev) settings.best[mode] = score;
  save();
  lastOver = { score, mode };
  resultTitle.textContent = mode === 'blitz' ? 'Time!' : `${settings.look.nickname} popped.`;
  resultScore.textContent = String(score);
  resultBest.textContent = score > prev && prev > 0 ? 'New best' : `Best ${settings.best[mode]}`;
  resultRank.textContent = '';
  postForm.hidden = false;
  postName.value = settings.playerName;
  postFlag.textContent = flag(settings.country);
  // show the card after the pop has played
  setTimeout(
    () => {
      if (game.state.phase !== 'over') return;
      resultEl.hidden = false;
      if (settings.playerName && score > 0) void postScore();
      else if (score === 0) {
        postForm.hidden = true;
        resultRank.textContent = 'Zero gets you nowhere. Hold longer.';
      }
    },
    mode === 'blitz' ? 300 : 650,
  );
  if (score > 0) sfx.win();
}

// ---------- HUD ----------
const cache = new Map<HTMLElement, string>();
function text(el: HTMLElement, v: string) {
  if (cache.get(el) === v) return;
  cache.set(el, v);
  el.textContent = v;
}

function renderHud(now: number) {
  const s = game.state;
  text(scoreEl, String(s.score));
  const best = Math.max(settings.best[s.mode], s.score);
  text(bestEl, best ? `Best ${best}` : '');

  if (s.mode === 'blitz') {
    const secs = Math.ceil(s.timeLeftMs / 1000);
    text(timeEl, String(secs));
    timeEl.classList.toggle('warn', secs <= 10);
    timebar.style.transform = `scaleX(${s.timeLeftMs / game.config.durationMs})`;
    text(comboEl, `×${game.mult()}`);
  }

  if (s.phase === 'holding') {
    text(gainEl, `+${Math.floor(s.provisional)}`);
    gainEl.className = 'gain show';
  } else if (gainFlash && now < gainFlash.until) {
    text(gainEl, gainFlash.text);
    gainEl.className = 'gain ' + gainFlash.cls;
  } else {
    gainEl.className = 'gain';
  }

  let st = '';
  if (s.phase === 'ready') {
    if (s.notice === 'tooEarly') st = 'Too quick. Hold a beat longer to bank.';
    else if (s.banks === 0 && s.pops === 0) st = s.mode === 'blitz' ? 'Hold, let go, repeat. Fast.' : 'Hold to pump her up.';
    else st = s.mode === 'blitz' ? `Combo ×${game.mult()}. Keep it going.` : 'She’s touchier now. Again?';
  } else if (s.phase === 'holding') {
    st = s.holdMs < game.config.minHoldMs ? 'Keep holding…' : 'Let go to bank.';
  } else if (s.phase === 'popping') {
    st = s.mode === 'blitz' ? 'Pop! That cost you 3 seconds.' : `${settings.look.nickname} popped.`;
  }
  text(statusEl, st);

  const canHold = s.phase === 'ready' || s.phase === 'holding';
  holdBtn.setAttribute('aria-disabled', String(!canHold));
  holdBtn.classList.toggle('down', s.phase === 'holding');
  holdBtn.classList.toggle('invite', s.phase === 'ready' && s.banks === 0 && s.pops === 0);
  text(holdLabel, s.phase === 'holding' ? 'Holding' : 'Hold');
}

function renderBubble(dt: number) {
  if (!stage) return;
  const s = game.state;
  const t = game.tension();
  let msg = '';
  let big = false;
  if (popAge >= 0.2) {
    msg = settings.look.popLine;
    big = true;
  } else if (s.phase === 'holding' && t > 0.62 && s.fakeTell?.kind !== 'serene') {
    fineClock += dt;
    if (fineClock % 3.2 < 1.5) msg = 'I’m fine.';
  } else if (s.phase === 'ready' && s.idleMs > 2600) {
    msg = t > 0.5 ? 'Take your time. Or don’t.' : 'Any day now.';
  } else {
    fineClock = 0;
  }
  if (msg) {
    text(bubble, msg);
    const p = stage.headScreen();
    const w = bubble.offsetWidth / 2 + 12;
    bubble.style.left = `${Math.min(window.innerWidth - w, Math.max(w, p.x))}px`;
    bubble.style.top = `${Math.max(bubble.offsetHeight + 80, p.y)}px`;
  }
  bubble.classList.toggle('show', !!msg);
  bubble.classList.toggle('big', big);
}

// ---------- loop ----------
let last = performance.now();
let time = 0;
function loop(now: number) {
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;
  time += dt;
  if (screen === 'game' && stage) {
    if (!openSheet) game.tick(dtMs);
    for (const e of game.takeEvents()) handle(e, now);
    if (popAge >= 0) popAge += dt;
    if (bankAge >= 0) bankAge += dt;
    const s = game.state;
    const tension = game.tension();
    sfx.holding(tension, s.phase === 'holding');
    stage.frame({
      dt,
      time,
      phase: s.phase,
      tension,
      holding: s.phase === 'holding',
      fakeTell: s.fakeTell?.kind ?? null,
      idleMs: s.idleMs,
      popAge,
      reduced: reduced(),
      bankAge,
    });
    renderHud(now);
    renderBubble(dt);
  } else {
    game.takeEvents();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.addEventListener('resize', () => stage?.resize());

// ---------- dev helpers ----------
if (import.meta.env.DEV) {
  (window as unknown as { __egg: unknown }).__egg = { game, settings, get stage() { return stage; }, startGame, goHome };
  if (new URLSearchParams(location.search).has('gif')) {
    splashGif(settings.look).then((blob) =>
      fetch('/__save-gif', { method: 'POST', body: blob }).then(() => console.log('[gif] saved', blob.size)),
    );
  }
}
