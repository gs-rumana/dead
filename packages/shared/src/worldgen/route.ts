import { Rng } from '../math/rng.ts';
import { clamp } from '../math/scalar.ts';
import { ROUTE_LENGTH } from '../data/world.ts';
import { fbm2 } from './noise.ts';

/** A point and orientation on a track. `heading` 0 points toward -Z; positive turns right (+X). */
export interface TrackFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** dy/ds */
  grade: number;
  /** Unit tangent (direction of increasing s). */
  tx: number;
  ty: number;
  tz: number;
  /** Unit right vector (horizontal). */
  rx: number;
  rz: number;
}

export function makeFrame(): TrackFrame {
  return { x: 0, y: 0, z: 0, heading: 0, grade: 0, tx: 0, ty: 0, tz: -1, rx: 1, rz: 0 };
}

/** Curvature is piecewise linear in s, so heading is piecewise quadratic and exact. */
interface CurvePiece {
  s0: number;
  s1: number;
  k0: number;
  k1: number;
  /** Heading at s0. */
  h0: number;
}

export interface NearestResult {
  s: number;
  /** Signed horizontal offset along the right vector. */
  lateral: number;
  /** Horizontal distance to the centreline. */
  dist: number;
}

/** A spur line's layout (§4.4): where it leaves the main line and how it curves. */
export interface SpurSpec {
  index: number;
  length: number;
  /** Pose at s = 0. */
  x0: number;
  z0: number;
  h0: number;
  /** Elevation at s = 0 (matches the main line). */
  y0: number;
  pieces: Array<{ len: number; k0: number; k1: number }>;
}

export const ROUTE_START = -250;
export const ROUTE_END = ROUTE_LENGTH + 400;

const TABLE_STEP = 1;
const ELEV_STEP = 5;
const INDEX_STEP = 4;
const CELL = 32;
const PROGRESS_CELL = 256;

/**
 * The main line (§6.6): a smooth seeded curve from s = ROUTE_START to ROUTE_END,
 * made of straights, transition spirals and arcs, with an elevation profile that
 * follows the land's large-scale shape at gentle grades.
 */
export class Route {
  readonly seed: number;
  readonly start: number;
  readonly end: number;
  /** Set for spur lines; undefined for the main line. */
  readonly spur: SpurSpec | undefined;
  private readonly pieces: CurvePiece[] = [];
  /** x, z every TABLE_STEP metres. */
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  private readonly elev: Float64Array;
  private readonly grid = new Map<number, number[]>();
  /** Coarse field of "nearest s" for any point, for biome lookups far from the track. */
  private progress!: Float32Array;
  private progressX0 = 0;
  private progressZ0 = 0;
  private progressW = 0;
  private progressH = 0;

  constructor(seed: number, spur?: SpurSpec) {
    this.seed = seed >>> 0;
    this.spur = spur;
    this.start = spur ? 0 : ROUTE_START;
    this.end = spur ? spur.length : ROUTE_END;
    if (spur) {
      let s = 0;
      let heading = spur.h0;
      for (const p of spur.pieces) {
        this.pieces.push({ s0: s, s1: s + p.len, k0: p.k0, k1: p.k1, h0: heading });
        heading += ((p.k0 + p.k1) / 2) * p.len;
        s += p.len;
      }
    } else this.buildCurvature();
    const n = Math.ceil((this.end - this.start) / TABLE_STEP) + 1;
    this.px = new Float64Array(n);
    this.pz = new Float64Array(n);
    this.integrate();
    this.elev = spur ? this.buildSpurElevation(spur) : this.buildElevation();
    this.buildIndex();
    if (!spur) this.buildProgressField();
  }

