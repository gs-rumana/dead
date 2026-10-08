import { expect, test, type Page } from '@playwright/test';

/**
 * M6 through the client (§14): weather on the HUD, a landmark puzzle solved with
 * E (Copperhead Mine's three levers), the boss's health bar, and the Fort Haven
 * finale from the winch to the results screen. The full km 0–80 pacing run is the
 * sim's bot test (packages/sim/test/fullrun.test.ts).
 */
test.setTimeout(360_000);

type P3 = { x: number; y: number; z: number };
type Dbg = {
  game: {
    debug: { tiles: number; target: { prompt: string } | null };
    lookAt: (x: number, y: number, z: number) => void;
    piecePos: (st: string, p: number) => P3 | null;
    world: {
      structure: (id: string) => {
        x: number;
        y: number;
        z: number;
        yaw: number;
        pieces: Array<{ x: number; z: number }>;
        landmark?: { triggers: number[]; gate: number };
        leverPiece?: number;
      };
    };
  };
  conn: {
    send: (t: string, m: unknown) => void;
    state: { props: { get: (k: string) => number | undefined }; finale: number; result: string };
  };
};

async function dev(page: Page, action: string, extra: Record<string, number> = {}) {
  await page.evaluate(
    ([a, e]) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'dev', action: a, ...e }),
    [action, extra] as const,
  );
}

/** Stand 1 m in front of a structure piece (local -x side) and look at it. */
async function faceTo(page: Page, stId: string, piece: number, dx = -1.1) {
  const at = await page.evaluate(
    ([sid, pid, d]) => {
      const g = (window as unknown as { __dt: Dbg }).__dt.game;
      const st = g.world.structure(sid);
      const p = st.pieces[pid]!;
      const lx = p.x + d;
      const c = Math.cos(st.yaw);
      const s = Math.sin(st.yaw);
      return { x: st.x + c * lx + s * p.z, z: st.z - s * lx + c * p.z };
    },
    [stId, piece, dx] as const,
  );
  await dev(page, 'tp', at);
  await page.waitForTimeout(700);
  const target = await page.evaluate(
    ([sid, pid]) => (window as unknown as { __dt: Dbg }).__dt.game.piecePos(sid, pid),
    [stId, piece] as const,
  );
  await page.evaluate((q) => (window as unknown as { __dt: Dbg }).__dt.game.lookAt(q!.x, q!.y + 0.3, q!.z), target);
  await page.waitForTimeout(300);
}

async function prompt(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.debug.target?.prompt ?? '');
}

test('a landmark raid, weather and the finale through the client', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?autostart=solo&seed=9');
  await page.waitForFunction(
    () =>
      !!(window as unknown as { __dt?: Dbg }).__dt &&
      (window as unknown as { __dt: Dbg }).__dt.game.debug.tiles > 15,
  );
  await dev(page, 'director', { value: 0 });
  await dev(page, 'god', { value: 1 });
  await dev(page, 'time', { value: 0.3 });

  // Weather shows on the HUD.
  await dev(page, 'weather', { value: 2 });
  await expect(page.getByTestId('weather')).toContainText('Storm', { timeout: 5000 });
  await dev(page, 'weather', { value: 0 });

  // Copperhead Mine: pull the three levers.
  await dev(page, 'landmark', { value: 1 });
  await page.waitForTimeout(2500);
  const triggers = await page.evaluate(
    () => (window as unknown as { __dt: Dbg }).__dt.game.world.structure('l1').landmark!.triggers,
  );
  for (const t of triggers) {
    await faceTo(page, 'l1', t);
    expect(await prompt(page)).toBe('Pull the lever');
    await page.keyboard.press('KeyE');
    await page.waitForFunction(
      (k) => (window as unknown as { __dt: Dbg }).__dt.conn.state.props.get(k) === 1,
      `l1:${t}`,
    );
  }
  // The vault opens and Dr. Voss wakes: his health bar shows.
  await expect(page.getByTestId('boss-bar')).toContainText('Dr. Voss', { timeout: 8000 });
  await dev(page, 'clear');

  // Fort Haven: start the winch with a held E.
  await dev(page, 'finale');
  await page.waitForTimeout(3000);
  const lever = await page.evaluate(
    () => (window as unknown as { __dt: Dbg }).__dt.game.world.structure('f1').leverPiece!,
  );
  await faceTo(page, 'f1', lever, -1.2);
  expect(await prompt(page)).toContain('winch');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyE');
  await expect(page.getByTestId('objective')).toContainText('Winching', { timeout: 5000 });
  // Two minutes of winching, then the gate is open.
  await page.waitForFunction(() => (window as unknown as { __dt: Dbg }).__dt.conn.state.finale === 2, null, {
    timeout: 140_000,
  });
  await expect(page.getByTestId('objective')).toContainText('Drive the train through');
  // Drive through: the run is won and the results screen shows.
  await dev(page, 'infinite-fuel', { value: 1 });
  await dev(page, 'drive', { value: 1 });
  await expect(page.getByTestId('results')).toContainText('You made it to Fort Haven', { timeout: 60_000 });
  await expect(page.getByTestId('results')).toContainText('Landmarks cleared');
  await page.getByTestId('results-leave').click();
  await expect(page.getByTestId('menu')).toBeVisible();
  expect(errors).toEqual([]);
});
