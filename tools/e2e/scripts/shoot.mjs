// Headless screenshot helper: node scripts/shoot.mjs "<url path>" out.png [width height]
import { chromium } from '@playwright/test';

const [, , path, out, w = '1280', h = '720'] = process.argv;
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5173${path}`);
const waitFor = process.env.WAIT_FOR ?? 'window.__viewer?.ready';
await page
  .waitForFunction(waitFor, null, { timeout: 30000 })
  .catch((e) => logs.push(`wait failed: ${e.message}`));
await page.waitForTimeout(Number(process.env.SETTLE ?? 300));
await page.screenshot({ path: out });
console.log(await page.title());
for (const l of logs.filter((l) => !l.includes('[vite]'))) console.log(l);
await browser.close();
