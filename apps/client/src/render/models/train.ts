import * as THREE from 'three/webgpu';
import { FLATCAR_DECK, LOCO_FLOOR, TENDER_COAL_STEPS, TENDER_TOP } from '@dead-tracks/shared';
import { MeshBuilder } from '../builder.ts';
import type { Swatch } from '../palette.ts';

/**
 * Hand-built rolling stock (§5.4): an American 4-4-0 locomotive, its tender and a
 * flatcar. Car-local axes match train space: +x right, +y up, +z toward the rear,
 * origin at the car centre at rail-top height.
 */

export const GAUGE_HALF = 0.72;
export const DRIVER_RADIUS = 0.8;
export const SMALL_WHEEL_RADIUS = 0.42;

/** Axle positions (car-local z) for animated wheel sets. */
export const LOCO_LEADING_AXLES = [-3.95, -2.85];
export const LOCO_DRIVER_AXLES = [-0.35, 1.95];
export const TENDER_AXLES = [-3.0, -1.8, 1.8, 3.0];
export const FLATCAR_AXLES = [-5.4, -4.2, 4.2, 5.4];
export const CRANK_RADIUS = 0.36;
export const CYLINDER_Z = -3.4;
export const CYLINDER_Y = 0.95;

/** Profile in the car's ZY plane, extruded across X. Points are (z, y). */
function prismZY(
  b: MeshBuilder,
  swatch: Swatch,
  pts: Array<[number, number]>,
  width: number,
  x = 0,
): void {
  b.prism(
    swatch,
    pts.map(([z, y]) => [-z, y] as [number, number]),
    width,
    x,
    0,
    0,
    { ry: Math.PI / 2 },
  );
}

