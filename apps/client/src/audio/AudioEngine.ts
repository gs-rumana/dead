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
  private readonly rain: GainNode;
  /** Wind floor from the weather (0..1). */
  private weatherWind = 0;
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

    // Rain: bright hiss on its own loop.
    const rs = this.ctx.createBufferSource();
    rs.buffer = this.noise;
    rs.loop = true;
    rs.playbackRate.value = 0.93;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    this.rain = this.ctx.createGain();
    this.rain.gain.value = 0;
    rs.connect(hp).connect(lp).connect(this.rain).connect(this.effects);
    rs.start();
  }

  /** Weather ambience (§4.5): rain hiss and a wind floor, both 0..1. */
  setWeather(rain: number, wind: number): void {
    const t = this.ctx.currentTime;
    this.rain.gain.setTargetAtTime(rain * 0.16, t, 1.5);
    this.weatherWind = wind;
  }

  /** Thunder after a lightning flash; closer strikes crack before they rumble. */
  thunder(delayS: number, near: number): void {
    const c = this.ctx;
    const t = c.currentTime + delayS;
    const rumble = (freq: number, decay: number, gain: number, at: number) => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      src.connect(f).connect(g).connect(this.effects);
      src.start(at);
      src.stop(at + decay + 0.1);
    };
    if (near > 0.6) rumble(2500, 0.35, 0.5 * near, t);
    rumble(110, 3.2, 0.9 * (0.4 + near * 0.6), t + 0.05);
    rumble(60, 4.5, 0.5, t + 0.4);
  }

  /** A werewolf's howl or a boss's roar: a rising, wavering voice. */
  howl(pos: { x: number; y: number; z: number }, low = false): void {
    const c = this.ctx;
    const t = c.currentTime;
    const dest = this.at(pos.x, pos.y, pos.z, 12);
    const osc = c.createOscillator();
    osc.type = low ? 'sawtooth' : 'triangle';
    const base = low ? 70 : 380;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.6, t + 0.6);
    osc.frequency.linearRampToValueAtTime(base * 1.45, t + 1.6);
    osc.frequency.linearRampToValueAtTime(base * 0.9, t + 2.2);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = c.createGain();
    lg.gain.value = base * 0.03;
    lfo.connect(lg).connect(osc.frequency);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = low ? 300 : 900;
    f.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(low ? 0.6 : 0.35, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    osc.connect(f).connect(g).connect(dest);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 2.4);
    lfo.stop(t + 2.4);
  }

  /** A vampire vanishing: a fast airy whoosh. */
  blink(pos: { x: number; y: number; z: number }): void {
    const c = this.ctx;
    const t = c.currentTime;
    const dest = this.at(pos.x, pos.y, pos.z, 6);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.4);
  }

  /** Dr. Voss's arc: a buzzing electric crack. */
  zap(pos: { x: number; y: number; z: number }): void {
    const c = this.ctx;
    const t = c.currentTime;
    const dest = this.at(pos.x, pos.y, pos.z, 10);
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.4);
    this.burst(dest, { freq: 4000, q: 1, attack: 0.001, decay: 0.25, gain: 0.5 });
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
    const w = this.weatherWind;
    this.wind.gain.setTargetAtTime(Math.min(0.14, 0.012 + speed * 0.005 + w * 0.09), t, 0.3);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 40 + w * 250, t, 0.3);
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

  /** A panner at a render-space position for one-shot 3D sounds. */
  private at(x: number, y: number, z: number, ref = 4): AudioNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
    p.connect(this.effects);
    setTimeout(() => p.disconnect(), 3000);
    return p;
  }

  /** Gunshot: a sharp crack plus a low boom; louder for shotguns and rifles. */
  gunshot(weapon: string, pos?: { x: number; y: number; z: number }): void {
    const dest = pos ? this.at(pos.x, pos.y, pos.z, 10) : this.effects;
    const heavy = weapon === 'coachgun' ? 1.3 : weapon === 'rifle' ? 1.15 : 1;
    this.burst(dest, { freq: 2600, q: 0.6, attack: 0.001, decay: 0.09, gain: 0.55 * heavy });
    this.burst(dest, {
      freq: 160,
      q: 0.8,
      attack: 0.002,
      decay: 0.32 * heavy,
      gain: 0.8 * heavy,
      type: 'lowpass',
    });
    // Echo off the landscape.
    setTimeout(
      () =>
        this.burst(dest, {
          freq: 500,
          q: 0.5,
          attack: 0.02,
          decay: 0.5,
          gain: 0.08 * heavy,
          type: 'lowpass',
        }),
      140,
    );
  }

  dryFire(): void {
    this.burst(this.effects, { freq: 4200, q: 6, attack: 0.001, decay: 0.03, gain: 0.25 });
  }

  reloadClick(): void {
    this.burst(this.effects, { freq: 3200, q: 5, attack: 0.001, decay: 0.04, gain: 0.2 });
  }

  swing(): void {
    this.burst(this.effects, { freq: 900, q: 0.7, attack: 0.04, decay: 0.18, gain: 0.25 });
  }

  /** Bullet into flesh; headshots get a wet crack. */
  hitFlesh(head: boolean, pos?: { x: number; y: number; z: number }): void {
    const dest = pos ? this.at(pos.x, pos.y, pos.z, 6) : this.effects;
    this.burst(dest, { freq: 240, q: 1.2, attack: 0.002, decay: 0.12, gain: 0.5, type: 'lowpass' });
    if (head) this.burst(dest, { freq: 1600, q: 2, attack: 0.001, decay: 0.08, gain: 0.35 });
  }

  /** Hit confirmation tick for the shooter. */
  hitTick(kill: boolean): void {
    this.burst(this.effects, {
      freq: kill ? 2200 : 3400,
      q: 8,
      attack: 0.001,
      decay: kill ? 0.12 : 0.05,
      gain: kill ? 0.3 : 0.18,
    });
  }

  explosion(pos: { x: number; y: number; z: number }): void {
    const dest = this.at(pos.x, pos.y, pos.z, 18);
    this.burst(dest, { freq: 90, q: 0.5, attack: 0.005, decay: 1.4, gain: 1.4, type: 'lowpass' });
    this.burst(dest, { freq: 900, q: 0.4, attack: 0.002, decay: 0.5, gain: 0.6 });
  }

  /** An undead moan: band-passed noise sweeping through vowel-like formants. */
  groan(pos: { x: number; y: number; z: number }, pitch = 1): void {
    const c = this.ctx;
    const t = c.currentTime;
    const dest = this.at(pos.x, pos.y, pos.z, 5);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 9;
    f1.frequency.setValueAtTime(420 * pitch, t);
    f1.frequency.linearRampToValueAtTime(260 * pitch, t + 1.1);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(85 * pitch, t);
    osc.frequency.linearRampToValueAtTime(65 * pitch, t + 1.1);
    const og = c.createGain();
    og.gain.value = 0.25;
    osc.connect(og).connect(f1);
    src.connect(f1).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    osc.start(t);
    src.stop(t + 1.3);
    osc.stop(t + 1.3);
  }

  hurt(): void {
    this.burst(this.effects, {
      freq: 200,
      q: 1,
      attack: 0.005,
      decay: 0.2,
      gain: 0.5,
      type: 'lowpass',
    });
  }

  /** A teammate's ping: two quick bell tones. */
  ping(): void {
    const c = this.ctx;
    const t = c.currentTime;
    for (const [f, at] of [
      [1320, 0],
      [1760, 0.09],
    ] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.18, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(this.effects);
      o.start(t + at);
      o.stop(t + at + 0.4);
    }
  }

  /** UI click / pickup tick. */
  tick(): void {
    this.burst(this.effects, { freq: 3000, q: 3, attack: 0.001, decay: 0.03, gain: 0.15 });
  }
}
