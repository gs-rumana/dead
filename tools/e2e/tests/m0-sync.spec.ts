import { expect, test, type Page } from '@playwright/test';

interface DebugHandle {
  conn: {
    code: string;
    selfId: string;
    state: {
      tick: number;
      test: { angle: number; color: number; nudges: number };
      players: { size: number };
    };
  };
}

async function readTest(page: Page) {
  return page.evaluate(() => {
    const dt = (window as unknown as { __dt: DebugHandle }).__dt;
    return {
      tick: dt.conn.state.tick,
      nudges: dt.conn.state.test.nudges,
      color: dt.conn.state.test.color,
      players: dt.conn.state.players.size,
      code: dt.conn.code,
    };
  });
}

async function nudge(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { __dt: { conn: { send: (t: string, m: unknown) => void } } }
    ).__dt.conn.send('cmd', { t: 'nudge' }),
  );
}

async function waitForGame(page: Page) {
  await page.waitForFunction(() => {
    const dt = (window as unknown as { __dt?: DebugHandle }).__dt;
    return !!dt && dt.conn.state.tick > 5;
  });
}

test('solo session runs the simulation in a worker', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=solo&seed=42');
  await waitForGame(page);
  const a = await readTest(page);
  await page.waitForTimeout(500);
  const b = await readTest(page);
  expect(b.tick).toBeGreaterThan(a.tick);
  expect(a.code).toBe('SOLO');
  await nudge(page);
  await expect.poll(async () => (await readTest(page)).nudges).toBe(1);
  await page.screenshot({ path: 'out/m0-solo.png' });
  expect(errors).toEqual([]);
});

test('two clients share the same synced test object through the server', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto('/?autostart=host&name=Alpha');
  await waitForGame(a);
  const code = (await readTest(a)).code;
  expect(code).toMatch(/^[A-Z]{4}$/);

  await b.goto(`/join/${code}?autostart=join&name=Bravo`);
  await waitForGame(b);
  await expect.poll(async () => (await readTest(a)).players).toBe(2);
  expect((await readTest(b)).players).toBe(2);

  await nudge(b);
  await expect.poll(async () => (await readTest(a)).nudges).toBe(1);
  const sa = await readTest(a);
  const sb = await readTest(b);
  expect(sa.color).toBe(sb.color);
  expect(Math.abs(sa.tick - sb.tick)).toBeLessThan(10);
  await a.screenshot({ path: 'out/m0-host.png' });
  await b.screenshot({ path: 'out/m0-join.png' });
  await ctxA.close();
  await ctxB.close();
});
