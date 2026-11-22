import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../../src/auth/auth.service.js";
import { encryptMfaSecret, matchTotpStep } from "../../src/auth/mfa.js";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

const encryptionSecret = "test-auth-encryption-secret-at-least-32-characters";
// Vector chuẩn RFC 6238 (SHA1): tại t=59s, bước 1 có mã 287082.
const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

type TotpState = { mfaLastUsedStep: number | null; mfaFailedAttempts: number; mfaLockedUntil: Date | null };

/** Tạo AuthService với prisma giả chỉ giữ trạng thái chống phát lại/khóa TOTP của một người dùng. */
function createService(state: TotpState): { verify(code: string): Promise<boolean> } {
  const user = {
    findUnique: vi.fn(() => Promise.resolve({ ...state })),
    updateMany: vi.fn(({ data, where }: { where: { OR: Array<{ mfaLastUsedStep: null | { lt: number } }> }; data: Partial<TotpState> }) => {
      const allowed = where.OR.some((condition) => condition.mfaLastUsedStep === null
        ? state.mfaLastUsedStep === null
        : state.mfaLastUsedStep !== null && state.mfaLastUsedStep < condition.mfaLastUsedStep.lt);
      if (!allowed) return Promise.resolve({ count: 0 });
      Object.assign(state, data);
      return Promise.resolve({ count: 1 });
    }),
    update: vi.fn(({ data }: { data: { mfaFailedAttempts?: number | { increment: number }; mfaLockedUntil?: Date | null } }) => {
      if (typeof data.mfaFailedAttempts === "object") state.mfaFailedAttempts += data.mfaFailedAttempts.increment;
      else if (typeof data.mfaFailedAttempts === "number") state.mfaFailedAttempts = data.mfaFailedAttempts;
      if (data.mfaLockedUntil !== undefined) state.mfaLockedUntil = data.mfaLockedUntil;
      return Promise.resolve({});
    }),
  };
  const config = { get: vi.fn((key: string) => ({ AUTH_ENCRYPTION_SECRET: encryptionSecret, MFA_ISSUER: "Wind EDU", WEB_ORIGIN: "http://localhost:3000" })[key]) } as unknown as ConfigService<Environment, true>;
  const service = new AuthService({ user } as unknown as PrismaService, {} as EmailDeliveryService, {} as ObjectStorageService, config);
  const privateApi = service as unknown as { verifyAccountTotp(userId: string, secret: string, code: string): Promise<boolean> };
  const encrypted = encryptMfaSecret(rfcSecret, encryptionSecret);
  return { verify: async (code) => privateApi.verifyAccountTotp("usr-mfa", await encrypted, code) };
}

describe("Chống vét cạn và phát lại TOTP", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trả đúng bước thời gian của mã khớp", () => {
    expect(matchTotpStep(rfcSecret, "287082", 59_000)).toBe(1);
    expect(matchTotpStep(rfcSecret, "000000", 59_000)).toBeNull();
  });

  it("không cho dùng lại cùng một mã trong cửa sổ hiệu lực", async () => {
    const state: TotpState = { mfaLastUsedStep: null, mfaFailedAttempts: 0, mfaLockedUntil: null };
    const service = createService(state);
    expect(await service.verify("287082")).toBe(true);
    expect(state.mfaLastUsedStep).toBe(1);
    expect(await service.verify("287082")).toBe(false);
    expect(state.mfaFailedAttempts).toBe(1);
  });

  it("khóa 15 phút sau 5 lần sai kể cả khi lần sau nhập đúng", async () => {
    const state: TotpState = { mfaLastUsedStep: null, mfaFailedAttempts: 0, mfaLockedUntil: null };
    const service = createService(state);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(await service.verify("000000")).toBe(false);
    expect(state.mfaLockedUntil?.getTime()).toBe(59_000 + 15 * 60_000);
    await expect(service.verify("287082")).rejects.toThrow(HttpException);
    vi.setSystemTime(59_000 + 15 * 60_000 + 1);
    // Hết khóa nhưng mã cũ đã ra khỏi cửa sổ ±1 chu kỳ nên vẫn bị từ chối.
    expect(await service.verify("287082")).toBe(false);
  });
});
