import { defineConfig } from '@playwright/test';
import { scryptSync } from 'node:crypto';
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3100',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
    permissions: ['camera', 'microphone'],
    screenshot: 'only-on-failure'
  },
  webServer: { command: 'node server.js', env: { PORT: '3100', DATA_FILE: ':memory:', ADMIN_PATH: '/gestion-tests-12345678901234567890', ADMIN_PASSWORD_HASH: '0123456789abcdef0123456789abcdef:' + scryptSync('test-password-only', '0123456789abcdef0123456789abcdef', 64).toString('hex') }, url: 'http://localhost:3100/health', reuseExistingServer: false }
});
