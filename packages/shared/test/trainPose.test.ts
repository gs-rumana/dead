import { describe, expect, it } from 'vitest';
import {
  CONSIST,
  RAIL_TOP,
  Route,
  TRAIN_LENGTH,
  computeCarPoses,
  makeCarPoses,
  makeFrame,
  trainToWorld,
  trainYawAt,
  worldToTrain,
} from '../src/index.ts';

const route = new Route(7);

describe('train pose', () => {
  it('puts the train on the rails, facing along the track', () => {
    const poses = computeCarPoses(route, 3000, makeCarPoses());
    // Front coupler centreline at rail height should sit on the track at s = 3000.
    const p = trainToWorld(poses, 0, 0, 0, { x: 0, y: 0, z: 0 });
    const f = route.frameAt(3000, makeFrame());
    expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeLessThan(0.05);
    expect(Math.abs(p.y - (f.y + RAIL_TOP))).toBeLessThan(0.05);
    // Right of the train = right of the track.
    const r = trainToWorld(poses, 1, 0, 0, { x: 0, y: 0, z: 0 });
    expect((r.x - p.x) * f.rx + (r.z - p.z) * f.rz).toBeCloseTo(1, 2);
    // Car yaw matches -heading.
    expect(trainYawAt(poses, 1)).toBeCloseTo(-route.headingAt(3000 - 1), 1);
  });

  it('round-trips world <-> train space on every car', () => {
    const poses = computeCarPoses(route, 8123.4, makeCarPoses());
    const w = { x: 0, y: 0, z: 0 };
    const t = { x: 0, y: 0, z: 0 };
    for (const car of CONSIST) {
      for (const [x, y, zOff] of [
        [0.5, 1.4, -1],
        [-1.2, 2.9, 2],
        [0, 0.3, 0],
      ] as const) {
        const z = car.zc + zOff;
        trainToWorld(poses, x, y, z, w);
        worldToTrain(poses, w.x, w.y, w.z, t);
        expect(t.x).toBeCloseTo(x, 4);
        expect(t.y).toBeCloseTo(y, 4);
        expect(t.z).toBeCloseTo(z, 4);
      }
    }
    expect(TRAIN_LENGTH).toBeGreaterThan(30);
  });
});
