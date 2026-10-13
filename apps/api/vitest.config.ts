import { defineConfig } from "vitest/config";
import { config as loadEnvironment } from "dotenv";

loadEnvironment({ path: "../../.env", quiet: true });
const testDatabase = process.env.WIND_TEST_DB_NAME ?? "trung_tam_giang_day_test";
if (!/^[a-zA-Z0-9_]+_test$/.test(testDatabase) || testDatabase.length > 63) throw new Error("Database kiểm thử phải có hậu tố _test.");
process.env.DB_NAME = testDatabase;
process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY = "";
process.env.RESEND_FROM = "";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "src/generated/**"],
    fileParallelism: false,
  },
});

