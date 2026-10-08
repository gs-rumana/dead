import * as THREE from 'three/webgpu';
import {
  CONSIST,
  FORT_POINTS,
  type CarPose,
  type Route,
  TRAIN,
  clamp,
  computeCarPoses,
  makeCarPoses,
} from '@dead-tracks/shared';
import { glowMaterial, paletteMaterial } from '../render/materials.ts';
import { itemGeometry } from '../render/models/items.ts';
import {
  CRANK_RADIUS,
  CYLINDER_Y,
  DRIVER_RADIUS,
  FLATCAR_AXLES,
  GAUGE_HALF,
  LOCO_DRIVER_AXLES,
  LOCO_LEADING_AXLES,
  SMALL_WHEEL_RADIUS,
  TENDER_AXLES,
  buildCouplingRod,
  buildFlatcar,
  buildLocomotive,
  buildMainRod,
  buildTender,
  buildWheelSet,
} from '../render/models/train.ts';

const MAIN_ROD = 2.55;
const SMOKE = 56;

/** Renders the train at a (client-smoothed) route position. */
export class TrainView {
  readonly poses: CarPose[] = makeCarPoses();
  private readonly cars: THREE.Mesh[] = [];
  private readonly drivers: THREE.InstancedMesh;
  private readonly smallWheels: THREE.InstancedMesh;
  private readonly coupling: THREE.InstancedMesh;
  private readonly mainRods: THREE.InstancedMesh;
  private readonly smoke: THREE.InstancedMesh;
  private readonly smokeState: Array<{
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    life: number;
    size: number;
  }> = [];
  private smokeNext = 0;
  private chuffAcc = 0;
  readonly headlamp: THREE.SpotLight;
  private readonly lampGlow: THREE.Mesh;
  readonly fireLight: THREE.PointLight;
  private readonly carMat = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();
  private readonly tmp2 = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private flicker = 0;
  /** Bolted plates and strung wire at the fortification points (§4.3). */
  private readonly fortMeshes: Array<{ plate: THREE.Mesh; wire: THREE.Mesh }> = [];
  /** Called on every exhaust beat (for sound). */
  onChuff: ((throttle: number) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly route: Route,
  ) {
    const mat = paletteMaterial();
    const geos = [buildLocomotive(), buildTender(), buildFlatcar()];
    for (const g of geos) {
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      scene.add(m);
      this.cars.push(m);
    }
    const inst = (geo: THREE.BufferGeometry, n: number) => {
      const im = new THREE.InstancedMesh(geo, mat, n);
      im.frustumCulled = false;
      im.castShadow = true;
      scene.add(im);
      return im;
    };
    this.drivers = inst(buildWheelSet(DRIVER_RADIUS, true), LOCO_DRIVER_AXLES.length);
    this.smallWheels = inst(
      buildWheelSet(SMALL_WHEEL_RADIUS, false),
      LOCO_LEADING_AXLES.length + TENDER_AXLES.length + FLATCAR_AXLES.length,
    );
    this.coupling = inst(buildCouplingRod(), 2);
    this.mainRods = inst(buildMainRod(MAIN_ROD), 2);

    const puff = new THREE.IcosahedronGeometry(1, 0);
    this.smoke = new THREE.InstancedMesh(
      puff,
      new THREE.MeshLambertNodeMaterial({
        color: 0xcfc9c0,
        flatShading: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      SMOKE,
    );
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 5;
    this.smoke.count = SMOKE;
    for (let i = 0; i < SMOKE; i++) {
      this.smokeState.push({ x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size: 0 });
      this.smoke.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    scene.add(this.smoke);

    this.headlamp = new THREE.SpotLight(0xffe2a8, 0, 140, 0.42, 0.55, 1.2);
    this.headlamp.castShadow = false;
    scene.add(this.headlamp, this.headlamp.target);
    this.lampGlow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), glowMaterial(0xffe6b0));
    scene.add(this.lampGlow);
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 9, 1.6);
    scene.add(this.fireLight);
    for (let i = 0; i < FORT_POINTS.length; i++) {
      const plate = new THREE.Mesh(itemGeometry('plate'), mat);
      const wire = new THREE.Mesh(itemGeometry('wire'), mat);
      for (const m of [plate, wire]) {
        m.matrixAutoUpdate = false;
        m.visible = false;
        m.castShadow = true;
        scene.add(m);
      }
      this.fortMeshes.push({ plate, wire });
    }
  }

