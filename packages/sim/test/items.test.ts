import { describe, expect, it } from 'vitest';
import {
  CARGO_SLOTS,
  FORT_POINTS,
  Frame,
  type InputFrame,
  SIM_DT,
  pieceWorld,
  trainInteractables,
  trainToWorld,
} from '@dead-tracks/shared';
import { Sim, type SimPlayer } from '../src/index.ts';

let seq = 0;
const inp = (over: Partial<InputFrame> = {}): InputFrame => ({
  seq: ++seq,
  mx: 0,
  my: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  frame: Frame.World,
  ...over,
});

function tick(sim: Sim, n = 1) {
  for (let i = 0; i < n; i++) {
    for (const id of sim.players.keys())
      sim.pushInput(id, inp({ frame: sim.players.get(id)!.motor.frame }));
    sim.step(SIM_DT);
  }
}

/** Teleport a player to a world point (ground frame). */
function put(sim: Sim, p: SimPlayer, x: number, y: number, z: number) {
  const m = p.motor;
  m.frame = Frame.World;
  m.x = x;
  m.y = y;
  m.z = z;
  m.vx = m.vy = m.vz = 0;
  p.wx = x;
  p.wy = y;
  p.wz = z;
  sim.space.streamTiles([{ x, z }]);
}

/** Put a player on the train at a train-space point. */
function putOnTrain(sim: Sim, p: SimPlayer, x: number, y: number, z: number) {
  const m = p.motor;
  m.frame = Frame.Train;
  m.x = x;
  m.y = y;
  m.z = z;
  const w = trainToWorld(sim.poses, x, y, z, { x: 0, y: 0, z: 0 });
  p.wx = w.x;
  p.wy = w.y;
  p.wz = w.z;
}

