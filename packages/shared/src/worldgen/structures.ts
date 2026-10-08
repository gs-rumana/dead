import {
  type ItemKind,
  type LootTable,
  STATION_STOCK,
  type ShopKind,
  type StockLine,
  TOWN_STOCK,
  WAGON_POOL,
} from '../data/items.ts';
import { ROUTE_LENGTH } from '../data/world.ts';
import { Rng, hashInts } from '../math/rng.ts';
import { FLATCAR_DECK, RAIL_TOP } from '../vehicles/consist.ts';
import { biomeWeights } from './biome.ts';
import type { Feature } from './features.ts';
import { type Route, type SpurSpec, type TrackFrame, makeFrame } from './route.ts';

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
  | 'sign'
  | 'fire'
  | 'tent'
  | 'palisade'
  | 'tower'
  | 'gate'
  | 'lever'
  | 'brazier'
  | 'rockwall';

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

/** A landmark raid's puzzle (§4.6): what opens the boss's door. */
export interface LandmarkSpec {
  kind: 'ranch' | 'mine' | 'chateau';
  /** The locked door (a 'gate' piece). */
  gate: number;
  /** Levers to pull or braziers to light (all of them open the gate). */
  triggers: number[];
  /** The container hiding the cellar key (ranch). */
  keyPiece: number;
  boss: 'rancher' | 'voss' | 'countess';
  /** Boss spawn point (structure-local). */
  bossX: number;
  bossZ: number;
}

export interface Structure {
  id: string;
  kind: 'station' | 'homestead' | 'wagon' | 'town' | 'camp' | 'fort' | 'landmark';
  name: string;
  /** World placement: origin and yaw (three.js yaw of the local -Z axis). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  pieces: Piece[];
  spawns: ItemSpawn[];
  shop?: { piece: number; kind: ShopKind; stock: StockLine[] };
  /** Town index for town buildings. */
  town?: number;
  landmark?: LandmarkSpec;
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

