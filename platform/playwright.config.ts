import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://itsm:itsm@127.0.0.1:5432/itsm_e2e";

// Use a preinstalled Chromium when the bundled revision isn't downloaded
// (sandboxed CI images). Otherwise Playwright's own browser is used.
const localChromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    // Fresh schema + seed on every run, then the production server.
    command: "npx prisma migrate deploy && npx tsx prisma/seed/seed.ts --reset && npx next start -p " + PORT,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      DIRECT_DATABASE_URL: E2E_DATABASE_URL,
      AUTH_URL: BASE_URL,
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-only-secret-0123456789abcdef0123456789abcdef",
      AUTH_TRUST_HOST: "true",
      // In-memory rate limiting: runs are independent of any shared Redis.
      REDIS_URL: "",
      TRUST_PROXY: "0",
      NODE_ENV: "production",
      // The E2E database is disposable; allow the seed under NODE_ENV=production.
      SEED_ALLOW_PRODUCTION: "1",
    },
  },
});
