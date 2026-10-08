import { expect, test } from '@playwright/test';

/**
 * M8 (§8): the production build installs a service worker, so after one visit the
 * game loads and a solo run starts with no network at all. Also checks §7's
 * download budget from the build itself.
 */
test.setTimeout(180_000);

type W = { __dt?: { game: { debug: { tiles: number } } } };

test('works offline after the first visit (solo)', async ({ page, context }) => {
  await page.goto('/');
  // Wait for the service worker to install, then reload so it controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 })
    .toBe(true);
  // Everything precached (the install step finished).
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]!);
    return (await c.keys()).length;
  });
  expect(cached).toBeGreaterThan(5);
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest.display).toBe('fullscreen');
  expect(manifest.orientation).toBe('landscape');

  await context.setOffline(true);
  await page.goto('/?autostart=solo&seed=7&quality=low');
  await page.waitForFunction(() => ((window as unknown as W).__dt?.game.debug.tiles ?? 0) > 5, null, {
    timeout: 90_000,
  });
  // Moving around in the offline run works.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: 'out/m8-offline.png' });
  await context.setOffline(false);
});

test('the download before play stays within budget', async ({ page }) => {
  let bytes = 0;
  page.on('response', async (r) => {
    const len = Number((await r.allHeaders())['content-length'] ?? 0);
    bytes += len || (await r.body().catch(() => Buffer.alloc(0))).length;
  });
  await page.goto('/?autostart=solo&seed=7&quality=low');
  await page.waitForFunction(() => ((window as unknown as W).__dt?.game.debug.tiles ?? 0) > 5, null, {
    timeout: 90_000,
  });
  // §7: at most 25 MB before play (uncompressed here, so a generous upper bound).
  expect(bytes / 1e6).toBeLessThan(25);
});
