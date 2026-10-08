import { describe, expect, it } from 'vitest';
import {
  CLASS_IDS,
  type InputFrame,
  Life,
  PERKS,
  PROTOCOL_VERSION,
  SIM_DT,
  TRAIN,
  WORLD,
  pieceWorld,
} from '@dead-tracks/shared';
import { Sim } from '../src/index.ts';
import { type AwardReport, type HostClient, RunHost } from '../src/host/RunHost.ts';

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
function tick(sim: Sim, n: number) {
  for (let i = 0; i < n; i++) {
    for (const [id, p] of sim.players) sim.pushInput(id, inp({ frame: p.motor.frame }));
    sim.step(SIM_DT);
  }
}

describe('M7: classes (§4.11)', () => {
  it('each class starts with its kit', async () => {
    const sim = await Sim.create({ seed: 31 });
    for (const c of CLASS_IDS) sim.addPlayer(c, c, c);
    const inv = (c: string) => sim.players.get(c)!.inv;
    expect(inv('drifter').slots.slice(0, 2)).toEqual(['revolver', 'shovel']);
    expect(inv('medic').bandage).toBe(3);
    expect(inv('engineer').slots.slice(0, 2)).toEqual(['coachgun', 'hatchet']);
    expect(inv('gunslinger').mags[0]).toBe(12);
    expect(inv('prospector').slots[0]).toBe('shovel');
    expect(inv('preacher').holywater).toBe(2);
  });

  it('medics revive faster and heal more', async () => {
    const run = async (cls: 'drifter' | 'medic') => {
      const sim = await Sim.create({ seed: 32 });
      sim.addPlayer('a', 'A', cls);
      sim.addPlayer('b', 'B');
      tick(sim, 2);
      const b = sim.players.get('b')!;
      b.hp = 1;
      sim.damagePlayer(b, 50, b.wx + 1, b.wz, '');
      expect(b.life).toBe(Life.Downed);
      // Stand next to them and hold E.
      const a = sim.players.get('a')!;
      a.motor.frame = b.motor.frame;
      a.motor.x = b.motor.x + 0.6;
      a.motor.y = b.motor.y;
      a.motor.z = b.motor.z;
      let t = 0;
      while (b.life === Life.Downed && t < 30 * 20) {
        sim.pushInput('a', inp({ frame: a.motor.frame, buttons: 16 }));
        sim.pushInput('b', inp({ frame: b.motor.frame }));
        sim.step(SIM_DT);
        t++;
      }
      return { ticks: t, hp: b.hp };
    };
    const d = await run('drifter');
    const m = await run('medic');
    expect(m.ticks).toBeLessThan(d.ticks * 0.75);
    expect(m.hp).toBeGreaterThan(d.hp);
  });

  it('an Engineer aboard makes the fire last longer', async () => {
    const burn = async (cls: 'drifter' | 'engineer') => {
      const sim = await Sim.create({ seed: 33 });
      sim.addPlayer('a', 'A', cls);
      sim.train.throttle = 1;
      sim.train.pressure = 1;
      sim.train.fuel = 200;
      tick(sim, 30 * 30);
      return 200 - sim.train.fuel;
    };
    const d = await burn('drifter');
    const e = await burn('engineer');
    expect(e / d).toBeCloseTo(PERKS.engineerBurn, 1);
    expect(TRAIN.burnAtCruise).toBeGreaterThan(0);
  });

  it('Preachers hit vampires harder; Prospectors sell for more', async () => {
    const sim = await Sim.create({ seed: 34 });
    sim.addPlayer('p', 'P', 'preacher');
    sim.addPlayer('d', 'D');
    sim.enemySystem.paused = true;
    const v1 = sim.enemySystem.spawn('vampire', 0, 50);
    const v2 = sim.enemySystem.spawn('vampire', 0, 60);
    sim.combat.damageEnemy(v1, 30, 0, 'p', 0, 0, 0);
    sim.combat.damageEnemy(v2, 30, 0, 'd', 0, 0, 0);
    expect(v1.maxHp - v1.hp).toBeCloseTo(30 * PERKS.preacherHoly);
    expect(v2.maxHp - v2.hp).toBeCloseTo(30);

    // Selling the same jewelry at the depot store.
    const sell = async (cls: 'drifter' | 'prospector') => {
      const s2 = await Sim.create({ seed: 35 });
      s2.addPlayer('a', 'A', cls);
      const st = s2.world.structures.find((x) => x.shop && x.kind === 'station')!;
      const c = pieceWorld(st, st.pieces[st.shop!.piece]!);
      s2.command('a', { t: 'dev', action: 'tp', x: c.x - 1, y: c.y - 0.4, z: c.z });
      tick(s2, 2);
      const a = s2.players.get('a')!;
      a.inv.pack.push('jewelry');
      const cash = a.inv.cash;
      s2.command('a', { t: 'sell', shop: st.id, slot: -1 });
      return a.inv.cash - cash;
    };
    const plain = await sell('drifter');
    const pro = await sell('prospector');
    expect(plain).toBeGreaterThan(0);
    expect(pro).toBe(Math.round(plain * PERKS.prospectorSell));
  });

  it('gunslingers reload faster and carry 12 rounds', async () => {
    const sim = await Sim.create({ seed: 36 });
    sim.addPlayer('g', 'G', 'gunslinger');
    sim.addPlayer('d', 'D');
    for (const id of ['g', 'd']) {
      const p = sim.players.get(id)!;
      p.inv.mags[0] = 0;
      sim.combat.reload(p);
    }
    const g = sim.players.get('g')!.inv.reload;
    const d = sim.players.get('d')!.inv.reload;
    expect(g / d).toBeCloseTo(PERKS.gunslingerReload);
    tick(sim, 30 * 10);
    expect(sim.players.get('g')!.inv.mags[0]).toBe(12);
    expect(sim.players.get('d')!.inv.mags[0]).toBe(6);
  });
});

