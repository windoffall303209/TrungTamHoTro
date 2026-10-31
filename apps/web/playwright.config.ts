import { defineConfig, devices } from "@playwright/test";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: "../../.env" });

const testDatabase = process.env.WIND_TEST_DB_NAME ?? "trung_tam_giang_day_test";
if (!/^[a-zA-Z0-9_]+_test$/.test(testDatabase) || testDatabase.length > 63) {
  throw new Error("WIND_TEST_DB_NAME phải là database kiểm thử riêng có hậu tố _test.");
}

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL: "http://localhost:3300", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], locale: "vi-VN", timezoneId: "Asia/Bangkok" },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"], locale: "vi-VN", timezoneId: "Asia/Bangkok" },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"], locale: "vi-VN", timezoneId: "Asia/Bangkok" },
    },
  ],
  webServer: [
    {
      command: "pnpm --dir ../.. dev:api",
      url: "http://127.0.0.1:4400/api/v1/health",
      reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
      timeout: 120_000,
      env: {
        API_PORT: "4400",
        WEB_ORIGIN: "http://localhost:3300",
        API_PREFIX: "api",
        API_VERSION: "1",
        STORAGE_PROVIDER: "local",
        STORAGE_ROOT: "../../output/playwright/storage",
        DATABASE_CONNECT_ON_START: "true",
        DB_NAME: testDatabase,
        NODE_ENV: "test",
        // Nhiều tài khoản E2E dùng chung IP; chỉ tăng ngân sách trên server test riêng.
        // Hành vi HTTP 429 được kiểm tra độc lập trong network-recovery.spec.ts.
        RATE_LIMIT_MAX: "1000",
        RESEND_API_KEY: "",
        RESEND_FROM: "",
      },
    },
    { command: "pnpm exec next dev --port 3300", url: "http://127.0.0.1:3300/login", reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1", timeout: 120_000, env: { NEXT_PUBLIC_API_URL: "http://localhost:4400/api/v1" } },
  ],
});
