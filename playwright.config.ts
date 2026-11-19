import { defineConfig, devices } from "@playwright/test";

/**
 * E2E-тесты. Требуют запущенного приложения (npm run dev или npm start)
 * и выполненного seed (npm run db:seed). Браузер: Chromium из Playwright
 * или системный Chrome (PW_CHROME_PATH).
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "ru-RU",
    screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROME_PATH ? { executablePath: process.env.PW_CHROME_PATH } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /responsive/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /responsive/ },
  ],
});
