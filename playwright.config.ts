import { defineConfig } from '@playwright/test';
const production = process.env.CHLADNI_TEST_PRODUCTION === '1';
const port = production ? 4173 : 5173;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1512, height: 982 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'],
    },
  },
  webServer: {
    command: `npm run ${production ? 'preview' : 'dev'} -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
});
