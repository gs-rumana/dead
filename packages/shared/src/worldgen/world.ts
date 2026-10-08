import { type Feature, routeFeatures } from './features.ts';
import { Route } from './route.ts';
import {
  type Structure,
  buildHomestead,
  buildStation,
  buildWagon,
  planStructures,
  toWorld,
} from './structures.ts';
import { Terrain } from './terrain.ts';
import { TILE_SIZE, tileKey } from './tiles.ts';

/**
 * Everything static about a run, generated from the seed (§6.6): the route, the
 * terrain, the stops and every building. Built identically by the host and each
 * client.
 */
export class World {
  readonly route: Route;
  readonly terrain: Terrain;
  readonly features: Feature[];
  readonly structures: Structure[] = [];
  private readonly byTile = new Map<string, Structure[]>();
  private readonly byId = new Map<string, Structure>();

  constructor(readonly seed: number) {
    this.route = new Route(seed);
    this.terrain = new Terrain(this.route);
    this.features = routeFeatures(seed);
    let n = 0;
    for (const f of this.features) {
      if (f.kind === 'station' || f.kind === 'start')
        this.structures.push(buildStation(this.route, f, `s${n++}`));
    }
    const plan = planStructures(this.route, this.features);
    for (const h of plan.homesteadSpots) {
      const y = this.terrain.natural(h.x, h.z, h.s);
      this.structures.push(buildHomestead(this.route, seed, h.idx, h.x, y, h.z, h.yaw, h.s));
    }
    plan.wagonS.forEach((s, i) => this.structures.push(buildWagon(this.route, seed, i, s)));
    this.terrain.setPads(
      this.structures
        .filter((s) => s.pad > 0)
        .map((s) => {
          // Stations flatten around the depot, not the track.
          const c = s.kind === 'station' ? toWorld(s, 9, 0, 0) : { x: s.x, y: s.y, z: s.z };
          return { x: c.x, z: c.z, y: s.y, r: s.pad };
        }),
    );
    for (const s of this.structures) {
      this.byId.set(s.id, s);
      const tx = Math.floor(s.x / TILE_SIZE);
      const tz = Math.floor(s.z / TILE_SIZE);
      const key = tileKey(tx, tz);
      let list = this.byTile.get(key);
      if (!list) this.byTile.set(key, (list = []));
      list.push(s);
    }
  }

  structure(id: string): Structure | undefined {
    return this.byId.get(id);
  }

  /** Structures whose origin lies in a tile (colliders load with the tile). */
  structuresInTile(tx: number, tz: number): Structure[] {
    return this.byTile.get(tileKey(tx, tz)) ?? [];
  }

  structuresNear(x: number, z: number, r: number): Structure[] {
    const out: Structure[] = [];
    const t0x = Math.floor((x - r - 64) / TILE_SIZE);
    const t1x = Math.floor((x + r + 64) / TILE_SIZE);
    const t0z = Math.floor((z - r - 64) / TILE_SIZE);
    const t1z = Math.floor((z + r + 64) / TILE_SIZE);
    for (let tz = t0z; tz <= t1z; tz++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        for (const s of this.structuresInTile(tx, tz)) {
          if (Math.hypot(s.x - x, s.z - z) < r + s.radius) out.push(s);
        }
      }
    }
    return out;
  }
}
