import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Swatch, swatchUV } from './palette.ts';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();

export interface PartOpts {
  /** Euler rotation in radians (XYZ). */
  rx?: number;
  ry?: number;
  rz?: number;
}

/**
 * Builds low-poly meshes from primitives (§5.4: hand-built in code). Every part
 * carries a palette swatch through its UVs, and the whole result merges into a
 * single geometry that renders with the shared palette material.
 */
export class MeshBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Applies a transform to everything added until the matching pop(). */
  push(x = 0, y = 0, z = 0, opts: PartOpts = {}, scale = 1): this {
    e.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    q.setFromEuler(e);
    m4.compose(v.set(x, y, z), q, sc.set(scale, scale, scale));
    const top = this.stack[this.stack.length - 1] as THREE.Matrix4;
    this.stack.push(top.clone().multiply(m4));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Adds an arbitrary geometry (consumed) with a swatch at a local transform. */
  add(geo: THREE.BufferGeometry, swatch: Swatch, x = 0, y = 0, z = 0, opts: PartOpts = {}): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    g.deleteAttribute('normal');
    const [u, vv] = swatchUV(swatch);
    const n = g.getAttribute('position').count;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = u;
      uv[i * 2 + 1] = vv;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    e.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
    q.setFromEuler(e);
    m4.compose(v.set(x, y, z), q, sc.set(1, 1, 1));
    const top = this.stack[this.stack.length - 1] as THREE.Matrix4;
    g.applyMatrix4(top.clone().multiply(m4));
    this.parts.push(g);
    return this;
  }

  /** Box by size, centred at (x, y, z). */
  box(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    opts?: PartOpts,
  ): this {
    return this.add(new THREE.BoxGeometry(sx, sy, sz), swatch, x, y, z, opts);
  }

  /** Box from min/max corners. */
  boxMinMax(
    swatch: Swatch,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): this {
    return this.box(swatch, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
  }

  /** Cylinder along Y by default; use rx/rz to lay it down. */
  cylinder(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    rTop: number,
    rBottom: number,
    h: number,
    segments = 8,
    opts?: PartOpts,
    openEnded = false,
  ): this {
    return this.add(
      new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, openEnded),
      swatch,
      x,
      y,
      z,
      opts,
    );
  }

  /** Cylinder along Z (boilers, axles along X use rz). */
  cylinderZ(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    r: number,
    len: number,
    segments = 10,
  ): this {
    return this.cylinder(swatch, x, y, z, r, r, len, segments, { rx: Math.PI / 2 });
  }

  cylinderX(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    r: number,
    len: number,
    segments = 10,
  ): this {
    return this.cylinder(swatch, x, y, z, r, r, len, segments, { rz: Math.PI / 2 });
  }

  cone(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    r: number,
    h: number,
    segments = 7,
    opts?: PartOpts,
  ): this {
    return this.add(new THREE.ConeGeometry(r, h, segments), swatch, x, y, z, opts);
  }

  /** Low-poly blob (icosahedron), scaled per axis. */
  blob(
    swatch: Swatch,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    detail = 0,
    opts?: PartOpts,
  ): this {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.scale(sx, sy, sz);
    return this.add(g, swatch, x, y, z, opts);
  }

  /** Extrudes a 2D polygon (in the XY plane) along Z by `depth`, centred. */
  prism(
    swatch: Swatch,
    points: Array<[number, number]>,
    depth: number,
    x = 0,
    y = 0,
    z = 0,
    opts?: PartOpts,
  ): this {
    const shape = new THREE.Shape(points.map(([px, py]) => new THREE.Vector2(px, py)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return this.add(g, swatch, x, y, z, opts);
  }

  get partCount(): number {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    for (const p of this.parts) {
      for (const name of Object.keys(p.attributes)) {
        if (name !== 'position' && name !== 'uv') p.deleteAttribute(name);
      }
    }
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error('MeshBuilder: merge failed');
    merged.computeVertexNormals();
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}
