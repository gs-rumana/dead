import {
  ENEMY_TYPES,
  type Feature,
  type InputFrame,
  ITEMS,
  type ItemKind,
  Life,
  SIM_DT,
  TRAIN,
  WORLD,
  isBoss,
  pieceWorld,
  toWorld,
} from '@dead-tracks/shared';
import type { Sim, SimPlayer } from '../Sim.ts';
import { Checkpoint, Finale } from '../world/FortSystem.ts';
import { BossState } from '../world/LandmarkSystem.ts';

/**
 * A scripted party that plays a whole run through the real sim (§11 bots, §14 M6
 * and M8 balancing): drive and stoke, stop at stations to scavenge, sell and buy
 * coal, raid the landmarks, hold Fort Ironwood and winch Fort Haven's gate.
 *
 * Movement between spots uses dev teleports (walking is the motor's job and is
 * covered elsewhere); everything else goes through the same commands players
 * send. Shooting is modelled as steady damage on the nearest enemy.
 */
export interface PilotOptions {
  /** Share of stations the party stops at (deterministic by station index). */
  stationStops: number;
  /** Junction indexes whose town the party visits by handcar. */
  towns: number[];
  /** Raid the landmarks on the way. */
  landmarks: boolean;
  /** Bots can't be hurt (pacing runs); off measures survival. */
  god: boolean;
  /** Damage each bot deals per second while an enemy is within reach. */
  dps: number;
  /** Seconds a town trip takes (handcar both ways plus shopping, §4.4). */
  townSeconds: number;
}

export const DEFAULT_PILOT: PilotOptions = {
  stationStops: 0.6,
  towns: [1, 4],
  landmarks: true,
  god: true,
  dps: 40,
  townSeconds: 200,
};

export interface PilotReport {
  won: boolean;
  over: boolean;
  minutes: number;
  km: number;
  stops: number;
  coalBought: number;
  coalBurned: number;
  bodiesBurned: number;
  /** Seconds spent with the firebox empty while trying to drive. */
  starvedSeconds: number;
  downs: number;
  kills: number;
  landmarks: number;
  avgTickMs: number;
  maxTickMs: number;
  timeline: string[];
}

const clock = (globalThis as { performance?: { now(): number } }).performance;
const now = (): number => (clock ? clock.now() : Date.now());

type Stop =
  | { kind: 'station'; f: Feature }
  | { kind: 'town'; f: Feature; spur: number }
  | { kind: 'landmark'; f: Feature; index: number }
  | { kind: 'checkpoint'; f: Feature }
  | { kind: 'gate'; f: Feature };

export class RunPilot {
  private readonly plan: Stop[] = [];
  private next = 0;
  private seq = 0;
  private readonly report: PilotReport = {
    won: false,
    over: false,
    minutes: 0,
    km: 0,
    stops: 0,
    coalBought: 0,
    coalBurned: 0,
    bodiesBurned: 0,
    starvedSeconds: 0,
    downs: 0,
    kills: 0,
    landmarks: 0,
    avgTickMs: 0,
    maxTickMs: 0,
    timeline: [],
  };
  private lastLife = new Map<string, number>();

  constructor(
    private readonly sim: Sim,
    private readonly ids: string[],
    private readonly opts: PilotOptions = DEFAULT_PILOT,
  ) {
    let station = 0;
    for (const f of sim.features) {
      if (f.kind === 'station') {
        // Every other-ish station, spread evenly.
        const k = station++;
        if (Math.floor((k + 1) * opts.stationStops) > Math.floor(k * opts.stationStops))
          this.plan.push({ kind: 'station', f });
      } else if (f.kind === 'junction') {
        const spur = sim.features.filter((g) => g.kind === 'junction').indexOf(f);
        if (opts.towns.includes(spur)) this.plan.push({ kind: 'town', f, spur });
      } else if (f.kind === 'landmark' && opts.landmarks) {
        const index = sim.features.filter((g) => g.kind === 'landmark').indexOf(f);
        this.plan.push({ kind: 'landmark', f, index });
      } else if (f.kind === 'fort') {
        this.plan.push(f.index === 0 ? { kind: 'checkpoint', f } : { kind: 'gate', f });
      }
    }
    this.plan.sort((a, b) => a.f.s - b.f.s);
  }

