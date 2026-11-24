import { describe, expect, it } from 'vitest';
import { Game, MAX_POINTS_PER_SEC, type Mode, type ModeConfig } from './state';
import { HoldInput } from './holdInput';

const FIXED = (v: number) => () => v;

function makeGame(mode: Mode = 'classic', cfg: Partial<ModeConfig> = {}, rng = 0.5) {
  return new Game(mode, { fakeTellChance: 0, ...cfg }, FIXED(rng));
}

function run(g: Game, ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) g.tick(step);
}

function holdUntil(g: Game, phase: string) {
  for (let i = 0; i < 10_000 && g.state.phase !== phase; i++) g.tick(16);
}

describe('classic: hold and release', () => {
  it('starts ready, banks on release, keeps going', () => {
    const g = makeGame();
    expect(g.state.phase).toBe('ready');
    g.press();
    run(g, 1200);
    const prov = Math.floor(g.state.provisional);
    expect(prov).toBeGreaterThan(5);
    g.release();
    expect(g.state.score).toBe(prov);
    expect(g.state.phase).toBe('ready');
    expect(g.takeEvents().some((e) => e.type === 'bank')).toBe(true);
  });

  it('early release banks nothing and keeps the pressure', () => {
    const g = makeGame();
    g.press();
    run(g, 200);
    const p = g.state.pressure;
    g.release();
    expect(g.state.score).toBe(0);
    expect(g.state.notice).toBe('tooEarly');
    expect(g.state.pressure).toBe(p);
    g.press();
    expect(g.state.phase).toBe('holding');
  });

  it('a bank cools her off and the line always sits above the pressure', () => {
    const g = makeGame('classic', {}, 0);
    g.press();
    run(g, 2500);
    const before = g.state.pressure;
    g.release();
    expect(g.state.pressure).toBeCloseTo(before * g.config.coolTo, 5);
    expect(g.state.threshold).toBeGreaterThanOrEqual(g.state.pressure + g.config.safetyGap - 1e-9);
  });

  it('each bank makes the next hold pay more and build faster', () => {
    const g = makeGame('classic', { thresholdMin: 10_000, thresholdMax: 10_000, coolTo: 0 });
    g.press();
    run(g, 1000);
    const first = g.state.provisional;
    const p1 = g.state.pressure;
    g.release();
    g.press();
    run(g, 1000);
    expect(g.state.provisional).toBeGreaterThan(first);
    expect(g.state.pressure).toBeGreaterThan(p1);
  });

  it('a pop mid-hold loses the hold and ends the run after the pop plays', () => {
    const g = makeGame();
    g.press();
    run(g, 1000);
    g.release();
    const banked = g.state.score;
    g.press();
    holdUntil(g, 'popping');
    expect(g.state.score).toBe(banked);
    const types = g.takeEvents().map((e) => e.type);
    expect(types).toContain('pop');
    g.release(); // letting go during the pop does nothing
    expect(g.state.phase).toBe('popping');
    run(g, 1010);
    expect(g.state.phase).toBe('over');
    const over = g.takeEvents().find((e) => e.type === 'over');
    expect(over).toMatchObject({ score: banked, mode: 'classic' });
  });

  it('a long frame cannot skip the pop', () => {
    const g = makeGame('classic', { thresholdMin: 20, thresholdMax: 20 });
    g.press();
    for (let i = 0; i < 100 && g.state.phase === 'holding'; i++) g.tick(5000);
    expect(g.state.phase).toBe('popping');
  });

  it('restart clears the run', () => {
    const g = makeGame();
    g.press();
    run(g, 800);
    g.release();
    g.start('classic');
    expect(g.state.score).toBe(0);
    expect(g.state.banks).toBe(0);
    expect(g.state.pressure).toBe(0);
    expect(g.state.phase).toBe('ready');
  });
});

describe('blitz (ADHD mode)', () => {
  it('runs on a 45 second clock and ends at zero', () => {
    const g = makeGame('blitz');
    expect(g.isTimed()).toBe(true);
    run(g, 45_100);
    expect(g.state.phase).toBe('over');
  });

  it('banks build a combo multiplier', () => {
    const g = makeGame('blitz', { thresholdMin: 10_000, thresholdMax: 10_000 });
    expect(g.mult()).toBe(1);
    for (let i = 0; i < 3; i++) {
      g.press();
      run(g, 400);
      g.release();
    }
    expect(g.mult()).toBe(2.5);
    const banks = g.takeEvents().filter((e) => e.type === 'bank');
    expect(banks.map((b) => (b as { mult: number }).mult)).toEqual([1, 1.5, 2]);
  });

  it('a pop costs time and the combo but the run keeps going', () => {
    const g = makeGame('blitz');
    g.press();
    run(g, 300);
    g.release();
    expect(g.state.combo).toBe(1);
    const scoreBefore = g.state.score;
    g.press();
    const tBefore = g.state.timeLeftMs;
    holdUntil(g, 'popping');
    expect(g.state.combo).toBe(0);
    expect(g.state.pressure).toBe(0);
    expect(g.state.timeLeftMs).toBeLessThan(tBefore - 2900);
    run(g, 700);
    expect(g.state.phase).toBe('ready');
    expect(g.state.score).toBe(scoreBefore);
  });

  it('a hold at the buzzer still banks', () => {
    const g = makeGame('blitz', { thresholdMin: 10_000, thresholdMax: 10_000, durationMs: 1000 });
    g.press();
    run(g, 1100);
    expect(g.state.phase).toBe('over');
    expect(g.state.score).toBeGreaterThan(0);
  });
});

