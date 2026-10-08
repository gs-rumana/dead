import { expect, test, type Page } from '@playwright/test';
import { Bot } from '../../bots/src/bot.ts';

/**
 * M2 "done when" proxy (§14): four players (two browsers, two bots) at 150 ms
 * simulated round-trip latency move around a moving train with no visible
 * rubber-banding. Measures prediction corrections and camera stability.
 */
test.setTimeout(180_000);

type Dbg = {
  game: {
    debug: {
      motor: { frame: number };
      corrections: number;
      correctionLog: string[];
      remotes: number;
      cameraInTrain: () => { x: number; y: number; z: number };
    };
    look: (yaw: number, pitch: number) => void;
  };
  conn: {
    code: string;
    stats: { rttMs: number };
    send: (t: string, m: unknown) => void;
    state: { train: { speed: number }; players: { size: number } };
  };
};
const W = (page: Page) => page.evaluate.bind(page);

async function start(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => {
    const d = (window as unknown as { __dt?: Dbg }).__dt;
    return !!d && d.conn.state.players.size > 0;
  });
  await page.evaluate(() => {
    (
      globalThis as unknown as { __netSim: { latencyMs: number; jitterMs: number } }
    ).__netSim.latencyMs = 150;
    (
      globalThis as unknown as { __netSim: { latencyMs: number; jitterMs: number } }
    ).__netSim.jitterMs = 15;
  });
}

async function cameraSteadiness(page: Page, frames = 60) {
  return page.evaluate(async (n) => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    let max = 0;
    let prev = d.game.debug.cameraInTrain();
    for (let i = 0; i < n; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const c = d.game.debug.cameraInTrain();
      max = Math.max(max, Math.hypot(c.x - prev.x, c.y - prev.y, c.z - prev.z));
      prev = c;
    }
    return max;
  }, frames);
}

test('four players at 150 ms on a moving train', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await start(a, '/?autostart=host&name=Alpha&seed=99');
  const code = await a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.code);
  await start(b, `/join/${code}?autostart=join&name=Bravo`);

  const bots = [
    new Bot('http://localhost:2567', 'Driver', 'driver'),
    new Bot('http://localhost:2567', 'Wanderer'),
  ];
  await bots[0]!.join(code);
  await bots[1]!.join(code);

  // Wait for the driver bot to get the train moving.
  await expect
    .poll(
      async () =>
        a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.train.speed),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(4);
  expect(
    await a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.players.size),
  ).toBe(4);

  // Both humans walk around on the moving train for a while.
  const walk = async (page: Page, yaw: number) => {
    await page.evaluate((y) => (window as unknown as { __dt: Dbg }).__dt.game.look(y, -0.1), yaw);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(700);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
  };
  const before = await Promise.all(
    [a, b].map((p) =>
      p.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.corrections),
    ),
  );
  for (let i = 0; i < 4; i++) {
    await Promise.all([walk(a, i % 2 ? 0 : Math.PI), walk(b, i % 2 ? Math.PI : 0)]);
  }
  await a.waitForTimeout(800);
  const after = await Promise.all(
    [a, b].map((p) =>
      p.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.corrections),
    ),
  );
  const rtt = await a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.stats.rttMs);
  const steadyA = await cameraSteadiness(a);
  const steadyB = await cameraSteadiness(b);
  const logs = await Promise.all(
    [a, b].map((p) =>
      p.evaluate(() =>
        (window as unknown as { __dt: Dbg }).__dt.game.debug.correctionLog.slice(-5).join(' | '),
      ),
    ),
  );
  console.log(
    JSON.stringify({
      rtt,
      corrections: after.map((v, i) => v - before[i]!),
      steadyA,
      steadyB,
      remotes: await a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.remotes),
    }),
  );
  console.log(logs.join('\n'));

  expect(rtt).toBeGreaterThan(120);
  // Both humans are still riding (nobody fell off).
  for (const p of [a, b])
    expect(
      await p.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.motor.frame),
    ).toBe(1);
  // No rubber-banding: walking and jumping on the moving train needs no corrections.
  for (let i = 0; i < 2; i++) expect(after[i]! - before[i]!).toBeLessThanOrEqual(1);
  expect(steadyA).toBeLessThan(0.03);
  expect(steadyB).toBeLessThan(0.03);
  await a.screenshot({ path: 'out/m2-alpha.png' });
  await b.screenshot({ path: 'out/m2-bravo.png' });
  await Promise.all(bots.map((x) => x.leave()));
  void W;
});
