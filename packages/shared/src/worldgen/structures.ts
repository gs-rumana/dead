import {
  type ItemKind,
  type LootTable,
  STATION_STOCK,
  type StockLine,
  WAGON_POOL,
} from '../data/items.ts';
import { ROUTE_LENGTH } from '../data/world.ts';
import { Rng, hashInts } from '../math/rng.ts';
import { FLATCAR_DECK, RAIL_TOP } from '../vehicles/consist.ts';
import { biomeWeights } from './biome.ts';
import type { Feature } from './features.ts';
import { type Route, type TrackFrame, makeFrame } from './route.ts';

/**
 * Buildings and stops from a modular kit (§4.4, §4.8). Every structure is a pure
 * function of the seed, so the host and every client agree on walls, doors,
 * containers and where loot lies (§6.6); only dynamic state (open doors, searched
 * drawers, broken boards) is synced.
 */

export type PieceKind =
  | 'floor'
  | 'wall'
  | 'roof'
  | 'gable'
  | 'platform'
  | 'door'
  | 'board'
  | 'counter'
  | 'shelf'
  | 'drawer'
  | 'cabinet'
  | 'safe'
  | 'stove'
  | 'bin'
  | 'tank'
  | 'post'
  | 'lamp'
  | 'fence'
  | 'well'
  | 'wagon'
  | 'ladder'
  | 'sign';

export interface Piece {
  id: number;
  kind: PieceKind;
  /** Centre in structure-local metres (y up from the structure origin). */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Rotation about Y (radians). */
  ry: number;
  /** Blocks movement (has a collider). */
  solid: boolean;
  /** Searchable container loot table. */
  loot?: LootTable;
  /** Door hinge side (+1 = hinge at +x end). */
  hinge?: 1 | -1;
  /** Render hint: palette swatch name. */
  swatch?: string;
}

export interface ItemSpawn {
  kind: ItemKind;
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface Structure {
  id: string;
  kind: 'station' | 'homestead' | 'wagon';
  name: string;
  /** World placement: origin and yaw (three.js yaw of the local -Z axis). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pieces: Piece[];
  spawns: ItemSpawn[];
  shop?: { piece: number; kind: 'station' | 'wagon'; stock: StockLine[] };
  /** Flat ground radius around the origin. */
  pad: number;
  /** Rough radius containing everything (for streaming). */
  radius: number;
  feature?: Feature;
  /** Palette family for walls. */
  wood: string;
}

/** Height of station platforms above the track bed: one short step below the flatcar deck. */
export const PLATFORM_TOP = RAIL_TOP + FLATCAR_DECK - 0.3;

class Kit {
  readonly pieces: Piece[] = [];
  readonly spawns: ItemSpawn[] = [];
  add(
    kind: PieceKind,
    x: number,
    y: number,
    z: number,
    hx: number,
    hy: number,
    hz: number,
    opts: Partial<Piece> = {},
  ): Piece {
    const p: Piece = {
      id: this.pieces.length,
      kind,
      x,
      y,
      z,
      hx,
      hy,
      hz,
      ry: 0,
      solid: true,
      ...opts,
    };
    this.pieces.push(p);
    return p;
  }