  private log(what: string): void {
    const t = this.sim.time / 60;
    this.report.timeline.push(`${t.toFixed(1)} min · km ${(this.sim.train.s / WORLD.metersPerKm).toFixed(1)} · ${what}`);
  }

  private get players(): SimPlayer[] {
    return this.ids.map((id) => this.sim.players.get(id)!).filter(Boolean);
  }

  /** One sim tick with idle inputs, the bots' fighting and the fireman. */
  private tick(): void {
    const sim = this.sim;
    for (const p of this.players)
      sim.pushInput(p.id, {
        seq: ++this.seq,
        mx: 0,
        my: 0,
        yaw: 0,
        pitch: 0,
        buttons: 0,
        frame: p.motor.frame,
      } satisfies InputFrame);
    const t0 = now();
    sim.step(SIM_DT);
    const ms = now() - t0;
    this.report.maxTickMs = Math.max(this.report.maxTickMs, ms);
    this.report.avgTickMs += ms;
    this.fight(SIM_DT);
    this.fireman();
    for (const p of this.players) {
      const before = this.lastLife.get(p.id) ?? Life.Alive;
      if (p.life === Life.Downed && before !== Life.Downed) this.report.downs++;
      this.lastLife.set(p.id, p.life);
      if (p.hp < 45 && p.inv.bandage > 0 && p.life === Life.Alive) sim.command(p.id, { t: 'heal' });
    }
    sim.drainEvents();
  }

  private wait(seconds: number, until?: () => boolean): void {
    const n = Math.round(seconds / SIM_DT);
    for (let i = 0; i < n && !this.sim.forts.result; i++) {
      this.tick();
      if (until?.()) return;
    }
  }

  /** Each bot shoots the nearest enemy within reach. */
  private fight(dt: number): void {
    const sim = this.sim;
    for (const p of this.players) {
      if (p.life !== Life.Alive) continue;
      let best = null as null | ReturnType<typeof sim.enemySystem.enemies.get>;
      let bd = 32;
      for (const e of sim.enemySystem.enemies.values()) {
        if (e.state === 'dead') continue;
        const d = Math.hypot(e.wx - p.wx, e.wz - p.wz);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) continue;
      best.hp -= this.opts.dps * dt;
      if (best.hp <= 0) {
        sim.killEnemy(best, p.id, 0, false);
        this.report.kills++;
      }
    }
  }

  /** Someone keeps the fire fed from the tender. */
  private fireman(): void {
    const t = this.sim.train;
    if (t.fuel < TRAIN.fireboxMax - TRAIN.coalPerShovel - 10 && t.coal > 0 && t.stoke())
      this.report.coalBurned++;
  }

  /** Drive to s and stop there (within a few metres). */
  private driveTo(s: number): void {
    const sim = this.sim;
    const t = sim.train;
    t.driver = '';
    for (let i = 0; i < 30 * 60 * 30 && !sim.forts.result; i++) {
      const left = s - t.s;
      const stopDist = (t.speed * t.speed) / (2 * TRAIN.brakeDecel * 0.85) + 6;
      if (left <= stopDist || left < 3) {
        t.throttle = 0;
        t.brake = 1;
        if (Math.abs(t.speed) < 0.05) break;
      } else {
        t.brake = 0;
        // Ease off near the stop so the brake isn't slammed from top speed.
        t.throttle = left < stopDist + 40 ? 0.3 : 1;
      }
      if (t.fuel <= 0.5 && t.coal <= 0) this.report.starvedSeconds += SIM_DT;
      this.tick();
      if (t.fuel <= 0 && t.coal <= 0 && Math.abs(t.speed) < 0.05) {
        // Out of fuel: scrounge the wilds for wood before giving up.
        if (!this.scrounge()) break;
      }
    }
    t.brake = 1;
    t.throttle = 0;
  }

  /** Out of fuel between stops: burn whatever bodies lie near the train. */
  private scrounge(): boolean {
    const got = this.burnBodies(80);
    if (got) return true;
    // Nothing near: wait for the dead to come (they always do) and burn them.
    this.wait(20);
    return this.burnBodies(80) > 0;
  }

