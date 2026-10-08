import { expect, test, type Page } from '@playwright/test';

/**
 * M1 "done when" proxy (§14): drive 20 km on a low-end profile and hold the frame
 * target. Runs at 4× train speed so it takes ~5 minutes; opt in with SOAK=1.
 * The real check is the iPhone 11 Pro; this catches regressions headlessly.
 */
test.skip(!process.env.SOAK, 'soak test: set SOAK=1');
test.setTimeout(15 * 60_000);

type Win = {
  __dt: {
    game: {
      debug: {
        perf: {
          fps: number;
          frameMs: number;
          frameMaxMs: number;
          drawCalls: number;
          triangles: number;
        };
        tiles: number;
        origin: { x: number; z: number };
      };
    };
    conn: { send: (t: string, m: unknown) => void; state: { train: { s: number; speed: number } } };
  };
};

const dev = (page: Page, action: string, value?: number) =>
  page.evaluate(
    ([a, v]) => (window as unknown as Win).__dt.conn.send('cmd', { t: 'dev', action: a, value: v }),
    [action, value] as const,
  );

test('drive 20 km on a throttled mobile profile', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const cdp = await page.context().newCDPSession(page);
  const throttle = Number(process.env.SOAK_CPU ?? 4);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto('/?autostart=solo&seed=7&quality=low');
  await page.waitForFunction(
    () => !!(window as unknown as Win).__dt && (window as unknown as Win).__dt.game.debug.tiles > 5,
    null,
    { timeout: 120_000 },
  );
  await dev(page, 'infinite-fuel', 1);
  await dev(page, 'turbo', 4);
  await dev(page, 'drive', 1);
  const samples: Array<{
    s: number;
    fps: number;
    frameMs: number;
    maxMs: number;
    calls: number;
    tris: number;
  }> = [];
  const target = 20_000;
  const start = Date.now();
  // Cycle the weather on the way (M6): rain, storm, dust and fog particles count too.
  const weathers = [1, 2, 4, 3, 0];
  let n = 0;
  while (Date.now() - start < 12 * 60_000) {
    await page.waitForTimeout(2000);
    if (n++ % 20 === 0) await dev(page, 'weather', weathers[(n / 20) % weathers.length | 0]!);
    const r = await page.evaluate(() => {
      const d = (window as unknown as Win).__dt;
      const p = d.game.debug.perf;
      return {
        s: d.conn.state.train.s,
        fps: p.fps,
        frameMs: p.frameMs,
        maxMs: p.frameMaxMs,
        calls: p.drawCalls,
        tris: p.triangles,
      };
    });
    samples.push(r);
    if (r.s >= target) break;
  }
  const last = samples[samples.length - 1]!;
  const fps = samples
    .slice(3)
    .map((x) => x.fps)
    .sort((a, b) => a - b);
  const p10 = fps[Math.floor(fps.length * 0.1)] ?? 0;
  const median = fps[Math.floor(fps.length / 2)] ?? 0;
  const maxCalls = Math.max(...samples.map((x) => x.calls));
  const maxTris = Math.max(...samples.map((x) => x.tris));
  console.log(
    JSON.stringify({
      cpuThrottle: throttle,
      km: last.s / 250,
      minutes: (Date.now() - start) / 60000,
      fpsMedian: median,
      fpsP10: p10,
      maxCalls,
      maxTris,
    }),
  );
  await page.screenshot({ path: 'out/m1-soak-end.png' });
  expect(last.s).toBeGreaterThanOrEqual(target);
  expect(maxCalls).toBeLessThanOrEqual(150);
  expect(maxTris).toBeLessThanOrEqual(250_000);
});
