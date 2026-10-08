import { defineConfig, devices } from '@playwright/test';

/**
 * Headless browser smoke tests (§11). Nothing opens on screen.
 * Uses the installed Google Chrome in headless mode to avoid extra browser downloads.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './out/results',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
  },
  // Locally: the installed Google Chrome (no download). CI: bundled Chromium plus WebKit (§8).
  projects:
    process.env.E2E_BROWSERS === 'ci'
      ? [
          { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : [
          {
            name: 'chrome',
            use: {
              ...devices['Desktop Chrome'],
              channel: 'chrome',
              launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
            },
          },
        ],
  webServer: [
    {
      command: 'pnpm --filter @dead-tracks/server dev',
      cwd: '../..',
      url: 'http://localhost:2567/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @dead-tracks/client dev',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
