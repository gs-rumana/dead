import * as THREE from 'three/webgpu';
import { attribute, floor, uniform, vec3 } from 'three/tsl';
import { NightType, Weather, type WeatherId, biomeWeights } from '@dead-tracks/shared';
import type { Sky } from './Sky.ts';

/** How each weather looks (§4.5): overcast, fog distance, particles and tint. */
interface Look {
  overcast: number;
  fog: number;
  rain: number;
  dust: number;
  wind: number;
  tint: [number, number, number];
  tintK: number;
}

const LOOKS: Record<WeatherId, Look> = {
  [Weather.Clear]: { overcast: 0, fog: 1, rain: 0, dust: 0, wind: 0, tint: [1, 1, 1], tintK: 0 },
  [Weather.Rain]: { overcast: 0.6, fog: 0.6, rain: 0.55, dust: 0, wind: 0.2, tint: [0.86, 0.9, 0.95], tintK: 0.35 },
  [Weather.Storm]: { overcast: 0.9, fog: 0.42, rain: 1, dust: 0, wind: 0.7, tint: [0.72, 0.78, 0.88], tintK: 0.5 },
  [Weather.Fog]: { overcast: 0.45, fog: 0.2, rain: 0, dust: 0, wind: 0, tint: [0.95, 0.96, 0.97], tintK: 0.3 },
  [Weather.Dust]: { overcast: 0.15, fog: 0.24, rain: 0, dust: 1, wind: 1, tint: [1.08, 0.74, 0.44], tintK: 1 },
};

/** Biome colour casts for sky and fog [prairie, badlands, forest]. */
const BIOME_TINT: Array<[number, number, number]> = [
  [1, 1, 1],
  [1.04, 0.9, 0.76],
  [0.8, 0.9, 0.86],
];
const BIOME_FOG = [1, 1, 0.72];

/**
 * Streaks falling through a box that follows the camera. Positions wrap on the GPU,
 * so the CPU only advances a time uniform (§6.9: cheap enough for phones).
 */
class Streaks {
  readonly mesh: THREE.LineSegments;
  private readonly uTime = uniform(0);
  private readonly uCam = uniform(new THREE.Vector3());
  private time = 0;

  constructor(
    private readonly max: number,
    box: [number, number, number],
    vel: [number, number, number],
    length: number,
    color: number,
    opacity: number,
  ) {
    const seed = new Float32Array(max * 2 * 3);
    const tail = new Float32Array(max * 2);
    let s = 987654321;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < max; i++) {
      const x = rnd() * box[0];
      const y = rnd() * box[1];
      const z = rnd() * box[2];
      for (let k = 0; k < 2; k++) {
        seed.set([x, y, z], (i * 2 + k) * 3);
        tail[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    const mat = new THREE.LineBasicNodeMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: true,
    });
    const b = vec3(box[0], box[1], box[2]);
    const v = vec3(vel[0], vel[1], vel[2]);
    const len = Math.hypot(vel[0], vel[1], vel[2]);
    const dir = vec3(vel[0] / len, vel[1] / len, vel[2] / len);
    // Wrap (seed + v t - cam) into the box, then centre the box on the camera.
    const p = attribute('seed', 'vec3').add(v.mul(this.uTime)).sub(this.uCam);
    const wrapped = p.sub(b.mul(floor(p.div(b))));
    mat.positionNode = wrapped
      .add(this.uCam)
      .sub(b.mul(0.5))
      .sub(dir.mul(attribute('tail', 'float').mul(length)));
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    g.setDrawRange(0, 0);
  }

  update(dt: number, amount: number, cam: THREE.Vector3): void {
    this.time = (this.time + dt) % 1000;
    this.uTime.value = this.time;
    this.uCam.value.copy(cam);
    const n = Math.round(Math.max(0, Math.min(1, amount)) * this.max);
    this.mesh.geometry.setDrawRange(0, n * 2);
    this.mesh.visible = n > 0;
  }
}

export interface WeatherInput {
  from: number;
  to: number;
  blend: number;
  night: number;
  /** Route distance for the biome cast. */
  s: number;
}

/**
 * Weather and night types on screen (§4.5): sky and fog blend, rain and dust,
 * lightning flashes, the full moon and the blood moon. Nothing jumps: every value
 * blends from the host's from/to/blend and the day phase.
 */
export class WeatherFx {
  private readonly rain: Streaks;
  private readonly dust: Streaks;
  private flash = 0;
  /** Pending flash pulses (seconds from now). */
  private readonly pulses: number[] = [];
  private blood = 0;
  private full = 0;
  /** Rain and wind levels for the audio (0..1). */
  rainLevel = 0;
  windLevel = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sky: Sky,
    lowQuality: boolean,
  ) {
    this.rain = new Streaks(lowQuality ? 1200 : 3200, [36, 22, 36], [1.8, -21, 0.9], 0.55, 0xb8c4d0, 0.38);
    this.dust = new Streaks(lowQuality ? 900 : 2200, [44, 12, 44], [9, -0.4, 3.5], 0.45, 0xc8a070, 0.35);
    scene.add(this.rain.mesh, this.dust.mesh);
  }

  /** A strike somewhere nearby: two or three quick flashes. */
  lightning(): void {
    this.pulses.push(0, 0.12 + Math.random() * 0.08);
    if (Math.random() < 0.5) this.pulses.push(0.35 + Math.random() * 0.2);
  }

  update(dt: number, w: WeatherInput, cam: THREE.Vector3): void {
    const a = LOOKS[w.from as WeatherId] ?? LOOKS[Weather.Clear];
    const b = LOOKS[w.to as WeatherId] ?? LOOKS[Weather.Clear];
    const t = Math.max(0, Math.min(1, w.blend));
    const mix = (x: number, y: number) => x + (y - x) * t;
    const bw: [number, number, number] = [1, 0, 0];
    biomeWeights(w.s, bw);
    const night = this.sky.night;

    // Night types fade in with the dark.
    const toward = (v: number, goal: number) => v + (goal - v) * Math.min(1, dt * 0.25);
    this.blood = toward(this.blood, w.night === NightType.BloodMoon ? 1 : 0);
    this.full = toward(this.full, w.night === NightType.FullMoon ? 1 : 0);

    // Flash pulses decay fast.
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i]! -= dt;
      if (this.pulses[i]! <= 0) {
        this.flash = 1;
        this.pulses.splice(i, 1);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 7);

    const env = this.sky.env;
    env.overcast = mix(a.overcast, b.overcast);
    env.fogK = mix(a.fog, b.fog) * (bw[0] * BIOME_FOG[0]! + bw[1] * BIOME_FOG[1]! + bw[2] * BIOME_FOG[2]!);
    const tk = mix(a.tintK, b.tintK);
    for (let c = 0; c < 3; c++) {
      const weatherTint = 1 + (mix(a.tint[c]!, b.tint[c]!) - 1) * tk;
      const biome = bw[0] * BIOME_TINT[0]![c]! + bw[1] * BIOME_TINT[1]![c]! + bw[2] * BIOME_TINT[2]![c]!;
      env.tint[c] = weatherTint * (1 + (biome - 1) * 0.6);
    }
    env.blood = this.blood * night;
    env.fullMoon = this.full;
    env.flash = this.flash;

    this.rainLevel = mix(a.rain, b.rain);
    const dustLevel = mix(a.dust, b.dust);
    this.windLevel = Math.max(mix(a.wind, b.wind), 0);
    this.rain.update(dt, this.rainLevel, cam);
    this.dust.update(dt, dustLevel, cam);
  }
}
