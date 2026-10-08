import { expect, test, type Page } from '@playwright/test';

type Dbg = {
  game: {
    debug: {
      tiles: number;
      enemies: number;
      perf: { fps: number; drawCalls: number; triangles: number };
    };
    aimAtNearestEnemy: (head?: boolean) => string | null;
    trigger: () => void;
    setAim: (on: boolean) => void;
    look: (y: number, p: number) => void;
  };
  conn: {
    send: (t: string, m: unknown) => void;
    selfId: string;
    state: {
      enemies: {
        size: number;
        get: (id: string) => { hp: number; anim: number } | undefined;
        forEach: (cb: (e: { anim: number }) => void) => void;
      };
      players: {
        get: (
          id: string,
        ) =>
          { hp: number; life: number; inv?: { mags: { at: (i: number) => number } } } | undefined;
      };
    };
  };
};
const W = (p: Page) => p as Page;
const dev = (page: Page, action: string, value?: number) =>
  page.evaluate(
    ([a, v]) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'dev', action: a, value: v }),
    [action, value] as const,
  );

test.setTimeout(120_000);

test('shoot walkers: hits register, heads pop, iron sights render', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?autostart=solo&seed=21');
  await page.waitForFunction(() => {
    const d = (window as unknown as { __dt?: Dbg }).__dt;
    return !!d && d.game.debug.tiles > 15;
  });
  await dev(page, 'director', 0);
  await dev(page, 'god', 1);
  await dev(page, 'ground');
  await page.waitForTimeout(500);
  await dev(page, 'spawn', 4);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.enemies), {
      timeout: 10_000,
    })
    .toBeGreaterThan(3);
  await page.waitForTimeout(400);

  // Count our kills from the host's hit events (bodies become items after a moment).
  await page.evaluate(() => {
    const d = (
      window as unknown as {
        __dt: Dbg & {
          conn: {
            onEvents: (
              cb: (evs: Array<{ e: string; kill?: boolean; by?: string }>) => void,
            ) => void;
          };
        };
      }
    ).__dt;
    (window as unknown as { __kills: number }).__kills = 0;
    d.conn.onEvents((evs) => {
      for (const ev of evs)
        if (ev.e === 'hit' && ev.kill && ev.by === d.conn.selfId)
          (window as unknown as { __kills: number }).__kills++;
    });
  });
  // Aimed headshots with the revolver until they're down (hip fire spreads ~0.7 m at 20 m).
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.setAim(true));
  await page.waitForTimeout(400);
  let kills = 0;
  for (let i = 0; i < 12 && kills < 3; i++) {
    const id = await page.evaluate(() =>
      (window as unknown as { __dt: Dbg }).__dt.game.aimAtNearestEnemy(true),
    );
    expect(id).not.toBeNull();
    await page.waitForTimeout(120);
    await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.trigger());
    await page.waitForTimeout(450);
    kills = await page.evaluate(() => (window as unknown as { __kills: number }).__kills);
    if (i === 1) await page.screenshot({ path: 'out/m3-shot.png' });
  }
  expect(kills).toBeGreaterThanOrEqual(2);

  // Iron sights.
  await page.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.game.aimAtNearestEnemy(false),
  );
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.setAim(true));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'out/m3-ironsights.png' });
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.setAim(false));
  void W;
  expect(errors).toEqual([]);
});

test('night horde of 80 renders within budget', async ({ page }) => {
  await page.goto('/?autostart=solo&seed=22');
  await page.waitForFunction(() => {
    const d = (window as unknown as { __dt?: Dbg }).__dt;
    return !!d && d.game.debug.tiles > 15;
  });
  await dev(page, 'god', 1);
  await dev(page, 'time', 0.78);
  await dev(page, 'ground');
  await page.waitForTimeout(500);
  await dev(page, 'horde', 80);
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    return { enemies: d.game.debug.enemies, ...d.game.debug.perf };
  });
  console.log(JSON.stringify(r));
  await page.screenshot({ path: 'out/m3-horde.png' });
  expect(r.enemies).toBeGreaterThan(60);
  expect(r.drawCalls).toBeLessThan(500);
});
