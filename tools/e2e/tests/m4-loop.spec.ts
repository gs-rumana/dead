import { expect, test, type Page } from '@playwright/test';

/**
 * M4 "done when" (§14): stop, loot, carry, burn, stow, sell, buy, fortify, depart —
 * driven through the real client: crosshair targeting, E and G, the shop UI.
 */
test.setTimeout(180_000);

type P3 = { x: number; y: number; z: number };
type Dbg = {
  game: {
    debug: {
      tiles: number;
      fuel: number;
      target: { prompt: string } | null;
      motor: { driving: boolean; frame: number };
    };
    world: {
      structures: Array<{
        id: string;
        kind: string;
        feature?: { kind: string };
        pieces: Array<{ id: number; kind: string; loot?: string }>;
        shop?: { piece: number };
      }>;
    };
    lookAt: (x: number, y: number, z: number) => void;
    look: (y: number, p: number) => void;
    piecePos: (st: string, p: number) => P3 | null;
    itemPos: (id: string) => P3 | null;
    trainPos: (x: number, y: number, z: number) => P3;
  };
  conn: {
    send: (t: string, m: unknown) => void;
    selfId: string;
    state: {
      train: { speed: number; fuel: number };
      items: {
        forEach: (
          cb: (
            it: { kind: string; slot: number; holder: string; frame: number },
            id: string,
          ) => void,
        ) => void;
      };
      props: { get: (k: string) => number | undefined };
      forts: { at: (i: number) => number | undefined };
      players: {
        get: (id: string) =>
          | {
              carry: string;
              carryKind: string;
              inv?: { cash: number; pack: { length: number; toArray: () => string[] } };
            }
          | undefined;
      };
    };
  };
};
const D = (page: Page) => page.evaluate.bind(page) as <R, A>(fn: (a: A) => R, arg: A) => Promise<R>;
const win = 'window as unknown as { __dt: Dbg }';
void win;

async function dev(page: Page, action: string, extra: Record<string, number> = {}) {
  await page.evaluate(
    ([a, e]) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'dev', action: a, ...e }),
    [action, extra] as const,
  );
}

async function tp(page: Page, p: P3, back = 1.4) {
  await dev(page, 'tp', { x: p.x + back, z: p.z + 0.3 });
  await page.waitForTimeout(500);
}

async function lookAt(page: Page, p: P3) {
  await page.evaluate(
    (q) => (window as unknown as { __dt: Dbg }).__dt.game.lookAt(q.x, q.y, q.z),
    p,
  );
  await page.waitForTimeout(250);
}

async function prompt(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __dt: Dbg }).__dt.game.debug.target?.prompt ?? '',
  );
}

async function me(page: Page) {
  return page.evaluate(() => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    const p = d.conn.state.players.get(d.conn.selfId)!;
    return { carry: p.carryKind, cash: p.inv?.cash ?? 0, pack: p.inv?.pack.toArray() ?? [] };
  });
}

/** The nearest loose item of a kind to the player. */
async function findItem(page: Page, kind: string): Promise<{ id: string; pos: P3 } | null> {
  return page.evaluate((k) => {
    const d = (window as unknown as { __dt: Dbg & { game: { debug: { camera: P3 } } } }).__dt;
    const cam = d.game.debug.camera;
    let found: { id: string; pos: P3 } | null = null;
    let best = Infinity;
    d.conn.state.items.forEach((it, id) => {
      if (it.kind !== k || it.holder || it.slot >= 0) return;
      const pos = d.game.itemPos(id);
      if (!pos) return;
      const dist = Math.hypot(pos.x - cam.x, pos.z - cam.z);
      if (dist < best) {
        best = dist;
        found = { id, pos };
      }
    });
    return found;
  }, kind);
}

