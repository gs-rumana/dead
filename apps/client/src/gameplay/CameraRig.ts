import * as THREE from 'three/webgpu';
import {
  type CarPose,
  Frame,
  PLAYER,
  type PhysicsSpace,
  trainDirToWorld,
  trainToWorld,
} from '@dead-tracks/shared';

export type CameraMode = 'third' | 'first';

const SHOULDER = 0.45;
const BOOM = 3.4;

/**
 * Third-person over-the-shoulder camera with collision, or first person while
 * driving (§4.7). Works in the player's frame, then maps to the world, so the view
 * turns with the train on curves.
 */
export class CameraRig {
  private readonly w = { x: 0, y: 0, z: 0 };
  private readonly d = { x: 0, y: 0, z: 0 };
  private boom = BOOM;
  readonly worldPos = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(
    dt: number,
    mode: CameraMode,
    frame: number,
    px: number,
    py: number,
    pz: number,
    yaw: number,
    pitch: number,
    poses: CarPose[],
    space: PhysicsSpace,
    ox: number,
    oz: number,
  ): void {
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let cx: number;
    let cy: number;
    let cz: number;
    if (mode === 'first') {
      cx = px - Math.sin(yaw) * 0.1;
      cy = py + PLAYER.eyeHeight;
      cz = pz - Math.cos(yaw) * 0.1;
      this.boom = BOOM;
    } else {
      const sx = px + rx * SHOULDER;
      const sy = py + 1.62;
      const sz = pz + rz * SHOULDER;
      let want = BOOM;
      const hit =
        frame === Frame.Train
          ? space.rayTrain(sx, sy, sz, -fx, -fy, -fz, BOOM + 0.3)
          : space.rayGround(sx, sy, sz, -fx, -fy, -fz, BOOM + 0.3);
      if (hit) want = Math.max(0.6, hit.toi - 0.3);
      // Pull in fast, ease back out.
      this.boom = want < this.boom ? want : this.boom + (want - this.boom) * Math.min(1, dt * 4);
      cx = sx - fx * this.boom;
      cy = sy - fy * this.boom + 0.12;
      cz = sz - fz * this.boom;
    }
    let lx = fx;
    let ly = fy;
    let lz = fz;
    if (frame === Frame.Train) {
      trainToWorld(poses, cx, cy, cz, this.w);
      trainDirToWorld(poses, pz, fx, fy, fz, this.d);
      cx = this.w.x;
      cy = this.w.y;
      cz = this.w.z;
      lx = this.d.x;
      ly = this.d.y;
      lz = this.d.z;
    }
    this.worldPos.set(cx, cy, cz);
    this.camera.position.set(cx - ox, cy, cz - oz);
    this.camera.lookAt(cx - ox + lx, cy + ly, cz - oz + lz);
  }
}
