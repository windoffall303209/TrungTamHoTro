import { defineConfig, devices } from "@playwright/test";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: "../../.env" });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], locale: "vi-VN", timezoneId: "Asia/Bangkok" },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], locale: "vi-VN", timezoneId: "Asia/Bangkok" },
    },
  ],
  webServer: [
    {
      command: "pnpm --dir ../.. dev:api",
      url: "http://127.0.0.1:4000/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        DATABASE_CONNECT_ON_START: "true",
        DB_NAME: process.env.WIND_TEST_DB_NAME ?? "trung_tam_giang_day_test",
        NODE_ENV: "test",
        RESEND_API_KEY: "",
        RESEND_FROM: "",
      },
    },
    { command: "pnpm dev", url: "http://127.0.0.1:3000/login", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
