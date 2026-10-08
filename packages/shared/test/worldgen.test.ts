import { describe, expect, it } from 'vitest';
import {
  ROUTE_LENGTH,
  Route,
  Terrain,
  hashInts,
  makeFrame,
  tileHeights,
  tileProps,
} from '../src/index.ts';
import { ROUTE_END, ROUTE_START } from '../src/worldgen/route.ts';

const route = new Route(42);
const terrain = new Terrain(route);

describe('Route', () => {
  it('covers the whole run', () => {
    expect(route.start).toBe(ROUTE_START);
    expect(route.end).toBeGreaterThan(ROUTE_LENGTH);
    const p = route.xzAt(0, { x: 0, z: 0 });
    expect(Math.hypot(p.x, p.z)).toBeLessThan(1e-9);
  });

  it('is arc-length parameterised: 1 m of s is 1 m of track', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    for (const s of [100, 2345.5, 9000, 15000.25, 19999]) {
      route.xzAt(s, a);
      route.xzAt(s + 1, b);
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(1, 4);
    }
  });

  it('has smooth heading and gentle grades', () => {
    let maxGrade = 0;
    let maxCurv = 0;
    for (let s = ROUTE_START; s < ROUTE_END; s += 7) {
      maxGrade = Math.max(maxGrade, Math.abs(route.gradeAt(s)));
      maxCurv = Math.max(maxCurv, Math.abs(route.curvatureAt(s)));
    }
    expect(maxGrade).toBeLessThan(0.02);
    expect(1 / maxCurv).toBeGreaterThan(400);
  });

  it('finds the nearest point on the centreline', () => {
    const f = route.frameAt(5000, makeFrame());
    const x = f.x + f.rx * 7;
    const z = f.z + f.rz * 7;
    const n = route.nearest(x, z, 50);
    expect(n).not.toBeNull();
    expect(n!.s).toBeCloseTo(5000, 1);
    expect(n!.lateral).toBeCloseTo(7, 2);
    expect(route.nearest(f.x + f.rx * 300, f.z + f.rz * 300, 50)).toBeNull();
  });

  it('is deterministic for a seed', () => {
    const again = new Route(42);
    const p1 = route.frameAt(12345, makeFrame());
    const p2 = again.frameAt(12345, makeFrame());
    expect(p2.x).toBe(p1.x);
    expect(p2.y).toBe(p1.y);
    const other = new Route(43).frameAt(12345, makeFrame());
    expect(other.x).not.toBe(p1.x);
  });
});

describe('Terrain', () => {
  it('is flat under the track bed', () => {
    for (const s of [0, 3000, 8000, 16000]) {
      const f = route.frameAt(s, makeFrame());
      expect(terrain.height(f.x, f.z)).toBeCloseTo(f.y, 3);
      expect(terrain.height(f.x + f.rx * 2.5, f.z + f.rz * 2.5)).toBeCloseTo(route.heightAt(s), 1);
    }
  });

  it('produces identical tile data on repeat (determinism hash)', () => {
    const h1 = tileHeights(terrain, 3, -40);
    const h2 = tileHeights(new Terrain(new Route(42)), 3, -40);
    expect(Array.from(h2)).toEqual(Array.from(h1));
    let hash = 0;
    for (const v of h1) hash = hashInts(hash, Math.round(v * 1000));
    expect(hash).toBeTypeOf('number');
  });

  it('places props away from the track', () => {
    const f = route.frameAt(2000, makeFrame());
    const tx = Math.floor(f.x / 128);
    const tz = Math.floor(f.z / 128);
    const props = tileProps(terrain, tx, tz);
    expect(props.length).toBeGreaterThan(10);
    for (const p of props) {
      const n = route.nearest(p.x, p.z, 4);
      expect(n).toBeNull();
    }
  });
});
