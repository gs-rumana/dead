/**
 * The train's layout (§4.3) in "train space": a straight train with z = 0 at the
 * front coupler and z increasing toward the rear, x to the right (facing forward),
 * y up from the rail tops. Players on the train move in this space (§6.8), so walking
 * on a curving, moving train is perfectly stable.
 *
 * Car-local coordinates use the car's centre as origin with the same axes.
 */

export interface ColliderBox {
  /** Centre in car-local coordinates. */
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface Interactable {
  id: 'controls' | 'firebox';
  /** Car-local position. */
  x: number;
  y: number;
  z: number;
  radius: number;
  prompt: string;
}

export interface CarDef {
  kind: 'loco' | 'tender' | 'flatcar';
  length: number;
  /** Car-local z of the front and rear pivots that ride the track. */
  pivotFront: number;
  pivotRear: number;
  colliders: ColliderBox[];
  interactables: Interactable[];
}

/** Box from min/max extents. */
function b(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): ColliderBox {
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    z: (z0 + z1) / 2,
    hx: (x1 - x0) / 2,
    hy: (y1 - y0) / 2,
    hz: (z1 - z0) / 2,
  };
}

/** Mirror a box across x = 0 and return both. */
function pair(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): ColliderBox[] {
  return [b(x0, x1, y0, y1, z0, z1), b(-x1, -x0, y0, y1, z0, z1)];
}

/** Rail tops sit this far above the top of the ballast (Route.heightAt). */
export const RAIL_TOP = 0.32;

/** Height of the walkable floors above the rail tops. */
export const LOCO_FLOOR = 1.4;
export const TENDER_TOP = 2.9;
export const FLATCAR_DECK = 1.25;

const LOCO: CarDef = {
  kind: 'loco',
  length: 11.5,
  pivotFront: -3.4,
  pivotRear: 1.9,
  colliders: [
    // Pilot (cowcatcher) and front beam.
    b(-1.0, 1.0, 0.15, 0.9, -5.75, -4.6),
    // Chassis and running boards.
    b(-1.35, 1.35, 0.35, LOCO_FLOOR, -4.6, 2.6),
    // Boiler.
    b(-0.75, 0.75, LOCO_FLOOR, 3.05, -4.35, 2.6),
    // Smokestack.
    b(-0.32, 0.32, 3.05, 4.6, -3.95, -3.3),
    // Steam and sand domes.
    b(-0.38, 0.38, 3.05, 3.55, -1.6, -0.9),
    b(-0.38, 0.38, 3.05, 3.5, 0.4, 1.1),
    // Cab floor.
    b(-1.4, 1.4, 0.35, LOCO_FLOOR, 2.6, 5.75),
    // Cab front wall beside and above the boiler.
    ...pair(0.75, 1.4, LOCO_FLOOR, 3.95, 2.6, 2.72),
    b(-0.75, 0.75, 3.05, 3.95, 2.6, 2.72),
    // Cab side walls with a side entrance at the rear.
    ...pair(1.3, 1.4, LOCO_FLOOR, 3.95, 2.72, 4.55),
    // Roof.
    b(-1.6, 1.6, 3.95, 4.08, 2.45, 5.9),
  ],
  interactables: [
    {
      id: 'controls',
      x: 0.9,
      y: LOCO_FLOOR + 1.0,
      z: 3.05,
      radius: 1.3,
      prompt: 'Take the controls',
    },
    { id: 'firebox', x: 0, y: LOCO_FLOOR + 0.6, z: 2.8, radius: 1.4, prompt: 'Shovel coal' },
  ],
};

/** Coal steps on the tender: [z0, z1, top] in car-local metres. */
export const TENDER_COAL_STEPS: Array<[number, number, number]> = [
  [-2.6, -1.7, 1.73],
  [-1.7, -0.8, 2.06],
  [-0.8, 0.1, 2.39],
  [0.1, 1.0, 2.68],
];

const TENDER: CarDef = {
  kind: 'tender',
  length: 7.0,
  pivotFront: -2.4,
  pivotRear: 2.4,
  colliders: [
    // Underframe and the fireman's apron at the front.
    b(-1.3, 1.3, 0.35, LOCO_FLOOR, -3.5, 3.5),
    // Coal bunker side walls.
    ...pair(1.25, 1.45, LOCO_FLOOR, TENDER_TOP, -2.6, 3.5),
    // Coal pile in four steps well under the auto-step height, so walking up it is
    // never borderline (borderline steps make prediction disagree with the host).
    ...TENDER_COAL_STEPS.map(([z0, z1, top]) => b(-1.25, 1.25, LOCO_FLOOR, top, z0, z1)),
    // Water tank.
    b(-1.25, 1.25, LOCO_FLOOR, TENDER_TOP, 1.0, 3.5),
  ],
  interactables: [],
};