  /** Carry bodies near the train to the firebox (§4.3: bodies burn). */
  private burnBodies(range: number): number {
    const sim = this.sim;
    const loco = sim.poses[1]!;
    let n = 0;
    for (const [id, it] of sim.items.items) {
      if (it.kind !== 'corpse' || it.holder) continue;
      if (Math.hypot(it.wx - loco.cx, it.wz - loco.cz) > range) continue;
      sim.items.items.delete(id);
      sim.train.fuel = Math.min(TRAIN.fireboxMax, sim.train.fuel + ITEMS.corpse.fuel);
      n++;
      if (sim.train.fuel > TRAIN.fireboxMax - 20) break;
    }
    this.report.bodiesBurned += n;
    return n;
  }

  private tp(p: SimPlayer, x: number, z: number, y = NaN): void {
    this.sim.command(p.id, Number.isFinite(y) ? { t: 'dev', action: 'tp', x, y, z } : { t: 'dev', action: 'tp', x, z });
  }

  private backAboard(): void {
    for (const p of this.players) this.sim.command(p.id, { t: 'dev', action: 'respawn' });
  }

  /** Search every container in a structure (hold E on each). */
  private searchAll(stId: string): void {
    const st = this.sim.world.structure(stId);
    if (!st) return;
    const bots = this.players.filter((p) => p.life === Life.Alive);
    let k = 0;
    for (const piece of st.pieces) {
      if (!piece.loot || this.sim.items.props.get(`${st.id}:${piece.id}`)) continue;
      const p = bots[k++ % bots.length];
      if (!p) return;
      const out = toWorld(st, piece.x - Math.sign(piece.x || 1) * 0.9, 0, piece.z);
      const floor = this.sim.space.rayGround(out.x, st.y + 2.3, out.z, 0, -1, 0, 6);
      this.tp(p, out.x, out.z, floor ? st.y + 2.3 - floor.toi + 0.05 : NaN);
      this.wait(0.4);
      this.sim.command(p.id, { t: 'use', target: `search:${st.id}:${piece.id}`, hold: true });
    }
  }

  /** Pick up loose valuables lying around a spot. */
  private pickUpNear(x: number, z: number, r: number): void {
    const sim = this.sim;
    for (const [id, it] of sim.items.items) {
      if (it.holder || Math.hypot(it.wx - x, it.wz - z) > r) continue;
      const def = ITEMS[it.kind as ItemKind];
      if (!def || def.cls !== 'valuable') continue;
      const p = this.players.find((q) => q.life === Life.Alive && q.inv.pack.length < 6);
      if (!p) return;
      this.tp(p, it.wx, it.wz, it.wy + 0.1);
      this.wait(0.2);
      sim.command(p.id, { t: 'use', target: `item:${id}` });
    }
  }

  /** Sell valuables, then buy coal and carry it to the tender. */
  private shop(stId: string): void {
    const sim = this.sim;
    const st = sim.world.structure(stId);
    if (!st?.shop) return;
    const counter = pieceWorld(st, st.pieces[st.shop.piece]!);
    for (const p of this.players) {
      if (p.life !== Life.Alive) continue;
      const out = toWorld(st, st.pieces[st.shop.piece]!.x - 1.2, 0, st.pieces[st.shop.piece]!.z);
      this.tp(p, out.x, out.z, counter.y - st.pieces[st.shop.piece]!.hy + 0.05);
      this.wait(0.2);
      sim.command(p.id, { t: 'sell', shop: st.id, slot: -1 });
      const line = st.shop.stock.find((l) => l.kind === 'coal');
      if (!line) continue;
      // Keep a little back for bandages.
      while (p.inv.cash - line.price >= 8) {
        const before = p.inv.cash;
        sim.command(p.id, { t: 'buy', shop: st.id, kind: 'coal' });
        if (p.inv.cash === before) break;
        this.report.coalBought++;
      }
      if (p.inv.bandage < 2 && p.inv.cash >= 12) sim.command(p.id, { t: 'buy', shop: st.id, kind: 'bandage' });
    }
    this.wait(0.5);
    // Carry the sacks aboard: each one becomes a shovel's worth in the tender.
    for (const [id, it] of sim.items.items) {
      if (it.kind !== 'coal' || it.holder || it.slot >= 0) continue;
      if (Math.hypot(it.wx - counter.x, it.wz - counter.z) > 25) continue;
      sim.items.items.delete(id);
      sim.train.coal++;
    }
  }

