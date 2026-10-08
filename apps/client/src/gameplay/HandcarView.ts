import * as THREE from 'three/webgpu';
import {
  type HandcarPose,
  type RunState,
  type World,
  handcarPose,
  makeHandcarPose,
} from '@dead-tracks/shared';
import { paletteMaterial } from '../render/materials.ts';
import { buildHandcar, buildPumpHandle, buildTrolley } from '../render/models/handcar.ts';

interface View {
  car: THREE.Mesh;
  handle: THREE.Mesh;
  trolley: THREE.Mesh;
  s: number;
  speed: number;
  pump: number;
  pose: HandcarPose;
  ready: boolean;
}

/** Handcars on their spurs (§4.4), extrapolated and smoothed like the train. */
export class HandcarView {
  private readonly views: View[] = [];
  private readonly geo = {
    car: buildHandcar(),
    handle: buildPumpHandle(),
    trolley: buildTrolley(),
  };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
  ) {
    const mat = paletteMaterial();
    for (let i = 0; i < world.spurs.length; i++) {
      const mk = (g: THREE.BufferGeometry) => {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.matrixAutoUpdate = false;
        scene.add(m);
        return m;
      };
      this.views.push({
        car: mk(this.geo.car),
        handle: mk(this.geo.handle),
        trolley: mk(this.geo.trolley),
        s: 22,
        speed: 0,
        pump: 0,
        pose: makeHandcarPose(),
        ready: false,
      });
    }
  }

  /** Smoothed pose of handcar i (for seated riders and cargo). */
  pose(i: number): HandcarPose | null {
    return this.views[i]?.pose ?? null;
  }

  update(dt: number, state: RunState, ox: number, oz: number): void {
    const m = new THREE.Matrix4();
    const t = new THREE.Matrix4();
    this.views.forEach((v, i) => {
      const hs = state.handcars[i];
      const spur = this.world.spurs[i]!;
      if (hs) {
        if (!v.ready) {
          v.s = hs.s;
          v.ready = true;
        }
        v.speed += (hs.speed - v.speed) * Math.min(1, dt * 6);
        v.s += v.speed * dt;
        v.s += (hs.s - v.s) * Math.min(1, dt * 3);
        v.trolley.visible = hs.trolley;
      }
      handcarPose(spur, v.s, v.pose);
      const p = v.pose;
      // Basis: right (rx, 0, rz), up, back (-fx, 0, -fz).
      m.set(p.rx, 0, -p.fx, p.x - ox, 0, 1, 0, p.y, p.rz, 0, -p.fz, p.z - oz, 0, 0, 0, 1);
      v.car.matrix.copy(m);
      v.trolley.matrix.copy(m);
      v.pump += Math.abs(v.speed) * dt * 1.6;
      t.makeRotationX(Math.sin(v.pump) * 0.32).setPosition(0, 0.75 + 1.0, 0);
      v.handle.matrix.multiplyMatrices(m, t);
      for (const o of [v.car, v.trolley, v.handle]) o.matrixWorldNeedsUpdate = true;
    });
  }
}