const FLATCAR_STAKES: ColliderBox[] = [];
for (let i = 0; i < 6; i++) {
  const z = -5.9 + i * 2.36;
  FLATCAR_STAKES.push(...pair(1.36, 1.46, FLATCAR_DECK, FLATCAR_DECK + 0.85, z - 0.06, z + 0.06));
}

const FLATCAR: CarDef = {
  kind: 'flatcar',
  length: 12.5,
  pivotFront: -4.8,
  pivotRear: 4.8,
  colliders: [b(-1.46, 1.46, 0.35, FLATCAR_DECK, -6.25, 6.25), ...FLATCAR_STAKES],
  interactables: [],
};

export const CAR_GAP = 0.9;

export interface CarLayout {
  def: CarDef;
  index: number;
  /** Train-space z of the car's front, centre and rear. */
  z0: number;
  zc: number;
  z1: number;
}

/** The v1 consist: locomotive, tender, one flatcar. */
export const CONSIST: readonly CarLayout[] = (() => {
  const defs = [LOCO, TENDER, FLATCAR];
  const out: CarLayout[] = [];
  let z = 0;
  defs.forEach((def, index) => {
    out.push({ def, index, z0: z, zc: z + def.length / 2, z1: z + def.length });
    z += def.length + CAR_GAP;
  });
  return out;
})();

export const TRAIN_LENGTH = (CONSIST[CONSIST.length - 1] as CarLayout).z1;

/** Gangway plates bridging the gaps between cars, in train space. */
export const GAP_PLATES: ColliderBox[] = [
  // Cab to tender apron: same floor height.
  b(-0.9, 0.9, LOCO_FLOOR - 0.08, LOCO_FLOOR, CONSIST[0]!.z1 - 0.3, CONSIST[1]!.z0 + 0.3),
];

/** Cargo slots on the flatcar deck (§4.8 snap placement), in train space. */
export const CARGO_SLOTS: Array<{ x: number; y: number; z: number }> = (() => {
  const flat = CONSIST[2]!;
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (let row = 0; row < 5; row++) {
    for (const x of [-0.75, 0.75]) out.push({ x, y: FLATCAR_DECK, z: flat.z0 + 1.6 + row * 2.3 });
  }
  return out;
})();

/** Fortification points along the train's sides (§4.3): plates and wire snap here. */
export const FORT_POINTS: Array<{ x: number; y: number; z: number; z0: number; z1: number }> =
  (() => {
    const out: Array<{ x: number; y: number; z: number; z0: number; z1: number }> = [];
    const flat = CONSIST[2]!;
    const tender = CONSIST[1]!;
    const loco = CONSIST[0]!;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const z0 = flat.z0 + i * (flat.def.length / 4);
        const z1 = z0 + flat.def.length / 4;
        out.push({ x: side * 1.5, y: FLATCAR_DECK + 0.5, z: (z0 + z1) / 2, z0, z1 });
      }
      out.push({ x: side * 1.5, y: LOCO_FLOOR + 0.6, z: tender.zc, z0: tender.z0, z1: tender.z1 });
      out.push({
        x: side * 1.5,
        y: LOCO_FLOOR + 0.6,
        z: loco.zc + 4.1,
        z0: loco.zc + 2.6,
        z1: loco.z1,
      });
    }
    return out;
  })();

/** Climbable ladders on the train (train space): the tender's rear ladder. */
export const TRAIN_LADDERS: ColliderBox[] = [
  b(0.4, 1.1, 0.3, TENDER_TOP + 0.6, CONSIST[1]!.z1 - 0.05, CONSIST[1]!.z1 + 0.45),
];

/** Interactables resolved to train space. */
export function trainInteractables(): Array<Interactable & { tz: number }> {
  const out: Array<Interactable & { tz: number }> = [];
  for (const car of CONSIST) {
    for (const it of car.def.interactables) out.push({ ...it, tz: car.zc + it.z });
  }
  return out;
}

/** True if a train-space point is within the train's walkable envelope. */
export function insideTrainBounds(x: number, y: number, z: number): boolean {
  return Math.abs(x) < 1.62 && z > -0.2 && z < TRAIN_LENGTH + 0.2 && y > -0.4 && y < 6;
}
