import { expect, test, type Page } from '@playwright/test';

type Dbg = {
  game: {
    debug: {
      motor: {
        frame: number;
        driving: boolean;
        x: number;
        y: number;
        z: number;
        grounded: boolean;
      };
      corrections: number;
      trainS: number;
      tiles: number;
      cameraInTrain: () => { x: number; y: number; z: number };
    };
    look: (yaw: number, pitch: number) => void;
  };
  conn: {
    send: (t: string, m: unknown) => void;
    state: { train: { speed: number; throttle: number; s: number; driver: string } };
  };
};

const dbg = (page: Page) =>
  page.evaluate(() => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    const m = d.game.debug.motor;
    return {
      frame: m.frame,
      driving: m.driving,
      grounded: m.grounded,
      z: m.z,
      corrections: d.game.debug.corrections,
      trainS: d.conn.state.train.s,
      speed: d.conn.state.train.speed,
      throttle: d.conn.state.train.throttle,
    };
  });

const dev = (page: Page, action: string, value?: number) =>
  page.evaluate(
    ([a, v]) =>
      (window as unknown as { __dt: Dbg }).__dt.conn.send('cmd', { t: 'dev', action: a, value: v }),
    [action, value] as const,
  );

test('drive the train, walk on it while it moves, and step off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?autostart=solo&seed=42');
  await page.waitForFunction(() => {
    const d = (window as unknown as { __dt?: Dbg }).__dt;
    return !!d && d.game.debug.tiles > 15;
  });

  // Into the cab and onto the controls.
  await dev(page, 'cab');
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.look(0, -0.15));
  await expect(page.getByTestId('prompt')).toContainText('Take the controls');
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await dbg(page)).driving).toBe(true);
  await expect(page.getByTestId('cab')).toBeVisible();

  // Open the throttle.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2200);
  await page.keyboard.up('KeyW');
  const s0 = (await dbg(page)).trainS;
  await page.waitForTimeout(6000);
  const moving = await dbg(page);
  expect(moving.throttle).toBeGreaterThan(0.9);
  expect(moving.speed).toBeGreaterThan(3);
  expect(moving.trainS).toBeGreaterThan(s0 + 15);
  await page.screenshot({ path: 'out/m1-driving.png' });

  // Leave the controls and walk back along the moving train.
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await dbg(page)).driving).toBe(false);
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.look(Math.PI, -0.2));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  // Stand still on the moving train and measure camera jitter in train space.
  const samples = await page.evaluate(async () => {
    const d = (window as unknown as { __dt: Dbg }).__dt;
    const out: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      out.push(d.game.debug.cameraInTrain());
    }
    return out;
  });
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  }
  const walking = await dbg(page);
  console.log(
    'corrections:',
    await page.evaluate(() =>
      (
        window as unknown as { __dt: { game: { debug: { correctionLog: string[] } } } }
      ).__dt.game.debug.correctionLog.join(' | '),
    ),
  );
  expect(walking.frame).toBe(1);
  expect(walking.speed).toBeGreaterThan(3);
  // Standing still on a moving train: the camera must not move relative to the train.
  expect(maxStep).toBeLessThan(0.02);
  expect(walking.corrections).toBeLessThan(5);
  await page.screenshot({ path: 'out/m1-on-moving-train.png' });

  // Step off and watch it go.
  await dev(page, 'ground');
  await page.waitForTimeout(3000);
  const off = await dbg(page);
  expect(off.frame).toBe(0);
  expect(off.grounded).toBe(true);
  await page.evaluate(() => (window as unknown as { __dt: Dbg }).__dt.game.look(0.4, 0.05));
  await page.waitForTimeout(300);
  await expect(page.getByTestId('train-widget')).toBeVisible();
  await page.screenshot({ path: 'out/m1-ground.png' });
  expect(errors).toEqual([]);
});
