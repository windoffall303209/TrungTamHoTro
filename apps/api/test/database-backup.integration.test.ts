import { existsSync } from "node:fs";
import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { DatabaseBackupService } from "../src/infrastructure/database-backup.service.js";
import { readFileHead, withTemporaryFile } from "../src/infrastructure/file-streams.js";

const databaseEnabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const utilitiesAvailable = [process.env.PG_DUMP_PATH, process.env.PG_RESTORE_PATH]
  .every((path) => typeof path === "string" && existsSync(path));

describe.skipIf(!databaseEnabled || !utilitiesAvailable)("PostgreSQL backup and restore", () => {
  let moduleRef: TestingModule;
  let service: DatabaseBackupService;

  // Nạp dịch vụ sao lưu PostgreSQL thật trên cơ sở dữ liệu kiểm thử riêng.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    service = moduleRef.get(DatabaseBackupService);
  });

  // Đóng tài nguyên ứng dụng sau khi đã xóa cơ sở dữ liệu khôi phục tạm.
  afterAll(async () => {
    await moduleRef?.close();
  });

  it("creates a custom-format dump and verifies it in an isolated temporary database", async () => {
    await withTemporaryFile(async (path) => {
      const backup = await service.createFullBackup(path);
      expect(backup.size).toBeGreaterThan(5);
      expect((await readFileHead(path, 5)).toString("ascii")).toBe("PGDMP");
      const restored = await service.verifyRestore(path);
      expect(restored.database).toMatch(/^wind_restore_[a-zA-Z0-9_]+$/);
      expect(restored.tableCount).toBeGreaterThan(0);
      expect(restored.rowCount).toBeGreaterThan(0);
      await expect(service.restoreToDatabase(path, "a".repeat(64))).rejects.toThrow();
      await expect(service.restoreToDatabase(path, process.env.DB_NAME!)).rejects.toThrow();
    });
  }, 60_000);
});
