import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { SystemServiceContext } from "../../src/domains/system/core/system.context.js";
import { requestRestore } from "../../src/domains/system/operations/retention/system-backups.js";

/** Ngữ cảnh tối thiểu: database đang vận hành tên wind_edu, không cần kết nối DB thật cho bước kiểm tra tên đích. */
const context = {
  database: () => undefined,
  databaseBackup: { isCurrentDatabase: (name: string) => name.trim().toLowerCase() === "wind_edu" },
} as unknown as SystemServiceContext;

describe("Khôi phục vận hành không được ghi đè database đang chạy", () => {
  it.each(["wind_edu", "WIND_EDU", "postgres", "template0", "Template1", "pg_catalog_copy"])("từ chối đích %s", async (targetDatabase) => {
    await expect(requestRestore(context, { backupId: "backup-1", mode: "OPERATIONAL", reason: "Khôi phục sau sự cố dữ liệu", targetDatabase }, "usr-admin")).rejects.toThrow(BadRequestException);
    await expect(requestRestore(context, { backupId: "backup-1", mode: "OPERATIONAL", reason: "Khôi phục sau sự cố dữ liệu", targetDatabase }, "usr-admin")).rejects.toThrow("database hệ thống");
  });

  it("cho phép tên database staging mới đi tiếp tới bước kiểm tra kết nối", async () => {
    await expect(requestRestore(context, { backupId: "backup-1", mode: "OPERATIONAL", reason: "Khôi phục sau sự cố dữ liệu", targetDatabase: "wind_edu_restore_20261122" }, "usr-admin")).rejects.toThrow("kết nối database");
  });
});
