import { defineConfig, devices } from '@playwright/test';

/** Soak, performance and production-only (PWA, offline) runs against a real build. */
export default defineConfig({
  testDir: './tests',
  testMatch: /(soak|prod)\.spec\.ts/,
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