  private atStation(f: Feature): void {
    const sim = this.sim;
    const st = sim.world.structures.find((s) => s.feature === f && s.kind === 'station');
    if (!st) return;
    this.searchAll(st.id);
    this.shop(st.id);
    this.burnBodies(60);
    this.backAboard();
    this.wait(20);
  }

  private townTrip(spur: number): void {
    const sim = this.sim;
    const town = sim.world.structures.filter((s) => s.town === spur);
    const t0 = sim.time;
    // The ride out (the parked train is left alone meanwhile, §4.3).
    const end = sim.world.spurs[spur]!;
    const f = end.frameAt(end.end, { x: 0, y: 0, z: 0, heading: 0, grade: 0, tx: 0, ty: 0, tz: 0, rx: 0, rz: 0 });
    for (const p of this.players) this.tp(p, f.x, f.z);
    this.wait(60);
    for (const b of town) if (b.pieces.some((p) => p.loot)) this.searchAll(b.id);
    const trading = town.find((b) => b.shop?.kind === 'trading');
    const sheriff = town.find((b) => b.shop?.kind === 'sheriff');
    if (sheriff) this.sellAt(sheriff.id);
    if (trading) this.sellAt(trading.id);
    const left = this.opts.townSeconds - (sim.time - t0);
    for (const p of this.players) this.tp(p, f.x, f.z);
    this.wait(Math.max(0, left));
    this.backAboard();
    this.burnBodies(80);
  }

  private sellAt(stId: string): void {
    const st = this.sim.world.structure(stId)!;
    const piece = st.pieces[st.shop!.piece]!;
    const out = toWorld(st, piece.x - 1.2, 0, piece.z);
    for (const p of this.players) {
      if (p.life !== Life.Alive) continue;
      this.tp(p, out.x, out.z, st.y + piece.y - piece.hy + 0.05);
      this.wait(0.2);
      this.sim.command(p.id, { t: 'sell', shop: st.id, slot: -1 });
    }
  }

  private raid(index: number): void {
    const sim = this.sim;
    const l = sim.landmarks.list[index];
    if (!l) return;
    const st = l.st;
    const spec = st.landmark!;
    const lead = this.players.find((p) => p.life === Life.Alive) ?? this.players[0]!;
    const near = (pieceId: number, dx = -0.9) => {
      const piece = st.pieces[pieceId]!;
      const out = toWorld(st, piece.x + dx, 0, piece.z);
      const floor = sim.space.rayGround(out.x, st.y + 2.3, out.z, 0, -1, 0, 6);
      this.tp(lead, out.x, out.z, floor ? st.y + 2.3 - floor.toi + 0.05 : NaN);
      this.wait(0.5);
    };
    // Walk over (about 70 m).
    for (const p of this.players) {
      const w = toWorld(st, -20, 0, 0);
      this.tp(p, w.x, w.z);
    }
    this.wait(15);
    this.searchAll(st.id);
    if (spec.kind === 'ranch') {
      if (!lead.inv.pack.includes('cellar_key')) {
        // Someone else may have it: hand it over.
        for (const p of this.players) {
          const i = p.inv.pack.indexOf('cellar_key');
          if (i >= 0 && p !== lead) {
            p.inv.pack.splice(i, 1);
            lead.inv.pack.push('cellar_key');
          }
        }
      }
      near(spec.gate, -1.0);
      sim.command(lead.id, { t: 'use', target: `unlock:${st.id}:${spec.gate}` });
    } else {
      for (const t of spec.triggers) {
        near(t);
        sim.command(lead.id, { t: 'use', target: `${spec.kind === 'mine' ? 'lever' : 'brazier'}:${st.id}:${t}`, hold: true });
      }
    }
    if (l.boss !== BossState.Awake) {
      this.log(`${st.name}: puzzle failed`);
      this.backAboard();
      return;
    }
    this.log(`${st.name}: boss awake`);
    // Fight in the yard until the boss falls (or 4 minutes pass).
    const yard = toWorld(st, spec.bossX - 10, 0, spec.bossZ);
    for (const p of this.players) this.tp(p, yard.x, yard.z);
    const dead = () => (l.boss as number) === BossState.Dead;
    this.wait(240, dead);
    this.log(`${st.name}: ${dead() ? 'boss dead' : 'gave up'}`);
    const vault = pieceWorld(st, st.pieces[spec.gate]!);
    this.pickUpNear(vault.x, vault.z, 8);
    this.backAboard();
    this.burnBodies(90);
  }

