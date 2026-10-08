import { describe, it } from 'vitest';
import { Sim } from '../src/index.ts';
import { HUMAN_PILOT, RunPilot } from '../src/bots/RunPilot.ts';

/**
 * Balancing pass (§12): human-like bot parties play full runs without god mode.
 * Slow (minutes); run with BALANCE=1. Prints a table instead of asserting, since
 * the targets are judgement calls.
 */
describe.skipIf(!process.env.BALANCE)('balance', () => {
  it('parties of 1, 2 and 4 over several seeds', async () => {
    const rows: string[] = [];
    for (const party of [1, 2, 4]) {
      for (const seed of [101, 202, 303]) {
        const sim = await Sim.create({ seed });
        const ids = Array.from({ length: party }, (_, i) => `b${i}`);
        for (const id of ids) sim.addPlayer(id, id);
        const r = new RunPilot(sim, ids, { ...HUMAN_PILOT, towns: party === 1 ? [1] : [1, 4] }).run(70);
        const last = r.timeline[r.timeline.length - 2] ?? '';
        rows.push(
          `${party}p seed ${seed}: ${r.won ? 'WON ' : r.over ? 'DIED' : 'STOP'} ${r.minutes.toFixed(1)} min km ${r.km.toFixed(1)} ` +
            `downs ${r.downs} deaths ${r.deaths} kills ${r.kills} landmarks ${r.landmarks} coal ${r.coalBought}/${r.coalBurned} starved ${r.starvedSeconds.toFixed(0)}s | ${last}`,
        );
        console.log(rows[rows.length - 1]);
        console.log('   causes', JSON.stringify(r.causes));
        if (process.env.BALANCE_LOG) console.log(r.timeline.map((l) => `   ${l}`).join('\n'));
      }
    }
  }, 3_600_000);
});
