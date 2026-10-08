import * as THREE from 'three/webgpu';
import {
  float,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
  dot,
} from 'three/tsl';
import { clamp, smoothstep as sstep } from '@dead-tracks/shared';

/** Fraction of the day/night cycle that is daylight (6 of 10 minutes, §4.5). */
const DAY_FRACTION = 0.6;

interface Key {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
}

const C = (h: number) => new THREE.Color(h);
const DAY: Key = {
  zenith: C(0x4a7fbf),
  horizon: C(0xcfdde3),
  sun: C(0xfff0d6),
  sunI: 2.7,
  hemiSky: C(0xd7e4ee),
  hemiGround: C(0x705d45),
  hemiI: 1.15,
};
const GOLDEN: Key = {
  zenith: C(0x48618f),
  horizon: C(0xf0b27a),
  sun: C(0xffb36b),
  sunI: 1.9,
  hemiSky: C(0xe7c1a0),
  hemiGround: C(0x5d4532),
  hemiI: 0.85,
};
const NIGHT: Key = {
  zenith: C(0x05080f),
  horizon: C(0x18202f),
  sun: C(0x8ea5d6),
  sunI: 0.42,
  hemiSky: C(0x34436a),
  hemiGround: C(0x15130f),
  hemiI: 0.3,
};

/**
 * Sky dome, sun, moon, stars, fog and the two scene lights, all driven smoothly by
 * the day phase (§4.5: nothing jumps).
 */
