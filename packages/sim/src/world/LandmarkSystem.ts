import {
  BOSS_NAMES,
  ENEMY_TYPES,
  type Structure,
  bossHp,
  pieceWorld,
  toWorld,
} from '@dead-tracks/shared';
import type { Sim, SimPlayer } from '../Sim.ts';

export const BossState = { Sleeping: 0, Awake: 1, Dead: 2 } as const;

interface Landmark {
  st: Structure;
  boss: number;
  bossId: string;
}

/**
 * The three landmark raids (§4.6): Grayson Ranch (find the cellar key), Copperhead
 * Mine (pull three levers) and Blackpine Chateau (light three braziers). Solving
 * the puzzle opens the boss's door; killing the boss counts toward the results.
 * Puzzle progress lives in the synced props map like doors and boards.
 */
export class LandmarkSystem {
  readonly list: Landmark[];

  constructor(private readonly sim: Sim) {
    this.list = sim.world.structures
      .filter((s) => s.landmark)
      .map((st) => ({ st, boss: BossState.Sleeping, bossId: '' }));
  }

  private find(stId: string): Landmark | undefined {
    return this.list.find((l) => l.st.id === stId);
  }

  private near(p: SimPlayer, st: Structure, pieceId: number, r: number): boolean {
    const w = pieceWorld(st, st.pieces[pieceId]!);
    return Math.hypot(w.x - p.wx, w.y - p.wy - 0.9, w.z - p.wz) <= r;
  }

  /** A lever pulled or a brazier lit. */
  trigger(p: SimPlayer, stId: string, pieceId: number): void {
    const l = this.find(stId);
    const spec = l?.st.landmark;
    if (!l || !spec || !spec.triggers.includes(pieceId) || !this.near(p, l.st, pieceId, 3.4)) return;
    const props = this.sim.items.props;
    const key = `${stId}:${pieceId}`;
    if (props.get(key)) return;
    props.set(key, 1);
    const done = spec.triggers.filter((t) => props.get(`${stId}:${t}`)).length;
    if (done < spec.triggers.length) {
      const what = spec.kind === 'mine' ? 'Power restored' : 'Braziers lit';
      this.sim.toast(p.id, `${what}: ${done} of ${spec.triggers.length}`);
      return;
    }
    this.open(l, spec.kind === 'mine' ? 'The vault hums open.' : 'The crypt door grinds open.');
  }

  /** The cellar door: needs the key from the manor. */
  unlock(p: SimPlayer, stId: string, pieceId: number): void {
    const l = this.find(stId);
    const spec = l?.st.landmark;
    if (!l || !spec || spec.gate !== pieceId || !this.near(p, l.st, pieceId, 3.2)) return;
    if (this.sim.items.props.get(`${stId}:${pieceId}`)) return;
    if (spec.kind !== 'ranch') {
      this.sim.toast(p.id, spec.kind === 'mine' ? 'No power. Find the levers.' : 'Sealed. Light the braziers.');
      return;
    }
    const i = p.inv.pack.indexOf('cellar_key');
    if (i < 0) {
      this.sim.toast(p.id, 'Locked. The key must be somewhere in the manor.');
      return;
    }
    p.inv.pack.splice(i, 1);
    this.open(l, 'The cellar door creaks open...');
  }

  /** Whether a searched container is the one hiding the key. */
  isKeyPiece(stId: string, pieceId: number): boolean {
    return this.find(stId)?.st.landmark?.keyPiece === pieceId;
  }

  private open(l: Landmark, text: string): void {
    const sim = this.sim;
    const spec = l.st.landmark!;
    const key = `${l.st.id}:${spec.gate}`;
    sim.items.props.set(key, 1);
    sim.space.setPieceState(key, 1);
    sim.broadcast(text);
    if (l.boss !== BossState.Sleeping) return;
    const at = toWorld(l.st, spec.bossX, 0, spec.bossZ);
    const e = sim.enemySystem.spawn(spec.boss, at.x, at.z);
    const players = [...sim.players.values()].filter((p) => p.connected).length;
    e.maxHp = e.hp = bossHp(spec.boss, players);
    e.homeX = at.x;
    e.homeZ = at.z;
    e.state = 'alerted';
    e.goalX = at.x;
    e.goalZ = at.z;
    e.stateT = 2;
    l.boss = BossState.Awake;
    l.bossId = e.id;
    sim.events.push({ ev: { e: 'boss', type: ENEMY_TYPES.indexOf(spec.boss), awake: true } });
    sim.broadcast(`${BOSS_NAMES[spec.boss]} awakens!`);
  }

  step(): void {
    const sim = this.sim;
    for (const l of this.list) {
      if (l.boss !== BossState.Awake) continue;
      const e = sim.enemySystem.enemies.get(l.bossId);
      if (e && e.state !== 'dead') continue;
      l.boss = BossState.Dead;
      sim.forts.landmarks++;
      const spec = l.st.landmark!;
      sim.events.push({ ev: { e: 'boss', type: ENEMY_TYPES.indexOf(spec.boss), awake: false } });
      sim.broadcast(`${BOSS_NAMES[spec.boss]} is dead! ${l.st.name} is cleared.`);
    }
  }

  /** Development: open a landmark's door straight away. */
  devOpen(index: number): void {
    const l = this.list[index];
    if (l) this.open(l, `${l.st.name} opened (dev).`);
  }
}
