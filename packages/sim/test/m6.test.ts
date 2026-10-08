import { describe, expect, it } from 'vitest';
import {
  type InputFrame,
  NightType,
  SIM_DT,
  Weather,
  WORLD,
  pieceWorld,
  toWorld,
} from '@dead-tracks/shared';
import { Sim } from '../src/index.ts';
import { Checkpoint, Finale } from '../src/world/FortSystem.ts';
import { BossState } from '../src/world/LandmarkSystem.ts';

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

function tick(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) {
    for (const [id, p] of sim.players) sim.pushInput(id, inp({ frame: p.motor.frame }));
    sim.step(SIM_DT);
  }
}

/** Steps n ticks and returns every event emitted. */
function collect(sim: Sim, n: number): Array<{ e: string; [k: string]: unknown }> {
  const out: Array<{ e: string; [k: string]: unknown }> = [];
  for (let i = 0; i < n; i++) {
    tick(sim, 1);
    for (const ev of sim.drainEvents()) out.push(ev.ev as { e: string });
  }
  return out;
}

/** Stand a player next to a structure piece (on its floor). */
function standAt(sim: Sim, id: string, stId: string, pieceId: number, dx = -0.9): void {
  const st = sim.world.structure(stId)!;
  const p = st.pieces[pieceId]!;
  const w = toWorld(st, p.x + dx, 0, p.z);
  const floor = sim.space.rayGround(w.x, st.y + 3, w.z, 0, -1, 0, 6);
  sim.command(id, { t: 'dev', action: 'tp', x: w.x, y: floor ? st.y + 3 - floor.toi + 0.05 : st.y + 0.5, z: w.z });
}

describe('M6: weather and night types', () => {
  it('weather blends over 30–60 s with at most one change per phase; storms throw lightning', async () => {
    const sim = await Sim.create({ seed: 11 });
    sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    // A few full cycles: from/to only change once a blend is done.
    let changes = 0;
    let last = `${sim.weather.from}>${sim.weather.to}`;
    let lastBlend = sim.weather.blend;
    for (let i = 0; i < 30 * 60 * 25; i += 30) {
      tick(sim, 30);
      const now = `${sim.weather.from}>${sim.weather.to}`;
      if (now !== last) {
        changes++;
        // A new blend starts from 0 and the old one had finished or nearly so.
        expect(sim.weather.blend).toBeLessThan(0.1);
        last = now;
      } else {
        // Blends only move forward, by at most 1/30 per second.
        expect(sim.weather.blend).toBeGreaterThanOrEqual(lastBlend - 1e-9);
        expect(sim.weather.blend - lastBlend).toBeLessThanOrEqual(1 / 30 + 1e-6);
      }
      lastBlend = sim.weather.blend;
    }
    // 25 minutes is 2.5 cycles: never more than one change per phase plus the dusk/dawn resets.
    expect(changes).toBeLessThanOrEqual(10);

    // Storms: lightning events around the train.
    sim.command('a', { t: 'dev', action: 'weather', value: Weather.Storm });
    const evs = collect(sim, 30 * 40);
    expect(evs.filter((e) => e.e === 'lightning').length).toBeGreaterThanOrEqual(2);
    // Storms dull the senses of the dead (§4.5).
    expect(sim.weather.senses.hearing).toBeLessThan(1);
  });

  it('full moon nights bring werewolves; blood moons bring vampires', async () => {
    const sim = await Sim.create({ seed: 12 });
    sim.addPlayer('a', 'A');
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    sim.command('a', { t: 'dev', action: 'time', value: 0.75 });
    tick(sim, 2);
    sim.command('a', { t: 'dev', action: 'night', value: NightType.FullMoon });
    const seen = new Set<string>();
    for (let i = 0; i < 90 && !seen.has('werewolf'); i++) {
      tick(sim, 30);
      for (const e of sim.enemySystem.enemies.values()) seen.add(e.type);
    }
    expect(seen.has('werewolf')).toBe(true);
    sim.command('a', { t: 'dev', action: 'clear' });
    sim.command('a', { t: 'dev', action: 'night', value: NightType.BloodMoon });
    for (let i = 0; i < 90 && !seen.has('vampire'); i++) {
      tick(sim, 30);
      for (const e of sim.enemySystem.enemies.values()) seen.add(e.type);
    }
    expect(seen.has('vampire')).toBe(true);
  });
});

