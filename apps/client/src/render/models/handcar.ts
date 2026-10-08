import * as THREE from 'three/webgpu';
import { HANDCAR } from '@dead-tracks/shared';
import { MeshBuilder } from '../builder.ts';

/**
 * Handcar and trolley (§4.4, §5.4: built in code). Local -z is forward along the
 * spur; origin at rail-top height on the centreline.
 */
export function buildHandcar(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const D = HANDCAR.deck;
  b.boxMinMax('woodGray', -0.9, D - 0.1, -HANDCAR.length / 2, 0.9, D, HANDCAR.length / 2);
  b.boxMinMax('iron', -0.85, 0.3, -1.2, 0.85, D - 0.1, 1.2);
  // Wheels.
  for (const z of [-0.8, 0.8]) {
    for (const x of [-0.72, 0.72])
      b.cylinder('iron', x, 0.32, z, 0.32, 0.32, 0.08, 10, { rz: Math.PI / 2 });
    b.cylinder('iron', 0, 0.32, z, 0.05, 0.05, 1.44, 6, { rz: Math.PI / 2 });
  }
  // The pump stand.
  b.boxMinMax('woodDark', -0.12, D, -0.12, 0.12, D + 0.9, 0.12);
  b.boxMinMax('iron', -0.06, D + 0.9, -0.06, 0.06, D + 1.0, 0.06);
  return b.build();
}

/** The see-saw pump handle, pivoting at the top of the stand. */
export function buildPumpHandle(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.box('woodDark', 0, 0, 0, 0.08, 0.08, 2.2);
  for (const z of [-1.1, 1.1]) b.box('wood', 0, 0, z, 1.1, 0.07, 0.07);
  return b.build();
}

export function buildTrolley(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const D = HANDCAR.deck;
  b.boxMinMax('wood', -0.85, D - 0.1, 2.0, 0.85, D, 4.0);
  b.boxMinMax('iron', -0.8, 0.3, 2.1, 0.8, D - 0.1, 3.9);
  for (const z of [2.4, 3.6]) {
    for (const x of [-0.72, 0.72])
      b.cylinder('iron', x, 0.28, z, 0.28, 0.28, 0.08, 10, { rz: Math.PI / 2 });
  }
  b.boxMinMax('iron', -0.04, D - 0.2, 1.3, 0.04, D - 0.12, 2.05);
  return b.build();
}
