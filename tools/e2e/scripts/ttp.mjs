// Time to playable (§7) on a throttled connection: node ttp.mjs <url> [down Mbps] [cpu]
import { chromium } from '@playwright/test';
const [, , url = 'http://localhost:4180/?autostart=solo&seed=7&quality=low', mbps = '9', cpu = '4'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 70,
  downloadThroughput: (Number(mbps) * 1e6) / 8,
  uploadThroughput: (1.5 * 1e6) / 8,
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(cpu) });
let bytes = 0;
cdp.on('Network.loadingFinished', (e) => (bytes += e.encodedDataLength));
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__dt?.game?.debug?.tiles > 5, null, { timeout: 120000 });
const playable = (Date.now() - t0) / 1000;
await page.waitForTimeout(2000);
const fps = await page.evaluate(() => window.__dt.game.debug.perf.fps);
console.log(JSON.stringify({ mbps: Number(mbps), cpu: Number(cpu), playableSeconds: playable, transferredMB: Math.round(bytes / 1e4) / 100, fps }));
await browser.close();
