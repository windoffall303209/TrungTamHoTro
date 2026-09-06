import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["dist/**", "src/generated/**"],
    fileParallelism: false,
  },
});

