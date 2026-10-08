import * as THREE from 'three/webgpu';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  gravity: number;
  drag: number;
}

const PARTICLES = 320;
const TRACERS = 24;
const DECALS = 96;

/**
 * Pooled combat effects in world space (render space = world minus origin, so
 * positions are passed in as world and shifted at draw time).
 */
export class Effects {
  private readonly particles: Particle[] = [];
  private readonly pMesh: THREE.InstancedMesh;
  private pNext = 0;
  private readonly tracers: Array<{
    ax: number;
    ay: number;
    az: number;
    bx: number;
    by: number;
    bz: number;
    age: number;
  }> = [];
  private readonly tMesh: THREE.InstancedMesh;
  private tNext = 0;
  private readonly decals: Array<{
    x: number;
    y: number;
    z: number;
    r: number;
    age: number;
    size: number;
  }> = [];
  private readonly dMesh: THREE.InstancedMesh;
  private dNext = 0;
  private readonly flashes: Array<{
    light: THREE.PointLight;
    age: number;
    life: number;
    power: number;
  }> = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly color = new THREE.Color();
  gore = true;
  private ox = 0;
  private oz = 0;
  /** Camera shake amount requested by explosions and hits (consumed by the game). */
  shake = 0;

  constructor(scene: THREE.Scene) {
    this.pMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertNodeMaterial({ flatShading: true }),
      PARTICLES,
    );
    this.pMesh.frustumCulled = false;
    this.pMesh.count = PARTICLES;
    for (let i = 0; i < PARTICLES; i++) {
      this.particles.push({
        x: 0,
        y: -1e4,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 1,
        life: 1,
        size: 0,
        gravity: 0,
        drag: 0,
      });
      this.pMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.pMesh.setColorAt(i, this.color.set(0xffffff));
    }
    scene.add(this.pMesh);