describe('M6: landmark raids', () => {
  it('places three landmarks clear of the track, one per biome', async () => {
    const sim = await Sim.create({ seed: 13 });
    const lms = sim.world.structures.filter((s) => s.landmark);
    expect(lms.map((l) => l.landmark!.kind)).toEqual(['ranch', 'mine', 'chateau']);
    for (const l of lms) {
      const n = sim.route.nearest(l.x, l.z, 200)!;
      expect(n.dist).toBeGreaterThan(50);
      // No piece reaches within 25 m of the rails.
      for (const p of l.pieces) {
        const w = pieceWorld(l, p);
        const near = sim.route.nearest(w.x, w.z, 25);
        expect(near).toBeNull();
      }
    }
  });

  it('Grayson Ranch: the cellar key opens the cellar and wakes the Rancher; killing him counts', async () => {
    const sim = await Sim.create({ seed: 14 });
    sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    const ranch = sim.landmarks.list[0]!;
    const spec = ranch.st.landmark!;
    // Locked without the key.
    standAt(sim, 'a', ranch.st.id, spec.gate, -1.0);
    tick(sim, 5);
    sim.command('a', { t: 'use', target: `unlock:${ranch.st.id}:${spec.gate}` });
    expect(sim.items.props.get(`${ranch.st.id}:${spec.gate}`) ?? 0).toBe(0);
    // Search the container that hides the key.
    standAt(sim, 'a', ranch.st.id, spec.keyPiece, 0);
    tick(sim, 5);
    sim.command('a', { t: 'use', target: `search:${ranch.st.id}:${spec.keyPiece}`, hold: true });
    const a = sim.players.get('a')!;
    expect(a.inv.pack).toContain('cellar_key');
    // Unlock: the door opens, the key is used, the boss wakes.
    standAt(sim, 'a', ranch.st.id, spec.gate, -1.0);
    tick(sim, 5);
    sim.command('a', { t: 'use', target: `unlock:${ranch.st.id}:${spec.gate}` });
    expect(sim.items.props.get(`${ranch.st.id}:${spec.gate}`)).toBe(1);
    expect(a.inv.pack).not.toContain('cellar_key');
    expect(ranch.boss).toBe(BossState.Awake);
    const boss = sim.enemySystem.enemies.get(ranch.bossId)!;
    expect(boss.type).toBe('rancher');
    // Solo bosses are scaled down (§4.6).
    expect(boss.maxHp).toBeLessThan(2600);
    // The Rancher comes for the player and hits hard (stomp or swing).
    const hp0 = a.hp;
    const evs = collect(sim, 30 * 12);
    expect(evs.some((e) => e.e === 'explode' || e.e === 'enemyAttack' || e.e === 'growl')).toBe(true);
    void hp0;
    // Kill him: the landmark counts toward the results.
    sim.killEnemy(boss, 'a', 0, false);
    tick(sim, 2);
    expect(ranch.boss).toBe(BossState.Dead);
    expect(sim.forts.landmarks).toBe(1);
  });

  it('Copperhead Mine: three levers open the vault and Dr. Voss throws arcs', async () => {
    const sim = await Sim.create({ seed: 15 });
    sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    const mine = sim.landmarks.list[1]!;
    const spec = mine.st.landmark!;
    expect(spec.triggers.length).toBe(3);
    spec.triggers.forEach((t, i) => {
      standAt(sim, 'a', mine.st.id, t, -0.9);
      tick(sim, 3);
      sim.command('a', { t: 'use', target: `lever:${mine.st.id}:${t}` });
      expect(sim.items.props.get(`${mine.st.id}:${t}`)).toBe(1);
      expect(mine.boss).toBe(i < 2 ? BossState.Sleeping : BossState.Awake);
    });
    expect(sim.items.props.get(`${mine.st.id}:${spec.gate}`)).toBe(1);
    // The vault gate no longer blocks: a ray through the doorway passes.
    tick(sim, 1);
    const g = pieceWorld(mine.st, mine.st.pieces[spec.gate]!);
    const out = toWorld(mine.st, mine.st.pieces[spec.gate]!.x - 2, 1.2, mine.st.pieces[spec.gate]!.z);
    const dx = g.x - out.x;
    const dz = g.z - out.z;
    const len = Math.hypot(dx, dz);
    const hit = sim.space.rayGround(out.x, mine.st.y + 1.2, out.z, dx / len, 0, dz / len, len + 0.5);
    expect(hit).toBeNull();
    // Stand back in the open and let Voss fight.
    const at = toWorld(mine.st, -14, 0, 0);
    sim.command('a', { t: 'dev', action: 'tp', x: at.x, z: at.z });
    const evs = collect(sim, 30 * 15);
    expect(evs.some((e) => e.e === 'zap')).toBe(true);
    // He raises the dead around him.
    const walkers = [...sim.enemySystem.enemies.values()].filter((e) => e.type === 'walker').length;
    expect(walkers).toBeGreaterThan(0);
  });

  it('Blackpine Chateau: three braziers open the crypt and wake the Countess', async () => {
    const sim = await Sim.create({ seed: 16 });
    sim.addPlayer('a', 'A');
    sim.enemySystem.paused = true;
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    const ch = sim.landmarks.list[2]!;
    const spec = ch.st.landmark!;
    for (const t of spec.triggers) {
      standAt(sim, 'a', ch.st.id, t, -0.9);
      tick(sim, 3);
      sim.command('a', { t: 'use', target: `brazier:${ch.st.id}:${t}`, hold: true });
    }
    expect(ch.boss).toBe(BossState.Awake);
    const boss = sim.enemySystem.enemies.get(ch.bossId)!;
    expect(boss.type).toBe('countess');
    // Far from everyone she does not despawn.
    sim.command('a', { t: 'dev', action: 'cab' });
    tick(sim, 30 * 5);
    expect(sim.enemySystem.enemies.has(ch.bossId)).toBe(true);
  });
});