export function buildLocomotive(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const F = LOCO_FLOOR;

  // Pilot (cowcatcher): a red wedge with dark slats.
  prismZY(
    b,
    'locoRed',
    [
      [-4.6, 0.15],
      [-4.6, 0.92],
      [-5.05, 0.92],
      [-5.78, 0.15],
    ],
    1.9,
  );
  for (let i = -3; i <= 3; i++) {
    b.box('woodDark', i * 0.26, 0.55, -5.2, 0.06, 0.08, 0.9, { rx: -0.95 });
  }
  b.box('locoRed', 0, 0.86, -4.66, 2.15, 0.22, 0.2);
  b.box('iron', 0, 0.86, -4.9, 0.22, 0.16, 0.3); // coupler

  // Frame and running boards.
  b.boxMinMax('iron', -1.0, 0.45, -4.6, 1.0, 1.3, 2.6);
  b.boxMinMax('wood', -1.38, 1.3, -4.45, -0.7, F, 2.6);
  b.boxMinMax('wood', 0.7, 1.3, -4.45, 1.38, F, 2.6);
  b.boxMinMax('brassDark', -1.4, 1.26, -4.45, -1.36, F + 0.02, 2.6);
  b.boxMinMax('brassDark', 1.36, 1.26, -4.45, 1.4, F + 0.02, 2.6);

  // Cylinders and steam chests.
  for (const side of [-1, 1]) {
    b.cylinderZ('iron', side * 1.0, CYLINDER_Y, CYLINDER_Z, 0.3, 1.1, 10);
    b.cylinderZ('brass', side * 1.0, CYLINDER_Y, CYLINDER_Z - 0.57, 0.31, 0.06, 10);
    b.cylinderZ('brass', side * 1.0, CYLINDER_Y, CYLINDER_Z + 0.57, 0.31, 0.06, 10);
    b.box('ironLight', side * 1.0, CYLINDER_Y + 0.4, CYLINDER_Z, 0.4, 0.3, 0.9);
    // Crosshead guides.
    b.box('steel', side * 1.0, CYLINDER_Y + 0.12, CYLINDER_Z + 1.25, 0.08, 0.05, 1.4);
    b.box('steel', side * 1.0, CYLINDER_Y - 0.12, CYLINDER_Z + 1.25, 0.08, 0.05, 1.4);
  }

  // Smokebox, boiler and bands.
  b.cylinderZ('smokebox', 0, 2.3, -3.85, 0.82, 1.15, 14);
  b.cylinderZ('ironLight', 0, 2.3, -4.44, 0.7, 0.04, 14);
  b.cylinderZ('brass', 0, 2.3, -4.46, 0.18, 0.04, 8);
  b.cylinderZ('locoGreen', 0, 2.3, -0.35, 0.76, 5.9, 14);
  for (const z of [-3.15, -2.0, -0.2, 1.5, 2.45]) b.cylinderZ('brass', 0, 2.3, z, 0.785, 0.08, 14);
  // Saddle under the smokebox.
  b.boxMinMax('smokebox', -0.6, 1.3, -4.3, 0.6, 1.75, -3.35);

  // Balloon smokestack.
  b.cylinder('smokebox', 0, 3.35, -3.65, 0.26, 0.3, 0.7, 10);
  b.cylinder('smokebox', 0, 4.05, -3.65, 0.62, 0.26, 0.75, 12);
  b.cylinder('iron', 0, 4.5, -3.65, 0.6, 0.64, 0.16, 12);
  b.cylinder('ironLight', 0, 3.02, -3.65, 0.36, 0.36, 0.08, 10);

  // Headlamp on its bracket.
  b.box('iron', 0, 3.12, -4.15, 0.5, 0.06, 0.5);
  b.box('locoRed', 0, 3.47, -4.15, 0.55, 0.62, 0.6);
  b.cylinder('brass', 0, 3.86, -4.15, 0.08, 0.2, 0.16, 6);
  b.cylinderZ('brass', 0, 3.47, -4.46, 0.24, 0.04, 10);

  // Domes, bell and whistle.
  for (const [z, h] of [
    [-1.25, 0.5],
    [0.75, 0.55],
  ] as const) {
    b.cylinder('brass', 0, 3.05 + h / 2 - 0.1, z, 0.34, 0.4, h, 12);
    b.blob('brass', 0, 3.05 + h - 0.08, z, 0.34, 0.2, 0.34, 1);
  }
  b.box('iron', 0, 3.22, -0.2, 0.08, 0.3, 0.08);
  b.cylinder('brass', 0, 3.45, -0.2, 0.12, 0.2, 0.26, 8);
  b.cylinder('brass', 0, 3.75, 0.75, 0.05, 0.05, 0.3, 6);

  // Handrails along the boiler.
  for (const side of [-1, 1]) b.box('brass', side * 0.86, 2.65, -1.0, 0.04, 0.04, 6.6);

  // Sand pipes and a whistle cord would go here; keep it light.

  // Cab.
  const cz0 = 2.6;
  const cz1 = 5.75;
  b.boxMinMax('woodDark', -1.4, 1.25, cz0, 1.4, F, cz1); // floor
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -1.42 : 1.3;
    const x1 = side < 0 ? -1.3 : 1.42;
    // Lower wall, window posts and header.
    b.boxMinMax('locoRed', x0, F, cz0, x1, F + 1.05, 4.55);
    b.boxMinMax('locoRed', x0, F + 1.05, cz0, x1, 3.95, cz0 + 0.18);
    b.boxMinMax('locoRed', x0, F + 1.05, 3.45, x1, 3.95, 3.62);
    b.boxMinMax('locoRed', x0, F + 1.05, 4.4, x1, 3.95, 4.55);
    b.boxMinMax('locoRed', x0, 3.35, cz0, x1, 3.95, 4.55);
    b.boxMinMax('locoRedDark', x0 - 0.01, F + 1.0, cz0, x1 + 0.01, F + 1.08, 4.55);
    // Grab irons and steps at the side entrance.
    b.box('brass', side * 1.45, 2.4, 4.68, 0.04, 1.4, 0.04);
    b.boxMinMax('iron', side * 1.3 - 0.2, 0.2, 4.75, side * 1.3 + 0.2, 0.26, 5.35);
    b.boxMinMax('iron', side * 1.3 - 0.2, 0.75, 4.75, side * 1.3 + 0.2, 0.81, 5.35);
  }
  // Front wall around the boiler with windows.
  for (const side of [-1, 1]) {
    b.boxMinMax(
      'locoRed',
      side < 0 ? -1.42 : 0.76,
      F,
      cz0 - 0.02,
      side < 0 ? -0.76 : 1.42,
      F + 1.4,
      cz0 + 0.1,
    );
    b.boxMinMax(
      'locoRed',
      side < 0 ? -1.42 : 1.12,
      F + 1.4,
      cz0 - 0.02,
      side < 0 ? -1.12 : 1.42,
      3.95,
      cz0 + 0.1,
    );
  }
  b.boxMinMax('locoRed', -0.76, 3.05, cz0 - 0.02, 0.76, 3.95, cz0 + 0.1);
  // Roof with overhang, gently arched.
  b.boxMinMax('locoRedDark', -1.62, 3.95, 2.45, 1.62, 4.05, 5.9);
  b.boxMinMax('locoRedDark', -1.2, 4.05, 2.45, 1.2, 4.12, 5.9);
  // Backhead: firebox door, gauges, levers.
  b.boxMinMax('smokebox', -0.75, F, cz0 + 0.1, 0.75, 3.05, cz0 + 0.22);
  b.boxMinMax('iron', -0.32, F + 0.35, cz0 + 0.22, 0.32, F + 0.8, cz0 + 0.27);
  for (const gx of [-0.35, 0.05, 0.42]) {
    b.cylinderZ('brass', gx, 2.75, cz0 + 0.25, 0.12, 0.06, 10);
    b.cylinderZ('white', gx, 2.75, cz0 + 0.285, 0.1, 0.01, 10);
  }
  b.box('brass', 0.62, 2.5, cz0 + 0.55, 0.05, 0.05, 0.7, { rx: 0.5 }); // throttle lever
  b.box('iron', 0.95, F + 0.55, cz0 + 0.5, 0.06, 1.1, 0.06, { rx: -0.25 }); // reverser
  b.box('brass', 1.1, 2.25, cz0 + 0.35, 0.12, 0.12, 0.18); // brake valve
  // Seats.
  b.boxMinMax('woodDark', 0.75, 2.2, 4.0, 1.28, 2.32, 4.6);
  b.boxMinMax('woodDark', -1.28, 2.2, 4.0, -0.75, 2.32, 4.6);

  // Half-round splashers over the driving wheels.
  for (const side of [-1, 1]) {
    for (const z of LOCO_DRIVER_AXLES) {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI;
        pts.push([z + Math.cos(a) * 0.86, F - 0.62 + Math.sin(a) * 0.86]);
      }
      prismZY(b, 'locoRed', pts, 0.16, side * 1.0);
      b.boxMinMax(
        'brass',
        side * 1.0 - 0.09,
        F + 0.2,
        z - 0.05,
        side * 1.0 + 0.09,
        F + 0.26,
        z + 0.05,
      );
    }
  }
  return b.build();
}

