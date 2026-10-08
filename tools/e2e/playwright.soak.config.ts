import { defineConfig, devices } from '@playwright/test';

/** Soak and performance runs against a production build (no HMR, real bundle). */
export default defineConfig({
  testDir: './tests',
  testMatch: /soak\.spec\.ts/,
  outputDir: './out/soak-results',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command:
      'pnpm --filter @dead-tracks/client build && pnpm --filter @dead-tracks/client preview --port 4173 --strictPort',
    cwd: '../..',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