describe('score ceiling used by the server', () => {
  it('an aggressive bot stays under the per-second cap in both modes', () => {
    for (const mode of ['classic', 'blitz'] as Mode[]) {
      // rng 1 = thresholds always at the max, the best case for a player
      const g = new Game(mode, { fakeTellChance: 0 }, FIXED(0.999));
      for (let i = 0; i < 400 && g.state.phase !== 'over'; i++) {
        if (g.state.phase === 'ready') g.press();
        g.tick(16);
        if (g.state.phase === 'holding' && g.tension() > 0.97) g.release();
        if (mode === 'classic' && g.state.elapsedMs > 120_000) break;
      }
      run(g, 60_000);
      const secs = Math.max(1, g.state.elapsedMs / 1000);
      expect(g.state.score / secs).toBeLessThan(MAX_POINTS_PER_SEC[mode]);
    }
  });
});

describe('fake tells', () => {
  it('a serene face only shows near the edge, panic only when safe', () => {
    const g = new Game('classic', { fakeTellChance: 1000 }, FIXED(0));
    g.press();
    const seen: string[] = [];
    for (let i = 0; i < 600 && g.state.phase === 'holding'; i++) {
      g.tick(16);
      for (const e of g.takeEvents()) if (e.type === 'fakeTell') seen.push(`${e.kind}@${g.tension()}`);
    }
    expect(seen.some((s) => s.startsWith('serene'))).toBe(true);
    for (const s of seen) {
      const t = Number(s.split('@')[1]);
      if (s.startsWith('serene')) expect(t).toBeGreaterThan(0.78);
      else expect(t).toBeLessThan(0.35);
    }
  });
});

describe('input edge cases', () => {
  function rig(mode: Mode = 'classic') {
    const g = makeGame(mode);
    const input = new HoldInput({ press: () => g.press(), release: (r) => g.release(r) });
    return { g, input };
  }

  it('ignores key auto-repeat and duplicate presses', () => {
    const { g, input } = rig();
    input.keyDown(false);
    run(g, 600);
    const holdMs = g.state.holdMs;
    input.keyDown(true);
    input.pointerDown(3);
    expect(g.state.holdMs).toBe(holdMs);
    input.keyUp();
    expect(g.state.phase).toBe('ready');
    expect(g.state.score).toBeGreaterThan(0);
  });

  it('touch cancellation counts as letting go', () => {
    const { g, input } = rig();
    input.pointerDown(7);
    run(g, 700);
    const prov = Math.floor(g.state.provisional);
    input.pointerCancel(7);
    expect(g.state.score).toBe(prov);
    expect(g.takeEvents().find((e) => e.type === 'bank')).toMatchObject({ reason: 'cancel' });
  });

  it('a second finger lifting does not release the first', () => {
    const { g, input } = rig();
    input.pointerDown(1);
    input.pointerDown(2);
    run(g, 600);
    input.pointerUp(2);
    expect(g.state.phase).toBe('holding');
    input.pointerUp(1);
    expect(g.state.phase).toBe('ready');
  });

  it('switching tabs releases the hold', () => {
    const { g, input } = rig();
    input.keyDown(false);
    run(g, 600);
    input.focusLost();
    expect(g.state.phase).toBe('ready');
    expect(input.isDown).toBe(false);
    input.keyUp();
    expect(g.state.phase).toBe('ready');
  });

  it('rapid tapping only ever registers too-early releases', () => {
    const { g, input } = rig();
    for (let i = 0; i < 30; i++) {
      input.keyDown(false);
      g.tick(5);
      input.keyUp();
    }
    expect(g.state.score).toBe(0);
    expect(g.state.phase).toBe('ready');
  });

  it('holding through a pop does not start a new hold by itself', () => {
    const g = makeGame('blitz', { thresholdMin: 8, thresholdMax: 8, safetyGap: 0 });
    const input = new HoldInput({ press: () => g.press(), release: (r) => g.release(r) });
    input.keyDown(false);
    holdUntil(g, 'popping');
    run(g, 800);
    expect(g.state.phase).toBe('ready');
    input.keyDown(true); // auto-repeat while still held
    expect(g.state.phase).toBe('ready');
  });
});
