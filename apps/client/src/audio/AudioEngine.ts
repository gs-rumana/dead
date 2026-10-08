/**
 * Procedural sound (§5.6): Web Audio synthesis for the locomotive, rails, wind and
 * actions, positioned in 3D. No sample files, so nothing to license or download.
 * Must be unlocked by a user gesture (iOS: "tap to start").
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly effects: GainNode;
  private readonly noise: AudioBuffer;
  private readonly locoPanner: PannerNode;
  private readonly locoBus: GainNode;
  private readonly wind: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private whistleOsc: OscillatorNode[] = [];
  private whistleGain: GainNode | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.effects = this.ctx.createGain();
    this.effects.connect(this.master);

    // One second of white noise, reused by every noisy sound.
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }

    this.locoPanner = this.ctx.createPanner();
    this.locoPanner.panningModel = 'HRTF';
    this.locoPanner.distanceModel = 'inverse';
    this.locoPanner.refDistance = 6;
    this.locoPanner.rolloffFactor = 1.1;
    this.locoBus = this.ctx.createGain();
    this.locoBus.connect(this.locoPanner);
    this.locoPanner.connect(this.effects);

    // Wind: looping noise through a low-pass, louder at speed.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.wind = this.ctx.createGain();
    this.wind.gain.value = 0;
    src.connect(this.windFilter).connect(this.wind).connect(this.effects);
    src.start();
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolumes(master: number, effects: number): void {
    this.master.gain.value = master;
    this.effects.gain.value = effects;
  }

  /** Listener pose (render space) and the locomotive's stack position. */
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  setLocoPosition(x: number, y: number, z: number): void {
    const p = this.locoPanner;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(x, t, 0.02);
      p.positionY.setTargetAtTime(y, t, 0.02);
      p.positionZ.setTargetAtTime(z, t, 0.02);
    } else p.setPosition(x, y, z);
  }

  /** Wind level from the listener's speed through the air (m/s). */
  setWind(speed: number): void {
    const t = this.ctx.currentTime;
    this.wind.gain.setTargetAtTime(Math.min(0.12, 0.012 + speed * 0.005), t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 40, t, 0.3);
  }

  private burst(
    dest: AudioNode,
    opts: {
      freq: number;
      q: number;
      attack: number;
      decay: number;
      gain: number;
      type?: BiquadFilterType;
    },
  ): void {
    const c = this.ctx;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + opts.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.attack + opts.decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.attack + opts.decay + 0.05);
  }

  /** One exhaust beat from the stack. Louder and sharper with more throttle. */
  chuff(throttle: number): void {
    this.burst(this.locoBus, {
      freq: 380 + throttle * 220,
      q: 0.9,
      attack: 0.008,
      decay: 0.16 + (1 - throttle) * 0.12,
      gain: 0.25 + throttle * 0.55,
    });
    this.burst(this.locoBus, {
      freq: 120,
      q: 0.7,
      attack: 0.01,
      decay: 0.12,
      gain: 0.25 + throttle * 0.3,
      type: 'lowpass',
    });
  }

  /** Wheels crossing a rail joint ("clickety-clack"). */
  railClick(speed: number): void {
    const g = Math.min(0.35, 0.05 + speed * 0.012);
    this.burst(this.effects, { freq: 1800, q: 4, attack: 0.002, decay: 0.05, gain: g });
    setTimeout(
      () =>
        this.burst(this.effects, { freq: 1500, q: 4, attack: 0.002, decay: 0.05, gain: g * 0.8 }),
      70 + 600 / Math.max(speed, 3),
    );
  }

  /** A shovel of coal into the firebox. */
  stoke(): void {
    this.burst(this.effects, { freq: 2500, q: 1.2, attack: 0.02, decay: 0.25, gain: 0.3 });
    setTimeout(
      () =>
        this.burst(this.effects, {
          freq: 300,
          q: 0.6,
          attack: 0.05,
          decay: 0.6,
          gain: 0.35,
          type: 'lowpass',
        }),
      180,
    );
  }

  /** Steam whistle: a detuned chord with vibrato, positioned at the locomotive. */
  whistle(durationS = 1.6): void {
    const c = this.ctx;
    const t = c.currentTime;
    this.stopWhistle();
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.08);
    g.gain.setValueAtTime(0.22, t + durationS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durationS + 0.35);
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    filter.connect(g).connect(this.locoBus);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain);
    this.whistleOsc = [415, 523, 622].map((f) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      lfoGain.connect(o.frequency);
      o.connect(filter);
      o.start(t);
      o.stop(t + durationS + 0.4);
      return o;
    });
    lfo.start(t);
    lfo.stop(t + durationS + 0.4);
    // Breathy steam on top.
    this.burst(this.locoBus, { freq: 2200, q: 0.5, attack: 0.05, decay: durationS, gain: 0.08 });
    this.whistleGain = g;
  }

  private stopWhistle(): void {
    for (const o of this.whistleOsc) {
      try {
        o.stop();
      } catch {
        // Already stopped.
      }
    }
    this.whistleOsc = [];
    this.whistleGain = null;
  }

  /** UI click / pickup tick. */
  tick(): void {
    this.burst(this.effects, { freq: 3000, q: 3, attack: 0.001, decay: 0.03, gain: 0.15 });
  }
}
