// Headless scene captures for visual checks: node scripts/scenes.mjs <outDir> [scene...]
// Needs the client dev server on :5173. Solo runs in the worker; no game server needed.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [, , outDir = '/tmp/dt-scenes', ...only] = process.argv;
mkdirSync(outDir, { recursive: true });
const seed = process.env.SEED ?? '7';
const quality = process.env.QUALITY ?? 'high';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5173/?autostart=solo&seed=${seed}&quality=${quality}`);
await page.waitForFunction(() => window.__dt?.game?.debug?.tiles > 10, null, { timeout: 60000 });
await page.addStyleTag({ content: '.perf-hud, .dev-panel { display: none !important; }' });

const dev = (action, extra = {}) =>
  page.evaluate(([a, e]) => window.__dt.conn.send('cmd', { t: 'dev', action: a, ...e }), [action, extra]);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
};
const lookAtStructure = (id, dy = 2) =>
  page.evaluate(
    ([sid, y]) => {
      const st = window.__dt.game.world.structure(sid);
      window.__dt.game.lookAt(st.x, st.y + y, st.z);
    },
    [id, dy],
  );

await dev('god', { value: 1 });
await dev('director', { value: 0 });

const scenes = {
  async ranch() {
    await dev('time', { value: 0.25 });
    await dev('weather', { value: 0 });
    await dev('landmark', { value: 0 });
    await wait(3000);
    await lookAtStructure('l0', 2);
    await wait(800);
    await shot('ranch');
  },
  async rancher() {
    await dev('landmark', { value: 10 });
    await wait(2500);
    await page.evaluate(() => {
      const st = window.__dt.game.world.structure('l0');
      const s = st.landmark;
      const c = Math.cos(st.yaw);
      const sn = Math.sin(st.yaw);
      window.__dt.game.lookAt(st.x + c * s.bossX + sn * s.bossZ, st.y + 2.5, st.z - sn * s.bossX + c * s.bossZ);
    });
    await wait(600);
    await shot('rancher');
    await dev('clear');
  },
  async mine() {
    await dev('time', { value: 0.35 });
    await dev('weather', { value: 4 });
    await dev('landmark', { value: 1 });
    await wait(3000);
    await lookAtStructure('l1', 3);
    await wait(1500);
    await shot('mine-dust');
    await dev('weather', { value: 0 });
    await wait(500);
    await shot('mine');
  },
  async chateau() {
    await dev('time', { value: 0.8 });
    await dev('weather', { value: 0 });
    await wait(500);
    await dev('night', { value: 2 });
    await dev('landmark', { value: 2 });
    await wait(4000);
    await lookAtStructure('l2', 4);
    await wait(4000);
    await shot('chateau-bloodmoon');
    await dev('landmark', { value: 12 });
    await wait(2000);
    await shot('countess');
    await dev('clear');
  },
  async storm() {
    await dev('night', { value: 0 });
    await dev('time', { value: 0.45 });
    await dev('cab');
    await dev('weather', { value: 2 });
    await wait(2500);
    await shot('storm');
  },
  async fog() {
    await dev('weather', { value: 3 });
    await dev('time', { value: 0.3 });
    await wait(1500);
    await shot('fog');
    await dev('weather', { value: 0 });
  },
  async sky() {
    await dev('cab');
    await dev('time', { value: 0.82 });
    await wait(500);
    await dev('night', { value: 2 });
    await wait(9000);
    await page.evaluate(() => {
      const g = window.__dt.game;
      g.lookYaw = 2.2;
      g.lookPitch = 0.35;
    });
    await wait(500);
    await shot('bloodmoon-sky');
    await dev('night', { value: 1 });
    await wait(9000);
    await shot('fullmoon-sky');
    await dev('night', { value: 0 });
  },
  async closeups() {
    await dev('time', { value: 0.3 });
    await dev('ground');
    await wait(1500);
    for (const [i, name] of [[4, 'werewolf'], [5, 'vampire'], [6, 'rancher-day'], [7, 'voss-day'], [8, 'countess-day']]) {
      await dev('clear');
      await dev('monster', { value: i });
      await wait(700);
      await page.evaluate(() => window.__dt.game.aimAtNearestEnemy?.());
      await wait(150);
      await shot(name);
    }
    await dev('clear');
  },
  async monsters() {
    await dev('time', { value: 0.78 });
    await wait(500);
    await dev('night', { value: 1 });
    await dev('ground');
    await wait(1500);
    await dev('monster', { value: 4 });
    await wait(1200);
    await page.evaluate(() => window.__dt.game.aimAtNearestEnemy?.());
    await wait(4000);
    await shot('werewolf-fullmoon');
    await dev('clear');
    await dev('monster', { value: 5 });
    await wait(1200);
    await page.evaluate(() => window.__dt.game.aimAtNearestEnemy?.());
    await wait(600);
    await shot('vampire');
    await dev('clear');
    await dev('monster', { value: 7 });
    await wait(1200);
    await page.evaluate(() => window.__dt.game.aimAtNearestEnemy?.());
    await wait(600);
    await shot('voss');
    await dev('clear');
    await dev('night', { value: 0 });
  },
  async forts() {
    await dev('time', { value: 0.3 });
    await dev('respawn');
    await page.evaluate(() => {
      const f = window.__dt.game.world.structure('f0');
      window.__dt.conn.send('cmd', { t: 'dev', action: 'skip', value: f.feature.s - 120 - window.__dt.conn.state.train.s });
    });
    await wait(4000);
    await dev('cab');
    await wait(500);
    await page.evaluate(() => {
      const f = window.__dt.game.world.structure('f0');
      window.__dt.game.lookAt(f.x, f.y + 3, f.z);
    });
    await wait(1500);
    await shot('fort-ironwood');
    await dev('finale');
    await wait(4000);
    await dev('cab');
    await page.evaluate(() => {
      const f = window.__dt.game.world.structure('f1');
      const g = window.__dt.game.piecePos('f1', f.gatePiece);
      window.__dt.game.lookAt(g.x, g.y, g.z);
    });
    await wait(1500);
    await shot('fort-haven-gate');
  },
};

for (const [name, fn] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await fn();
  } catch (e) {
    console.log(`scene ${name} failed: ${e.message}`);
  }
}
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
