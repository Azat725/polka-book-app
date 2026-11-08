import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// A different secret and data directory are created for each invocation.
process.env.E2E_BOT_TOKEN ||= randomBytes(32).toString('hex');
process.env.E2E_RUN_ID ||= `${Date.now()}-${randomBytes(4).toString('hex')}`;
const root = resolve(import.meta.dirname, '..');
const python = resolve(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: '../artifacts/e2e-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `"${python}" "${resolve(root, 'scripts/e2e_backend.py')}"`,
      url: 'http://127.0.0.1:8000/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        E2E_BOT_TOKEN: process.env.E2E_BOT_TOKEN,
        E2E_RUN_ID: process.env.E2E_RUN_ID,
      },
    },
    {
      command: 'npm run build && npm run preview -- --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173',
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
