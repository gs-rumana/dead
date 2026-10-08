import * as THREE from 'three/webgpu';
import type { WeaponId } from '@dead-tracks/shared';
import { MeshBuilder } from '../builder.ts';

/**
 * Hand-built weapons (§4.7). Local axes: the barrel points down -Z, +Y up, origin
 * at the grip. `sight` is the point on the sight line used to align iron sights.
 */
export interface WeaponModel {
  geometry: THREE.BufferGeometry;
  /** Muzzle position (local). */
  muzzle: THREE.Vector3;
  /** A point on the sight line (local): rear notch, front blade share this line. */
  sight: THREE.Vector3;
  twoHanded: boolean;
}

const cache = new Map<string, WeaponModel>();

export function weaponModel(id: WeaponId | string): WeaponModel | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const m = build(id);
  if (m) cache.set(id, m);
  return m;
}

function build(id: string): WeaponModel | null {
  const b = new MeshBuilder();
  switch (id) {
    case 'revolver': {
      // Grip, frame, cylinder, barrel, hammer, sights.
      b.box('woodDark', 0, -0.05, 0.03, 0.03, 0.1, 0.045, { rx: 0.35 });
      b.box('steel', 0, 0.02, -0.02, 0.028, 0.05, 0.07);
      b.cylinder('steel', 0, 0.025, -0.075, 0.022, 0.022, 0.055, 6, { rx: Math.PI / 2 });
      b.cylinder('iron', 0, 0.036, -0.17, 0.008, 0.008, 0.16, 6, { rx: Math.PI / 2 });
      b.box('iron', 0, 0.022, -0.16, 0.012, 0.012, 0.13);
      b.box('steel', 0, 0.05, 0.015, 0.008, 0.02, 0.012, { rx: -0.4 });
      b.box('steel', 0, 0.05, -0.245, 0.003, 0.012, 0.008);
      b.box('steel', 0, 0.035, -0.05, 0.004, 0.004, 0.012);
      b.box('steel', 0, -0.005, 0.0, 0.006, 0.02, 0.025);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0.036, -0.25),
        sight: new THREE.Vector3(0, 0.056, 0),
        twoHanded: false,
      };
    }
    case 'rifle': {
      b.box('wood', 0, -0.035, 0.24, 0.04, 0.08, 0.32, { rx: 0.12 });
      b.box('brass', 0, 0.0, 0.0, 0.042, 0.06, 0.16);
      b.cylinder('iron', 0, 0.022, -0.38, 0.011, 0.011, 0.62, 6, { rx: Math.PI / 2 });
      b.cylinder('iron', 0, -0.004, -0.33, 0.01, 0.01, 0.52, 6, { rx: Math.PI / 2 });
      b.box('wood', 0, 0.004, -0.2, 0.038, 0.035, 0.22);
      b.box('iron', 0, -0.055, 0.03, 0.008, 0.035, 0.11);
      b.box('steel', 0, 0.042, -0.68, 0.004, 0.016, 0.006);
      b.box('steel', 0, 0.04, -0.12, 0.012, 0.012, 0.01);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0.022, -0.69),
        sight: new THREE.Vector3(0, 0.05, 0),
        twoHanded: true,
      };
    }
    case 'coachgun': {
      b.box('wood', 0, -0.03, 0.22, 0.045, 0.085, 0.3, { rx: 0.15 });
      b.box('steel', 0, 0.0, 0.0, 0.05, 0.055, 0.12);
      for (const x of [-0.013, 0.013])
        b.cylinder('iron', x, 0.012, -0.29, 0.013, 0.013, 0.48, 7, { rx: Math.PI / 2 });
      b.box('wood', 0, -0.012, -0.14, 0.04, 0.025, 0.18);
      b.box('steel', 0, 0.03, -0.525, 0.006, 0.006, 0.006);
      b.box('steel', 0, 0.03, -0.06, 0.003, 0.003, 0.008);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0.012, -0.53),
        sight: new THREE.Vector3(0, 0.034, 0),
        twoHanded: true,
      };
    }
    case 'shovel':
      b.cylinder('wood', 0, 0, -0.35, 0.016, 0.018, 0.85, 6, { rx: Math.PI / 2 });
      b.box('wood', 0, 0, 0.1, 0.1, 0.025, 0.03);
      b.box('steel', 0, 0, -0.85, 0.18, 0.02, 0.24);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0, -0.9),
        sight: new THREE.Vector3(0, 0.05, 0),
        twoHanded: true,
      };
    case 'hatchet':
      b.cylinder('wood', 0, 0, -0.16, 0.014, 0.016, 0.38, 6, { rx: Math.PI / 2 });
      b.box('steel', 0, 0.045, -0.33, 0.02, 0.1, 0.06);
      b.box('steel', 0, 0.09, -0.33, 0.006, 0.03, 0.09);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0.06, -0.33),
        sight: new THREE.Vector3(0, 0.05, 0),
        twoHanded: false,
      };
    case 'dynamite':
      b.cylinder('signRed', 0, 0, -0.06, 0.016, 0.016, 0.17, 7, { rx: Math.PI / 2 });
      b.cylinder('white', 0, 0, -0.16, 0.002, 0.002, 0.05, 4, { rx: Math.PI / 2 });
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0, -0.18),
        sight: new THREE.Vector3(0, 0.05, 0),
        twoHanded: false,
      };
    case 'holywater':
      b.cylinder('glass', 0, 0.03, -0.02, 0.03, 0.034, 0.1, 8);
      b.cylinder('glass', 0, 0.1, -0.02, 0.012, 0.016, 0.05, 6);
      b.box('white', 0, 0.04, -0.054, 0.012, 0.04, 0.003);
      b.box('white', 0, 0.048, -0.054, 0.03, 0.01, 0.003);
      return {
        geometry: b.build(),
        muzzle: new THREE.Vector3(0, 0.1, -0.02),
        sight: new THREE.Vector3(0, 0.05, 0),
        twoHanded: false,
      };
    default:
      return null;
  }
}