export function buildTender(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const F = LOCO_FLOOR;
  const T = TENDER_TOP;
  b.boxMinMax('iron', -1.2, 0.5, -3.5, 1.2, 0.95, 3.5); // frame
  b.boxMinMax('woodDark', -1.3, 0.95, -3.5, 1.3, F, 3.5); // deck/apron
  // Tank and bunker walls.
  b.boxMinMax('locoRed', -1.45, F, -2.6, -1.25, T, 3.5);
  b.boxMinMax('locoRed', 1.25, F, -2.6, 1.45, T, 3.5);
  b.boxMinMax('locoRed', -1.25, F, 1.0, 1.25, T, 3.5);
  b.boxMinMax('locoRedDark', -1.47, T - 0.08, -2.6, 1.47, T + 0.02, -2.4);
  b.boxMinMax('locoRedDark', -1.47, T - 0.1, -2.6, -1.23, T + 0.04, 3.52);
  b.boxMinMax('locoRedDark', 1.23, T - 0.1, -2.6, 1.47, T + 0.04, 3.52);
  b.boxMinMax('brassDark', -1.47, F + 0.6, -2.62, 1.47, F + 0.66, 3.52);
  // Coal, stepped with lumpy tops.
  for (const [z0, z1, top] of TENDER_COAL_STEPS) {
    b.boxMinMax('coal', -1.25, F, z0, 1.25, top, z1);
    for (const x of [-0.8, 0, 0.8]) b.blob('coal', x, top, (z0 + z1) / 2, 0.42, 0.09, 0.36);
  }
  // Water hatch and tool box on the tank top.
  b.cylinder('iron', 0, T + 0.08, 2.4, 0.35, 0.35, 0.14, 10);
  b.boxMinMax('woodDark', -1.1, T, 2.9, -0.4, T + 0.3, 3.4);
  // Rear ladder.
  for (let i = 0; i < 5; i++)
    b.boxMinMax('iron', 0.5, 0.6 + i * 0.5, 3.5, 1.0, 0.64 + i * 0.5, 3.56);
  b.boxMinMax('iron', 0.48, 0.5, 3.5, 0.52, T, 3.56);
  b.boxMinMax('iron', 0.98, 0.5, 3.5, 1.02, T, 3.56);
  // Couplers.
  b.box('iron', 0, 0.86, -3.62, 0.22, 0.16, 0.25);
  b.box('iron', 0, 0.86, 3.62, 0.22, 0.16, 0.25);
  addTruckFrames(b, [-2.4, 2.4]);
  return b.build();
}

