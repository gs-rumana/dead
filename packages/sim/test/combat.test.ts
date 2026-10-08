import { describe, expect, it } from 'vitest';
import {
  Btn,
  Frame,
  type InputFrame,
  Life,
  PLAYER,
  SIM_DT,
  rayVsEnemy,
  shotDirections,
  hashInts,
} from '@dead-tracks/shared';
import { Sim } from '../src/index.ts';

let seq = 0;

/** Test helper: an enemy that holds still and never notices anyone. */
function blind<T extends { def: { sight: number }; state: string }>(e: T): T {
  e.def = { ...e.def, sight: 0 };
  e.state = 'ambush';
  return e;
}
function inp(over: Partial<InputFrame> = {}): InputFrame {
  return { seq: ++seq, mx: 0, my: 0, yaw: 0, pitch: 0, buttons: 0, frame: Frame.World, ...over };
}

async function groundSim(players = ['a']) {
  const sim = await Sim.create({ seed: 77 });
  for (const id of players) sim.addPlayer(id, id);
  sim.enemySystem.paused = true;
  for (const id of players) sim.command(id, { t: 'dev', action: 'ground' });
  for (let i = 0; i < 10; i++) {
    for (const id of players) sim.pushInput(id, inp());
    sim.step(SIM_DT);
  }
  return sim;
}

/** Aim from the player's eye at a point; returns the fire command with a claimed hit. */
function shotAt(
  sim: Sim,
  id: string,
  tx: number,
  ty: number,
  tz: number,
  enemyId: string,
  s: number,
) {
  const p = sim.players.get(id)!;
  const ox = p.wx;
  const oy = p.wy + PLAYER.eyeHeight;
  const oz = p.wz;
  const d = [tx - ox, ty - oy, tz - oz];
  const l = Math.hypot(d[0]!, d[1]!, d[2]!);
  return {
    t: 'fire' as const,
    seq: s,
    ox,
    oy,
    oz,
    dx: d[0]! / l,
    dy: d[1]! / l,
    dz: d[2]! / l,
    aim: true,
    hits: [{ e: enemyId, p: 0 }],
  };
}

describe('combat', () => {
  it('validates claimed hits against where the enemy was', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    const e = sim.enemySystem.spawn('walker', p.wx + 0.5, p.wz - 12);
    e.state = 'ambush'; // hold still
    sim.step(SIM_DT);
    const hp0 = e.hp;
    // A shot aimed at the chest lands.
    sim.command('a', shotAt(sim, 'a', e.wx, e.wy + 1.2, e.wz, e.id, 1));
    expect(e.hp).toBeLessThan(hp0);
    // A shot aimed far to the side claiming the same enemy is rejected.
    for (let i = 0; i < 12; i++) sim.step(SIM_DT);
    const hp1 = e.hp;
    sim.command('a', shotAt(sim, 'a', e.wx + 8, e.wy + 1.2, e.wz, e.id, 2));
    expect(e.hp).toBe(hp1);
    // Spent rounds come out of the magazine.
    expect(p.inv.mags[0]).toBe(4);
  });

  it('headshots kill a walker in one revolver shot and pop the head', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    const e = blind(sim.enemySystem.spawn('walker', p.wx, p.wz - 10));
    sim.step(SIM_DT);
    sim.command('a', shotAt(sim, 'a', e.wx, e.wy + 1.66, e.wz, e.id, 5));
    expect(e.state).toBe('dead');
    expect(e.gore & 1).toBe(1);
  });

  it('enforces fire rate and reloads one round at a time', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    const e = sim.enemySystem.spawn('brute', p.wx, p.wz - 10);
    e.state = 'ambush';
    sim.step(SIM_DT);
    sim.command('a', shotAt(sim, 'a', e.wx, e.wy + 1.0, e.wz, e.id, 10));
    sim.command('a', shotAt(sim, 'a', e.wx, e.wy + 1.0, e.wz, e.id, 11));
    expect(p.inv.mags[0]).toBe(5);
    sim.pushInput('a', inp({ buttons: Btn.Reload }));
    sim.step(SIM_DT);
    for (let i = 0; i < 30; i++) {
      sim.pushInput('a', inp());
      sim.step(SIM_DT);
    }
    expect(p.inv.mags[0]).toBe(6);
    expect(p.inv.pistol).toBe(23);
  });

  it('shotgun pellets are deterministic from the shot sequence', () => {
    const a = shotDirections(0, 0, -1, 0.07, 9, hashInts(3, 42));
    const b = shotDirections(0, 0, -1, 0.07, 9, hashInts(3, 42));
    expect(a).toEqual(b);
    expect(rayVsEnemy('walker', 0, 0, -10, 0, 1.6, 0, 0, 0, -1, 50)?.zone).toBe(1);
  });

  it('dynamite blows up a pack', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    const pack = [0, 1, 2].map((i) =>
      blind(sim.enemySystem.spawn('walker', p.wx + i - 1, p.wz - 9)),
    );
    p.inv.selected = 2; // dynamite
    sim.command('a', { t: 'throw', dx: 0, dy: -0.25, dz: -1 });
    for (let i = 0; i < 30 * 4; i++) sim.step(SIM_DT);
    expect(pack.filter((e) => e.state === 'dead').length).toBeGreaterThanOrEqual(2);
  });
});

