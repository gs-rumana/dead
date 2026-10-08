import { describe, expect, it } from 'vitest';
import { Sim } from '../src/index.ts';
import { DEFAULT_PILOT, RunPilot } from '../src/bots/RunPilot.ts';

/**
 * M6 "done when" (§14): a bot party completes km 0 to 80 in 30–45 minutes. The
 * pilot plays through the real sim: stations, two town trips, the three landmark
 * raids, the Fort Ironwood checkpoint and the Fort Haven finale.
 */
describe('M6: a full run', () => {
  for (const [seed, party] of [
    [21, 2],
    [22, 4],
  ] as const) {
    it(`a ${party}-bot party completes the route (seed ${seed})`, async () => {
      const sim = await Sim.create({ seed });
      const ids = Array.from({ length: party }, (_, i) => `b${i}`);
      for (const id of ids) sim.addPlayer(id, id);
      const r = new RunPilot(sim, ids, DEFAULT_PILOT).run(70);
      console.log(
        `seed ${seed} ×${party}: ${r.won ? 'WON' : 'LOST'} in ${r.minutes.toFixed(1)} min, km ${r.km.toFixed(1)}, ` +
          `stops ${r.stops}, coal bought ${r.coalBought}/burned ${r.coalBurned}, bodies ${r.bodiesBurned}, ` +
          `starved ${r.starvedSeconds.toFixed(0)} s, kills ${r.kills}, landmarks ${r.landmarks}, ` +
          `tick avg ${r.avgTickMs.toFixed(2)} max ${r.maxTickMs.toFixed(1)} ms\n  ` +
          r.timeline.join('\n  '),
      );
      expect(r.won).toBe(true);
      expect(r.minutes).toBeGreaterThan(30);
      expect(r.minutes).toBeLessThan(45);
      expect(r.landmarks).toBe(3);
    }, 600_000);
  }
});
