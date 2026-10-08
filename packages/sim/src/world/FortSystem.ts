import {
  FORT_HALF_LENGTH,
  Frame,
  type Structure,
  WORLD,
  fortGate,
  pieceWorld,
  toWorld,
} from '@dead-tracks/shared';
import type { Sim } from '../Sim.ts';

export const Checkpoint = { Idle: 0, Active: 1, Done: 2 } as const;
export const Finale = { Closed: 0, Winching: 1, Open: 2, Won: 3 } as const;

/** How long the checkpoint lasts and the winch takes (§4.1, §4.4). */
export const CHECKPOINT_SECONDS = 90;
export const WINCH_SECONDS = 120;

export interface RunResult {
  won: boolean;
  km: number;
  minutes: number;
  landmarks: number;
  bounties: number;
  kills: number;
  /** The dev panel was used (no bonds, §12). */
  dev: boolean;
}

/**
 * Fort Ironwood's checkpoint defense and Fort Haven's finale: the gate stays shut
 * until someone winches it open, the dead come in waves, and the run is won when
 * the train rolls through (§4.1).
 */
export class FortSystem {
  checkpoint: number = Checkpoint.Idle;
  checkpointT = 0;
  finale: number = Finale.Closed;
  winch = 0;
  result: RunResult | null = null;
  kills = 0;
  bounties = 0;
  landmarks = 0;
  private waveT = 0;
  readonly ironwood: Structure | undefined;
  readonly haven: Structure | undefined;
  /** Route distance of Fort Haven's gate. */
  readonly gateS: number;

  constructor(private readonly sim: Sim) {
    this.ironwood = sim.world.structures.find((s) => s.id === 'f0');
    this.haven = sim.world.structures.find((s) => s.id === 'f1');
    this.gateS = (this.haven?.feature?.s ?? WORLD.routeKm * WORLD.metersPerKm) + FORT_HALF_LENGTH;
  }

  /** The train may not pass a shut gate. */
  get trainLimit(): number {
    return this.finale >= Finale.Open ? Infinity : this.gateS - 4;
  }

  step(dt: number): void {
    const sim = this.sim;
    const train = sim.train;
    // Fort Ironwood: a checkpoint defense when the train first stops inside.
    const iw = this.ironwood?.feature?.s;
    if (iw !== undefined && this.checkpoint === Checkpoint.Idle && Math.abs(train.s - iw) < FORT_HALF_LENGTH && Math.abs(train.speed) < 2) {
      this.checkpoint = Checkpoint.Active;
      this.checkpointT = CHECKPOINT_SECONDS;
      sim.broadcast('Checkpoint! Hold Fort Ironwood until the all-clear.');
    }
    if (this.checkpoint === Checkpoint.Active) {
      this.checkpointT -= dt;
      this.waves(dt, this.ironwood!, 2.6, this.waveSize(3));
      if (this.checkpointT <= 0) {
        this.checkpoint = Checkpoint.Done;
        for (const p of sim.players.values()) p.inv.cash += 25;
        sim.broadcast('All clear. The fort pays $25 a head.');
      }
    }
    // Fort Haven: winch, hold, roll through.
    if (this.finale === Finale.Winching && this.haven) {
      this.winch = Math.min(1, this.winch + dt / WINCH_SECONDS);
      this.waves(dt, this.haven, 2.4, this.waveSize(4));
      if (this.winch >= 1) {
        this.finale = Finale.Open;
        const g = fortGate(this.haven);
        if (g) {
          sim.items.props.set(`${this.haven.id}:${g.gate}`, 1);
          sim.space.setPieceState(`${this.haven.id}:${g.gate}`, 1);
        }
        sim.broadcast('The gate is open! Get the train through!');
      }
    }
    if (this.finale === Finale.Open && train.s > this.gateS + 40) {
      this.finale = Finale.Won;
      this.finish(true);
    }
  }

  /** Someone pulls Fort Haven's winch lever. */
  useWinch(playerId: string): void {
    const p = this.sim.players.get(playerId);
    if (!p || !this.haven || this.finale !== Finale.Closed) return;
    const g = fortGate(this.haven);
    if (!g) return;
    const w = pieceWorld(this.haven, this.haven.pieces[g.lever]!);
    if (Math.hypot(w.x - p.wx, w.z - p.wz) > 4) return;
    this.finale = Finale.Winching;
    this.winch = 0;
    this.sim.broadcast('The winch groans. Hold them off until the gate is up!');
  }

  /** Waves grow with the party: a solo defender faces about a third of a full party's. */
  private waveSize(full: number): number {
    const n = [...this.sim.players.values()].filter((p) => p.connected).length;
    return Math.max(1, Math.round(full * ([0.35, 0.5, 0.75, 1][Math.max(0, Math.min(3, n - 1))] ?? 1)));
  }

  /** Waves of the dead from outside the walls. */
  private waves(dt: number, fort: Structure, every: number, size: number): void {
    const sim = this.sim;
    this.waveT -= dt;
    if (this.waveT > 0) return;
    this.waveT = every;
    if (sim.enemySystem.alive >= 70) return;
    for (let i = 0; i < size; i++) {
      // Out beyond the walls, coming from all sides.
      const a = sim.rng.range(0, Math.PI * 2);
      const r = FORT_HALF_LENGTH + sim.rng.range(12, 30);
      const p = toWorld(fort, Math.cos(a) * r * 0.75, 0, Math.sin(a) * r);
      const type = sim.rng.chance(0.06) ? 'brute' : sim.rng.chance(0.35) ? 'runner' : 'walker';
      const e = sim.enemySystem.spawn(type, p.x, p.z);
      e.state = 'alerted';
      e.goalX = fort.x;
      e.goalZ = fort.z;
      e.stateT = 40;
    }
  }

  finish(won: boolean): void {
    if (this.result) return;
    const sim = this.sim;
    this.result = {
      won,
      km: Math.min(WORLD.routeKm, Math.max(0, sim.train.s / WORLD.metersPerKm)),
      minutes: sim.time / 60,
      landmarks: this.landmarks,
      bounties: this.bounties,
      kills: this.kills,
      dev: sim.devUsed,
    };
    sim.events.push({ ev: { e: 'runEnd', won } });
  }

  static frame = Frame;
}