export function buildFlatcar(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const D = FLATCAR_DECK;
  b.boxMinMax('iron', -1.1, 0.55, -6.25, 1.1, 0.95, 6.25);
  b.boxMinMax('woodDark', -1.48, 0.95, -6.25, -1.3, D - 0.02, 6.25); // side sills
  b.boxMinMax('woodDark', 1.3, 0.95, -6.25, 1.48, D - 0.02, 6.25);
  // Deck planks with alternating tones.
  for (let i = 0; i < 18; i++) {
    const z0 = -6.25 + (i * 12.5) / 18;
    b.boxMinMax(
      i % 2 ? 'woodGray' : 'woodGrayDark',
      -1.46,
      D - 0.12,
      z0 + 0.01,
      1.46,
      D,
      z0 + 12.5 / 18 - 0.01,
    );
  }
  // Stake posts.
  for (let i = 0; i < 6; i++) {
    const z = -5.9 + i * 2.36;
    b.boxMinMax('wood', 1.36, D, z - 0.06, 1.46, D + 0.85, z + 0.06);
    b.boxMinMax('wood', -1.46, D, z - 0.06, -1.36, D + 0.85, z + 0.06);
  }
  // Brake wheel at the rear.
  b.box('iron', -1.0, D + 0.5, 6.1, 0.05, 1.0, 0.05);
  b.cylinder('iron', -1.0, D + 1.0, 6.1, 0.3, 0.3, 0.04, 10);
  b.box('iron', 0, 0.86, -6.37, 0.22, 0.16, 0.25);
  b.box('iron', 0, 0.86, 6.37, 0.22, 0.16, 0.25);
  addTruckFrames(b, [-4.8, 4.8]);
  return b.build();
}

/** Static bogie side frames; the wheels themselves are animated separately. */
function addTruckFrames(b: MeshBuilder, centres: number[]): void {
  for (const z of centres) {
    b.boxMinMax('iron', -0.9, 0.35, z - 0.15, 0.9, 0.55, z + 0.15); // bolster
    for (const side of [-1, 1]) {
      b.box('iron', side * 0.88, 0.42, z, 0.1, 0.22, 1.9);
      b.box('ironLight', side * 0.88, 0.42, z, 0.12, 0.12, 0.4);
    }
  }
}

/** One wheel set (two wheels and an axle) centred at the origin, axle along X. */
export function buildWheelSet(radius: number, driver: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const seg = driver ? 16 : 12;
  for (const side of [-1, 1]) {
    const x = side * GAUGE_HALF;
    b.cylinderX('iron', x, 0, 0, radius, 0.13, seg);
    b.cylinderX(driver ? 'locoRed' : 'ironLight', x + side * 0.02, 0, 0, radius * 0.86, 0.14, seg);
    b.cylinderX('iron', x + side * 0.05, 0, 0, radius * 0.22, 0.16, 8);
    if (driver) {
      // Spokes and counterweight make the rotation readable.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.box(
          'iron',
          x + side * 0.075,
          Math.sin(a) * radius * 0.45,
          Math.cos(a) * radius * 0.45,
          0.04,
          0.07,
          radius * 0.8,
          { rx: -a },
        );
      }
      b.box('iron', x + side * 0.08, -radius * 0.5, 0, 0.05, radius * 0.35, radius * 0.7);
      // Crank pin.
      b.cylinderX('steel', x + side * 0.16, CRANK_RADIUS, 0, 0.07, 0.18, 6);
    }
  }
  b.cylinderX('iron', 0, 0, 0, 0.08, GAUGE_HALF * 2, 6);
  return b.build();
}

/** Coupling rod joining the two drivers on one side, local origin at its centre. */
export function buildCouplingRod(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const len = LOCO_DRIVER_AXLES[1]! - LOCO_DRIVER_AXLES[0]!;
  b.box('steel', 0, 0, 0, 0.06, 0.12, len + 0.2);
  return b.build();
}

/** Main rod from the crosshead to the rear crank pin; origin at the crosshead, along +z. */
export function buildMainRod(length: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.box('steel', 0, 0, length / 2, 0.06, 0.13, length);
  b.box('ironLight', 0, 0, 0, 0.12, 0.2, 0.25);
  return b.build();
}