  /** Spurs follow the land more closely (handcars climb), starting level with the main line. */
  private buildSpurElevation(spur: SpurSpec): Float64Array {
    const n = Math.ceil((this.end - this.start) / ELEV_STEP) + 1;
    const out = new Float64Array(n);
    const p = { x: 0, z: 0 };
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xzAt(i * ELEV_STEP, p);
      raw[i] = Route.landHeight(this.seed, p.x, p.z);
    }
    const r = 16;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      let c = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) {
        acc += raw[j] as number;
        c++;
      }
      const t = clamp((i * ELEV_STEP - 40) / 160, 0, 1);
      const w = t * t * (3 - 2 * t);
      out[i] = spur.y0 + (acc / c - spur.y0) * w;
    }
    const maxRise = 0.03 * ELEV_STEP;
    for (let i = 1; i < n; i++) {
      const prev = out[i - 1] as number;
      out[i] = clamp(out[i] as number, prev - maxRise, prev + maxRise);
    }
    return out;
  }

  /** Large-scale land height used by both the track profile and the terrain. */
  static landHeight(seed: number, x: number, z: number): number {
    return fbm2(seed ^ 0x51ed27, x, z, 2600, 3, 0.45) * 38;
  }

  private buildCurvature(): void {
    const rng = new Rng(this.seed ^ 0x7a11);
    let s = this.start;
    let heading = 0;
    // A long straight through the start station.
    const push = (len: number, k0: number, k1: number) => {
      const piece = { s0: s, s1: s + len, k0, k1, h0: heading };
      this.pieces.push(piece);
      heading += ((k0 + k1) / 2) * len;
      s += len;
    };
    push(650, 0, 0);
    while (s < this.end) {
      // Bias turns back toward the general direction so the route stays a corridor.
      let sign = rng.chance(0.5) ? 1 : -1;
      if (heading > 0.35) sign = -1;
      else if (heading < -0.35) sign = 1;
      const radius = rng.range(420, 1100);
      const angle = rng.range(0.12, 0.6);
      const k = sign / radius;
      const trans = rng.range(70, 140);
      // Heading change from both spirals = k * trans; the arc supplies the rest.
      const arcLen = Math.max(20, (angle - Math.abs(k) * trans) * radius);
      push(trans, 0, k);
      push(arcLen, k, k);
      push(trans, k, 0);
      push(rng.range(140, 650), 0, 0);
    }
  }

  private pieceAt(s: number): CurvePiece {
    const ps = this.pieces;
    let lo = 0;
    let hi = ps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((ps[mid] as CurvePiece).s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return ps[lo] as CurvePiece;
  }

  headingAt(s: number): number {
    const p = this.pieceAt(clamp(s, this.start, this.end));
    const d = clamp(s, this.start, this.end) - p.s0;
    const len = p.s1 - p.s0;
    const dk = len > 0 ? (p.k1 - p.k0) / len : 0;
    return p.h0 + p.k0 * d + 0.5 * dk * d * d;
  }

  curvatureAt(s: number): number {
    const p = this.pieceAt(clamp(s, this.start, this.end));
    const len = p.s1 - p.s0;
    return len > 0 ? p.k0 + ((p.k1 - p.k0) * (s - p.s0)) / len : p.k0;
  }

  /** Simpson integration of the unit direction between two s values. */
  private integrateStep(sA: number, sB: number, out: { x: number; z: number }): void {
    const n = 4;
    const h = (sB - sA) / n;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i <= n; i++) {
      const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
      const hd = this.headingAt(sA + h * i);
      sx += w * Math.sin(hd);
      sz += w * -Math.cos(hd);
    }
    out.x = (sx * h) / 3;
    out.z = (sz * h) / 3;
  }

  private integrate(): void {
    const d = { x: 0, z: 0 };
    // s = 0 sits at the world origin (main line) or the junction (spurs).
    const i0 = Math.round((0 - this.start) / TABLE_STEP);
    this.px[i0] = this.spur?.x0 ?? 0;
    this.pz[i0] = this.spur?.z0 ?? 0;
    for (let i = i0 + 1; i < this.px.length; i++) {
      const sA = this.start + (i - 1) * TABLE_STEP;
      this.integrateStep(sA, sA + TABLE_STEP, d);
      this.px[i] = (this.px[i - 1] as number) + d.x;
      this.pz[i] = (this.pz[i - 1] as number) + d.z;
    }
    for (let i = i0 - 1; i >= 0; i--) {
      const sA = this.start + i * TABLE_STEP;
      this.integrateStep(sA, sA + TABLE_STEP, d);
      this.px[i] = (this.px[i + 1] as number) - d.x;
      this.pz[i] = (this.pz[i + 1] as number) - d.z;
    }
  }

  private buildElevation(): Float64Array {
    const n = Math.ceil((this.end - this.start) / ELEV_STEP) + 1;
    const raw = new Float64Array(n);
    const p = { x: 0, z: 0 };
    for (let i = 0; i < n; i++) {
      this.xzAt(this.start + i * ELEV_STEP, p);
      raw[i] = Route.landHeight(this.seed, p.x, p.z);
    }
    // Smooth with a wide moving average, twice, so grades stay gentle.
    let cur = raw;
    for (let pass = 0; pass < 2; pass++) {
      const radius = 50; // samples (250 m)
      const out = new Float64Array(n);
      let acc = 0;
      let count = 0;
      for (let i = -radius; i < n + radius; i++) {
        const add = i + radius;
        if (add >= 0 && add < n) {
          acc += cur[add] as number;
          count++;
        }
        const rem = i - radius - 1;
        if (rem >= 0 && rem < n) {
          acc -= cur[rem] as number;
          count--;
        }
        if (i >= 0 && i < n) out[i] = acc / count;
      }
      cur = out;
    }
    // Clamp grade to 1.8%.
    const maxRise = 0.018 * ELEV_STEP;
    for (let i = 1; i < n; i++) {
      const prev = cur[i - 1] as number;
      cur[i] = clamp(cur[i] as number, prev - maxRise, prev + maxRise);
    }
    // The start yard is level.
    const iStart = Math.round((0 - this.start) / ELEV_STEP);
    const yardY = cur[iStart] as number;
    for (let i = 0; i < n; i++) {
      const s = this.start + i * ELEV_STEP;
      const t = clamp((s - 120) / 300, 0, 1);
      const w = t * t * (3 - 2 * t);
      cur[i] = yardY + ((cur[i] as number) - yardY) * w;
    }
    return cur;
  }

  /** Horizontal position at s (exact heading integration from the nearest table entry). */
  xzAt(s: number, out: { x: number; z: number }): { x: number; z: number } {
    const sc = clamp(s, this.start, this.end);
    const f = (sc - this.start) / TABLE_STEP;
    const i = Math.min(Math.floor(f), this.px.length - 1);
    const s0 = this.start + i * TABLE_STEP;
    const bx = this.px[i] as number;
    const bz = this.pz[i] as number;
    if (sc - s0 < 1e-9) {
      out.x = bx;
      out.z = bz;
    } else {
      const d = { x: 0, z: 0 };
      this.integrateStep(s0, sc, d);
      out.x = bx + d.x;
      out.z = bz + d.z;
    }
    // Beyond the ends, continue straight.
    if (s !== sc) {
      const h = this.headingAt(sc);
      out.x += Math.sin(h) * (s - sc);
      out.z += -Math.cos(h) * (s - sc);
    }
    return out;
  }

  /** Horizontal bounding box of the centreline (for quick rejection). */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.px.length; i += 4) {
      const x = this.px[i] as number;
      const z = this.pz[i] as number;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { minX, maxX, minZ, maxZ };
  }

  /** Track bed height (top of ballast) at s, C1-smooth. */
  heightAt(s: number): number {
    const f = (clamp(s, this.start, this.end) - this.start) / ELEV_STEP;
    const n = this.elev.length;
    const i = Math.min(Math.floor(f), n - 2);
    const t = f - i;
    const e = this.elev;
    const p0 = e[Math.max(i - 1, 0)] as number;
    const p1 = e[i] as number;
    const p2 = e[i + 1] as number;
    const p3 = e[Math.min(i + 2, n - 1)] as number;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }

  gradeAt(s: number): number {
    return (this.heightAt(s + 0.5) - this.heightAt(s - 0.5)) / 1;
  }

  /** Full frame at s. */
  frameAt(s: number, out: TrackFrame): TrackFrame {
    this.xzAt(s, out);
    out.y = this.heightAt(s);
    const h = this.headingAt(s);
    const g = this.gradeAt(s);
    out.heading = h;
    out.grade = g;
    const sh = Math.sin(h);
    const ch = Math.cos(h);
    const inv = 1 / Math.sqrt(1 + g * g);
    out.tx = sh * inv;
    out.ty = g * inv;
    out.tz = -ch * inv;
    out.rx = ch;
    out.rz = sh;
    return out;
  }

  private cellKey(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  private buildIndex(): void {
    const p = { x: 0, z: 0 };
    const n = Math.floor((this.end - this.start) / INDEX_STEP);
    for (let i = 0; i <= n; i++) {
      this.xzAt(this.start + i * INDEX_STEP, p);
      const key = this.cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push(i);
    }
  }

  private buildProgressField(): void {
    const C = PROGRESS_CELL;
    const margin = 1500;
    const p = { x: 0, z: 0 };
    const sx: number[] = [];
    const sz: number[] = [];
    const ss: number[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let s = this.start; s <= this.end; s += 32) {
      this.xzAt(s, p);
      sx.push(p.x);
      sz.push(p.z);
      ss.push(s);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.progressX0 = Math.floor((minX - margin) / C) * C;
    this.progressZ0 = Math.floor((minZ - margin) / C) * C;
    this.progressW = Math.ceil((maxX + margin - this.progressX0) / C) + 1;
    this.progressH = Math.ceil((maxZ + margin - this.progressZ0) / C) + 1;
    this.progress = new Float32Array(this.progressW * this.progressH);
    for (let j = 0; j < this.progressH; j++) {
      for (let i = 0; i < this.progressW; i++) {
        const x = this.progressX0 + i * C;
        const z = this.progressZ0 + j * C;
        let best = 0;
        let bestD = Infinity;
        for (let k = 0; k < ss.length; k++) {
          const dx = (sx[k] as number) - x;
          const dz = (sz[k] as number) - z;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = ss[k] as number;
          }
        }
        this.progress[j * this.progressW + i] = best;
      }
    }
  }

  /** Approximate route distance for any point (bilinear over a coarse field). */
  progressAt(x: number, z: number): number {
    const fx = clamp((x - this.progressX0) / PROGRESS_CELL, 0, this.progressW - 1.001);
    const fz = clamp((z - this.progressZ0) / PROGRESS_CELL, 0, this.progressH - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const w = this.progressW;
    const a = this.progress[j * w + i] as number;
    const b = this.progress[j * w + i + 1] as number;
    const c = this.progress[(j + 1) * w + i] as number;
    const d = this.progress[(j + 1) * w + i + 1] as number;
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  /**
   * Nearest point on the centreline within `maxDist` (horizontal), or null.
   * Exact enough for terrain flattening and frame switching.
   */
  nearest(x: number, z: number, maxDist: number, out?: NearestResult): NearestResult | null {
    const r = Math.ceil(maxDist / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    let best = -1;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.grid.get(this.cellKey(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const s = this.start + i * INDEX_STEP;
          const fi = (s - this.start) / TABLE_STEP;
          const ax = this.px[fi] as number;
          const az = this.pz[fi] as number;
          const d = (ax - x) * (ax - x) + (az - z) * (az - z);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
    if (best < 0) return null;
    // Refine by projecting onto the 1 m table polyline around the best sample (no trig).
    const centre = (best * INDEX_STEP) / TABLE_STEP;
    const lo = Math.max(0, centre - INDEX_STEP);
    const hi = Math.min(this.px.length - 1, centre + INDEX_STEP);
    let bestS = this.start + centre * TABLE_STEP;
    let bestDist2 = Infinity;
    let bestLat = 0;
    for (let i = lo; i < hi; i++) {
      const ax = this.px[i] as number;
      const az = this.pz[i] as number;
      const ex = (this.px[i + 1] as number) - ax;
      const ez = (this.pz[i + 1] as number) - az;
      const len2 = ex * ex + ez * ez;
      let t = ((x - ax) * ex + (z - az) * ez) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      const d2 = qx * qx + qz * qz;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestS = this.start + (i + t) * TABLE_STEP;
        const inv = 1 / Math.sqrt(len2);
        // For direction (ex, ez) the right vector is (-ez, ex).
        bestLat = ((x - ax) * -ez + (z - az) * ex) * inv;
      }
    }
    const s = bestS;
    const lateral = bestLat;
    const dist = Math.sqrt(bestDist2);
    if (dist > maxDist) return null;
    const res = out ?? { s: 0, lateral: 0, dist: 0 };
    res.s = s;
    res.lateral = lateral;
    res.dist = dist;
    return res;
  }
}
