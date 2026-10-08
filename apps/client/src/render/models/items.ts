import * as THREE from 'three/webgpu';
import type { ItemKind } from '@dead-tracks/shared';
import { MeshBuilder } from '../builder.ts';
import { weaponModel } from './weapons.ts';

/** Low-poly items (§4.8). Origins sit on the floor; bulky items are about knee to waist high. */
const cache = new Map<string, THREE.BufferGeometry>();

export function itemGeometry(kind: ItemKind): THREE.BufferGeometry {
  const hit = cache.get(kind);
  if (hit) return hit;
  const g = build(kind);
  cache.set(kind, g);
  return g;
}

function build(kind: ItemKind): THREE.BufferGeometry {
  const b = new MeshBuilder();
  switch (kind) {
    case 'coal':
      b.blob('dirt', 0, 0.28, 0, 0.36, 0.28, 0.26, 1);
      b.cylinder('dirt', 0, 0.58, 0, 0.08, 0.16, 0.12, 6);
      b.blob('coal', 0, 0.62, 0, 0.1, 0.05, 0.1);
      break;
    case 'crate':
      b.box('wood', 0, 0.3, 0, 0.6, 0.6, 0.6);
      for (const y of [0.08, 0.52]) b.box('woodDark', 0, y, 0, 0.62, 0.06, 0.62);
      b.box('woodDark', 0, 0.3, 0.31, 0.08, 0.6, 0.02, { rz: 0.8 });
      break;
    case 'chair':
      b.box('wood', 0, 0.45, 0, 0.45, 0.05, 0.42);
      for (const [x, z] of [
        [-0.19, -0.17],
        [0.19, -0.17],
        [-0.19, 0.17],
        [0.19, 0.17],
      ] as const)
        b.box('woodDark', x, 0.22, z, 0.04, 0.45, 0.04);
      b.box('wood', 0, 0.75, 0.19, 0.45, 0.55, 0.04);
      break;
    case 'table':
      b.box('wood', 0, 0.74, 0, 1.0, 0.06, 0.7);
      for (const [x, z] of [
        [-0.44, -0.29],
        [0.44, -0.29],
        [-0.44, 0.29],
        [0.44, 0.29],
      ] as const)
        b.box('woodDark', x, 0.36, z, 0.06, 0.72, 0.06);
      break;
    case 'cabinet':
      b.box('wood', 0, 0.55, 0, 0.7, 1.1, 0.45);
      b.box('woodDark', 0, 0.55, 0.23, 0.02, 1.0, 0.01);
      b.box('brass', 0.06, 0.6, 0.235, 0.03, 0.03, 0.02);
      break;
    case 'barrel':
      b.cylinder('wood', 0, 0.42, 0, 0.27, 0.27, 0.84, 9);
      for (const y of [0.12, 0.42, 0.72]) b.cylinder('iron', 0, y, 0, 0.28, 0.28, 0.04, 9);
      break;
    case 'strongbox':
      b.box('ironLight', 0, 0.2, 0, 0.5, 0.4, 0.34);
      b.box('brass', 0, 0.3, 0.175, 0.08, 0.1, 0.02);
      break;
    case 'plate':
      b.box('steel', 0, 0.5, 0, 1.0, 1.0, 0.05);
      for (const [x, y] of [
        [-0.4, 0.1],
        [0.4, 0.1],
        [-0.4, 0.9],
        [0.4, 0.9],
      ] as const)
        b.cylinder('iron', x, y, 0.03, 0.03, 0.03, 0.02, 5, { rx: Math.PI / 2 });
      break;
    case 'wire':
      for (let i = 0; i < 3; i++)
        b.cylinder(
          'ironLight',
          0,
          0.3,
          0,
          0.3,
          0.3,
          0.04,
          10,
          { rx: Math.PI / 2, ry: i * 0.5 },
          true,
        );
      b.box('iron', 0, 0.3, 0, 0.6, 0.04, 0.04);
      break;
    case 'trolley_kit':
      // A flat-packed trolley: deck boards, two axles with wheels, a rope.
      b.box('woodLight', 0, 0.06, 0, 0.9, 0.08, 0.6);
      b.box('wood', 0, 0.12, -0.2, 0.9, 0.04, 0.12);
      b.box('wood', 0, 0.12, 0.2, 0.9, 0.04, 0.12);
      for (const x of [-0.3, 0.3]) {
        b.cylinder('iron', x, 0.2, 0, 0.025, 0.025, 0.62, 6, { rx: Math.PI / 2 });
        for (const z of [-0.28, 0.28]) b.cylinder('steel', x, 0.2, z, 0.11, 0.11, 0.05, 10, { rx: Math.PI / 2 });
      }
      b.box('leather', 0, 0.16, 0, 0.04, 0.12, 0.64);
      break;
    case 'lumber':
      for (let i = 0; i < 4; i++)
        b.box(
          i % 2 ? 'wood' : 'woodLight',
          (i % 2) * 0.15 - 0.07,
          0.06 + Math.floor(i / 2) * 0.12,
          0,
          0.14,
          0.11,
          1.4,
        );
      break;
    case 'gold_bar':
      b.box('signYellow', 0, 0.04, 0, 0.18, 0.08, 0.09);
      break;
    case 'gold_nugget':
      b.blob('signYellow', 0, 0.05, 0, 0.06, 0.05, 0.05);
      break;
    case 'silver_watch':
      b.cylinder('steel', 0, 0.015, 0, 0.05, 0.05, 0.02, 10);
      b.cylinder('white', 0, 0.027, 0, 0.042, 0.042, 0.004, 10);
      break;
    case 'jewelry':
      b.box('woodDark', 0, 0.05, 0, 0.16, 0.1, 0.12);
      b.blob('signRed', 0, 0.12, 0, 0.04, 0.03, 0.04);
      break;
    case 'cash':
      b.box('grass2', 0, 0.03, 0, 0.16, 0.05, 0.08);
      b.box('white', 0, 0.035, 0, 0.04, 0.052, 0.082);
      break;
    case 'ammo_pistol':
    case 'ammo_rifle':
    case 'ammo_shells':
      b.box(kind === 'ammo_shells' ? 'signRed' : 'wood', 0, 0.06, 0, 0.18, 0.12, 0.12);
      b.box('white', 0, 0.06, 0.061, 0.12, 0.06, 0.002);
      break;
    case 'bandage':
      b.cylinder('white', 0, 0.06, 0, 0.06, 0.06, 0.1, 8, { rz: Math.PI / 2 });
      break;
    case 'tonic':
      b.cylinder('copper', 0, 0.08, 0, 0.045, 0.05, 0.16, 7);
      b.cylinder('woodDark', 0, 0.18, 0, 0.02, 0.02, 0.05, 5);
      break;
    case 'bond':
      // A rolled certificate tied with a red ribbon.
      b.cylinder('white', 0, 0.035, 0, 0.035, 0.035, 0.24, 8, { rz: Math.PI / 2 });
      b.cylinder('signRed', 0, 0.035, 0, 0.038, 0.038, 0.03, 8, { rz: Math.PI / 2 });
      break;
    case 'cellar_key':
      b.cylinder('brass', -0.06, 0.012, 0, 0.03, 0.03, 0.012, 10);
      b.box('brass', 0.03, 0.012, 0, 0.13, 0.012, 0.02);
      b.box('brass', 0.08, 0.012, 0.02, 0.02, 0.012, 0.03);
      break;
    case 'bounty':
      b.cylinder('brass', 0, 0.01, 0, 0.05, 0.05, 0.01, 5);
      break;
    default: {
      // Weapons and throwables reuse their held models, laid flat.
      const w = weaponModel(kind);
      if (w) {
        const g = w.geometry.clone();
        g.rotateZ(Math.PI / 2);
        g.translate(0, 0.04, 0);
        return g;
      }
      b.box('white', 0, 0.1, 0, 0.2, 0.2, 0.2);
    }
  }
  return b.build();
}

/** Half-height for placing items on surfaces and carrying them. */
export function itemHeight(kind: ItemKind): number {
  switch (kind) {
    case 'cabinet':
      return 1.1;
    case 'plate':
      return 1.0;
    case 'table':
    case 'barrel':
      return 0.8;
    case 'chair':
      return 1.0;
    default:
      return 0.5;
  }
}