  /** Shows plates and wire per the synced fortification state. */
  updateForts(forts: ArrayLike<number>, originX: number, originZ: number): void {
    FORT_POINTS.forEach((fp, i) => {
      const f = forts[i] ?? 0;
      const fm = this.fortMeshes[i]!;
      fm.plate.visible = f === 1;
      fm.wire.visible = f === 2;
      if (!f) return;
      const car = CONSIST.findIndex((c) => fp.z >= c.z0 && fp.z <= c.z1);
      const p = this.poses[Math.max(0, car)] as CarPose;
      const c = CONSIST[Math.max(0, car)]!;
      setCarMatrix(this.carMat, p, originX, originZ);
      // Stand the plate on the car's side, facing out.
      this.tmp
        .makeRotationY(fp.x > 0 ? Math.PI / 2 : -Math.PI / 2)
        .setPosition(fp.x + Math.sign(fp.x) * 0.05, fp.y - 0.55, fp.z - c.zc);
      const target = f === 1 ? fm.plate : fm.wire;
      target.matrix.multiplyMatrices(this.carMat, this.tmp);
      if (f === 2) target.matrix.scale(new THREE.Vector3(2.6, 1, 1));
      target.matrixWorldNeedsUpdate = true;
    });
  }

  get locoPose(): CarPose {
    return this.poses[0] as CarPose;
  }

  /** Places everything for the train at route distance `s`. */
  update(
    dt: number,
    s: number,
    speed: number,
    throttle: number,
    fuel: number,
    night: number,
    originX: number,
    originZ: number,
  ): void {
    computeCarPoses(this.route, s, this.poses);
    const wheelAngleSmall = -s / SMALL_WHEEL_RADIUS;
    const wheelAngleDriver = -s / DRIVER_RADIUS;
    let small = 0;
    for (let i = 0; i < CONSIST.length; i++) {
      const p = this.poses[i] as CarPose;
      setCarMatrix(this.carMat, p, originX, originZ);
      const mesh = this.cars[i] as THREE.Mesh;
      mesh.matrix.copy(this.carMat);
      mesh.matrixWorldNeedsUpdate = true;
      const axles = i === 0 ? LOCO_LEADING_AXLES : i === 1 ? TENDER_AXLES : FLATCAR_AXLES;
      for (const z of axles) {
        this.tmp.makeRotationX(wheelAngleSmall).setPosition(0, SMALL_WHEEL_RADIUS, z);
        this.tmp2.multiplyMatrices(this.carMat, this.tmp);
        this.smallWheels.setMatrixAt(small++, this.tmp2);
      }
      if (i === 0) {
        LOCO_DRIVER_AXLES.forEach((z, k) => {
          this.tmp.makeRotationX(wheelAngleDriver).setPosition(0, DRIVER_RADIUS, z);
          this.tmp2.multiplyMatrices(this.carMat, this.tmp);
          this.drivers.setMatrixAt(k, this.tmp2);
        });
        // Rods follow the crank pins.
        const pinY = DRIVER_RADIUS + CRANK_RADIUS * Math.cos(wheelAngleDriver);
        const pinDz = CRANK_RADIUS * Math.sin(wheelAngleDriver);
        const zMid = (LOCO_DRIVER_AXLES[0]! + LOCO_DRIVER_AXLES[1]!) / 2;
        const pinZFront = LOCO_DRIVER_AXLES[0]! + pinDz;
        const dy = pinY - CYLINDER_Y;
        const crossZ = pinZFront - Math.sqrt(Math.max(0.01, MAIN_ROD * MAIN_ROD - dy * dy));
        const rodAngle = -Math.asin(clamp(dy / MAIN_ROD, -1, 1));
        [-1, 1].forEach((side, k) => {
          const x = side * (GAUGE_HALF + 0.25);
          this.tmp.makeTranslation(x, pinY, zMid + pinDz);
          this.tmp2.multiplyMatrices(this.carMat, this.tmp);
          this.coupling.setMatrixAt(k, this.tmp2);
          this.tmp
            .makeRotationX(rodAngle)
            .setPosition(side * (GAUGE_HALF + 0.33), CYLINDER_Y, crossZ);
          this.tmp2.multiplyMatrices(this.carMat, this.tmp);
          this.mainRods.setMatrixAt(k, this.tmp2);
        });
        this.placeLights(p, night, fuel, dt, originX, originZ);
        this.emitSmoke(dt, p, speed, throttle, fuel);
      }
    }
    for (const im of [this.smallWheels, this.drivers, this.coupling, this.mainRods])
      im.instanceMatrix.needsUpdate = true;
    this.updateSmoke(dt, originX, originZ);
  }

