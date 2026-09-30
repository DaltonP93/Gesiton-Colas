import { defineConfig, devices } from '@playwright/test';

/**
 * Prueba de punta a punta: compila la aplicación, levanta la API sirviendo el frontend
 * y recorre el flujo completo en un navegador real.
 *
 *   npm run build && npm run e2e
 *
 * Variables: E2E_DATABASE_URL (base descartable), PW_CHROMIUM_PATH (Chromium ya instalado).
 */
const port = Number(process.env.E2E_PORT ?? 3210);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'es-ES',
    timezoneId: 'America/Asuncion',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: 'node e2e/reset-db.mjs && node apps/api/dist/index.js',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      PUBLIC_URL: baseURL,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://gc:gc@127.0.0.1:5432/gestion_colas_e2e',
      JWT_SECRET: 'e2e-secret-0123456789abcdef0123456789',
      UPLOAD_DIR: './e2e/.uploads',
      LOG_LEVEL: 'warn',
      // Los correos se leen desde /api/v1/dev/outbox (solo en pruebas).
      MAIL_DRIVER: 'log',
      DEV_OUTBOX: 'true',
      SUPERADMIN_EMAIL: 'root@e2e.test',
      SUPERADMIN_PASSWORD: 'RootE2e2026!',
    },
  },
});
