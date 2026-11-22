import "reflect-metadata";
import { ConflictException, ValidationPipe } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { ConfirmEmailChangeDto, EmailChangeOtpDto, UpdateProfileDto } from "../../src/auth/auth.dto.js";
import { AuthService } from "../../src/auth/auth.service.js";
import { hashPassword } from "../../src/auth/password.js";
import type { Environment } from "../../src/config/environment.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";
import type { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";

/** Tạo ConfigService giả đủ khóa để khởi tạo AuthService trong unit test. */
function makeConfig(): ConfigService<Environment, true> {
  const values: Record<string, string> = {
    AUTH_ENCRYPTION_SECRET: "test-auth-encryption-secret-at-least-32-characters",
    MFA_ISSUER: "Wind EDU",
    WEB_ORIGIN: "http://localhost:3000",
  };
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

interface UpdateUserCall {
  where: { id: string };
  data: {
    displayName: string;
    phone: string | null;
    timezone: string;
    locale: string;
    email?: string;
    emailVerifiedAt?: Date;
    username?: string;
  };
}

describe("cập nhật hồ sơ và email tài khoản", () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  it("chấp nhận hồ sơ hợp lệ trong UpdateProfileDto nhưng từ chối email chưa xác minh và username", async () => {
    const accepted: unknown = await pipe.transform(
      {
        displayName: "Wind Of Fall",
        phone: "0901234567",
        timezone: "Asia/Bangkok",
        locale: "vi-VN",
      },
      { type: "body", metatype: UpdateProfileDto },
    );
    expect(accepted).toMatchObject({ displayName: "Wind Of Fall", phone: "0901234567" });

    await expect(
      pipe.transform(
        {
          displayName: "Wind Of Fall",
          email: "new.admin@wind.edu.vn",
          timezone: "Asia/Bangkok",
          locale: "vi-VN",
        },
        { type: "body", metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        {
          displayName: "Wind Of Fall",
          username: "hacked-username",
          timezone: "Asia/Bangkok",
          locale: "vi-VN",
        },
        { type: "body", metatype: UpdateProfileDto },
      ),
    ).rejects.toThrow();
  });

  it("kiểm tra DTO gửi và xác nhận OTP đổi email mới", async () => {
    await expect(
      pipe.transform({ email: "khong-hop-le" }, { type: "body", metatype: EmailChangeOtpDto }),
    ).rejects.toThrow();

    const acceptedOtpRequest: unknown = await pipe.transform(
      { email: "new.admin@wind.edu.vn", currentPassword: "Current-Pass-2026!" },
      { type: "body", metatype: EmailChangeOtpDto },
    );
    expect(acceptedOtpRequest).toMatchObject({ email: "new.admin@wind.edu.vn", currentPassword: "Current-Pass-2026!" });

    await expect(
      pipe.transform(
        { challengeId: "ch-12345678901234567890", email: "new.admin@wind.edu.vn", code: "123456", mfaCode: "12ab56" },
        { type: "body", metatype: ConfirmEmailChangeDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { challengeId: "ch-12345678901234567890", email: "new.admin@wind.edu.vn", code: "12ab56" },
        { type: "body", metatype: ConfirmEmailChangeDto },
      ),
    ).rejects.toThrow();
  });

  it("cập nhật hồ sơ cơ bản mà không cho sửa username hoặc email qua updateProfile", async () => {
    const capturedUserUpdates: UpdateUserCall[] = [];
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "usr-admin",
          username: "admin@wind.edu.vn",
          displayName: "Wind Of Fall",
          email: "old@wind.edu.vn",
          phone: "0901234567",
          timezone: "Asia/Bangkok",
          locale: "vi-VN",
          avatarObjectKey: null,
          avatarUpdatedAt: null,
          status: "ACTIVE",
          emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
          mfaEnabledAt: null,
          passwordHash: "hashed",
          createdAt: new Date("2026-09-15T10:26:00Z"),
        }),
        update: vi.fn((args: UpdateUserCall) => {
          capturedUserUpdates.push(args);
          return Promise.resolve({});
        }),
      },
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      {} as EmailDeliveryService,
      {} as ObjectStorageService,
      makeConfig(),
    );

    const profile = await service.updateProfile("usr-admin", {
      displayName: "  Wind Of Fall  ",
      phone: "0901234567",
      timezone: "Asia/Bangkok",
      locale: "vi-VN",
    });

    expect(profile.username).toBe("admin@wind.edu.vn");
    expect(profile.email).toBe("old@wind.edu.vn");
    expect(capturedUserUpdates).toHaveLength(1);
    expect(capturedUserUpdates[0]?.data).toEqual({
      displayName: "Wind Of Fall",
      phone: "0901234567",
      timezone: "Asia/Bangkok",
      locale: "vi-VN",
    });
  });

  it("gửi OTP tới email mới, từ chối mã sai và cập nhật email đã xác minh khi mã đúng", async () => {
    const currentPassword = "Current-Pass-2026!";
    const passwordHash = await hashPassword(currentPassword);
    let storedEmail = "old@wind.edu.vn";
    const revokedSessionQueries: unknown[] = [];
    const capturedUserUpdates: UpdateUserCall[] = [];
    const capturedAudits: Array<{ data: { action: string; context: Record<string, string | null> } }> = [];
    const sentEmails: Array<{ to: string; subject: string; text: string }> = [];
    const tokens = new Map<string, {
      id: string;
      type: string;
      userId: string;
      codeHash: string | null;
      failedAttempts: number;
      consumedAt: Date | null;
      expiresAt: Date;
    }>();

    const accountTokenApi = {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(tokens.get(where.id) ?? null)),
      create: vi.fn(({ data }: { data: { id: string; type: string; userId: string; codeHash: string; expiresAt: Date } }) => {
        const record = {
          id: data.id,
          type: data.type,
          userId: data.userId,
          codeHash: data.codeHash,
          failedAttempts: 0,
          consumedAt: null,
          expiresAt: data.expiresAt,
        };
        tokens.set(data.id, record);
        return Promise.resolve(record);
      }),
      update: vi.fn(({ where }: { where: { id: string } }) => {
        const record = tokens.get(where.id);
        if (record) record.failedAttempts += 1;
        return Promise.resolve(record);
      }),
      updateMany: vi.fn(({ where, data }: { where: { id?: string | { not: string }; consumedAt?: null }; data: { consumedAt: Date } }) => {
        let count = 0;
        for (const record of tokens.values()) {
          if (typeof where.id === "string" && record.id !== where.id) continue;
          if (where.consumedAt === null && record.consumedAt !== null) continue;
          record.consumedAt = data.consumedAt;
          count += 1;
        }
        return Promise.resolve({ count });
      }),
    };

    const userApi = {
      findUnique: vi.fn(({ where }: { where: { id?: string; email?: string } }) => {
        if (where.email) return Promise.resolve(null);
        return Promise.resolve({
          id: "usr-admin",
          username: "admin@wind.edu.vn",
          displayName: "Wind Of Fall",
          email: storedEmail,
          phone: "",
          timezone: "Asia/Bangkok",
          locale: "vi-VN",
          avatarObjectKey: null,
          avatarUpdatedAt: null,
          status: "ACTIVE",
          emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
          mfaEnabledAt: null,
          mfaSecretEncrypted: null,
          passwordHash,
          createdAt: new Date("2026-09-15T10:26:00Z"),
        });
      }),
      update: (args: UpdateUserCall): Promise<object> => {
        capturedUserUpdates.push(args);
        if (typeof args.data.email === "string") storedEmail = args.data.email;
        return Promise.resolve({});
      },
    };

    const auditLogApi = {
      create: (entry: { data: { action: string; context: Record<string, string | null> } }): Promise<object> => {
        capturedAudits.push(entry);
        return Promise.resolve({});
      },
    };

    const authSessionApi = {
      updateMany: vi.fn((query: unknown) => {
        revokedSessionQueries.push(query);
        return Promise.resolve({ count: 2 });
      }),
    };

    const prisma = {
      user: userApi,
      accountToken: accountTokenApi,
      auditLog: auditLogApi,
      authSession: authSessionApi,
      $transaction: vi.fn(async (arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        const callback = arg as (tx: unknown) => Promise<unknown>;
        return callback({
          user: userApi,
          accountToken: accountTokenApi,
          auditLog: auditLogApi,
          authSession: authSessionApi,
        });
      }),
    } as unknown as PrismaService;

    const emailDelivery = {
      send: vi.fn((input: { to: string; subject: string; text: string }) => {
        sentEmails.push(input);
        return Promise.resolve({ provider: "resend" as const, providerMessageId: "msg-1", acceptedAt: new Date().toISOString() });
      }),
    } as unknown as EmailDeliveryService;

    const service = new AuthService(
      prisma,
      emailDelivery,
      {} as ObjectStorageService,
      makeConfig(),
    );

    // Phiên bị chiếm nhưng không biết mật khẩu thì không thể yêu cầu đổi email.
    await expect(service.sendEmailChangeOtp("usr-admin", "new.admin@wind.edu.vn")).rejects.toThrow("Mật khẩu hiện tại không chính xác.");
    await expect(service.sendEmailChangeOtp("usr-admin", "new.admin@wind.edu.vn", { currentPassword: "Wrong-Pass-2026!" })).rejects.toThrow("Mật khẩu hiện tại không chính xác.");
    expect(sentEmails).toHaveLength(0);

    const challenge = await service.sendEmailChangeOtp("usr-admin", "  New.Admin@Wind.edu.vn ", { currentPassword });
    expect(challenge.email).toBe("new.admin@wind.edu.vn");
    expect(sentEmails[0]?.to).toBe("new.admin@wind.edu.vn");
    const otpCode = sentEmails[0]?.text.match(/\b(\d{6})\b/)?.[1];
    expect(otpCode).toBeDefined();

    await expect(
      service.confirmEmailChange("usr-admin", challenge.challengeId, "new.admin@wind.edu.vn", otpCode!, {}, "session-current"),
    ).rejects.toThrow("Mật khẩu hiện tại không chính xác.");
    await expect(
      service.confirmEmailChange("usr-admin", challenge.challengeId, "new.admin@wind.edu.vn", "000000", { currentPassword }, "session-current"),
    ).rejects.toThrow("Mã OTP không chính xác.");
    expect(storedEmail).toBe("old@wind.edu.vn");

    const profile = await service.confirmEmailChange("usr-admin", challenge.challengeId, "new.admin@wind.edu.vn", otpCode!, { currentPassword }, "session-current");
    expect(profile.username).toBe("admin@wind.edu.vn");
    expect(profile.email).toBe("new.admin@wind.edu.vn");
    expect(profile.emailVerifiedAt).toBeTruthy();
    expect(capturedUserUpdates).toHaveLength(1);
    expect(capturedUserUpdates[0]?.data.email).toBe("new.admin@wind.edu.vn");
    expect(capturedUserUpdates[0]?.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(capturedUserUpdates[0]?.data).not.toHaveProperty("username");
    expect(capturedAudits).toHaveLength(1);
    expect(capturedAudits[0]?.data).toMatchObject({
      action: "PROFILE_EMAIL_UPDATED",
      context: { previousEmail: "old@wind.edu.vn", newEmail: "new.admin@wind.edu.vn", verificationMethod: "PASSWORD+EMAIL_OTP", revokedSessions: 2 },
    });
    expect(revokedSessionQueries).toEqual([
      expect.objectContaining({ where: { userId: "usr-admin", revokedAt: null, id: { not: "session-current" } } }),
    ]);
    // Email cũ nhận cảnh báo với email mới đã được che bớt.
    const warning = sentEmails.at(-1);
    expect(warning?.to).toBe("old@wind.edu.vn");
    expect(warning?.text).toContain("ne*******@wind.edu.vn");
    expect(warning?.text).not.toContain("new.admin@wind.edu.vn");
  });

  it("từ chối khi email mới trùng email hiện tại hoặc đã thuộc về tài khoản khác", async () => {
    const prisma = {
      user: {
        findUnique: vi.fn(({ where }: { where: { id?: string; email?: string } }) => {
          if (where.email === "taken@wind.edu.vn") return Promise.resolve({ id: "usr-other" });
          return Promise.resolve({
            id: "usr-admin",
            email: "admin@wind.edu.vn",
            emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
          });
        }),
      },
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      {} as EmailDeliveryService,
      {} as ObjectStorageService,
      makeConfig(),
    );

    await expect(service.sendEmailChangeOtp("usr-admin", "admin@wind.edu.vn", { currentPassword: "Current-Pass-2026!" })).rejects.toThrow(
      "Email mới phải khác email hiện tại của tài khoản.",
    );
    await expect(service.sendEmailChangeOtp("usr-admin", "taken@wind.edu.vn", { currentPassword: "Current-Pass-2026!" })).rejects.toThrow(
      ConflictException,
    );
  });
});
