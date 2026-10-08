import { beforeAll, describe, expect, it } from 'vitest';
import {
  Btn,
  DRIVER_SPOT,
  Frame,
  type InputFrame,
  ROUTE_LENGTH,
  SIM_DT,
  TRAIN,
  trainInteractables,
} from '@dead-tracks/shared';
import { Sim } from '../src/index.ts';

let seq = 0;
function input(over: Partial<InputFrame> = {}): InputFrame {
  return { seq: ++seq, mx: 0, my: 0, yaw: 0, pitch: 0, buttons: 0, frame: Frame.Train, ...over };
}

function tick(sim: Sim, id: string, inp: Partial<InputFrame> = {}, n = 1) {
  for (let i = 0; i < n; i++) {
    sim.pushInput(id, input(inp));
    sim.step(SIM_DT);
  }
}

/** Walk the player to an interactable and face it. */
function standAt(sim: Sim, id: string, which: 'controls' | 'firebox') {
  const it = trainInteractables().find((i) => i.id === which)!;
  const m = sim.players.get(id)!.motor;
  m.frame = Frame.Train;
  m.x = it.x;
  m.y = 1.4;
  m.z = it.tz + 0.9;
  m.vx = m.vy = m.vz = 0;
}

describe('Sim: the train runs', () => {
  let sim: Sim;
  beforeAll(async () => {
    sim = await Sim.create({ seed: 5 });
    sim.addPlayer('p1', 'Ada');
  });

  it('spawns the player standing on the train', () => {
    tick(sim, 'p1', {}, 10);
    const m = sim.players.get('p1')!.motor;
    expect(m.frame).toBe(Frame.Train);
    expect(m.grounded).toBe(true);
  });

  it('takes the controls, accelerates, burns fuel', () => {
    standAt(sim, 'p1', 'controls');
    tick(sim, 'p1', { pitch: -0.4, buttons: Btn.Interact });
    expect(sim.train.driver).toBe('p1');
    const m = sim.players.get('p1')!.motor;
    expect(m.driving).toBe(true);
    expect(m.z).toBeCloseTo(DRIVER_SPOT.z);
    const fuel0 = sim.train.fuel;
    const s0 = sim.train.s;
    tick(sim, 'p1', { my: 1 }, 30 * 20);
    expect(sim.train.throttle).toBe(1);
    expect(sim.train.speed).toBeGreaterThan(8);
    expect(sim.train.s).toBeGreaterThan(s0 + 50);
    expect(sim.train.fuel).toBeLessThan(fuel0);
  });

  it('brakes to a stop and only reverses when stopped', () => {
    tick(sim, 'p1', { my: -1 }, 30 * 3);
    expect(sim.train.throttle).toBe(0);
    tick(sim, 'p1', { buttons: Btn.Brake }, 30 * 15);
    expect(sim.train.speed).toBe(0);
    tick(sim, 'p1', { buttons: Btn.Reload });
    expect(sim.train.reverser).toBe(-1);
    tick(sim, 'p1', {}, 1);
    tick(sim, 'p1', { my: 1 }, 30 * 30);
    expect(sim.train.speed).toBeLessThan(0);
    expect(sim.train.speed).toBeGreaterThan(-TRAIN.maxReverseSpeed * 1.11);
  });

  it('stokes the firebox from the tender', () => {
    tick(sim, 'p1', { buttons: Btn.Interact });
    expect(sim.train.driver).toBe('');
    tick(sim, 'p1', {});
    standAt(sim, 'p1', 'firebox');
    sim.train.fuel = 10;
    const coal = sim.train.coal;
    tick(sim, 'p1', { pitch: -0.5, buttons: Btn.Interact });
    expect(sim.train.coal).toBe(coal - 1);
    expect(sim.train.fuel).toBeGreaterThan(30);
  });

  it('coasts to a stop with no fuel', async () => {
    const s = await Sim.create({ seed: 9 });
    s.addPlayer('x', 'X');
    s.train.throttle = 1;
    s.train.fuel = 3;
    s.train.coal = 0;
    for (let i = 0; i < 30 * 240; i++) s.step(SIM_DT);
    expect(s.train.fuel).toBe(0);
    expect(s.train.speed).toBe(0);
  });
});

describe('Sim: full-length drive', () => {
  it('drives the whole route (dev refuel) inside the tick budget', async () => {
    const sim = await Sim.create({ seed: 123 });
    sim.addPlayer('d', 'Driver');
    sim.train.throttle = 1;
    sim.train.pressure = 1;
    let maxTick = 0;
    let total = 0;
    let ticks = 0;
    while (sim.train.s < ROUTE_LENGTH && ticks < 30 * 60 * 40) {
      if (sim.train.fuel < 60) sim.train.fuel = 240;
      const t0 = performance.now();
      sim.step(SIM_DT);
      const dt = performance.now() - t0;
      maxTick = Math.max(maxTick, dt);
      total += dt;
      ticks++;
    }
    expect(sim.train.s).toBeGreaterThanOrEqual(ROUTE_LENGTH);
    const minutes = ticks / 30 / 60;
    // At ~20 m/s the 20 km route takes roughly 17–25 minutes of driving.
    expect(minutes).toBeGreaterThan(15);
    expect(minutes).toBeLessThan(30);
    expect(total / ticks).toBeLessThan(2);
    console.log(
      `drive: ${minutes.toFixed(1)} min, avg tick ${(total / ticks).toFixed(3)} ms, max ${maxTick.toFixed(2)} ms`,
    );
  });
});

describe('prediction parity', () => {
  it('a client-side motor fed the same inputs matches the host exactly', async () => {
    const {
      PhysicsSpace,
      initPhysics,
      makeMotorState,
      stepMotor,
      copyMotorState,
      Terrain,
      Route,
      computeCarPoses,
      makeCarPoses,
      CONSIST,
    } = await import('@dead-tracks/shared');
    const sim = await Sim.create({ seed: 42 });
    sim.addPlayer('p', 'P');
    sim.command('p', { t: 'dev', action: 'cab' });
    const R = await initPhysics();
    const route = new Route(42);
    const space = new PhysicsSpace(R, new Terrain(route));
    const poses = computeCarPoses(route, sim.train.s, makeCarPoses());
    const ctx = { space, poses, trainSpeed: 0 };
    const client = makeMotorState();
    copyMotorState(client, sim.players.get('p')!.motor);
    let seq = 1000;
    let maxErr = 0;
    for (let i = 0; i < 120; i++) {
      const inp = {
        seq: ++seq,
        mx: i % 40 < 20 ? 0.3 : -0.2,
        my: 1,
        yaw: Math.PI,
        pitch: 0,
        buttons: i % 25 === 0 ? Btn.Jump : 0,
        frame: Frame.Train,
      };
      stepMotor(ctx, client, inp, SIM_DT);
      sim.pushInput('p', inp);
      sim.step(SIM_DT);
      const host = sim.players.get('p')!.motor;
      maxErr = Math.max(
        maxErr,
        Math.hypot(host.x - client.x, host.y - client.y, host.z - client.z),
      );
    }
    const host = sim.players.get('p')!.motor;
    expect(host.z).toBeGreaterThan(CONSIST[1]!.z0);
    expect(maxErr).toBeLessThan(1e-6);
  });
});