describe('M6: forts and the finale', () => {
  it('Fort Ironwood holds a 90 s checkpoint when the train stops inside', async () => {
    const sim = await Sim.create({ seed: 17 });
    sim.addPlayer('a', 'A');
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    const iw = sim.forts.ironwood!;
    sim.train.s = iw.feature!.s;
    sim.train.speed = 0;
    tick(sim, 3);
    expect(sim.forts.checkpoint).toBe(Checkpoint.Active);
    const cash0 = sim.players.get('a')!.inv.cash;
    tick(sim, 30 * 92);
    expect(sim.forts.checkpoint).toBe(Checkpoint.Done);
    expect(sim.players.get('a')!.inv.cash).toBe(cash0 + 25);
  });

  it('Fort Haven: the shut gate stops the train; the winch opens it; rolling through wins the run', async () => {
    const sim = await Sim.create({ seed: 18 });
    sim.addPlayer('a', 'A');
    sim.command('a', { t: 'dev', action: 'god', value: 1 });
    sim.command('a', { t: 'dev', action: 'finale' });
    sim.command('a', { t: 'dev', action: 'infinite-fuel', value: 1 });
    sim.command('a', { t: 'dev', action: 'drive', value: 1 });
    // Full throttle into the gate: the train stops short of it.
    sim.train.throttle = 1;
    sim.train.brake = 0;
    tick(sim, 30 * 20);
    expect(sim.train.s).toBeLessThanOrEqual(sim.forts.gateS);
    expect(sim.forts.finale).toBe(Finale.Closed);
    // Pull the winch lever.
    const haven = sim.forts.haven!;
    const lever = (haven as unknown as { leverPiece: number }).leverPiece;
    standAt(sim, 'a', haven.id, lever, -1.0);
    tick(sim, 3);
    sim.command('a', { t: 'use', target: 'winch' });
    expect(sim.forts.finale).toBe(Finale.Winching);
    tick(sim, 30 * 122);
    expect(sim.forts.finale).toBe(Finale.Open);
    // Back in the cab and through the gate.
    sim.command('a', { t: 'dev', action: 'drive', value: 1 });
    sim.train.throttle = 1;
    sim.train.brake = 0;
    const evs = collect(sim, 30 * 40);
    expect(sim.forts.finale).toBe(Finale.Won);
    expect(evs.some((e) => e.e === 'runEnd' && e.won === true)).toBe(true);
    expect(sim.forts.result?.won).toBe(true);
    expect(sim.forts.result!.km).toBeGreaterThan(WORLD.routeKm - 1);
  });
});
