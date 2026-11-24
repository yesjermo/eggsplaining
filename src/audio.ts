// Tiny WebAudio synth. Every sound is generated; nothing is loaded.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noise: AudioBuffer | null = null;
  private nextCreak = 0;
  muted = false;

  /** Must be called from a user gesture at least once. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  /** Called every frame while holding. tension 0..1 sets the hum pitch and how often she creaks. */
  holding(tension: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    if (active && !this.hum) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc2.type = 'triangle';
      filter.type = 'lowpass';
      filter.Q.value = 6;
      gain.gain.value = 0;
      osc.connect(filter);
      osc2.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      osc2.start();
      gain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.04);
      this.hum = { osc, osc2, gain, filter };
    }
    if (!active && this.hum) {
      const h = this.hum;
      h.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      h.osc.stop(ctx.currentTime + 0.2);
      h.osc2.stop(ctx.currentTime + 0.2);
      this.hum = null;
    }
    if (this.hum) {
      const t = ctx.currentTime;
      const f = 70 + tension * 150;
      this.hum.osc.frequency.setTargetAtTime(f, t, 0.05);
      this.hum.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.05);
      this.hum.filter.frequency.setTargetAtTime(300 + tension * 1800, t, 0.05);
      // Creaks: consistent cue, start at 55% and get more frequent toward the pop.
      if (tension > 0.55 && t > this.nextCreak) {
        this.creak(tension);
        const gap = 1.1 - (tension - 0.55) * 2.0; // 1.1s → ~0.2s
        this.nextCreak = t + Math.max(0.16, gap) * (0.7 + Math.random() * 0.6);
      }
    }
  }

  private creak(tension: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 18;
    bp.frequency.setValueAtTime(380 + Math.random() * 200, t);
    bp.frequency.exponentialRampToValueAtTime(160, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 + tension * 0.6, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5, 0.3);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bank(): void {
    this.tone(660, 0.14, 'triangle', 0.25);
    this.tone(990, 0.22, 'triangle', 0.22, 0.08);
  }

  tooEarly(): void {
    this.tone(220, 0.16, 'square', 0.08, 0, 140);
  }

  ready(): void {
    this.tone(520, 0.08, 'sine', 0.18);
  }

  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 0.35);
  }

  pop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    // crack burst
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, 0, 0.4);
    // thump
    this.tone(160, 0.35, 'sine', 0.7, 0, 40);
    // confetti sparkle
    for (let i = 0; i < 6; i++) this.tone(1200 + Math.random() * 1600, 0.09, 'triangle', 0.06, 0.1 + i * 0.06);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.2, i * 0.1));
  }

  /** Blitz combo: each step climbs a semitone-ish. */
  combo(step: number): void {
    const f = 660 * Math.pow(2, Math.min(step, 12) / 8);
    this.tone(f, 0.12, 'square', 0.07);
    this.tone(f * 1.5, 0.16, 'triangle', 0.12, 0.05);
  }

  tick(): void {
    this.tone(1400, 0.04, 'square', 0.05);
  }

  /** Soul leaving: a soft rising wobble. */
  soul(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 1.1);
    lfo.frequency.value = 7;
    lg.gain.value = 25;
    lfo.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.3);
    lfo.stop(t + 1.3);
  }
}
