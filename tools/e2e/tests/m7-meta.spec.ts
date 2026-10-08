import { type Browser, type Page, expect, test } from '@playwright/test';

/**
 * M7 "done when" (§14): bonds and unlocks survive a reload and a device switch
 * after sign-in. A device is a fresh browser context (its own storage). Sign-in
 * uses the development provider, which only exists on dev servers.
 */
test.setTimeout(240_000);

const SERVER = 'http://localhost:2567';

async function device(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return ctx.newPage();
}

async function openMenu(page: Page) {
  await page.goto('/');
  const gate = page.getByTestId('age-ok');
  if (await gate.isVisible().catch(() => false)) await gate.click();
  else {
    await page.waitForSelector('[data-testid=age-gate], [data-testid=menu]');
    if (await gate.isVisible().catch(() => false)) await gate.click();
  }
  await expect(page.getByTestId('username')).toBeVisible({ timeout: 15_000 });
}

const bonds = async (page: Page) => Number((await page.getByTestId('bonds').innerText()).replace(/\D/g, ''));
const token = (page: Page) => page.evaluate(() => localStorage.getItem('dead-tracks:token') ?? '');

async function signInDev(page: Page, who: string) {
  await page.getByTestId('signin-dev').click();
  await page.waitForURL(/\/auth\/dev\/authorize/);
  await page.getByTestId('dev-id').fill(who);
  await page.getByTestId('dev-sign-in').click();
  await page.waitForURL((u) => u.origin === 'http://localhost:5173');
  await expect(page.getByTestId('signed-in')).toBeVisible({ timeout: 15_000 });
}

test('bonds and unlocks survive a reload and a device switch after sign-in', async ({ browser }) => {
  const who = `e2e${Date.now().toString(36)}`;
  // Device A: a guest earns bonds (granted here; earning them takes a full run) and unlocks the Medic.
  const a = await device(browser);
  await openMenu(a);
  expect(await bonds(a)).toBe(0);
  const res = await a.request.post(`${SERVER}/api/dev/bonds`, {
    headers: { Authorization: `Bearer ${await token(a)}` },
    data: { bonds: 20 },
  });
  expect(res.ok()).toBe(true);
  await a.reload();
  await expect(a.getByTestId('bonds')).toContainText('20');
  await a.getByTestId('unlock-medic').click();
  await expect(a.getByTestId('bonds')).toContainText('5');
  await expect(a.getByTestId('unlock-medic')).toHaveCount(0);
  await expect(a.getByTestId('class-medic')).toHaveClass(/picked/);

  // Reload: still there.
  await a.reload();
  await expect(a.getByTestId('username')).toBeVisible();
  expect(await bonds(a)).toBe(5);
  await expect(a.getByTestId('unlock-medic')).toHaveCount(0);

  // Sign in: the guest's progress becomes the account's.
  await signInDev(a, who);
  expect(await bonds(a)).toBe(5);
  await expect(a.getByTestId('unlock-medic')).toHaveCount(0);
  await a.reload();
  await expect(a.getByTestId('signed-in')).toBeVisible({ timeout: 15_000 });
  expect(await bonds(a)).toBe(5);

  // Device B: a different browser with its own storage signs in to the same account.
  const b = await device(browser);
  await openMenu(b);
  expect(await bonds(b)).toBe(0);
  await expect(b.getByTestId('unlock-medic')).toBeVisible();
  await signInDev(b, who);
  expect(await bonds(b)).toBe(5);
  await expect(b.getByTestId('unlock-medic')).toHaveCount(0);

  // ...and plays a Medic there: three bandages in the kit.
  await b.getByTestId('class-medic').click();
  await b.getByTestId('play-solo').click();
  await b.waitForFunction(
    () => ((window as unknown as { __dt?: { game: { debug: { tiles: number } } } }).__dt?.game.debug.tiles ?? 0) > 5,
    null,
    { timeout: 60_000 },
  );
  await expect(b.locator('.class-tag')).toHaveText('Medic', { timeout: 10_000 });
  const bandages = await b.evaluate(() => {
    const d = (window as unknown as { __dt: { conn: { selfId: string; state: { players: { get: (id: string) => { inv?: { bandage: number } } } } } } }).__dt;
    return d.conn.state.players.get(d.conn.selfId)?.inv?.bandage ?? -1;
  });
  expect(bandages).toBe(3);
  await a.context().close();
  await b.context().close();
});

