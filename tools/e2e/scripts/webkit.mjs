// Safari check (§8) in headless WebKit: menu, solo run, a few seconds of play.
import { webkit } from '@playwright/test';
const url = process.argv[2] ?? 'http://localhost:5173';
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(url + '/');
await page.getByTestId('age-ok').click();
await page.waitForSelector('[data-testid=username]', { timeout: 20000 }).catch(() => errors.push('no profile'));
await page.screenshot({ path: '/tmp/dt-scenes/webkit-menu.png' });
await page.getByTestId('play-solo').click();
const ok = await page.waitForFunction(() => window.__dt?.game?.debug?.tiles > 5, null, { timeout: 90000 }).then(() => true).catch((e) => (errors.push(e.message), false));
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/dt-scenes/webkit-game.png' });
const info = ok ? await page.evaluate(() => ({ backend: window.__dt.game.debug.perf.backend, fps: window.__dt.game.debug.perf.fps, calls: window.__dt.game.debug.perf.drawCalls })) : null;
console.log(JSON.stringify({ ok, info, errors: errors.slice(0, 10) }));
await browser.close();
