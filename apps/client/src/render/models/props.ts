import * as THREE from 'three/webgpu';
import { PropKind, type PropKindId } from '@dead-tracks/shared';
import { MeshBuilder } from '../builder.ts';

/**
 * Low-poly nature props (§5.3 placeholders until CC0 packs land). Each kind has a
 * near and a far (cheaper) version for distance LOD. Origins sit on the ground.
 */
export function buildProp(kind: PropKindId, lod: 0 | 1): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const far = lod === 1;
  switch (kind) {
    case PropKind.Grass: {
      const blades = far ? 3 : 7;
      for (let i = 0; i < blades; i++) {
        const a = (i / blades) * Math.PI * 2 + i * 0.7;
        const r = 0.12 + (i % 3) * 0.07;
        const h = 0.45 + ((i * 37) % 5) * 0.08;
        b.cone(i % 2 ? 'grassDry' : 'grass3', Math.cos(a) * r, h / 2, Math.sin(a) * r, 0.07, h, 3, {
          rx: Math.sin(a) * 0.25,
          rz: Math.cos(a) * 0.25,
        });
      }
      break;
    }
    case PropKind.Bush:
      b.blob('leaf2', 0, 0.45, 0, 0.75, 0.5, 0.7, far ? 0 : 1);
      if (!far) {
        b.blob('leaf1', 0.45, 0.35, 0.2, 0.45, 0.35, 0.45);
        b.blob('leaf3', -0.35, 0.3, -0.25, 0.4, 0.3, 0.4);
      }
      break;
    case PropKind.Oak:
      b.cylinder('bark', 0, 1.3, 0, 0.22, 0.34, 2.6, far ? 5 : 7);
      if (!far) {
        b.cylinder('bark', 0.45, 2.6, 0, 0.08, 0.14, 1.3, 5, { rz: -0.7 });
        b.cylinder('bark', -0.35, 2.8, 0.2, 0.07, 0.12, 1.2, 5, { rz: 0.6 });
      }
      b.blob('leaf1', 0, 3.6, 0, 2.2, 1.4, 2.0, far ? 0 : 1);
      if (!far) {
        b.blob('leaf2', 1.3, 3.3, 0.5, 1.2, 0.9, 1.1);
        b.blob('leaf3', -1.2, 3.4, -0.4, 1.2, 0.9, 1.2);
        b.blob('leaf2', 0.2, 4.4, -0.6, 1.1, 0.8, 1.0);
      }
      break;
    case PropKind.Pine: {
      b.cylinder('barkDark', 0, 1.0, 0, 0.14, 0.26, 2.0, 5);
      const tiers = far ? 2 : 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const r = 1.9 * (1 - t * 0.75);
        const h = far ? 3.4 : 2.0;
        b.cone(
          i % 2 ? 'pine2' : 'pine1',
          0,
          1.6 + i * (far ? 2.2 : 1.15) + h / 2,
          0,
          r,
          h,
          far ? 5 : 7,
        );
      }
      break;
    }
    case PropKind.RockSmall:
      b.blob('rock', 0, 0.12, 0, 0.45, 0.3, 0.38, 0, { ry: 0.6 });
      break;
    case PropKind.RockBig:
      b.blob('rock', 0, 0.55, 0, 1.4, 1.1, 1.2, 0, { ry: 0.3, rz: 0.15 });
      if (!far) b.blob('rockDark', 0.8, 0.3, 0.6, 0.7, 0.55, 0.6, 0, { ry: 1.1 });
      break;
    case PropKind.DeadTree:
      b.cylinder('barkPale', 0, 1.4, 0, 0.1, 0.22, 2.8, 5, { rz: 0.06 });
      b.cylinder('barkPale', 0.35, 2.4, 0, 0.04, 0.08, 1.3, 4, { rz: -0.8 });
      if (!far) {
        b.cylinder('barkPale', -0.3, 2.0, 0.15, 0.04, 0.07, 1.1, 4, { rz: 0.9, ry: 0.4 });
        b.cylinder('barkPale', 0.1, 2.9, -0.2, 0.03, 0.06, 0.9, 4, { rx: 0.7 });
      }
      break;
    case PropKind.Cactus:
      b.cylinder('cactus', 0, 1.2, 0, 0.2, 0.24, 2.4, far ? 5 : 7);
      b.blob('cactus', 0, 2.4, 0, 0.2, 0.15, 0.2);
      if (!far) {
        b.cylinder('cactusDark', 0.38, 1.3, 0, 0.12, 0.13, 0.5, 6, { rz: Math.PI / 2 });
        b.cylinder('cactus', 0.55, 1.75, 0, 0.12, 0.13, 0.9, 6);
        b.cylinder('cactusDark', -0.33, 1.0, 0, 0.11, 0.12, 0.4, 6, { rz: Math.PI / 2 });
        b.cylinder('cactus', -0.48, 1.35, 0, 0.11, 0.12, 0.7, 6);
      }
      break;
  }
  return b.build();
}

/** Telegraph pole beside the track. */
export function buildTelegraphPole(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.cylinder('woodGray', 0, 3.4, 0, 0.09, 0.13, 6.8, 6);
  b.box('woodGray', 0, 6.3, 0, 1.4, 0.12, 0.12);
  for (const x of [-0.6, -0.25, 0.25, 0.6]) b.cylinder('glass', x, 6.43, 0, 0.04, 0.05, 0.12, 5);
  return b.build();
}

/** Kilometre post: a white board with the HUD km painted on (number added as decal later). */
export function buildMilepost(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.box('white', 0, 0.75, 0, 0.12, 1.5, 0.12);
  b.box('white', 0, 1.35, 0, 0.5, 0.35, 0.06);
  b.box('black', 0, 1.35, 0.035, 0.36, 0.18, 0.01);
  return b.build();
}

/** One railway sleeper (tie). */
export function buildSleeper(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.box('woodDark', 0, -0.09, 0, 2.6, 0.16, 0.24);
  return b.build();
}

export const PROP_KINDS: PropKindId[] = [
  PropKind.Grass,
  PropKind.Bush,
  PropKind.Oak,
  PropKind.Pine,
  PropKind.RockSmall,
  PropKind.RockBig,
  PropKind.DeadTree,
  PropKind.Cactus,
];