test('the full station loop through the client', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=solo&seed=8');
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __dt?: Dbg }).__dt &&
      (window as unknown as { __dt: Dbg }).__dt.game.debug.tiles > 15,
  );
  await dev(page, 'director', { value: 0 });
  await dev(page, 'clear');
  await dev(page, 'god', { value: 1 });
  await page.waitForTimeout(1500);
  const depot = await page.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.game.world.structures.find(
      (s) => s.feature?.kind === 'start',
    )!,
  );

  // 1. Loot: carry a coal sack.
  const sack = (await findItem(page, 'coal'))!;
  expect(sack).not.toBeNull();
  await tp(page, sack.pos);
  await lookAt(page, { ...sack.pos, y: sack.pos.y + 0.3 });
  expect(await prompt(page)).toContain('Carry');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await me(page)).carry).toBe('coal');

  // 2. Burn it in the furnace.
  await dev(page, 'cab');
  await page.waitForTimeout(500);
  const fire = await page.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.game.trainPos(0, 2.0, 8.55),
  );
  await lookAt(page, fire);
  const fuel0 = await page.evaluate(
    () => (window as unknown as { __dt: Dbg }).__dt.conn.state.train.fuel,
  );
  expect(await prompt(page)).toContain('Burn');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await me(page)).carry).toBe('');
  expect(
    await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.train.fuel),
  ).toBeGreaterThan(fuel0 + 30);

  // 3. Search the depot drawers (hold E).
  const drawer = depot.pieces.find((p) => p.kind === 'drawer')!;
  const dpos = (await page.evaluate(
    ([s, p]) => (window as unknown as { __dt: Dbg }).__dt.game.piecePos(s, p),
    [depot.id, drawer.id] as const,
  ))!;
  await dev(page, 'tp', { x: dpos.x, y: dpos.y - 0.45, z: dpos.z });
  await page.waitForTimeout(400);
  // Step back a little from the drawer and face it.
  await lookAt(page, dpos);
  expect(await prompt(page)).toMatch(/search/i);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyE');
  await expect
    .poll(() =>
      page.evaluate(
        ([k]) => (window as unknown as { __dt: Dbg }).__dt.conn.state.props.get(k) ?? 0,
        [`${depot.id}:${drawer.id}`] as const,
      ),
    )
    .toBe(1);

  // 4. Sell valuables and buy a plate at the counter.
  await dev(page, 'item', { value: 5 }); // jewelry at our feet
  await page.waitForTimeout(800);
  const jewel = (await findItem(page, 'jewelry'))!;
  await lookAt(page, jewel.pos);
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await me(page)).pack.length).toBeGreaterThan(0);
  const counter = depot.pieces[depot.shop!.piece]!;
  const cpos = (await page.evaluate(
    ([s, p]) => (window as unknown as { __dt: Dbg }).__dt.game.piecePos(s, p),
    [depot.id, counter.id] as const,
  ))!;
  await dev(page, 'tp', { x: cpos.x, y: cpos.y - 0.5, z: cpos.z + 1.6 });
  await page.waitForTimeout(400);
  await lookAt(page, cpos);
  expect(await prompt(page)).toContain('Shop');
  await page.keyboard.press('KeyE');
  await expect(page.getByTestId('shop')).toBeVisible();
  const cash0 = (await me(page)).cash;
  await page
    .getByText('Sell everything')
    .or(page.getByRole('button', { name: /^\$/ }).last())
    .first()
    .click();
  await expect.poll(async () => (await me(page)).cash).toBeGreaterThan(cash0);
  await dev(page, 'cash', { value: 50 });
  await page.waitForTimeout(300);
  await page.getByTestId('buy-plate').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shop')).toBeHidden();
  await page.waitForTimeout(1200);

  // 5. Fortify: carry the plate to the flatcar.
  const plate = (await findItem(page, 'plate'))!;
  expect(plate).not.toBeNull();
  await tp(page, plate.pos, 1.2);
  await lookAt(page, { ...plate.pos, y: plate.pos.y + 0.4 });
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await me(page)).carry).toBe('plate');
  await dev(page, 'respawn');
  await page.waitForTimeout(600);
  // Fort point 1: left side of the flatcar, second quarter (nearest the respawn spot).
  const point = await page.evaluate(() =>
    (window as unknown as { __dt: Dbg }).__dt.game.trainPos(-1.5, 1.75, 24.99),
  );
  await lookAt(page, point);
  expect(await prompt(page)).toContain('plate');
  await page.keyboard.press('KeyE');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.forts.at(1) ?? 0),
    )
    .toBeGreaterThan(0);

  // 6. Stow a crate in a cargo slot.
  await dev(page, 'item', { value: 3 });
  await page.waitForTimeout(800);
  const crate = (await findItem(page, 'crate'))!;
  await lookAt(page, { ...crate.pos, y: crate.pos.y + 0.3 });
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await me(page)).carry).toBe('crate');
  await page.waitForTimeout(300);
  expect(await prompt(page)).toContain('Stow');
  await page.keyboard.press('KeyE');
  await expect
    .poll(() =>
      page.evaluate(() => {
        let slotted = 0;
        (window as unknown as { __dt: Dbg }).__dt.conn.state.items.forEach((it) => {
          if (it.kind === 'crate' && it.slot >= 0) slotted++;
        });
        return slotted;
      }),
    )
    .toBe(1);

  // 7. Depart.
  await dev(page, 'cab');
  await page.waitForTimeout(500);
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.look(0, -0.15));
  await page.keyboard.press('KeyE');
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.motor.driving),
    )
    .toBe(true);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.train.speed),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(2);
  await page.screenshot({ path: 'out/m4-depart.png' });
  void D;
  expect(errors).toEqual([]);
});