  /** A wall from (x0,z0) to (x1,z1) on the floor at height y, with openings along it. */
  wall(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    h: number,
    openings: Array<{
      at: number;
      w: number;
      bottom: number;
      top: number;
      door?: boolean;
      boards?: boolean;
    }>,
    swatch: string,
  ): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    const ry = Math.atan2(-uz, ux);
    const t = 0.1;
    const seg = (a: number, b: number, y0: number, y1: number) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const m = (a + b) / 2;
      this.add('wall', x0 + ux * m, (y0 + y1) / 2, z0 + uz * m, (b - a) / 2, (y1 - y0) / 2, t, {
        ry,
        swatch,
      });
    };
    const sorted = [...openings].sort((a, b) => a.at - b.at);
    let cur = 0;
    for (const o of sorted) {
      const a = o.at - o.w / 2;
      const b = o.at + o.w / 2;
      seg(cur, a, y, y + h);
      seg(a, b, y, y + o.bottom);
      seg(a, b, y + o.top, y + h);
      const m = o.at;
      if (o.door) {
        this.add('door', x0 + ux * m, y + o.top / 2, z0 + uz * m, o.w / 2, o.top / 2, 0.05, {
          ry,
          hinge: 1,
          swatch: 'woodDark',
        });
      } else if (o.boards) {
        this.add(
          'board',
          x0 + ux * m,
          y + (o.bottom + o.top) / 2,
          z0 + uz * m,
          o.w / 2,
          (o.top - o.bottom) / 2,
          0.04,
          { ry, swatch: 'woodGray' },
        );
      }
      cur = b;
    }
    seg(cur, len, y, y + h);
  }

  /** A simple cabin: floor, four walls, door, windows, roof, gable. */
  cabin(
    cx: number,
    cz: number,
    w: number,
    d: number,
    floorY: number,
    opts: { door: 'front' | 'back'; boards: boolean; swatch: string; wallH?: number },
  ): { x0: number; x1: number; z0: number; z1: number; y: number } {
    const h = opts.wallH ?? 3.1;
    const x0 = cx - w / 2;
    const x1 = cx + w / 2;
    const z0 = cz - d / 2;
    const z1 = cz + d / 2;
    // Foundation and floor.
    this.add('floor', cx, floorY - 0.6, cz, w / 2 + 0.1, 0.6, d / 2 + 0.1, { swatch: 'woodDark' });
    const door = { at: d / 2, w: 1.2, bottom: 0, top: 2.2, door: true };
    const win = (at: number) => ({ at, w: 1.0, bottom: 0.9, top: 2.0, boards: opts.boards });
    // Front wall faces -x (toward the track for stations); the door is in it.
    this.wall(
      x0,
      z1,
      x0,
      z0,
      floorY,
      h,
      opts.door === 'front' ? [door, win(d * 0.2), win(d * 0.8)] : [win(d / 2)],
      opts.swatch,
    );
    this.wall(x1, z0, x1, z1, floorY, h, opts.door === 'back' ? [door] : [win(d / 2)], opts.swatch);
    this.wall(x0, z0, x1, z0, floorY, h, [win(w / 2)], opts.swatch);
    this.wall(x1, z1, x0, z1, floorY, h, [win(w / 2)], opts.swatch);
    this.add('roof', cx, floorY + h + 0.08, cz, w / 2 + 0.45, 0.08, d / 2 + 0.45, {
      swatch: 'woodGrayDark',
    });
    this.add('gable', cx, floorY + h + 0.9, cz, w / 2 + 0.45, 0.75, d / 2 + 0.45, {
      solid: false,
      swatch: 'woodGrayDark',
    });
    return { x0, x1, z0, z1, y: floorY };
  }
}

const tf: TrackFrame = makeFrame();