  private carLocal(
    p: CarPose,
    x: number,
    y: number,
    z: number,
    ox: number,
    oz: number,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    return out.set(
      p.cx + p.rx * x + p.ux * y + p.bx * z - ox,
      p.cy + p.ry * x + p.uy * y + p.by * z,
      p.cz + p.rz * x + p.uz * y + p.bz * z - oz,
    );
  }

  private placeLights(
    p: CarPose,
    night: number,
    fuel: number,
    dt: number,
    ox: number,
    oz: number,
  ): void {
    const lit = night > 0.25;
    this.carLocal(p, 0, 3.47, -4.5, ox, oz, this.headlamp.position);
    this.carLocal(p, 0, 1.0, -40, ox, oz, this.headlamp.target.position);
    this.headlamp.intensity = lit ? 60 * Math.min(1, (night - 0.25) * 3) : 0;
    this.carLocal(p, 0, 3.47, -4.49, ox, oz, this.lampGlow.position);
    this.lampGlow.lookAt(this.carLocal(p, 0, 3.47, -10, ox, oz, this.v));
    (this.lampGlow.material as THREE.MeshBasicNodeMaterial).color.setScalar(lit ? 1.6 : 0.7);
    this.flicker += dt * 13;
    const f = 0.8 + Math.sin(this.flicker) * 0.1 + Math.sin(this.flicker * 2.7) * 0.08;
    this.carLocal(p, 0, 1.8, 3.1, ox, oz, this.fireLight.position);
    this.fireLight.intensity = fuel > 0 ? (1.5 + night * 5) * f : 0;
  }

  private emitSmoke(dt: number, p: CarPose, speed: number, throttle: number, fuel: number): void {
    if (fuel <= 0) return;
    // Four chuffs per driver revolution, plus a lazy idle plume.
    const revs = Math.abs(speed) / (2 * Math.PI * DRIVER_RADIUS);
    this.chuffAcc += dt * (revs * 4 * (0.4 + throttle) + 2.2);
    const beats = revs * 4;
    while (this.chuffAcc >= 1) {
      this.chuffAcc -= 1;
      if (beats > 0.15) this.onChuff?.(throttle);
      const sm = this.smokeState[this.smokeNext] as (typeof this.smokeState)[number];
      this.smokeNext = (this.smokeNext + 1) % SMOKE;
      this.carLocal(p, 0, 4.6, -3.65, 0, 0, this.v);
      sm.x = this.v.x + (Math.random() - 0.5) * 0.2;
      sm.y = this.v.y;
      sm.z = this.v.z + (Math.random() - 0.5) * 0.2;
      // Puffs leave the stack with a bit of the train's speed, then drag.
      const k = speed * 0.25;
      sm.vx = -p.bx * k + (Math.random() - 0.5) * 0.6;
      sm.vy = 2.2 + throttle * 2.5 + Math.random();
      sm.vz = -p.bz * k + (Math.random() - 0.5) * 0.6;
      sm.age = 0;
      sm.life = 2.6 + Math.random() * 1.6;
      sm.size = 0.35 + throttle * 0.3;
    }
  }

  private updateSmoke(dt: number, ox: number, oz: number): void {
    const m = this.tmp;
    for (let i = 0; i < SMOKE; i++) {
      const s = this.smokeState[i] as (typeof this.smokeState)[number];
      if (s.age >= s.life) {
        this.smoke.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      s.age += dt;
      const drag = Math.exp(-dt * 0.9);
      s.vx *= drag;
      s.vz *= drag;
      s.vy *= Math.exp(-dt * 0.5);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const t = s.age / s.life;
      const grow = s.size * (0.7 + t * 3.2) * (t > 0.7 ? (1 - t) / 0.3 : 1);
      m.makeRotationY(i * 1.7 + t)
        .scale(this.v.set(grow, grow * 0.85, grow))
        .setPosition(s.x - ox, s.y, s.z - oz);
      this.smoke.setMatrixAt(i, m);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const c of this.cars) this.scene.remove(c);
  }
}

/** Matrix from a car pose in render space (world minus origin). */
export function setCarMatrix(m: THREE.Matrix4, p: CarPose, ox: number, oz: number): THREE.Matrix4 {
  return m.set(
    p.rx,
    p.ux,
    p.bx,
    p.cx - ox,
    p.ry,
    p.uy,
    p.by,
    p.cy,
    p.rz,
    p.uz,
    p.bz,
    p.cz - oz,
    0,
    0,
    0,
    1,
  );
}

export { TRAIN };
