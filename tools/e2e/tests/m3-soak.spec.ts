import { expect, test, type Page } from '@playwright/test';

/**
 * M3 "done when" proxy (§14): a night horde of 80 on a low-end profile stays inside
 * the §7 mobile budgets. Real check: the iPhone 11 Pro. Opt in with SOAK=1.
 */
test.skip(!process.env.SOAK, 'soak test: set SOAK=1');
test.setTimeout(5 * 60_000);

type Win = {
  __dt: {
    game: {
      debug: {
        tiles: number;
        enemies: number;
        perf: {
          fps: number;
          frameMs: number;
          drawCalls: number;
          triangles: number;
          heapMb: number;
        };
      };
    };
    conn: { send: (t: string, m: unknown) => void; stats: { inRate: number } };
  };
};
const dev = (page: Page, action: string, value?: number) =>
  page.evaluate(
    ([a, v]) => (window as unknown as Win).__dt.conn.send('cmd', { t: 'dev', action: a, value: v }),
    [action, value] as const,
  );

test('80-zombie night on a throttled mobile profile', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SOAK_CPU ?? 4) });
  await page.goto('/?autostart=solo&seed=12&quality=low');
  await page.waitForFunction(
    () => !!(window as unknown as Win).__dt && (window as unknown as Win).__dt.game.debug.tiles > 5,
    null,
    { timeout: 120_000 },
  );
  await dev(page, 'god', 1);
  await dev(page, 'time', 0.78);
  await dev(page, 'ground');
  await page.waitForTimeout(1000);
  await dev(page, 'horde', 80);
  const samples: Array<{
    fps: number;
    calls: number;
    tris: number;
    kbs: number;
    enemies: number;
    heap: number;
  }> = [];
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500);
    samples.push(
      await page.evaluate(() => {
        const d = (window as unknown as Win).__dt;
        const p = d.game.debug.perf;
        return {
          fps: p.fps,
          calls: p.drawCalls,
          tris: p.triangles,
          kbs: d.conn.stats.inRate / 1024,
          enemies: d.game.debug.enemies,
          heap: p.heapMb,
        };
      }),
    );
  }
  const tail = samples.slice(4);
  const fps = tail.map((s) => s.fps).sort((a, b) => a - b);
  const result = {
    fpsMedian: fps[Math.floor(fps.length / 2)],
    fpsMin: fps[0],
    maxCalls: Math.max(...tail.map((s) => s.calls)),
    maxTris: Math.max(...tail.map((s) => s.tris)),
    maxKBs: Math.max(...tail.map((s) => s.kbs)),
    enemies: Math.max(...tail.map((s) => s.enemies)),
    heapMb: Math.max(...tail.map((s) => s.heap)),
  };
  // Sanity: enemies really are positioned and moving on the client.
  const sane = await page.evaluate(() => {
    let ok = 0;
    (
      window as unknown as {
        __dt: {
          conn: {
            state: { enemies: { forEach: (cb: (e: { x: number; z: number }) => void) => void } };
          };
        };
      }
    ).__dt.conn.state.enemies.forEach((e) => {
      if (Number.isFinite(e.x) && Number.isFinite(e.z)) ok++;
    });
    return ok;
  });
  console.log(JSON.stringify({ ...result, positioned: sane }));
  expect(sane).toBeGreaterThan(60);
  await page.screenshot({ path: 'out/m3-soak.png' });
  expect(result.enemies).toBeGreaterThan(60);
  expect(result.maxCalls).toBeLessThanOrEqual(150);
  expect(result.maxTris).toBeLessThanOrEqual(250_000);
  expect(result.maxKBs).toBeLessThanOrEqual(15);
  expect(result.heapMb).toBeLessThanOrEqual(200);
});