describe('enemies and survival', () => {
  it('walkers chase and hurt a player until they are downed', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    p.inv.tonic = 0;
    // Spawn on the far side of the parked train: they have to climb over it.
    for (let i = 0; i < 4; i++) sim.enemySystem.spawn('walker', p.wx + 6 + i, p.wz + 3);
    for (let i = 0; i < 30 * 30 && p.life === Life.Alive; i++) {
      sim.pushInput('a', inp());
      sim.step(SIM_DT);
    }
    expect(p.life).toBe(Life.Downed);
  });

  it('a teammate revives a downed player with a bandage; bleeding out respawns at the next station', async () => {
    const sim = await groundSim(['a', 'b']);
    const a = sim.players.get('a')!;
    const b = sim.players.get('b')!;
    sim.damagePlayer(a, 500, 0, 0, 'test');
    expect(a.life).toBe(Life.Downed);
    // b stands next to a and holds Interact.
    b.motor.frame = a.motor.frame;
    b.motor.x = a.motor.x + 1;
    b.motor.y = a.motor.y;
    b.motor.z = a.motor.z;
    for (let i = 0; i < 30 * 4 && a.life !== Life.Alive; i++) {
      sim.pushInput('b', inp({ buttons: Btn.Interact }));
      sim.pushInput('a', inp());
      sim.step(SIM_DT);
    }
    expect(a.life).toBe(Life.Alive);
    expect(a.hp).toBe(25);
    expect(b.inv.bandage).toBe(0);

    // Down again with nobody helping: bleed out, then respawn once the train passes a station.
    sim.damagePlayer(a, 500, 0, 0, 'test');
    for (let i = 0; i < 30 * 31; i++) {
      sim.pushInput('b', inp());
      sim.step(SIM_DT);
    }
    expect(a.life).toBe(Life.Dead);
    sim.train.s = a.respawnS + 1;
    sim.step(SIM_DT);
    expect(a.life).toBe(Life.Alive);
    expect(a.motor.frame).toBe(Frame.Train);
  });

  it('a solo player uses their tonic when downed; without one the run ends', async () => {
    const sim = await groundSim();
    const p = sim.players.get('a')!;
    expect(p.inv.tonic).toBe(1);
    sim.damagePlayer(p, 500, 0, 0, 'test');
    sim.pushInput('a', inp({ buttons: Btn.Interact }));
    sim.step(SIM_DT);
    expect(p.life).toBe(Life.Alive);
    expect(p.hp).toBe(75);
    sim.damagePlayer(p, 500, 0, 0, 'test');
    sim.step(SIM_DT);
    expect(sim.over).toBe(true);
  });

  it('holds the 80-enemy cap with four players at night within the tick budget', async () => {
    const sim = await Sim.create({ seed: 31 });
    for (const id of ['a', 'b', 'c', 'd']) sim.addPlayer(id, id);
    sim.command('a', { t: 'dev', action: 'time', value: 0.75 });
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    // Everyone steps off and stands around; the director ramps up.
    for (const id of ['a', 'b', 'c', 'd']) sim.command(id, { t: 'dev', action: 'ground' });
    sim.command('a', { t: 'dev', action: 'horde', value: 80 });
    const times: number[] = [];
    let maxEnemies = 0;
    for (let i = 0; i < 30 * 40; i++) {
      for (const id of ['a', 'b', 'c', 'd'])
        sim.pushInput(id, inp({ my: i % 60 < 30 ? 0.5 : -0.5 }));
      const t0 = performance.now();
      sim.step(SIM_DT);
      times.push(performance.now() - t0);
      maxEnemies = Math.max(maxEnemies, sim.enemySystem.alive);
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`80-enemy night: p95 ${p95.toFixed(2)} ms, max enemies ${maxEnemies}`);
    expect(maxEnemies).toBeLessThanOrEqual(80);
    expect(maxEnemies).toBeGreaterThan(60);
    expect(p95).toBeLessThan(10);
  });
});
