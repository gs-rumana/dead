import {
  BLEND_MAX,
  BLEND_MIN,
  DAY,
  DAY_CYCLE,
  NIGHT_ODDS,
  NightType,
  type NightTypeId,
  WEATHER_ODDS,
  WEATHER_SENSES,
  Weather,
  type WeatherId,
  biomeWeights,
  nightWeather,
} from '@dead-tracks/shared';
import type { Sim } from '../Sim.ts';

/**
 * Day weather and night types (§4.5): at most one change per phase, blended over
 * 30–60 s; nothing jumps. The night type is rolled at dusk.
 */
export class WeatherSim {
  /** What the sky is blending from and to, and how far along (0..1). */
  from: WeatherId = Weather.Clear;
  to: WeatherId = Weather.Clear;
  blend = 1;
  private blendDur = BLEND_MIN;
  night: NightTypeId = NightType.Clear;
  private phase = -1;
  /** When in this phase the one change happens (sim seconds), or -1. */
  private changeAt = -1;
  private pending: WeatherId = Weather.Clear;
  private lightningT = 6;

  constructor(private readonly sim: Sim) {}

  /** The weather that counts right now (the blend target once past halfway). */
  get current(): WeatherId {
    return this.blend >= 0.5 ? this.to : this.from;
  }

  /** Enemy senses under the current weather. */
  get senses(): { sight: number; hearing: number } {
    const a = WEATHER_SENSES[this.from];
    const b = WEATHER_SENSES[this.to];
    const t = this.blend;
    return { sight: a.sight + (b.sight - a.sight) * t, hearing: a.hearing + (b.hearing - a.hearing) * t };
  }

  step(dt: number): void {
    const sim = this.sim;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.blendDur);
    // Phase index: day k = 2k, night k = 2k + 1.
    const t = sim.time + DAY.startOffset * DAY.dayLength;
    const cycle = Math.floor(t / DAY_CYCLE);
    const night = t - cycle * DAY_CYCLE >= DAY.dayLength;
    const phase = cycle * 2 + (night ? 1 : 0);
    if (phase !== this.phase) {
      this.phase = phase;
      if (night) {
        // Roll tonight's type; the first night is always clear (§4.5).
        this.night = cycle === 0 ? NightType.Clear : this.roll(NIGHT_ODDS);
        this.begin(nightWeather(this.night));
        this.changeAt = -1;
      } else {
        this.night = NightType.Clear;
        // Morning clears whatever the night brought, then maybe one change later today.
        this.begin(Weather.Clear);
        const odds = this.dayOdds();
        this.pending = this.roll(odds);
        this.changeAt = this.pending !== Weather.Clear ? sim.time + sim.rng.range(40, DAY.dayLength * 0.6) : -1;
      }
    }
    // Storms throw lightning somewhere around the train (a light and sky flash, §6.9).
    const storm =
      (this.from === Weather.Storm ? 1 - this.blend : 0) + (this.to === Weather.Storm ? this.blend : 0);
    if (storm > 0.4) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.lightningT = sim.rng.range(5, 14);
        const loco = sim.poses[1]!;
        const a = sim.rng.range(0, Math.PI * 2);
        const d = sim.rng.range(80, 450);
        sim.events.push({ ev: { e: 'lightning', x: loco.cx + Math.cos(a) * d, z: loco.cz + Math.sin(a) * d } });
      }
    }
    if (this.changeAt > 0 && sim.time >= this.changeAt && this.blend >= 1) {
      this.changeAt = -1;
      this.begin(this.pending);
    }
  }

  /** Development: force weather or a night type. */
  force(weather: WeatherId, night?: NightTypeId): void {
    if (night !== undefined) this.night = night;
    this.begin(weather);
    this.blend = 1;
    this.from = weather;
  }

  private begin(w: WeatherId): void {
    if (w === this.to && this.blend >= 1) return;
    this.from = this.current;
    this.to = w;
    this.blend = 0;
    this.blendDur = this.sim.rng.range(BLEND_MIN, BLEND_MAX);
  }

  private dayOdds(): Record<number, number> {
    const w = biomeWeights(this.sim.train.s, [1, 0, 0]);
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(WEATHER_ODDS)) out[Number(k)] = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    return out;
  }

  private roll<T extends number>(odds: Record<number, number>): T {
    const keys = Object.keys(odds).map(Number);
    return this.sim.rng.weighted(keys, keys.map((k) => odds[k] ?? 0)) as T;
  }
}