  run(maxMinutes = 70): PilotReport {
    const sim = this.sim;
    for (const p of this.players) {
      if (this.opts.god) sim.command(p.id, { t: 'dev', action: 'god', value: 1 });
    }
    sim.command(this.ids[0]!, { t: 'dev', action: 'cab' });
    const t0 = sim.time;
    this.log('depart');
    while (!sim.forts.result && sim.time - t0 < maxMinutes * 60 && !sim.over) {
      const stop = this.plan[this.next];
      if (!stop) break;
      const target =
        stop.kind === 'checkpoint'
          ? stop.f.s
          : stop.kind === 'gate'
            ? sim.forts.gateS - 6
            : stop.kind === 'landmark'
              ? stop.f.s + 30
              : stop.kind === 'town'
                ? stop.f.s + 20
                : stop.f.s + 10;
      this.driveTo(target);
      if (Math.abs(sim.train.s - target) > 40) {
        this.log(`stalled before ${stop.f.name} (fuel ${sim.train.fuel.toFixed(0)}, coal ${sim.train.coal})`);
        break;
      }
      this.report.stops++;
      this.next++;
      switch (stop.kind) {
        case 'station':
          this.log(`station ${stop.f.name}`);
          this.atStation(stop.f);
          break;
        case 'town':
          this.log(`town trip (${stop.f.name})`);
          this.townTrip(stop.spur);
          break;
        case 'landmark':
          this.log(`landmark ${stop.f.name}`);
          this.raid(stop.index);
          break;
        case 'checkpoint':
          this.log('Fort Ironwood checkpoint');
          this.wait(5);
          this.wait(120, () => sim.forts.checkpoint === Checkpoint.Done);
          this.log(`checkpoint ${sim.forts.checkpoint === Checkpoint.Done ? 'held' : 'not done'}`);
          // The fort's stores sell coal too.
          for (const b of sim.world.structures.filter((s) => s.id.startsWith('f0b'))) this.shop(b.id);
          this.backAboard();
          break;
        case 'gate': {
          this.log('Fort Haven gate');
          const g = sim.forts.haven!;
          const lever = (g as unknown as { leverPiece: number }).leverPiece;
          const piece = g.pieces[lever]!;
          const out = toWorld(g, piece.x - 1, 0, piece.z);
          this.tp(this.players[0]!, out.x, out.z);
          this.wait(0.5);
          sim.command(this.ids[0]!, { t: 'use', target: 'winch' });
          this.wait(130, () => sim.forts.finale >= Finale.Open);
          this.log(`gate ${sim.forts.finale >= Finale.Open ? 'open' : 'stuck'}`);
          this.backAboard();
          sim.command(this.ids[0]!, { t: 'dev', action: 'cab' });
          this.driveTo(sim.forts.gateS + 80);
          break;
        }
      }
    }
    const r = this.report;
    r.won = sim.forts.result?.won ?? false;
    r.over = sim.over;
    r.minutes = (sim.time - t0) / 60;
    r.km = sim.train.s / WORLD.metersPerKm;
    r.landmarks = sim.forts.landmarks;
    r.avgTickMs /= Math.max(1, sim.tick);
    this.log(r.won ? 'won' : 'ended');
    void ENEMY_TYPES;
    void isBoss;
    return r;
  }
}