test('a party forms in the lobby; pings reach teammates; keys can be rebound', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await openMenu(a);
  await openMenu(b);
  await a.getByTestId('host').click();
  await expect(a.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  const code = (await a.getByTestId('lobby-code').innerText()).trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  await b.getByTestId('code-input').fill(code);
  await b.getByTestId('join').click();
  await expect(b.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('members').locator('li:not(.empty)')).toHaveCount(2);
  await b.getByTestId('lobby-ready').click();
  await expect(a.getByTestId('members')).toContainText('Ready');
  // Only the leader has the start button.
  await expect(b.getByTestId('lobby-start')).toHaveCount(0);
  await a.getByTestId('lobby-start').click();
  type W = { __dt?: { game: { debug: { tiles: number }; lookAt: (x: number, y: number, z: number) => void }; conn: { code: string; state: { players: { size: number } } } } };
  for (const p of [a, b])
    await p.waitForFunction(() => ((window as unknown as W).__dt?.game.debug.tiles ?? 0) > 5, null, { timeout: 60_000 });
  // Both are in the same run, which shows the party code.
  await a.waitForFunction(() => (window as unknown as W).__dt!.conn.state.players.size === 2);
  expect(await a.evaluate(() => (window as unknown as W).__dt!.conn.code)).toBe(code);
  await expect(a.getByTestId('compass')).toBeVisible();

  // A taps the ping key: B sees a marker and hears about it.
  await a.evaluate(() => {
    const g = (window as unknown as { __dt: { game: { touchPing: boolean } } }).__dt.game;
    g.touchPing = true;
    setTimeout(() => (g.touchPing = false), 150);
  });
  await expect(b.locator('.marker.ping')).toHaveCount(1, { timeout: 5000 });
  await expect(b.locator('.marker.ping')).toContainText('Look here');

  // The ping wheel: hold, flick toward "Help!" (top-right), release. (Pings are rate limited.)
  await a.waitForTimeout(700);
  await a.evaluate(() => ((window as unknown as { __dt: { game: { touchPing: boolean } } }).__dt.game.touchPing = true));
  await expect(a.getByTestId('ping-wheel')).toBeVisible();
  await a.evaluate(() => {
    const g = (window as unknown as { __dt: { game: { input: { touch: { lookDx: number; lookDy: number } } } } }).__dt.game;
    g.input.touch.lookDx = 40;
    g.input.touch.lookDy = -24;
  });
  await a.waitForTimeout(200);
  await a.screenshot({ path: 'out/m7-ping-wheel.png' });
  await a.evaluate(() => ((window as unknown as { __dt: { game: { touchPing: boolean } } }).__dt.game.touchPing = false));
  await expect(b.locator('.marker.ping')).toContainText('Help!', { timeout: 5000 });

  // Rebind "use meds" to V in the pause menu; it sticks across a reload.
  await a.keyboard.press('Escape');
  await expect(a.getByTestId('pause-menu')).toBeVisible();
  await a.getByRole('button', { name: 'Controls' }).click();
  await a.getByTestId('bind-heal').click();
  await expect(a.getByTestId('bind-heal')).toHaveText('Press a key…');
  await a.waitForTimeout(100);
  await a.keyboard.press('KeyV');
  await expect(a.getByTestId('bind-heal')).toHaveText('V');
  const saved = await a.evaluate(() => JSON.parse(localStorage.getItem('dead-tracks:settings') ?? '{}').keys?.heal);
  expect(saved).toBe('KeyV');
  expect(
    await a.evaluate(() => (window as unknown as { __dt: { game: { input: { codeFor: (x: string) => string } } } }).__dt.game.input.codeFor('heal')),
  ).toBe('KeyV');
  await a.context().close();
  await b.context().close();
});