/** Converts a world point to a structure's local frame. */
export function toLocal(
  st: { x: number; z: number; yaw: number },
  wx: number,
  wz: number,
): { x: number; z: number } {
  const dx = wx - st.x;
  const dz = wz - st.z;
  const c = Math.cos(st.yaw);
  const s = Math.sin(st.yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

/** Converts a structure-local point to world. */
export function toWorld(
  st: { x: number; y: number; z: number; yaw: number },
  lx: number,
  ly: number,
  lz: number,
): { x: number; y: number; z: number } {
  const c = Math.cos(st.yaw);
  const s = Math.sin(st.yaw);
  return { x: st.x + c * lx + s * lz, y: st.y + ly, z: st.z - s * lx + c * lz };
}

function woodFor(s: number): string {
  const w: [number, number, number] = [1, 0, 0];
  biomeWeights(s, w);
  if (w[1] > 0.5) return 'woodGray';
  if (w[2] > 0.5) return 'woodDark';
  return 'wood';
}

/**
 * A station (§4.4): a curved platform along the track, a depot with a shop
 * counter, drawers, a cabinet and a safe, a coal bin with sacks, lamps and a
 * water tower. Local frame: origin on the centreline at the stop, -Z along the
 * track, +X toward the station side.
 */
export function buildStation(route: Route, f: Feature, id: string): Structure {
  route.frameAt(f.s, tf);
  const yawTrack = -tf.heading;
  // Local +X points to the station side.
  const side = f.side;
  const yaw = side > 0 ? yawTrack : yawTrack + Math.PI;
  const st = { x: tf.x, y: tf.y, z: tf.z, yaw };
  const k = new Kit();
  const wood = woodFor(f.s);
  const rng = new Rng(hashInts(route.seed, 0x57a7, Math.round(f.s)));
  // Curved platform in 4 m segments following the track.
  const half = 22;
  for (let ds = -half; ds < half; ds += 4) {
    const s0 = f.s + ds;
    route.frameAt(s0 + 2, tf);
    const lat = side * 3.75;
    const wx = tf.x + tf.rx * lat;
    const wz = tf.z + tf.rz * lat;
    const l = toLocal(st, wx, wz);
    const ry = (side > 0 ? -tf.heading : -tf.heading + Math.PI) - yaw;
    const top = tf.y - st.y + PLATFORM_TOP;
    k.add('platform', l.x, top - 0.75, l.z, 2.0, 0.75, 2.02, { ry, swatch: 'woodGray' });
  }
  // Depot: floor at platform height, door facing the track.
  const dx = 9.6;
  const cab = k.cabin(dx, 0, 6.4, 9, PLATFORM_TOP, { door: 'front', boards: false, swatch: wood });
  // A walkway joins the platform and the depot door.
  k.add('platform', 6.2, PLATFORM_TOP - 0.75, 0, 0.75, 0.75, 1.6, { swatch: 'woodGray' });
  // Shop counter across the back half, shelves behind it, the safe in a corner.
  const counter = k.add('counter', cab.x0 + 3.8, PLATFORM_TOP + 0.5, 0, 0.35, 0.5, 2.2, {
    swatch: 'woodDark',
  });
  k.add('shelf', cab.x1 - 0.35, PLATFORM_TOP + 1.1, -1.6, 0.25, 1.1, 1.2, {
    loot: 'shelf',
    swatch: 'wood',
  });
  k.add('shelf', cab.x1 - 0.35, PLATFORM_TOP + 1.1, 1.6, 0.25, 1.1, 1.2, {
    loot: 'shelf',
    swatch: 'wood',
  });
  k.add('safe', cab.x1 - 0.55, PLATFORM_TOP + 0.5, cab.z1 - 0.55, 0.45, 0.5, 0.45, {
    loot: 'safe',
    swatch: 'ironLight',
  });
  k.add('drawer', cab.x0 + 0.5, PLATFORM_TOP + 0.45, cab.z0 + 1.0, 0.4, 0.45, 0.7, {
    loot: 'drawer',
    swatch: 'woodDark',
  });
  k.add('cabinet', cab.x0 + 0.45, PLATFORM_TOP + 0.9, cab.z1 - 0.9, 0.35, 0.9, 0.6, {
    loot: 'cabinet',
    swatch: 'wood',
  });
  k.add('stove', cab.x0 + 2.2, PLATFORM_TOP + 0.5, cab.z0 + 0.6, 0.4, 0.5, 0.4, { swatch: 'iron' });
  // Loose furniture to burn.
  k.spawns.push({ kind: 'chair', x: cab.x0 + 1.4, y: PLATFORM_TOP, z: cab.z1 - 2.2, ry: 0.4 });
  k.spawns.push({ kind: 'table', x: cab.x0 + 1.6, y: PLATFORM_TOP, z: cab.z1 - 3.4, ry: 0 });
  if (rng.chance(0.6))
    k.spawns.push({ kind: 'chair', x: cab.x0 + 2.1, y: PLATFORM_TOP, z: cab.z1 - 4.0, ry: 2.2 });
  // Coal bin on the platform with a few sacks.
  k.add('bin', 4.6, PLATFORM_TOP + 0.35, -half + 6, 0.9, 0.35, 1.4, {
    swatch: 'woodDark',
    solid: true,
  });
  const sacks = 2 + rng.int(0, 2);
  for (let i = 0; i < sacks; i++)
    k.spawns.push({
      kind: 'coal',
      x: 3.4,
      y: PLATFORM_TOP,
      z: -half + 4.6 + i * 1.0,
      ry: rng.range(-0.3, 0.3),
    });
  if (rng.chance(0.5))
    k.spawns.push({ kind: 'crate', x: 4.4, y: PLATFORM_TOP, z: half - 5, ry: rng.range(0, 1) });
  if (rng.chance(0.5))
    k.spawns.push({ kind: 'barrel', x: 5.0, y: PLATFORM_TOP, z: half - 7, ry: 0 });
  // Lamps and the station sign.
  for (const z of [-12, 12])
    k.add('lamp', 5.4, PLATFORM_TOP + 1.6, z, 0.06, 1.6, 0.06, { solid: true, swatch: 'iron' });
  k.add('sign', 5.6, PLATFORM_TOP + 2.0, 0, 0.06, 0.45, 1.6, { solid: false, swatch: 'white' });
  // Water tower off the platform end, with a ladder.
  const tz = half + 8;
  for (const [px, pz] of [
    [6, tz - 1.4],
    [8.8, tz - 1.4],
    [6, tz + 1.4],
    [8.8, tz + 1.4],
  ] as const) {
    k.add('post', px, 2.7, pz, 0.15, 2.7, 0.15, { swatch: 'woodDark' });
  }
  k.add('tank', 7.4, 6.6, tz, 1.9, 1.3, 1.9, { swatch: 'woodDark' });
  k.add('ladder', 5.75, 3.0, tz, 0.15, 3.0, 0.35, { solid: false, swatch: 'iron' });
  return {
    id,
    kind: 'station',
    name: f.name,
    ...st,
    pieces: k.pieces,
    spawns: k.spawns,
    shop: { piece: counter.id, kind: 'station', stock: STATION_STOCK },
    pad: 18,
    radius: 34,
    feature: f,
    wood,
  };
}

/** A homestead off the line: cabin with loot and furniture, fence, well (§4.8). */
export function buildHomestead(
  route: Route,
  seed: number,
  idx: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  s: number,
): Structure {
  const rng = new Rng(hashInts(seed, 0x40e5, idx));
  const k = new Kit();
  const wood = woodFor(s);
  const cab = k.cabin(0, 0, 6 + rng.int(0, 2), 7 + rng.int(0, 2), 0.35, {
    door: rng.chance(0.5) ? 'front' : 'back',
    boards: rng.chance(0.4),
    swatch: wood,
  });
  k.add('drawer', cab.x0 + 0.5, 0.35 + 0.45, cab.z0 + 0.8, 0.4, 0.45, 0.6, {
    loot: 'drawer',
    swatch: 'woodDark',
  });
  k.add('cabinet', cab.x1 - 0.45, 0.35 + 0.9, cab.z1 - 0.8, 0.35, 0.9, 0.6, {
    loot: 'cabinet',
    swatch: 'wood',
  });
  k.add('stove', cab.x1 - 0.6, 0.35 + 0.5, cab.z0 + 0.6, 0.4, 0.5, 0.4, { swatch: 'iron' });
  if (rng.chance(0.25))
    k.add('safe', cab.x1 - 0.5, 0.35 + 0.5, 0, 0.45, 0.5, 0.45, {
      loot: 'safe',
      swatch: 'ironLight',
    });
  const furniture: ItemKind[] = ['chair', 'chair', 'table', 'cabinet', 'crate'];
  const n = 2 + rng.int(0, 2);
  for (let i = 0; i < n; i++) {
    k.spawns.push({
      kind: rng.pick(furniture),
      x: rng.range(cab.x0 + 1.2, cab.x1 - 1.2),
      y: 0.35,
      z: rng.range(cab.z0 + 1.2, cab.z1 - 1.2),
      ry: rng.range(0, 6.28),
    });
  }
  // Yard: a well, a few barrels and crates, lumber, a fence line.
  k.add('well', cab.x1 + 4, 0.45, cab.z0 - 2, 0.7, 0.45, 0.7, { swatch: 'rock' });
  for (let i = 0; i < 2 + rng.int(0, 2); i++) {
    k.spawns.push({
      kind: rng.pick<ItemKind>(['barrel', 'crate', 'lumber', 'barrel']),
      x: cab.x0 - 2 - rng.range(0, 3),
      y: 0,
      z: rng.range(-4, 4),
      ry: rng.range(0, 6.28),
    });
  }
  for (let i = 0; i < 5; i++)
    k.add('fence', cab.x1 + 7, 0.55, -8 + i * 4, 0.06, 0.55, 2, { swatch: 'woodGray' });
  if (rng.chance(0.15))
    k.spawns.push({ kind: 'strongbox', x: cab.x1 - 1.2, y: 0.35, z: cab.z1 - 1.4, ry: 0 });
  return {
    id: `h${idx}`,
    kind: 'homestead',
    name: 'Homestead',
    x,
    y,
    z,
    yaw,
    pieces: k.pieces,
    spawns: k.spawns,
    pad: 14,
    radius: 24,
    wood,
  };
}

/** The merchant's wagon beside the line (§4.4: random main-line stops). */
export function buildWagon(route: Route, seed: number, idx: number, s: number): Structure {
  route.frameAt(s, tf);
  const side = hashInts(seed, 0x3a9, idx) & 1 ? 1 : -1;
  const yaw = side > 0 ? -tf.heading : -tf.heading + Math.PI;
  const k = new Kit();
  const wagon = k.add('wagon', 6.5, 1.0, 0, 1.0, 1.0, 2.2, { swatch: 'wood' });
  const rng = new Rng(hashInts(seed, 0x3aa, idx));
  const pool = [...WAGON_POOL];
  const stock: StockLine[] = [];
  for (let i = 0; i < 5 && pool.length; i++)
    stock.push(pool.splice(rng.int(0, pool.length - 1), 1)[0] as StockLine);
  return {
    id: `w${idx}`,
    kind: 'wagon',
    name: 'Merchant wagon',
    x: tf.x,
    y: tf.y,
    z: tf.z,
    yaw,
    pieces: k.pieces,
    spawns: [],
    shop: { piece: wagon.id, kind: 'wagon', stock },
    pad: 0,
    radius: 12,
    wood: 'wood',
  };
}

/** Flat ground under a structure. */
export interface Pad {
  x: number;
  z: number;
  y: number;
  r: number;
}

export interface StructurePlan {
  /** Stations, homesteads and wagons with world placement but no terrain-dependent pieces yet. */
  homesteadSpots: Array<{ idx: number; x: number; z: number; yaw: number; s: number }>;
  wagonS: number[];
}

/** Where homesteads and wagons go (pure function of the seed and route). */
export function planStructures(route: Route, features: Feature[]): StructurePlan {
  const seed = route.seed;
  const rng = new Rng(hashInts(seed, 0x9a17));
  const homesteadSpots: StructurePlan['homesteadSpots'] = [];
  let s = 700;
  let idx = 0;
  while (s < ROUTE_LENGTH - 400) {
    const clear = features.every(
      (f) => f.kind === 'station' || f.kind === 'start' || Math.abs(f.s - s) > 300,
    );
    if (clear) {
      route.frameAt(s, tf);
      const side = rng.chance(0.5) ? 1 : -1;
      const lat = side * rng.range(38, 95);
      const along = rng.range(-20, 20);
      const x = tf.x + tf.rx * lat + Math.sin(tf.heading) * along;
      const z = tf.z + tf.rz * lat - Math.cos(tf.heading) * along;
      // Cabin front faces the track.
      const yaw = Math.atan2(-(tf.x - x), -(tf.z - z)) + Math.PI / 2;
      homesteadSpots.push({ idx: idx++, x, z, yaw, s });
    }
    s += rng.range(900, 1900);
  }
  const wagonS: number[] = [];
  let ws = 1800 + rng.range(0, 1500);
  while (ws < ROUTE_LENGTH - 600) {
    if (features.every((f) => Math.abs(f.s - ws) > 220)) wagonS.push(ws);
    ws += rng.range(2600, 4200);
  }
  return { homesteadSpots, wagonS };
}
