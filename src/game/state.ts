// Pure game rules for Eggsplaining. No DOM, no Three.js, no timers:
// time only moves when the caller passes dt to tick(). Randomness is injected.
//
// Solo runs, two modes:
//  - classic: hold to pump, let go to bank. She cools off a little after each bank and gets
//    touchier (faster pressure, bigger payouts). One pop ends the run. Score = everything banked.
//  - blitz ("ADHD mode"): 45 seconds, faster everything, banks build a combo multiplier.
//    A pop wipes the hold and the combo and costs 3 seconds, but the run keeps going.

export type Mode = 'classic' | 'blitz';
export type Phase = 'ready' | 'holding' | 'popping' | 'over';
export type ReleaseReason = 'release' | 'cancel' | 'blur' | 'time';
export type FakeTellKind = 'serene' | 'panic';

export type GameEvent =
  | { type: 'start'; mode: Mode }
  | { type: 'holdStart' }
  | { type: 'tooEarly' }
  | { type: 'bank'; points: number; total: number; mult: number; reason: ReleaseReason }
  | { type: 'pop'; lost: number; endsRun: boolean }
  | { type: 'over'; score: number; mode: Mode; elapsedMs: number }
  | { type: 'fakeTell'; kind: FakeTellKind }
  | { type: 'timeWarn' };

export interface ModeConfig {
  minHoldMs: number;
  popMs: number;
  thresholdMin: number;
  thresholdMax: number;
  /** pressure units per second at zero pressure, before speed-ups */
  pressureRate: number;
  /** pressure at which the rate has doubled */
  pressureAccel: number;
  /** each bank multiplies the pressure rate by (1 + speedUp), capped at maxSpeed */
  speedUp: number;
  maxSpeed: number;
  pointsBase: number;
  pointsPerPressure: number;
  /** multiplier gained per bank (classic: per bank in the run, blitz: per bank in the combo) */
  multStep: number;
  maxMult: number;
  /** pressure kept after a bank (0..1) */
  coolTo: number;
  /** a re-rolled threshold is always at least this far above the current pressure */
  safetyGap: number;
  /** 0 = untimed */
  durationMs: number;
  popPenaltyMs: number;
  fakeTellChance: number;
  fakeTellMs: number;
}

export const MODES: Record<Mode, ModeConfig> = {
  classic: {
    minHoldMs: 450,
    popMs: 1000,
    thresholdMin: 55,
    thresholdMax: 95,
    pressureRate: 9,
    pressureAccel: 70,
    speedUp: 0.12,
    maxSpeed: 2.2,
    pointsBase: 7,
    pointsPerPressure: 0.22,
    multStep: 0.15,
    maxMult: 3,
    coolTo: 0.5,
    safetyGap: 15,
    durationMs: 0,
    popPenaltyMs: 0,
    fakeTellChance: 0.45,
    fakeTellMs: 750,
  },
  blitz: {
    minHoldMs: 250,
    popMs: 650,
    thresholdMin: 45,
    thresholdMax: 95,
    pressureRate: 18,
    pressureAccel: 60,
    speedUp: 0.08,
    maxSpeed: 2,
    pointsBase: 10,
    pointsPerPressure: 0.3,
    multStep: 0.5,
    maxMult: 5,
    coolTo: 0.35,
    safetyGap: 12,
    durationMs: 45_000,
    popPenaltyMs: 3_000,
    fakeTellChance: 0.6,
    fakeTellMs: 600,
  },
};

export { MAX_POINTS_PER_SEC } from '../shared/limits.js';

export interface GameState {
  mode: Mode;
  phase: Phase;
  score: number;
  banks: number;
  /** blitz combo (consecutive banks without a pop) */
  combo: number;
  pressure: number;
  threshold: number;
  holdMs: number;
  provisional: number;
  phaseMs: number;
  /** ms in 'ready' without holding, drives the foot tap */
  idleMs: number;
  /** total run time so far */
  elapsedMs: number;
  /** blitz: ms left on the clock */
  timeLeftMs: number;
  pops: number;
  fakeTell: { kind: FakeTellKind; ms: number } | null;
  notice: 'tooEarly' | null;
  warned: boolean;
}

export type Rng = () => number;

export class Game {
  state!: GameState;
  config!: ModeConfig;
  private rng: Rng;
  private events: GameEvent[] = [];
  private overrides: Partial<ModeConfig>;

  constructor(mode: Mode = 'classic', overrides: Partial<ModeConfig> = {}, rng: Rng = Math.random) {
    this.rng = rng;
    this.overrides = overrides;
    this.start(mode);
  }

  start(mode: Mode = this.state?.mode ?? 'classic'): void {
    this.config = { ...MODES[mode], ...this.overrides };
    this.events = [];
    this.state = {
      mode,
      phase: 'ready',
      score: 0,
      banks: 0,
      combo: 0,
      pressure: 0,
      threshold: 0,
      holdMs: 0,
      provisional: 0,
      phaseMs: 0,
      idleMs: 0,
      elapsedMs: 0,
      timeLeftMs: this.config.durationMs,
      pops: 0,
      fakeTell: null,
      notice: null,
      warned: false,
    };
    this.state.threshold = this.roll(0);
    this.emit({ type: 'start', mode });
  }

  takeEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** 0..1, how close she is to popping. The only pressure signal rendering may use. */
  tension(): number {
    const s = this.state;
    if (s.phase === 'popping') return 1;
    return Math.min(1, s.pressure / s.threshold);
  }

  /** Current payout multiplier. */
  mult(): number {
    const s = this.state;
    const steps = s.mode === 'blitz' ? s.combo : s.banks;
    return Math.min(this.config.maxMult, 1 + this.config.multStep * steps);
  }

  isTimed(): boolean {
    return this.config.durationMs > 0;
  }

  press(): void {
    const s = this.state;
    if (s.phase !== 'ready') return;
    s.phase = 'holding';
    s.phaseMs = 0;
    s.holdMs = 0;
    s.provisional = 0;
    s.idleMs = 0;
    s.notice = null;
    this.emit({ type: 'holdStart' });
  }

  release(reason: ReleaseReason = 'release'): void {
    const s = this.state;
    if (s.phase !== 'holding') return;
    const c = this.config;
    s.fakeTell = null;
    if (s.holdMs < c.minHoldMs) {
      // Too short: nothing banked. Pressure already added stays in.
      s.phase = 'ready';
      s.phaseMs = 0;
      s.provisional = 0;
      s.holdMs = 0;
      s.notice = 'tooEarly';
      this.emit({ type: 'tooEarly' });
      return;
    }
    const mult = this.mult();
    const points = Math.floor(s.provisional);
    s.score += points;
    s.banks += 1;
    s.combo += 1;
    s.provisional = 0;
    s.holdMs = 0;
    s.phase = 'ready';
    s.phaseMs = 0;
    // She cools off a little, and the hidden line moves.
    s.pressure *= c.coolTo;
    s.threshold = this.roll(s.pressure);
    this.emit({ type: 'bank', points, total: s.score, mult, reason });
  }

  tick(dtMs: number): void {
    if (!(dtMs > 0)) return;
    // Clamp long gaps (tab asleep) so one frame cannot leap far past the threshold.
    const dt = Math.min(dtMs, 100);
    const s = this.state;
    const c = this.config;
    if (s.phase === 'over') return;
    s.phaseMs += dt;
    s.elapsedMs += dt;

    if (this.isTimed()) {
      s.timeLeftMs = Math.max(0, s.timeLeftMs - dt);
      if (!s.warned && s.timeLeftMs <= 10_000) {
        s.warned = true;
        this.emit({ type: 'timeWarn' });
      }
      if (s.timeLeftMs <= 0) {
        // At the buzzer a long-enough hold still banks; a too-short one is lost.
        if (s.phase === 'holding') this.release('time');
        this.finish();
        return;
      }
    }

    if (s.phase === 'ready') {
      s.idleMs += dt;
      return;
    }

    if (s.phase === 'popping') {
      if (s.phaseMs >= c.popMs) {
        if (this.isTimed()) {
          s.phase = 'ready';
          s.phaseMs = 0;
        } else {
          this.finish();
        }
      }
      return;
    }

    // holding
    const sec = dt / 1000;
    s.holdMs += dt;
    const speed = Math.min(c.maxSpeed, Math.pow(1 + c.speedUp, s.banks));
    const rate = c.pressureRate * speed * (1 + s.pressure / c.pressureAccel);
    s.pressure += rate * sec;
    s.provisional += (c.pointsBase + c.pointsPerPressure * s.pressure) * this.mult() * sec;

    if (s.pressure >= s.threshold) {
      this.pop();
      return;
    }

    if (s.fakeTell) {
      s.fakeTell.ms -= dt;
      if (s.fakeTell.ms <= 0) s.fakeTell = null;
    } else {
      const t = this.tension();
      const eligible: FakeTellKind | null =
        t > 0.78 ? 'serene' : t < 0.35 && s.holdMs > 300 ? 'panic' : null;
      if (eligible && this.rng() < c.fakeTellChance * sec) {
        s.fakeTell = { kind: eligible, ms: c.fakeTellMs };
        this.emit({ type: 'fakeTell', kind: eligible });
      }
    }
  }

  private pop(): void {
    const s = this.state;
    const c = this.config;
    const lost = Math.floor(s.provisional);
    const endsRun = !this.isTimed();
    s.provisional = 0;
    s.holdMs = 0;
    s.fakeTell = null;
    s.pops += 1;
    s.combo = 0;
    s.phase = 'popping';
    s.phaseMs = 0;
    if (endsRun) {
      s.pressure = s.threshold;
    } else {
      s.pressure = 0;
      s.threshold = this.roll(0);
      s.timeLeftMs = Math.max(0, s.timeLeftMs - c.popPenaltyMs);
    }
    this.emit({ type: 'pop', lost, endsRun });
  }

  private finish(): void {
    const s = this.state;
    if (s.phase === 'over') return;
    s.phase = 'over';
    s.phaseMs = 0;
    s.fakeTell = null;
    this.emit({ type: 'over', score: s.score, mode: s.mode, elapsedMs: s.elapsedMs });
  }

  private roll(pressure: number): number {
    const { thresholdMin: a, thresholdMax: b, safetyGap } = this.config;
    const lo = Math.max(a, Math.min(b, pressure + safetyGap));
    return lo + (b - lo) * this.rng();
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }
}