  /** A false-front western storefront: tall facade, porch with posts, sign board. */
  storefront(
    cx: number,
    cz: number,
    w: number,
    d: number,
    floorY: number,
    swatch: string,
    sign: string,
  ): { x0: number; x1: number; z0: number; z1: number; y: number } {
    const cab = this.cabin(cx, cz, w, d, floorY, { door: 'front', boards: false, swatch });
    // Facade rising above the roof line, on the front (-x) wall.
    this.add('wall', cab.x0 - 0.12, floorY + 3.1 + 0.9, cz, 0.06, 0.9, w * 0 + d / 2 + 0.4, {
      swatch,
      solid: false,
    });
    this.add('sign', cab.x0 - 0.2, floorY + 3.6, cz, 0.04, 0.35, Math.min(d / 2 - 0.3, 2.2), {
      solid: false,
      swatch: sign,
    });
    // Porch deck and posts.
    this.add('platform', cab.x0 - 1.1, floorY - 0.6, cz, 1.0, 0.6, d / 2 + 0.3, {
      swatch: 'woodGray',
    });
    for (const z of [cz - d / 2 - 0.2, cz + d / 2 + 0.2])
      this.add('post', cab.x0 - 2.0, floorY + 1.4, z, 0.08, 1.4, 0.08, { swatch: 'woodDark' });
    this.add('roof', cab.x0 - 1.1, floorY + 2.85, cz, 1.05, 0.05, d / 2 + 0.35, {
      swatch: 'woodGrayDark',
      solid: false,
    });
    return cab;
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

  /** A stone room on the ground with a locked iron gate in its front (-x) wall. Returns the gate. */
  vault(cx: number, cz: number, hw: number, hd: number, h: number, swatch: string): number {
    const x0 = cx - hw;
    const x1 = cx + hw;
    const z0 = cz - hd;
    const z1 = cz + hd;
    this.wall(x0, z1, x0, z0, 0, h, [{ at: hd, w: 1.4, bottom: 0, top: 2.3 }], swatch);
    this.wall(x1, z0, x1, z1, 0, h, [], swatch);
    this.wall(x0, z0, x1, z0, 0, h, [], swatch);
    this.wall(x1, z1, x0, z1, 0, h, [], swatch);
    this.add('roof', cx, h + 0.12, cz, hw + 0.3, 0.12, hd + 0.3, { swatch: 'rockDark' });
    return this.add('gate', x0, 1.15, cz, 0.7, 1.15, 0.06, { ry: Math.PI / 2, swatch: 'iron' }).id;
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

// ---------------------------------------------------------------------------
// Towns (§4.4): reached by handcar along a spur; full shops and lots of loot.
// ---------------------------------------------------------------------------

type TownRole =
  'gunsmith' | 'doctor' | 'general' | 'trading' | 'sheriff' | 'saloon' | 'house' | 'church';

const SIGN: Record<TownRole, string> = {
  gunsmith: 'iron',
  doctor: 'white',
  general: 'signYellow',
  trading: 'brass',
  sheriff: 'signRed',
  saloon: 'locoRed',
  house: 'woodGray',
  church: 'white',
};

/**
 * Buildings for the town at the end of a spur. The street runs on from where the
 * spur ends; storefronts face it from both sides. Each building is its own
 * structure so shops, loot and colliders stream independently.
 */
export function buildTown(spur: Route, townIndex: number, name: string): Structure[] {
  const seed = spur.seed;
  const rng = new Rng(hashInts(seed, 0x70a1, townIndex));
  spur.frameAt(spur.end, tf);
  const ex = tf.x;
  const ey = tf.y;
  const ez = tf.z;
  const h = tf.heading;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const wood = woodFor(spur.spur ? 0 : 0);
  void wood;
  const roles: TownRole[] = ['gunsmith', 'doctor', 'general', 'trading', 'sheriff', 'saloon'];
  const extra: TownRole[] = ['house', 'house', 'house', 'church', 'house', 'house'];
  const left = [] as TownRole[];
  const right = [] as TownRole[];
  const all = [...roles, ...extra.slice(0, 4 + rng.int(0, 2))];
  // Shuffle while keeping the shops near the station end.
  for (let i = 0; i < all.length; i++) (i % 2 ? right : left).push(all[i] as TownRole);
  const out: Structure[] = [];
  const street0 = 22;
  const spacing = 13;
  let n = 0;
  for (const [sideSign, list] of [
    [-1, left],
    [1, right],
  ] as const) {
    list.forEach((role, i) => {
      const along = street0 + i * spacing + (sideSign > 0 ? 4 : 0);
      const lat = sideSign * 11;
      const cx = ex + fx * along + rx * lat;
      const cz = ez + fz * along + rz * lat;
      // Local -x faces the street.
      const yaw = Math.atan2(sideSign * rx, sideSign * rz) + Math.PI / 2;
      out.push(buildTownBuilding(seed, townIndex, n++, role, cx, ey, cz, yaw, name, rng));
    });
  }
  // A small handcar platform where the spur ends.
  const k = new Kit();
  k.add('platform', 0, 0.45, 0, 2.2, 0.45, 5, { swatch: 'woodGray' });
  k.add('lamp', 2.0, 0.9 + 1.6, 3.5, 0.06, 1.6, 0.06, { swatch: 'iron' });
  k.add('sign', 2.1, 2.1, 0, 0.06, 0.45, 1.4, { solid: false, swatch: 'white' });
  out.push({
    id: `t${townIndex}p`,
    kind: 'town',
    name,
    x: ex + rx * 3.8,
    y: ey,
    z: ez + rz * 3.8,
    yaw: -h + Math.PI / 2,
    pieces: k.pieces,
    spawns: [],
    pad: 0,
    radius: 8,
    wood: 'wood',
    town: townIndex,
  });
  return out;
}

function buildTownBuilding(
  seed: number,
  town: number,
  n: number,
  role: TownRole,
  x: number,
  y: number,
  z: number,
  yaw: number,
  name: string,
  rng: Rng,
): Structure {
  const k = new Kit();
  const swatch = rng.pick(['wood', 'woodGray', 'woodLight', 'locoRedDark', 'woodDark']);
  const w = role === 'saloon' || role === 'trading' ? 9 : role === 'house' ? 6.5 : 7.5;
  const d = role === 'saloon' ? 11 : role === 'church' ? 12 : 8;
  const floor = 0.6;
  const cab =
    role === 'house' || role === 'church'
      ? k.cabin(0, 0, w, d, floor, { door: 'front', boards: rng.chance(0.5), swatch })
      : k.storefront(0, 0, w, d, floor, swatch, SIGN[role]);
  let shop: Structure['shop'] | undefined;
  const counter = () =>
    k.add('counter', cab.x0 + w * 0.55, floor + 0.5, 0, 0.35, 0.5, d * 0.3, { swatch: 'woodDark' });
  switch (role) {
    case 'gunsmith':
    case 'doctor':
    case 'general':
    case 'trading':
    case 'sheriff': {
      const c = counter();
      shop = { piece: c.id, kind: role, stock: TOWN_STOCK[role] };
      k.add('shelf', cab.x1 - 0.35, floor + 1.1, -d * 0.22, 0.25, 1.1, d * 0.15, {
        loot: 'shelf',
        swatch: 'wood',
      });
      if (role === 'sheriff') {
        k.add('cabinet', cab.x1 - 0.45, floor + 0.9, d * 0.3, 0.35, 0.9, 0.6, {
          loot: 'cabinet',
          swatch: 'iron',
        });
        // Jail bars at the back.
        for (let i = 0; i < 6; i++)
          k.add('post', cab.x1 - 2.4, floor + 1.2, -d / 2 + 0.6 + i * 0.35, 0.03, 1.2, 0.03, {
            swatch: 'iron',
          });
      }
      if (role === 'trading')
        k.add('safe', cab.x1 - 0.55, floor + 0.5, d / 2 - 0.6, 0.45, 0.5, 0.45, {
          loot: 'safe',
          swatch: 'ironLight',
        });
      break;
    }
    case 'saloon': {
      k.add('counter', cab.x1 - 1.4, floor + 0.55, 0, 0.4, 0.55, d * 0.35, { swatch: 'woodDark' });
      k.add('shelf', cab.x1 - 0.35, floor + 1.1, 0, 0.25, 1.1, d * 0.3, {
        loot: 'saloon',
        swatch: 'wood',
      });
      k.add('drawer', cab.x1 - 1.4, floor + 0.4, -d * 0.4, 0.35, 0.4, 0.5, {
        loot: 'saloon',
        swatch: 'woodDark',
      });
      for (let i = 0; i < 3; i++) {
        k.spawns.push({
          kind: 'table',
          x: cab.x0 + 2 + (i % 2) * 2.5,
          y: floor,
          z: -d / 3 + i * (d / 3),
          ry: rng.range(0, 3),
        });
        k.spawns.push({
          kind: 'chair',
          x: cab.x0 + 1.4 + (i % 2) * 2.5,
          y: floor,
          z: -d / 3 + i * (d / 3) + 0.9,
          ry: rng.range(0, 6),
        });
      }
      break;
    }
    case 'house':
      k.add('drawer', cab.x0 + 0.5, floor + 0.45, cab.z0 + 0.8, 0.4, 0.45, 0.6, {
        loot: 'drawer',
        swatch: 'woodDark',
      });
      k.add('cabinet', cab.x1 - 0.45, floor + 0.9, cab.z1 - 0.8, 0.35, 0.9, 0.6, {
        loot: 'cabinet',
        swatch: 'wood',
      });
      if (rng.chance(0.3))
        k.add('safe', cab.x1 - 0.5, floor + 0.5, 0, 0.45, 0.5, 0.45, {
          loot: 'safe',
          swatch: 'ironLight',
        });
      for (let i = 0; i < 2; i++)
        k.spawns.push({
          kind: rng.pick<ItemKind>(['chair', 'table', 'cabinet', 'crate']),
          x: rng.range(cab.x0 + 1.4, cab.x1 - 1.4),
          y: floor,
          z: rng.range(cab.z0 + 1.2, cab.z1 - 1.2),
          ry: rng.range(0, 6),
        });
      break;
    case 'church':
      for (let i = 0; i < 4; i++)
        k.spawns.push({
          kind: 'chair',
          x: cab.x0 + 2 + i * 1.2,
          y: floor,
          z: rng.range(-2, 2),
          ry: Math.PI / 2,
        });
      k.add('post', cab.x1 - 1, floor + 4.6, 0, 0.12, 1.4, 0.12, { swatch: 'white', solid: false });
      k.add('post', cab.x1 - 1, floor + 5.3, 0, 0.12, 0.12, 0.6, { swatch: 'white', solid: false });
      break;
  }
  if (rng.chance(0.4))
    k.spawns.push({
      kind: rng.pick<ItemKind>(['barrel', 'crate', 'lumber']),
      x: cab.x0 - 1.6,
      y: floor,
      z: rng.range(-d / 2, d / 2),
      ry: rng.range(0, 6),
    });
  if (role === 'general' && rng.chance(0.6))
    k.spawns.push({ kind: 'trolley_kit', x: cab.x0 - 3.2, y: 0, z: d / 2 + 1.5, ry: 0 });
  const label =
    role === 'house'
      ? 'House'
      : role === 'church'
        ? 'Church'
        : `${name} ${role === 'trading' ? 'trading post' : role === 'general' ? 'general store' : role}`;
  return {
    id: `t${town}b${n}`,
    kind: 'town',
    name: label,
    x,
    y,
    z,
    yaw,
    pieces: k.pieces,
    spawns: k.spawns,
    ...(shop ? { shop } : {}),
    pad: 9,
    radius: 14,
    wood: swatch,
    town,
  };
}

/** The spur line for a junction (§4.4): a siding that curves away to a town 300–800 m off. */
export function spurSpec(main: Route, f: Feature, index: number): SpurSpec {
  const rng = new Rng(hashInts(main.seed, 0x5b0, index));
  main.frameAt(f.s, tf);
  const side = f.side;
  const lat = side * 4.6;
  const length = Math.round(rng.range(320, 650));
  const pieces: SpurSpec['pieces'] = [];
  let used = 0;
  const push = (len: number, k0: number, k1: number) => {
    pieces.push({ len, k0, k1 });
    used += len;
  };
  // The siding where the handcar waits, then a turnout curving away.
  push(45, 0, 0);
  const k = side / 170;
  push(50, 0, k);
  push(90, k, k);
  push(50, k, 0);
  // Gentle meanders that never swing back toward the main line.
  let dir = 1;
  while (used < length - 80) {
    const r = rng.range(520, 900);
    const len = Math.min(rng.range(60, 130), length - 80 - used);
    if (len < 20) break;
    push(len / 3, 0, (side * dir) / r);
    push(len / 3, (side * dir) / r, (side * dir) / r);
    push(len / 3, (side * dir) / r, 0);
    dir = -dir;
  }
  push(Math.max(20, length - used), 0, 0);
  const total = pieces.reduce((a, p) => a + p.len, 0);
  return {
    index,
    length: total,
    x0: tf.x + tf.rx * lat,
    z0: tf.z + tf.rz * lat,
    h0: tf.heading,
    y0: main.heightAt(f.s),
    pieces,
  };
}

/** An outlaw camp beside the line (§4.6): a fire, tents, loot, and guards by day. */
export function buildCamp(route: Route, seed: number, idx: number, s: number): Structure {
  const rng = new Rng(hashInts(seed, 0xca4, idx));
  route.frameAt(s, tf);
  const side = rng.chance(0.5) ? 1 : -1;
  const lat = side * rng.range(42, 70);
  const x = tf.x + tf.rx * lat;
  const z = tf.z + tf.rz * lat;
  const k = new Kit();
  k.add('fire', 0, 0.15, 0, 0.6, 0.15, 0.6, { solid: false, swatch: 'rock' });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng.range(-0.3, 0.3);
    k.add('tent', Math.cos(a) * 6, 1.0, Math.sin(a) * 6, 1.3, 1.0, 1.6, {
      ry: -a,
      swatch: 'shirt',
    });
  }
  k.spawns.push({ kind: 'crate', x: 2.5, y: 0, z: -2, ry: 0.3 });
  k.spawns.push({ kind: rng.chance(0.5) ? 'strongbox' : 'barrel', x: -2.6, y: 0, z: 2.2, ry: 1.2 });
  k.spawns.push({ kind: 'lumber', x: 1.5, y: 0, z: 2.8, ry: 0.4 });
  return {
    id: `c${idx}`,
    kind: 'camp',
    name: 'Outlaw camp',
    x,
    y: 0,
    z,
    yaw: 0,
    pieces: k.pieces,
    spawns: k.spawns,
    pad: 12,
    radius: 14,
    wood: 'wood',
  };
}

/** Camp positions: a couple per biome, away from other stops. */
export function planCamps(route: Route, features: Feature[]): number[] {
  const rng = new Rng(hashInts(route.seed, 0xca5));
  const out: number[] = [];
  let s = 1600 + rng.range(0, 800);
  while (s < ROUTE_LENGTH - 800) {
    if (features.every((f) => Math.abs(f.s - s) > 350)) out.push(s);
    s += rng.range(2800, 4200);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Forts (§4.4): Fort Ironwood (km 40) and Fort Haven (km 80) on the main line.
// ---------------------------------------------------------------------------

export const FORT_HALF_LENGTH = 38;
export const FORT_HALF_WIDTH = 26;

/**
 * A palisade compound the track runs through. Gates sit where the track crosses
 * the end walls. Inside: stores along one side. Fort Haven's far gate is closed
 * and opens with a winch (the finale).
 */
export function buildFort(route: Route, f: Feature, fortIndex: number): Structure[] {
  route.frameAt(f.s, tf);
  const yaw = -tf.heading;
  const st = { x: tf.x, y: tf.y, z: tf.z, yaw };
  const k = new Kit();
  const H = 4.2;
  const L = FORT_HALF_LENGTH;
  const W = FORT_HALF_WIDTH;
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(-(z1 - z0), x1 - x0);
    k.add('palisade', (x0 + x1) / 2, H / 2 - 1.5, (z0 + z1) / 2, len / 2, H / 2 + 1.5, 0.25, {
      ry,
      swatch: 'woodDark',
    });
  };
  // Side walls (parallel to the track).
  wall(-W, -L, -W, L);
  wall(W, -L, W, L);
  // End walls with a 6 m gap for the track (local -z is the direction of travel).
  for (const z of [-L, L]) {
    wall(-W, z, -3.2, z);
    wall(3.2, z, W, z);
  }
  // Corner towers.
  for (const [x, z] of [[-W, -L], [W, -L], [-W, L], [W, L]] as const) {
    k.add('tower', x, 3.4 - 1.5, z, 1.6, 3.4 + 1.5, 1.6, { swatch: 'woodGrayDark' });
  }
  const haven = fortIndex === 1;
  let gate = -1;
  let lever = -1;
  if (haven) {
    // The far gate is shut across the track; a winch house beside it opens it.
    gate = k.add('gate', 0, H / 2, -L, 3.2, H / 2, 0.3, { swatch: 'iron' }).id;
    lever = k.add('lever', 5.5, 1.1, -L + 3, 0.4, 1.1, 0.4, { swatch: 'iron', solid: true }).id;
  }
  // Platforms on both sides of the track for unloading.
  for (const side of [-1, 1]) k.add('platform', side * 4.5, PLATFORM_TOP - 0.75, 0, 1.6, 0.75, 22, { swatch: 'woodGray' });
  const out: Structure[] = [];
  const name = f.name;
  out.push({
    id: `f${fortIndex}`,
    kind: 'fort',
    name,
    ...st,
    pieces: k.pieces,
    spawns: [],
    pad: 0,
    radius: L + 6,
    wood: 'woodDark',
    feature: f,
    ...(haven ? { gatePiece: gate, leverPiece: lever } : {}),
  } as Structure);
  // Stores along the right side inside the walls.
  const rng = new Rng(hashInts(route.seed, 0xf047, fortIndex));
  const roles = ['gunsmith', 'doctor', 'general', 'trading'] as const;
  roles.forEach((role, i) => {
    const lx = W - 9;
    const lz = -L + 12 + i * 17;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const x = st.x + c * lx + sn * lz;
    const z = st.z - sn * lx + c * lz;
    // Face the track (local -x).
    const b = buildTownBuilding(route.seed, 100 + fortIndex, i, role, x, st.y, z, yaw, name, rng);
    b.id = `f${fortIndex}b${i}`;
    b.kind = 'fort';
    out.push(b);
  });
  return out;
}

/** Fort Haven's gate and winch pieces (set by buildFort). */
export function fortGate(st: Structure): { gate: number; lever: number } | null {
  const s = st as Structure & { gatePiece?: number; leverPiece?: number };
  return s.gatePiece !== undefined && s.gatePiece >= 0 ? { gate: s.gatePiece, lever: s.leverPiece ?? -1 } : null;
}


// ---------------------------------------------------------------------------
// Landmarks (§4.6): a raid with a puzzle and a boss, one per biome.
// ---------------------------------------------------------------------------

/** Builds the landmark beside the line for feature f (index 0 ranch, 1 mine, 2 chateau). */
export function buildLandmark(
  route: Route,
  f: Feature,
  index: number,
  groundY: (x: number, z: number) => number,
): Structure {
  route.frameAt(f.s, tf);
  const side = f.side;
  const lat = side * 64;
  const x = tf.x + tf.rx * lat;
  const z = tf.z + tf.rz * lat;
  // Local -x faces the track.
  const yaw = Math.atan2(-(tf.x - x), -(tf.z - z)) + Math.PI / 2;
  const k = new Kit();
  const rng = new Rng(hashInts(route.seed, 0x1a4d, index));
  let spec: LandmarkSpec;
  if (index === 0) {
    // Grayson Ranch: the manor hides the cellar key; the Rancher waits below.
    const house = k.cabin(0, -5, 11, 14, 0.35, {
      door: 'front',
      boards: true,
      swatch: 'woodLight',
      wallH: 3.4,
    });
    const containers = [
      k.add('drawer', house.x0 + 0.5, 0.8, house.z0 + 1.0, 0.4, 0.45, 0.7, { loot: 'drawer', swatch: 'woodDark' }),
      k.add('cabinet', house.x1 - 0.45, 1.25, house.z1 - 1.0, 0.35, 0.9, 0.6, { loot: 'cabinet', swatch: 'wood' }),
      k.add('drawer', house.x1 - 0.5, 0.8, house.z0 + 1.2, 0.4, 0.45, 0.7, { loot: 'drawer', swatch: 'woodDark' }),
      k.add('cabinet', house.x1 - 0.45, 1.25, -5, 0.35, 0.9, 0.6, { loot: 'cabinet', swatch: 'wood' }),
      k.add('shelf', 0, 1.45, house.z0 + 0.35, 1.2, 1.1, 0.25, { loot: 'shelf', swatch: 'wood' }),
    ].map((p) => p.id);
    for (let i = 0; i < 4; i++)
      k.spawns.push({
        kind: rng.pick<ItemKind>(['chair', 'table', 'cabinet']),
        x: rng.range(-3, 3),
        y: 0.5,
        z: rng.range(-10, 0),
        ry: rng.range(0, 6),
      });
    // A red barn and a fenced yard.
    k.cabin(1, -21, 9, 7, 0.2, { door: 'front', boards: false, swatch: 'locoRed', wallH: 3.6 });
    for (let i = 0; i < 6; i++)
      k.add('fence', -10, 0.55, -24 + i * 4.8, 0.06, 0.55, 2.4, { swatch: 'woodGray' });
    k.add('well', -5, 0.5, 8, 0.7, 0.5, 0.7, { swatch: 'rock' });
    // The cellar: a stone outbuilding with a locked iron door.
    const gate = k.vault(8, 10, 2.6, 2.6, 2.6, 'rock');
    for (let i = 0; i < 3; i++)
      k.spawns.push({ kind: 'gold_bar', x: 9 + rng.range(-1.2, 1.2), y: 0.1, z: 10 + rng.range(-1.2, 1.2), ry: 0 });
    k.spawns.push({ kind: 'strongbox', x: 9.4, y: 0, z: 11.4, ry: 0.5 });
    k.spawns.push({ kind: 'bond', x: 7.2, y: 0.1, z: 8.6, ry: 0 });
    spec = {
      kind: 'ranch',
      gate,
      triggers: [],
      keyPiece: containers[rng.int(0, containers.length - 1)]!,
      boss: 'rancher',
      bossX: 1,
      bossZ: 10,
    };
  } else if (index === 1) {
    // Copperhead Mine and Lab: three levers restore power to the vault.
    k.add('rockwall', 18, 4.5, 0, 6, 5.5, 18, { swatch: 'rockRed' });
    const gate = k.vault(10, 0, 2.5, 2.2, 2.8, 'rockRedDark');
    // Timber frame around the adit.
    for (const zz of [-1.1, 1.1])
      k.add('post', 7.3, 1.3, zz, 0.14, 1.3, 0.14, { swatch: 'woodDark', solid: false });
    k.add('post', 7.3, 2.65, 0, 0.16, 0.12, 1.3, { swatch: 'woodDark', solid: false });
    // The headframe over the old shaft.
    for (const [px, pz] of [[2, -13], [5, -13], [2, -10], [5, -10]] as const)
      k.add('post', px, 3, pz, 0.15, 3, 0.15, { swatch: 'woodDark' });
    k.add('roof', 3.5, 6.1, -11.5, 1.9, 0.12, 1.9, { swatch: 'woodGrayDark', solid: false });
    const lab = k.cabin(-5, -10, 7, 8, 0.35, { door: 'front', boards: false, swatch: 'woodGray' });
    k.add('safe', lab.x1 - 0.6, 0.85, lab.z0 + 0.8, 0.45, 0.5, 0.45, { loot: 'safe', swatch: 'ironLight' });
    k.add('shelf', -5, 1.45, lab.z1 - 0.35, 1.2, 1.1, 0.25, { loot: 'shelf', swatch: 'woodGray' });
    // A boiler shed for the generator.
    k.add('tank', -6, 1.4, 10, 1.1, 1.4, 1.1, { swatch: 'rust' });
    const triggers = [
      k.add('lever', 6.4, 0.6, 3.2, 0.25, 0.6, 0.25, { swatch: 'iron' }).id,
      k.add('lever', lab.x1 - 0.6, 0.95, -10 + 2.2, 0.25, 0.6, 0.25, { swatch: 'iron' }).id,
      k.add('lever', -4.2, 0.6, 10, 0.25, 0.6, 0.25, { swatch: 'iron' }).id,
    ];
    for (let i = 0; i < 4; i++)
      k.spawns.push({
        kind: rng.pick<ItemKind>(['gold_nugget', 'gold_nugget', 'gold_bar']),
        x: 11 + rng.range(-1.2, 1.2),
        y: 0.1,
        z: rng.range(-1.2, 1.2),
        ry: 0,
      });
    k.spawns.push({ kind: 'bond', x: 11.5, y: 0.1, z: 1.2, ry: 0 });
    k.spawns.push({ kind: 'crate', x: 3, y: 0, z: 6, ry: 0.4 });
    k.spawns.push({ kind: 'lumber', x: 1, y: 0, z: -4, ry: 1.0 });
    spec = { kind: 'mine', gate, triggers, keyPiece: -1, boss: 'voss', bossX: 3, bossZ: 0 };
  } else {
    // Blackpine Chateau: light the three braziers to open the crypt.
    const hall = k.cabin(0, 0, 12, 16, 0.35, {
      door: 'front',
      boards: true,
      swatch: 'rockDark',
      wallH: 4.2,
    });
    for (const zz of [-8.6, 8.6])
      k.add('tower', -6.6, 3.2, zz, 1.3, 3.2, 1.3, { swatch: 'rockDark' });
    k.add('cabinet', hall.x1 - 0.45, 1.25, hall.z1 - 1.0, 0.35, 0.9, 0.6, { loot: 'cabinet', swatch: 'woodDark' });
    k.add('drawer', hall.x1 - 0.5, 0.8, hall.z0 + 1.0, 0.4, 0.45, 0.7, { loot: 'drawer', swatch: 'woodDark' });
    k.add('shelf', 2, 1.45, hall.z0 + 0.35, 1.2, 1.1, 0.25, { loot: 'shelf', swatch: 'woodDark' });
    const triggers = [
      k.add('brazier', -10, 0.5, -6, 0.4, 0.5, 0.4, { swatch: 'iron' }).id,
      k.add('brazier', -10, 0.5, 6, 0.4, 0.5, 0.4, { swatch: 'iron' }).id,
      k.add('brazier', 12, 0.5, -8, 0.4, 0.5, 0.4, { swatch: 'iron' }).id,
    ];
    const gate = k.vault(14, 13, 2.4, 2.4, 2.6, 'rock');
    // Headstones before the crypt.
    for (let i = 0; i < 6; i++)
      k.add('post', 6 + (i % 3) * 1.8, 0.45, 15 + Math.floor(i / 3) * 2.2, 0.3, 0.45, 0.08, { swatch: 'rock' });
    for (let i = 0; i < 3; i++)
      k.spawns.push({
        kind: rng.pick<ItemKind>(['jewelry', 'gold_bar', 'silver_watch']),
        x: 14.5 + rng.range(-1, 1),
        y: 0.1,
        z: 13 + rng.range(-1, 1),
        ry: 0,
      });
    k.spawns.push({ kind: 'bond', x: 15.2, y: 0.1, z: 12, ry: 0 });
    for (let i = 0; i < 3; i++)
      k.spawns.push({ kind: 'chair', x: rng.range(-3, 3), y: 0.5, z: rng.range(-6, 6), ry: rng.range(0, 6) });
    spec = { kind: 'chateau', gate, triggers, keyPiece: -1, boss: 'countess', bossX: 8, bossZ: 10 };
  }
  return {
    id: `l${index}`,
    kind: 'landmark',
    name: f.name,
    x,
    y: groundY(x, z),
    z,
    yaw,
    pieces: k.pieces,
    spawns: k.spawns,
    pad: 26,
    radius: 30,
    wood: 'wood',
    feature: f,
    landmark: spec,
  };
}
