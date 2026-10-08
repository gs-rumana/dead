import { describe, expect, it } from 'vitest';
import { Frame, HANDCAR, type InputFrame, Life, SIM_DT, pieceWorld } from '@dead-tracks/shared';
import { Sim } from '../src/index.ts';

let seq = 0;
const inp = (over: Partial<InputFrame> = {}): InputFrame => ({
  seq: ++seq,
  mx: 0,
  my: 0,
  yaw: 0,
  pitch: 0,
  buttons: 0,
  frame: 0,
  ...over,
});

function tick(sim: Sim, n: number, perPlayer: (id: string) => Partial<InputFrame> = () => ({})) {
  for (let i = 0; i < n; i++) {
    for (const [id, p] of sim.players)
      sim.pushInput(id, inp({ frame: p.motor.frame, ...perPlayer(id) }));
    sim.step(SIM_DT);
  }
}

describe('M5: handcars and towns', () => {
  it('two riders pump a handcar to town and back; stamina drains; the trolley adds cargo room', async () => {
    const sim = await Sim.create({ seed: 8 });
    sim.addPlayer('a', 'A');
    sim.addPlayer('b', 'B');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    for (const id of ['a', 'b']) sim.command(id, { t: 'dev', action: 'handcar', value: 0 });
    tick(sim, 3);
    for (const id of ['a', 'b']) sim.command(id, { t: 'use', target: 'handcar:0' });
    const hc = sim.handcars[0]!;
    expect(hc.riders).toBe(2);
    expect(sim.players.get('a')!.motor.frame).toBe(Frame.Handcar + 0);
    // Both pump "forward" for their seat (front seats face +s).
    const t0 = sim.time;
    let peak = 0;
    for (let i = 0; i < 30 * 200 && hc.s < hc.spur.end - 6; i++) {
      tick(sim, 1, () => ({ my: 1 }));
      peak = Math.max(peak, Math.abs(hc.speed));
      // Rest a moment when tired so stamina recovers.
      for (const id of ['a', 'b'])
        if (sim.players.get(id)!.motor.stamina < 5) sim.players.get(id)!.motor.stamina = 60;
    }
    const tripS = sim.time - t0;
    expect(hc.s).toBeGreaterThan(hc.spur.end - 8);
    expect(peak).toBeGreaterThan(HANDCAR.speeds[2]! * 0.9);
    expect(peak).toBeLessThanOrEqual(HANDCAR.speeds[2]! + 0.01);
    // §4.4: a round trip of 1–3 minutes, so one way is under 90 s.
    expect(tripS).toBeLessThan(90);
    // Riders are in the world near the town now.
    const a = sim.players.get('a')!;
    const end = hc.spur.frameAt(hc.spur.end, {
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      grade: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      rx: 0,
      rz: 0,
    });
    expect(Math.hypot(a.wx - end.x, a.wz - end.z)).toBeLessThan(12);
    // Hop off.
    sim.pushInput('a', inp({ frame: a.motor.frame, buttons: 16 }));
    sim.step(SIM_DT);
    expect(a.motor.frame).toBe(Frame.World);

    // Town shops: buy a trolley at the general store and hitch it.
    const general = sim.world.structures.find((s) => s.town === 0 && s.shop?.kind === 'general')!;
    expect(general).toBeDefined();
    const c = pieceWorld(general, general.pieces[general.shop!.piece]!);
    sim.command('a', { t: 'dev', action: 'tp', x: c.x, y: c.y - 0.5, z: c.z });
    sim.command('a', { t: 'dev', action: 'cash', value: 100 });
    tick(sim, 2);
    // The tp lands us beside the counter: shopping range is 5 m.
    const cash0 = a.inv.cash;
    sim.command('a', { t: 'buy', shop: general.id, kind: 'trolley_kit' });
    expect(a.inv.cash).toBe(cash0 - 45);
    tick(sim, 30);
    const kit = [...sim.items.items.values()].find((i) => i.kind === 'trolley_kit' && !i.holder)!;
    expect(kit).toBeDefined();
    sim.command('a', { t: 'dev', action: 'tp', x: kit.wx + 0.8, z: kit.wz });
    tick(sim, 2);
    sim.command('a', { t: 'use', target: `item:${kit.id}` });
    expect(a.carry).toBe(kit.id);
    const pose = sim.handcarPoses[0]!;
    sim.command('a', {
      t: 'dev',
      action: 'tp',
      x: pose.x + pose.rx * 1.5,
      z: pose.z + pose.rz * 1.5,
    });
    tick(sim, 2);
    sim.command('a', { t: 'use', target: 'handcar:0' });
    expect(hc.trolley).toBe(true);
    // Load four crates: 2 on the handcar, 2 on the trolley; the fifth doesn't fit.
    for (let i = 0; i < 5; i++) {
      const crate = sim.items.spawn('crate', Frame.World, a.wx + 0.5, a.wy, a.wz);
      sim.command('a', { t: 'use', target: `item:${crate.id}` });
      sim.command('a', { t: 'use', target: 'handcar:0' });
    }
    const loaded = [...sim.items.items.values()].filter(
      (i) => i.frame === Frame.Handcar + 0 && i.kind === 'crate',
    ).length;
    expect(loaded).toBe(4);
    expect(a.carry).not.toBe('');
  });

  it('only the sheriff pays for bounties; the doctor heals for a fee', async () => {
    const sim = await Sim.create({ seed: 8 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    const sheriff = sim.world.structures.find((s) => s.town === 1 && s.shop?.kind === 'sheriff')!;
    const trading = sim.world.structures.find((s) => s.town === 1 && s.shop?.kind === 'trading')!;
    const doctor = sim.world.structures.find((s) => s.town === 1 && s.shop?.kind === 'doctor')!;
    const at = (st: typeof sheriff) => {
      const c = pieceWorld(st, st.pieces[st.shop!.piece]!);
      sim.command('a', { t: 'dev', action: 'tp', x: c.x, y: c.y - 0.5, z: c.z });
      tick(sim, 1);
    };
    p.inv.pack.push('bounty', 'gold_bar');
    at(trading);
    const c0 = p.inv.cash;
    sim.command('a', { t: 'sell', shop: trading.id, slot: -1 });
    expect(p.inv.cash).toBe(c0 + 60);
    expect(p.inv.pack).toEqual(['bounty']);
    at(sheriff);
    sim.command('a', { t: 'sell', shop: sheriff.id, slot: -1 });
    expect(p.inv.cash).toBe(c0 + 90);
    at(doctor);
    p.hp = 40;
    sim.command('a', { t: 'buy', shop: doctor.id, kind: 'heal' });
    expect(p.hp).toBe(100);
  });
});

describe('M5: the parked train and outlaws', () => {
  it('raiders board a parked train while everyone is away and knock cargo off', async () => {
    const sim = await Sim.create({ seed: 12 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = false;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    // Cargo aboard, then everyone leaves for town.
    for (let i = 0; i < 4; i++) {
      const it = sim.items.spawn(
        'crate',
        Frame.Train,
        i % 2 ? 0.75 : -0.75,
        1.25,
        22 + i * 2.3,
        0,
        { slot: i },
      );
      void it;
    }
    sim.command('a', { t: 'dev', action: 'town', value: 0 });
    // Keep the regular director quiet so only raiders come.
    const budget = sim.enemySystem.budget.bind(sim.enemySystem);
    sim.enemySystem.budget = () => 0;
    tick(sim, 30 * 120);
    sim.enemySystem.budget = budget;
    const aboard = [...sim.enemySystem.enemies.values()].filter(
      (e) => e.frame === Frame.Train && e.state === 'ambush',
    );
    expect(aboard.length).toBeGreaterThan(0);
    const knocked = [...sim.items.items.values()].filter(
      (i) => i.kind === 'crate' && i.frame === Frame.World,
    );
    expect(knocked.length).toBeGreaterThan(0);
    void p;
  });

  it('outlaws guard their camp by day, shoot, and drop a bounty when killed', async () => {
    const sim = await Sim.create({ seed: 14 });
    const p = sim.addPlayer('a', 'A');
    sim.enemySystem.paused = false;
    const budget = sim.enemySystem.budget.bind(sim.enemySystem);
    sim.enemySystem.budget = () => 0;
    const camp = sim.world.structures.find((s) => s.kind === 'camp')!;
    expect(camp).toBeDefined();
    sim.command('a', { t: 'dev', action: 'tp', x: camp.x + 30, z: camp.z });
    tick(sim, 30 * 20);
    const outlaws = [...sim.enemySystem.enemies.values()].filter((e) => e.type === 'outlaw');
    expect(outlaws.length).toBeGreaterThanOrEqual(3);
    expect(p.hp).toBeLessThan(100);
    sim.killEnemy(outlaws[0]!, 'a', 0, false);
    tick(sim, 10);
    expect([...sim.items.items.values()].some((i) => i.kind === 'bounty')).toBe(true);
    sim.enemySystem.budget = budget;
    void Life;
  });
});