export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  readonly fog = new THREE.Fog(0xffffff, 80, 600);
  private readonly stars: THREE.Points;
  private readonly moon: THREE.Mesh;
  private readonly uZenith = uniform(new THREE.Color());
  private readonly uHorizon = uniform(new THREE.Color());
  private readonly uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  private readonly uSunColor = uniform(new THREE.Color());
  private readonly uSunAmount = uniform(1);
  private readonly starMat: THREE.PointsNodeMaterial;
  private readonly key: Key = {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sun: new THREE.Color(),
    sunI: 0,
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiI: 0,
  };
  /** World-space direction toward the light (sun by day, moon by night). */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  /** 0 at noon, 1 at midnight; drives lamps and glow. */
  night = 0;
  viewDistance = 600;
  /** Weather and night-type look, written each frame by WeatherFx (§4.5). */
  readonly env = {
    overcast: 0,
    fogK: 1,
    tint: [1, 1, 1] as [number, number, number],
    blood: 0,
    fullMoon: 0,
    flash: 0,
  };
  private readonly moonMat: THREE.MeshBasicNodeMaterial;

  constructor(radius: number) {
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const dir = normalize(positionLocal);
    const up = max(dir.y, float(0));
    const sky = mix(this.uHorizon, this.uZenith, pow(up, float(0.55)));
    const sd = max(dot(dir, this.uSunDir), float(0));
    const disk = smoothstep(float(0.9993), float(0.9997), sd).mul(this.uSunAmount);
    const glow = pow(sd, float(12)).mul(0.35).mul(this.uSunAmount);
    const below = smoothstep(float(0.0), float(-0.25), dir.y);
    const base = mix(sky, this.uHorizon.mul(0.55), below);
    mat.colorNode = base.add(this.uSunColor.mul(glow.add(disk.mul(4))));
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 12), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    // Stars: a fixed random field on the upper hemisphere.
    const n = 900;
    const pos = new Float32Array(n * 3);
    let seed = 1234567;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) {
      const u = rnd();
      const theta = rnd() * Math.PI * 2;
      const y = 0.05 + u * 0.95;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(theta) * r * radius * 0.95;
      pos[i * 3 + 1] = y * radius * 0.95;
      pos[i * 3 + 2] = Math.sin(theta) * r * radius * 0.95;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsNodeMaterial({
      color: 0xe8eeff,
      size: 2,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.dome.add(this.stars);

    this.moonMat = new THREE.MeshBasicNodeMaterial({ color: 0xe9ecf5, fog: false, depthWrite: false });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.035, 16), this.moonMat);
    this.moon.renderOrder = -8;
    this.dome.add(this.moon);

    this.sun.castShadow = false;
    this.hemi.position.set(0, 1, 0);
  }

  /** dayPhase in [0, 1): 0 = sunrise, 0.6 = sunset, 0.8 = midnight. */
  update(dayPhase: number, camera: THREE.Camera): void {
    let elev: number;
    let az: number;
    if (dayPhase < DAY_FRACTION) {
      const t = dayPhase / DAY_FRACTION;
      elev = Math.sin(t * Math.PI) * 1.05;
      az = -Math.PI / 2 + t * Math.PI;
    } else {
      const t = (dayPhase - DAY_FRACTION) / (1 - DAY_FRACTION);
      elev = -Math.sin(t * Math.PI) * 0.6;
      az = Math.PI / 2 + t * Math.PI;
    }
    // Sun rises in the east (+x), tilted south for long shadows.
    this.sunDir
      .set(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev) * 0.6 + 0.3)
      .normalize();
    const sunUp = this.sunDir.y;
    const day = sstep(-0.1, 0.22, sunUp);
    const golden = clamp(1 - Math.abs(sunUp - 0.05) / 0.22, 0, 1) * sstep(-0.12, 0.0, sunUp);
    this.night = 1 - day;

    const k = this.key;
    blendKey(k, NIGHT, DAY, day);
    blendKey(k, k, GOLDEN, golden * 0.85);
    this.applyEnv(k);

    this.uZenith.value.copy(k.zenith);
    this.uHorizon.value.copy(k.horizon);
    this.uSunDir.value.copy(this.sunDir);
    this.uSunColor.value.copy(k.sun);
    this.uSunAmount.value = sstep(-0.05, 0.02, sunUp) * (1 - this.env.overcast * 0.9);

    // By night the key light is the moon, opposite the sun.
    if (day > 0.15) this.lightDir.copy(this.sunDir);
    else
      this.lightDir.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y), -this.sunDir.z).normalize();
    this.sun.color.copy(k.sun);
    this.sun.intensity = k.sunI * (day > 0.15 ? sstep(-0.02, 0.12, sunUp) * 0.85 + 0.15 : 1);
    // Overcast skies soften the key light; the full moon lights the night.
    this.sun.intensity *= 1 - this.env.overcast * 0.55;
    if (day <= 0.15) this.sun.intensity *= 1 + this.env.fullMoon * 0.7 - this.env.overcast * 0.2;
    this.hemi.color.copy(k.hemiSky);
    this.hemi.groundColor.copy(k.hemiGround);
    this.hemi.intensity = k.hemiI * (1 - this.env.overcast * 0.15) + this.env.flash * 2.2;

    this.fog.color.copy(k.horizon).lerp(k.zenith, 0.12);
    const fk = this.env.fogK;
    this.fog.near = this.viewDistance * 0.18 * Math.min(1, fk * 0.8);
    this.fog.far = Math.max(45, this.viewDistance * (0.95 - this.night * 0.25) * fk);

    this.starMat.opacity = clamp(this.night * 1.3 - 0.3, 0, 1) * (1 - this.env.overcast) * (1 - this.env.fullMoon * 0.4);
    const moonDir = new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    const radius = (this.dome.geometry as THREE.SphereGeometry).parameters.radius * 0.9;
    this.moon.position.copy(moonDir).multiplyScalar(radius);
    this.moon.scale.setScalar(1 + this.env.fullMoon * 0.7);
    this.moonMat.color.setRGB(0.91, 0.925 - this.env.blood * 0.75, 0.96 - this.env.blood * 0.82);
    this.moon.lookAt(0, 0, 0);
    this.moon.visible = moonDir.y > -0.05;

    this.dome.position.copy(camera.position);
    // Keep the dome inside the far plane or it gets clipped to the clear colour.
    const far = (camera as THREE.PerspectiveCamera).far ?? 1000;
    const r = (this.dome.geometry as THREE.SphereGeometry).parameters.radius;
    this.dome.scale.setScalar((far * 0.92) / r);
  }

  /** Weather, biome and night type over the time-of-day key. */
  private applyEnv(k: Key): void {
    const e = this.env;
    for (const c of [k.zenith, k.horizon]) {
      // Overcast: toward a grey of the same brightness, a little darker.
      const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
      GREY.setRGB(l, l, l);
      c.lerp(GREY, e.overcast * 0.8).multiplyScalar(1 - e.overcast * 0.3);
      c.r *= e.tint[0];
      c.g *= e.tint[1];
      c.b *= e.tint[2];
    }
    k.hemiSky.lerp(k.horizon, e.overcast * 0.5);
    if (e.blood > 0) {
      k.zenith.lerp(BLOOD_ZENITH, e.blood);
      k.horizon.lerp(BLOOD_HORIZON, e.blood * 0.9);
      k.sun.lerp(BLOOD_LIGHT, e.blood * 0.8);
      k.hemiSky.lerp(BLOOD_HORIZON, e.blood * 0.6);
    }
    if (e.flash > 0) {
      k.zenith.lerp(FLASH, e.flash * 0.7);
      k.horizon.lerp(FLASH, e.flash * 0.6);
    }
  }
}

const GREY = new THREE.Color();
const BLOOD_ZENITH = new THREE.Color(0x2a0306);
const BLOOD_HORIZON = new THREE.Color(0x5a0e0a);
const BLOOD_LIGHT = new THREE.Color(0xd04a3a);
const FLASH = new THREE.Color(0xc8d2ff);

function blendKey(out: Key, a: Key, b: Key, t: number): void {
  out.zenith.copy(a.zenith).lerp(b.zenith, t);
  out.horizon.copy(a.horizon).lerp(b.horizon, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
  out.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
}

export { vec3 };