describe('M7: pings (§4.14)', () => {
  it('broadcasts pings near the player, rate limited', async () => {
    const sim = await Sim.create({ seed: 37 });
    sim.addPlayer('a', 'A');
    tick(sim, 2);
    const a = sim.players.get('a')!;
    sim.command('a', { t: 'ping', kind: 0, x: a.wx + 5, y: a.wy, z: a.wz });
    sim.command('a', { t: 'ping', kind: 1, x: a.wx + 5, y: a.wy, z: a.wz });
    tick(sim, 30);
    sim.command('a', { t: 'ping', kind: 99, x: a.wx, y: a.wy, z: a.wz });
    sim.command('a', { t: 'ping', kind: 4, x: a.wx + 5000, y: a.wy, z: a.wz });
    sim.command('a', { t: 'ping', kind: 4, x: a.wx + 9, y: a.wy, z: a.wz, target: '12' });
    const pings = sim.drainEvents().filter((e) => e.ev.e === 'ping');
    expect(pings.map((p) => (p.ev as { kind: number }).kind)).toEqual([0, 4]);
    expect((pings[1]!.ev as { target?: string }).target).toBe('12');
  });
});

describe('M7: bonds from runs (§4.10)', () => {
  const client = (id: string): HostClient => ({ id, send: () => {} });

  it('pays each account once: on leaving early and at the end', async () => {
    const host = await RunHost.create({ seed: 38, code: 'TEST', allowDev: false });
    const awards: AwardReport[] = [];
    host.onAward = (r) => awards.push(r);
    host.join(client('a'), { protocol: PROTOCOL_VERSION }, { userId: 'ua', name: 'Alice', classes: ['drifter', 'medic'] });
    host.join(client('b'), { protocol: PROTOCOL_VERSION, cls: 'medic' }, { userId: 'ub', name: 'Bob', classes: ['drifter'] });
    // Bob asked for a class he hasn't unlocked.
    expect(host.sim.players.get('b')!.cls).toBe('drifter');
    // Dev commands are refused on this host.
    host.message(client('a'), 'cmd', { t: 'dev', action: 'skip', value: 5000 });
    expect(host.sim.devUsed).toBe(false);
    // Bob leaves at km 30 with a railroad bond in his pack.
    host.sim.train.s = 30 * WORLD.metersPerKm;
    host.sim.players.get('b')!.inv.pack.push('bond');
    host.leave(client('b'));
    expect(awards).toHaveLength(1);
    expect(awards[0]!.userId).toBe('ub');
    expect(awards[0]!.bonds).toBe(3 + 3);
    // Bob comes back for the end: distance he was already paid for isn't paid again.
    host.join(client('b2'), { protocol: PROTOCOL_VERSION }, { userId: 'ub', name: 'Bob', classes: ['drifter'] });
    host.sim.train.s = WORLD.routeKm * WORLD.metersPerKm;
    host.sim.forts.landmarks = 2;
    host.sim.forts.finish(true);
    host.step();
    const alice = awards.find((r) => r.userId === 'ua' && r.final)!;
    const bob = awards.find((r) => r.userId === 'ub' && r.final)!;
    expect(alice.bonds).toBe(8 + 6 + 10);
    expect(bob.bonds).toBe(8 + 6 + 10 - 6);
    expect(alice.stats.runs).toBe(1);
    expect(bob.stats.runs).toBe(0);
  });
});
