import { beforeAll, describe, expect, it } from 'vitest';
import {
  Btn,
  CONSIST,
  FLATCAR_DECK,
  Frame,
  type InputFrame,
  type MotorContext,
  PhysicsSpace,
  Route,
  SIM_DT,
  Terrain,
  computeCarPoses,
  initPhysics,
  makeCarPoses,
  makeMotorState,
  stepMotor,
  trainToWorld,
  trainYawAt,
} from '../src/index.ts';

let ctx: MotorContext;
const route = new Route(11);
const terrain = new Terrain(route);
const TRAIN_S = 200;

beforeAll(async () => {
  const R = await initPhysics();
  const space = new PhysicsSpace(R, terrain);
  const poses = computeCarPoses(route, TRAIN_S, makeCarPoses());
  space.setTrainPoses(poses);
  ctx = { space, poses, trainSpeed: 0 };
});

function input(seq: number, over: Partial<InputFrame> = {}): InputFrame {
  return { seq, mx: 0, my: 0, yaw: 0, pitch: 0, buttons: 0, frame: Frame.World, ...over };
}

function run(st: ReturnType<typeof makeMotorState>, ticks: number, mk: (i: number) => InputFrame) {
  for (let i = 0; i < ticks; i++) {
    ctx.space.streamTiles([trainToWorldIfNeeded(st)]);
    ctx.space.refresh();
    stepMotor(ctx, st, mk(i), SIM_DT);
  }
}

function trainToWorldIfNeeded(st: ReturnType<typeof makeMotorState>) {
  if (st.frame === Frame.World) return { x: st.x, z: st.z };
  return trainToWorld(ctx.poses, st.x, st.y, st.z, { x: 0, y: 0, z: 0 });
}

describe('character motor', () => {
  it('walks on terrain and stays on the ground', () => {
    const st = makeMotorState();
    st.x = 60;
    st.z = 40;
    st.y = terrain.height(60, 40) + 1;
    run(st, 60, (i) => input(i + 1, { my: 1 }));
    expect(st.grounded).toBe(true);
    expect(st.z).toBeLessThan(40 - 4);
    expect(Math.abs(st.y - terrain.height(st.x, st.z))).toBeLessThan(0.15);
  });

  it('mantles from the ground onto the flatcar deck and switches to train space', () => {
    const flat = CONSIST[2]!;
    // Stand on the ground beside the flatcar, facing it (left side, looking right).
    const side = trainToWorld(ctx.poses, -2.3, 0, flat.zc, { x: 0, y: 0, z: 0 });
    const st = makeMotorState();
    st.x = side.x;
    st.z = side.z;
    st.y = terrain.height(side.x, side.z) + 0.5;
    // Settle onto the ground.
    run(st, 20, (i) => input(i + 1));
    expect(st.grounded).toBe(true);
    // Face the car: yaw so forward points to the train's right (+x in train space).
    const yaw = trainYawAt(ctx.poses, flat.zc) - Math.PI / 2;
    let seq = 100;
    // Walk up to the car, then jump at it.
    run(st, 15, () => input(++seq, { yaw, my: 1 }));
    run(st, 1, () => input(++seq, { yaw, my: 1, buttons: Btn.Jump }));
    run(st, 30, () => input(++seq, { yaw, my: 0.2, frame: st.frame }));
    expect(st.frame).toBe(Frame.Train);
    expect(st.y).toBeGreaterThan(FLATCAR_DECK - 0.1);
    expect(st.y).toBeLessThan(FLATCAR_DECK + 0.2);
    expect(st.grounded).toBe(true);
  });

  it('walks off the side of the train into world space and lands on the ground', () => {
    const flat = CONSIST[2]!;
    const st = makeMotorState();
    st.frame = Frame.Train;
    st.x = 0;
    st.y = FLATCAR_DECK + 0.05;
    st.z = flat.zc;
    // In train space, yaw -PI/2 faces +x (right).
    run(st, 60, (i) => input(i + 1, { yaw: -Math.PI / 2, my: 1, frame: Frame.Train }));
    expect(st.frame).toBe(Frame.World);
    run(st, 30, (i) => input(i + 100, { frame: Frame.World }));
    expect(st.grounded).toBe(true);
    expect(Math.abs(st.y - terrain.height(st.x, st.z))).toBeLessThan(0.3);
  });

  it('walks the length of the train from the flatcar to the cab', () => {
    const st = makeMotorState();
    st.frame = Frame.Train;
    st.x = 0;
    st.y = FLATCAR_DECK + 0.05;
    st.z = CONSIST[2]!.zc;
    // Forward (yaw 0) is toward the front (-z). Jump/mantle up onto the tender, then on.
    let seq = 0;
    for (let i = 0; i < 400 && st.z > CONSIST[0]!.zc + 3; i++) {
      const jump = i % 12 === 0 ? Btn.Jump : 0;
      run(st, 1, () => input(++seq, { my: 1, buttons: jump, frame: Frame.Train }));
    }
    expect(st.frame).toBe(Frame.Train);
    expect(st.z).toBeLessThan(CONSIST[0]!.zc + 3.1);
  });
});