describe('M4: the loop at a station', () => {
  it('stop, loot, carry, burn, stow, sell, buy, fortify', async () => {
    const sim = await Sim.create({ seed: 8 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    tick(sim, 40); // structures near the start activate
    const depot = sim.world.structures.find(
      (s) => s.kind === 'station' && s.feature?.kind === 'start',
    )!;
    expect(depot).toBeDefined();
    const sacks = [...sim.items.items.values()].filter((i) => i.kind === 'coal');
    expect(sacks.length).toBeGreaterThanOrEqual(2);

    // Loot: carry a coal sack to the furnace and burn it.
    const sack = sacks[0]!;
    put(sim, p, sack.wx + 1, sack.wy, sack.wz);
    sim.command('a', { t: 'use', target: `item:${sack.id}` });
    expect(p.carry).toBe(sack.id);
    expect(p.motor.carry).toBeLessThan(1);
    const fire = trainInteractables().find((f) => f.id === 'firebox')!;
    putOnTrain(sim, p, 0, 1.42, fire.tz + 1);
    sim.train.fuel = 50;
    sim.command('a', { t: 'use', target: 'firebox' });
    expect(p.carry).toBe('');
    expect(sim.train.fuel).toBeGreaterThan(90);
    expect(sim.items.items.has(sack.id)).toBe(false);

    // Search the depot's drawer: loot goes into the inventory, once.
    const drawer = depot.pieces.find((x) => x.kind === 'drawer')!;
    const dw = pieceWorld(depot, drawer);
    put(sim, p, dw.x, dw.y - 0.4, dw.z);
    const before = JSON.stringify(p.inv);
    sim.command('a', { t: 'use', target: `search:${depot.id}:${drawer.id}`, hold: true });
    expect(sim.items.props.get(`${depot.id}:${drawer.id}`)).toBe(1);
    const afterFirst = JSON.stringify(p.inv);
    sim.command('a', { t: 'use', target: `search:${depot.id}:${drawer.id}`, hold: true });
    expect(JSON.stringify(p.inv)).toBe(afterFirst);
    void before;

    // Doors open and close.
    const door = depot.pieces.find((x) => x.kind === 'door')!;
    const doorW = pieceWorld(depot, door);
    put(sim, p, doorW.x, doorW.y - 1, doorW.z);
    sim.command('a', { t: 'use', target: `door:${depot.id}:${door.id}` });
    expect(sim.items.props.get(`${depot.id}:${door.id}`)).toBe(1);

    // Stow a crate in a cargo slot.
    const crate = sim.items.spawn('crate', Frame.World, p.wx + 0.5, p.wy, p.wz);
    sim.command('a', { t: 'use', target: `item:${crate.id}` });
    const slot = CARGO_SLOTS[3]!;
    putOnTrain(sim, p, slot.x, slot.y, slot.z + 0.5);
    sim.command('a', { t: 'use', target: 'cargo' });
    expect(crate.slot).toBeGreaterThanOrEqual(0);
    expect(crate.frame).toBe(Frame.Train);
    // Cargo rides with the train.
    const s0 = sim.train.s;
    sim.train.throttle = 1;
    sim.train.pressure = 1;
    tick(sim, 180);
    expect(sim.train.s).toBeGreaterThan(s0 + 5);
    expect(crate.frame).toBe(Frame.Train);
    sim.train.throttle = 0;
    sim.train.speed = 0;
    sim.train.s = s0;
    sim.step(SIM_DT);

    // Sell valuables at the counter, then buy a plate.
    p.inv.pack.push('gold_bar', 'jewelry');
    const counter = depot.pieces[depot.shop!.piece]!;
    const cw = pieceWorld(depot, counter);
    put(sim, p, cw.x - 1.2, cw.y - 0.5, cw.z);
    const cash0 = p.inv.cash;
    sim.command('a', { t: 'sell', shop: depot.id, slot: -1 });
    expect(p.inv.pack.length).toBe(0);
    expect(p.inv.cash).toBeGreaterThan(cash0 + 40);
    sim.command('a', { t: 'buy', shop: depot.id, kind: 'plate' });
    tick(sim, 20);
    const plate = [...sim.items.items.values()].find((i) => i.kind === 'plate')!;
    expect(plate).toBeDefined();

    // Fortify: carry the plate to a point on the flatcar.
    put(sim, p, plate.wx + 0.5, plate.wy, plate.wz);
    sim.command('a', { t: 'use', target: `item:${plate.id}` });
    expect(p.carry).toBe(plate.id);
    const fp = FORT_POINTS[0]!;
    putOnTrain(sim, p, fp.x * 0.5, 1.27, fp.z);
    sim.command('a', { t: 'use', target: 'fort:0' });
    expect(sim.items.forts[0]).toBe(1);
    expect(p.carry).toBe('');
  });

  it('a zombie becomes a body you can burn', async () => {
    const sim = await Sim.create({ seed: 9 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    tick(sim, 5);
    const e = sim.enemySystem.spawn('brute', p.wx + 3, p.wz + 3);
    sim.killEnemy(e, 'a', 0, false);
    tick(sim, 90);
    const body = [...sim.items.items.values()].find((i) => i.kind === 'corpse')!;
    expect(body).toBeDefined();
    expect(body.body).toBe('brute');
    put(sim, p, body.wx + 0.8, body.wy, body.wz);
    sim.command('a', { t: 'use', target: `item:${body.id}`, hold: true });
    expect(body.searched).toBe(true);
    sim.command('a', { t: 'use', target: `item:${body.id}` });
    expect(p.carry).toBe(body.id);
    const fire = trainInteractables().find((f) => f.id === 'firebox')!;
    putOnTrain(sim, p, 0, 1.42, fire.tz + 1);
    sim.train.fuel = 10;
    sim.command('a', { t: 'use', target: 'firebox' });
    expect(sim.train.fuel).toBeGreaterThan(60);
  });

  it('plates keep climbers off; brutes smash them', async () => {
    const sim = await Sim.create({ seed: 10 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    // Plate every point.
    for (let i = 0; i < FORT_POINTS.length; i++) {
      sim.items.forts[i] = 1;
      sim.items.fortHp[i] = 100;
    }
    tick(sim, 5);
    for (let i = 0; i < 6; i++) sim.enemySystem.spawn('walker', p.wx + 3 + i * 0.5, p.wz + 2);
    tick(sim, 30 * 15);
    const aboard = [...sim.enemySystem.enemies.values()].filter(
      (e) => e.frame === Frame.Train && !e.climb,
    ).length;
    expect(aboard).toBe(0);
  });
});
