// Heap and scene counts across repeated teleport tours (leak check): node memtour.mjs [port]
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto('http://localhost:5173/?autostart=solo&seed=7&quality=low');
await page.waitForFunction(() => window.__dt?.game?.debug?.tiles > 5, null, { timeout: 60000 });
const dev = (a, e = {}) => page.evaluate(([a, e]) => window.__dt.conn.send('cmd', { t: 'dev', action: a, ...e }), [a, e]);
const info = () => page.evaluate(() => {
  window.gc?.();
  const g = window.__dt.game;
  let meshes = 0, objects = 0;
  g.scene.traverse((o) => { objects++; if (o.isMesh) meshes++; });
  const m = g.renderer.info.memory;
  return { heap: Math.round(performance.memory.usedJSHeapSize / 1048576), objects, meshes, geometries: m.geometries, textures: m.textures };
});
await page.waitForTimeout(3000);
console.log('start', JSON.stringify(await info()));
for (let i = 0; i < 3; i++) {
  for (const t of [0, 2, 4]) { await dev('town', { value: t }); await page.waitForTimeout(2500); }
  for (const l of [0, 1, 2]) { await dev('landmark', { value: l }); await page.waitForTimeout(2500); }
  await dev('respawn'); await page.waitForTimeout(3000);
  console.log('tour', i, JSON.stringify(await info()));
}
await browser.close();
