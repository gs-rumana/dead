import { expect, test, type Page } from '@playwright/test';

/**
 * M5 "done when" proxy (§14): two players split up — one rides the handcar to a
 * town, shops and comes back; the other stays with the train. Feel is the user's
 * call; this checks the mechanics hold together over a full round trip.
 */
test.setTimeout(300_000);

type Dbg = {
  game: {
    debug: { tiles: number; motor: { frame: number }; target: { prompt: string } | null };
    lookAt: (x: number, y: number, z: number) => void;
    piecePos: (st: string, p: number) => { x: number; y: number; z: number } | null;
    world: {
      spurs: Array<{ end: number }>;
      structures: Array<{ id: string; town?: number; shop?: { kind: string; piece: number } }>;
    };
  };
  conn: {
    code: string;
    selfId: string;
    send: (t: string, m: unknown) => void;
    state: {
      handcars: { at: (i: number) => { s: number; speed: number } };
      enemies: { size: number };
      players: {
        get: (id: string) => { life: number; inv?: { dynamite: number; cash: number } } | undefined;
        size: number;
      };
    };
  };
};
const dt = (page: Page) => page.evaluate.bind(page);
void dt;

async function dev(page: Page, action: string, extra: Record<string, number> = {}) {
  await page.evaluate(
    ([a, e]) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'dev', action: a, ...e }),
    [action, extra] as const,
  );
}

async function boot(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __dt?: Dbg }).__dt &&
      (window as unknown as { __dt: Dbg }).__dt.game.debug.tiles > 10,
  );
}

async function ride(page: Page, key: 'KeyW' | 'KeyS', until: (s: number) => boolean) {
  await page.keyboard.down(key);
  const start = Date.now();
  while (Date.now() - start < 150_000) {
    const s = await page.evaluate(
      () => (window as unknown as { __dt: Dbg }).__dt.conn.state.handcars.at(0).s,
    );
    if (until(s)) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.up(key);
  return (Date.now() - start) / 1000;
}

test('one rides to town and back while the other guards the train', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await boot(a, '/?autostart=host&name=Rider&seed=8');
  const code = await a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.code);
  await boot(b, `/join/${code}?autostart=join&name=Guard`);
  await dev(a, 'god', { value: 1 });

  // The rider walks up to the junction's handcar and climbs on with E.
  await dev(a, 'handcar', { value: 0 });
  await a.waitForTimeout(1500);
  const hc = await a.evaluate(() => {
    const d = (
      window as unknown as { __dt: Dbg & { game: { trainPos: unknown; itemPos: unknown } } }
    ).__dt;
    return d.conn.state.handcars.at(0).s;
  });
  expect(hc).toBeGreaterThan(5);
  await a.evaluate(() => {
    // Look roughly toward the handcar (it is 1.8 m to our side).
    const d = (window as unknown as { __dt: Dbg }).__dt;
    d.conn.send('cmd', { t: 'use', target: 'handcar:0' });
  });
  await expect
    .poll(() => a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.motor.frame))
    .toBe(2);

  // Pump to town.
  const end = await a.evaluate(
    () => (window as unknown as { __dt: Dbg }).__dt.game.world.spurs[0]!.end,
  );
  const out = await ride(a, 'KeyW', (s) => s > end - 8);
  // Off, into the general store, buy dynamite, back on.
  await a.keyboard.press('KeyE');
  await expect
    .poll(() => a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.motor.frame))
    .toBe(0);
  const store = await a.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.game.world.structures.find(
      (s) => s.town === 0 && s.shop?.kind === 'gunsmith',
    )!,
  );
  const counter = (await a.evaluate(
    ([id, p]) => (window as unknown as { __dt: Dbg }).__dt.game.piecePos(id, p),
    [store.id, store.shop!.piece] as const,
  ))!;
  await dev(a, 'tp', { x: counter.x, y: counter.y - 0.5, z: counter.z });
  await dev(a, 'cash', { value: 40 });
  await a.waitForTimeout(500);
  const dyn0 = await a.evaluate(() => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    return d.conn.state.players.get(d.conn.selfId)!.inv!.dynamite;
  });
  await a.evaluate(
    (id) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', {
        t: 'buy',
        shop: id,
        kind: 'dynamite',
      }),
    store.id,
  );
  await expect
    .poll(() =>
      a.evaluate(() => {
        const d = (window as unknown as { __dt: Dbg }).__dt;
        return d.conn.state.players.get(d.conn.selfId)!.inv!.dynamite;
      }),
    )
    .toBe(dyn0 + 1);
  await dev(a, 'handcar', { value: 0 });
  await a.waitForTimeout(800);
  await a.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'use', target: 'handcar:0' }),
  );
  await expect
    .poll(() => a.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.motor.frame))
    .toBe(2);
  await a.screenshot({ path: 'out/m5-town.png' });
  // Pump home (S pumps backwards from a front seat).
  const back = await ride(a, 'KeyS', (s) => s < 30);
  console.log(
    JSON.stringify({
      outS: out,
      backS: back,
      enemies: await b.evaluate(
        () => (window as unknown as { __dt: Dbg }).__dt.conn.state.enemies.size,
      ),
    }),
  );
  // §4.4: a round trip of about 1–3 minutes plus time in town (with one rider, the upper end).
  expect(out + back).toBeLessThan(200);
  await b.screenshot({ path: 'out/m5-guard.png' });
});