    this.tMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicNodeMaterial({ color: 0xfff1b8, fog: true }),
      TRACERS,
    );
    this.tMesh.frustumCulled = false;
    this.tMesh.count = TRACERS;
    for (let i = 0; i < TRACERS; i++) {
      this.tracers.push({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, age: 1 });
      this.tMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    scene.add(this.tMesh);

    const decalGeo = new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2);
    this.dMesh = new THREE.InstancedMesh(
      decalGeo,
      new THREE.MeshLambertNodeMaterial({
        color: 0x4a0b0b,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      DECALS,
    );
    this.dMesh.frustumCulled = false;
    this.dMesh.count = DECALS;
    this.dMesh.receiveShadow = true;
    for (let i = 0; i < DECALS; i++) {
      this.decals.push({ x: 0, y: -1e4, z: 0, r: 0, age: 999, size: 0 });
      this.dMesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    }
    scene.add(this.dMesh);

    // A fixed number of always-visible lights: changing the light count would
    // recompile every material's shader (a long hitch), so only intensity changes.
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffc477, 0, 14, 1.8);
      scene.add(light);
      this.flashes.push({ light, age: 1, life: 1, power: 0 });
    }
  }

  private emit(
    x: number,
    y: number,
    z: number,
    color: number,
    n: number,
    speed: number,
    size: number,
    life: number,
    gravity = 9,
    up = 0.5,
    drag = 1.5,
  ): void {
    for (let i = 0; i < n; i++) {
      const p = this.particles[this.pNext] as Particle;
      const idx = this.pNext;
      this.pNext = (this.pNext + 1) % PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * r * sp;
      p.vy = Math.abs(u) * sp * up + sp * 0.3 * up;
      p.vz = Math.sin(a) * r * sp;
      p.age = 0;
      p.life = life * (0.6 + Math.random() * 0.6);
      p.size = size * (0.6 + Math.random() * 0.8);
      p.gravity = gravity;
      p.drag = drag;
      this.pMesh.setColorAt(idx, this.color.set(color).multiplyScalar(0.85 + Math.random() * 0.3));
    }
    if (this.pMesh.instanceColor) this.pMesh.instanceColor.needsUpdate = true;
  }

  /** Bullet striking an enemy. */
  blood(x: number, y: number, z: number, amount = 1, ground?: number): void {
    if (!this.gore) {
      this.emit(x, y, z, 0x6b5a48, 5, 2.5, 0.05, 0.5);
      return;
    }
    this.emit(x, y, z, 0x7a0e0e, Math.round(10 * amount), 3.5 * amount, 0.055, 0.7);
    if (ground !== undefined) this.decal(x, ground, z, 0.35 + Math.random() * 0.4 * amount);
  }

  /** Head popped or limb lost. */
  gib(x: number, y: number, z: number, ground: number): void {
    if (!this.gore) return;
    this.emit(x, y, z, 0x5c0d0d, 22, 5, 0.09, 1.1);
    this.emit(x, y, z, 0xd8cdb0, 4, 4, 0.05, 1.0);
    this.decal(x, ground, z, 0.9);
  }

  /** Bullet striking the world. */
  impact(x: number, y: number, z: number, metal = false): void {
    this.emit(
      x,
      y,
      z,
      metal ? 0xffd27a : 0x8a7a62,
      metal ? 6 : 8,
      metal ? 6 : 2.5,
      metal ? 0.025 : 0.06,
      metal ? 0.25 : 0.6,
      metal ? 6 : 5,
      0.7,
    );
  }

  tracer(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const t = this.tracers[this.tNext] as (typeof this.tracers)[number];
    this.tNext = (this.tNext + 1) % TRACERS;
    Object.assign(t, { ax, ay, az, bx, by, bz, age: 0 });
  }

  muzzle(x: number, y: number, z: number, power = 1): void {
    const f =
      this.flashes.find((fl) => fl.age >= fl.life) ??
      (this.flashes[0] as (typeof this.flashes)[number]);
    f.light.position.set(x - this.ox, y, z - this.oz);
    f.age = 0;
    f.life = 0.06;
    f.power = 30 * power;
    this.emit(x, y, z, 0xffe0a0, 4, 1.2, 0.03, 0.08, 0, 0.2, 3);
    this.emit(x, y, z, 0xb0aaa2, 3, 0.8, 0.07, 0.6, -0.4, 0.4, 2);
  }

  explosion(x: number, y: number, z: number, r: number, holy: boolean, distToCamera: number): void {
    const f =
      this.flashes.find((fl) => fl.age >= fl.life) ??
      (this.flashes[0] as (typeof this.flashes)[number]);
    f.light.position.set(x - this.ox, y + 1, z - this.oz);
    f.light.color.set(holy ? 0x9fd4ff : 0xffb060);
    f.age = 0;
    f.life = 0.35;
    f.power = holy ? 60 : 160;
    if (holy) {
      this.emit(x, y + 0.3, z, 0xcfe8ff, 26, 6, 0.06, 0.6, 2, 0.6);
    } else {
      this.emit(x, y + 0.5, z, 0xffa040, 30, 12, 0.14, 0.35, 4, 0.8, 2);
      this.emit(x, y + 0.5, z, 0x4a4440, 28, 6, 0.35, 1.6, -1.2, 0.8, 1.2);
      this.emit(x, y + 0.2, z, 0x5a4a38, 26, 10, 0.08, 1.2, 9, 1.2, 0.6);
      this.decal(x, y, z, r * 0.45, 0x1e1a17);
    }
    this.shake = Math.max(this.shake, Math.max(0, 1 - distToCamera / (r * 6)) * (holy ? 0.3 : 1));
  }

  /** A vampire vanishing or arriving: a dark puff with red sparks. */
  blink(x: number, y: number, z: number): void {
    this.emit(x, y + 1.1, z, 0x241a2a, 26, 2.5, 0.1, 0.55, -0.8, 0.6, 2.5);
    this.emit(x, y + 1.2, z, 0x9a1a1a, 10, 3.5, 0.04, 0.4, 1, 0.5, 2);
  }

  /** Dr. Voss's arc: sparks along a jagged path and a blue flash where it lands. */
  zap(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : 0.35;
      this.emit(
        ax + (bx - ax) * t + (Math.random() - 0.5) * j,
        ay + (by - ay) * t + (Math.random() - 0.5) * j,
        az + (bz - az) * t + (Math.random() - 0.5) * j,
        0xbfe6ff,
        2,
        0.8,
        0.07,
        0.16,
        0,
        0.3,
        4,
      );
    }
    const f =
      this.flashes.find((fl) => fl.age >= fl.life) ??
      (this.flashes[0] as (typeof this.flashes)[number]);
    f.light.position.set(bx - this.ox, by + 0.5, bz - this.oz);
    f.light.color.set(0x8fc8ff);
    f.age = 0;
    f.life = 0.15;
    f.power = 60;
  }

  decal(x: number, y: number, z: number, size: number, _color?: number): void {
    const d = this.decals[this.dNext] as (typeof this.decals)[number];
    this.dNext = (this.dNext + 1) % DECALS;
    Object.assign(d, { x, y: y + 0.03, z, r: Math.random() * Math.PI * 2, age: 0, size });
  }

  update(dt: number, ox: number, oz: number): void {
    if (ox !== this.ox || oz !== this.oz) this.shiftLights(ox - this.ox, oz - this.oz);
    this.ox = ox;
    this.oz = oz;
    const m = this.m;
    for (let i = 0; i < PARTICLES; i++) {
      const p = this.particles[i] as Particle;
      if (p.age >= p.life) {
        if (p.size !== 0) {
          p.size = 0;
          this.pMesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        }
        continue;
      }
      p.age += dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vz *= k;
      p.vy = p.vy * k - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const s = p.size * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) * 0.8);
      m.makeRotationY(i)
        .scale(this.s.set(s, s, s))
        .setPosition(p.x - ox, p.y, p.z - oz);
      this.pMesh.setMatrixAt(i, m);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < TRACERS; i++) {
      const t = this.tracers[i] as (typeof this.tracers)[number];
      if (t.age > 0.07) {
        if (t.age < 1) {
          t.age = 1;
          this.tMesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        }
        continue;
      }
      t.age += dt;
      // A short streak travelling from muzzle to target.
      const len = Math.hypot(t.bx - t.ax, t.by - t.ay, t.bz - t.az);
      const head = Math.min(1, (t.age / 0.07) * 1.2);
      const tail = Math.max(0, head - Math.min(0.6, 6 / Math.max(len, 1)));
      const hx = t.ax + (t.bx - t.ax) * head;
      const hy = t.ay + (t.by - t.ay) * head;
      const hz = t.az + (t.bz - t.az) * head;
      const sx = t.ax + (t.bx - t.ax) * tail;
      const sy = t.ay + (t.by - t.ay) * tail;
      const sz = t.az + (t.bz - t.az) * tail;
      const seg = Math.hypot(hx - sx, hy - sy, hz - sz);
      this.v.set(hx - sx, hy - sy, hz - sz).normalize();
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.v);
      m.compose(
        this.s.set((sx + hx) / 2 - ox, (sy + hy) / 2, (sz + hz) / 2 - oz),
        this.q,
        new THREE.Vector3(0.018, 0.018, Math.max(seg, 0.01)),
      );
      this.tMesh.setMatrixAt(i, m);
    }
    this.tMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < DECALS; i++) {
      const d = this.decals[i] as (typeof this.decals)[number];
      if (d.age > 60) continue;
      d.age += dt;
      const s = d.size * Math.min(1, d.age * 6) * (d.age > 50 ? (60 - d.age) / 10 : 1);
      m.makeRotationY(d.r)
        .scale(this.s.set(s, 1, s))
        .setPosition(d.x - ox, d.y, d.z - oz);
      this.dMesh.setMatrixAt(i, m);
    }
    this.dMesh.instanceMatrix.needsUpdate = true;

    for (const f of this.flashes) {
      if (f.age >= f.life) {
        f.light.intensity = 0;
        continue;
      }
      f.age += dt;
      f.light.intensity = f.power * Math.max(0, 1 - f.age / f.life);
    }
  }

  /** Flash lights are positioned in render space by the caller; shift them on rebase. */
  shiftLights(dx: number, dz: number): void {
    for (const f of this.flashes) {
      f.light.position.x -= dx;
      f.light.position.z -= dz;
    }
  }
}
