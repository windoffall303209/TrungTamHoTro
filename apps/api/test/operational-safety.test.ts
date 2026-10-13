import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { AuthService } from "../src/auth/auth.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { Environment } from "../src/config/environment.js";
import type { EmailDeliveryService } from "../src/infrastructure/email-delivery.service.js";
import type { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";
import { ownedJobWhere, startOperationalLease } from "../src/system/operational-lease.js";
import { SystemService } from "../src/system/system.service.js";

afterEach(() => vi.useRealTimers());

describe("Quyền xử lý tác vụ", () => {
  it("kết thúc cả tác vụ RUNNING và PENDING đã dùng hết lần thử", async () => {
    const models = Array.from({ length: 3 }, () => ({ updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValue(null) }));
    const service = new SystemService({ isStartupConnectionEnabled: () => true, backupJob: models[0], dataExportJob: models[1], retentionJob: models[2] } as unknown as PrismaService);
    expect(await service.drainOperationalJobs()).toEqual({ backup: 0, export: 0, retention: 0 });
    for (const model of models) {
      const first = model.updateMany.mock.calls[0]?.[0] as { where: { status: unknown; attempts: unknown }; data: { status: string } };
      expect(first.where.status).toEqual({ in: ["RUNNING", "PENDING"] });
      expect(first.where.attempts).toEqual({ gte: 5 });
      expect(first.data.status).toBe("FAILED");
    }
  });
  it("tiến trình cũ không được đặt lại tác vụ của lần thử mới", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUniqueOrThrow = vi.fn();
    const prisma = { backupJob: { updateMany, findUniqueOrThrow } } as unknown as PrismaService;
    const service = new SystemService() as unknown as { retryBackupJob(db: PrismaService, id: string, attempts: number, error: unknown): Promise<void> };
    await service.retryBackupJob(prisma, "job", 2, new Error("late failure"));
    const input = updateMany.mock.calls[0]?.[0] as { where: { attempts: number; status: string; availableAt: { gt: Date } } };
    expect(input.where.attempts).toBe(2);
    expect(input.where.status).toBe("RUNNING");
    expect(input.where.availableAt.gt).toBeInstanceOf(Date);
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("ràng buộc trạng thái, lần thử và thời hạn", () => {
    const where = ownedJobWhere({ id: "job", attempts: 2 });
    expect(where).toMatchObject({ id: "job", attempts: 3, status: "RUNNING" });
    expect(where.availableAt.gt).toBeInstanceOf(Date);
  });
  it("gia hạn định kỳ và dừng sau khi mất quyền", async () => {
    vi.useFakeTimers();
    const renew = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    const lease = startOperationalLease(renew);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(renew).toHaveBeenCalledTimes(1);
    await expect(lease.assertOwned()).rejects.toThrow("mất quyền");
    await expect(lease.assertOwned()).rejects.toThrow();
    expect(renew).toHaveBeenCalledTimes(2);
    await lease.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renew).toHaveBeenCalledTimes(2);
  });
  it("không tiếp tục khi không xác minh được quyền", async () => {
    const lease = startOperationalLease(vi.fn().mockRejectedValue(new Error("offline")));
    await expect(lease.assertOwned()).rejects.toThrow("mất quyền");
    await lease.stop();
  });
});

describe("CSRF nhiều tab", () => {
  it("giữ token ổn định, tương thích phiên cũ và từ chối token khác phiên", async () => {
    const row = { id: "session-a", csrfTokenHash: createHash("sha256").update("legacy").digest("hex"), revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 60_000) };
    const findUnique = vi.fn().mockResolvedValue(row);
    const update = vi.fn();
    const config = new ConfigService<Environment, true>({ AUTH_ENCRYPTION_SECRET: "a".repeat(64), WEB_ORIGIN: "http://localhost:3000" });
    const service = new AuthService({ authSession: { findUnique, update } } as unknown as PrismaService, {} as EmailDeliveryService, {} as ObjectStorageService, config);
    const token = await service.issueCsrf(row.id);
    expect(await service.issueCsrf(row.id)).toBe(token);
    expect(await service.validateCsrf("cookie", token)).toBe(true);
    expect(await service.validateCsrf("cookie", "legacy")).toBe(true);
    expect(await service.validateCsrf("cookie", await service.issueCsrf("session-b"))).toBe(false);
    expect(await service.validateCsrf("cookie", undefined)).toBe(false);
    row.revokedAt = new Date();
    expect(await service.validateCsrf("cookie", token)).toBe(false);
    row.revokedAt = null;
    row.expiresAt = new Date(0);
    expect(await service.validateCsrf("cookie", token)).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
