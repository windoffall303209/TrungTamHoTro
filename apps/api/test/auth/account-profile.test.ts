import "reflect-metadata";
import { ConflictException, ValidationPipe } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { UpdateProfileDto } from "../../src/auth/auth.dto.js";
import { AuthService } from "../../src/auth/auth.service.js";
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

  it("chấp nhận email hợp lệ trong UpdateProfileDto nhưng từ chối trường username", async () => {
    const accepted: unknown = await pipe.transform(
      {
        displayName: "Wind Of Fall",
        email: "new.admin@wind.edu.vn",
        phone: "0901234567",
        timezone: "Asia/Bangkok",
        locale: "vi-VN",
      },
      { type: "body", metatype: UpdateProfileDto },
    );
    expect(accepted).toMatchObject({ displayName: "Wind Of Fall", email: "new.admin@wind.edu.vn" });

    await expect(
      pipe.transform(
        {
          displayName: "Wind Of Fall",
          email: "khong-hop-le",
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

  it("cập nhật email mới, giữ nguyên username, thu hồi OTP cũ và ghi audit log", async () => {
    const capturedUserUpdates: UpdateUserCall[] = [];
    const capturedAudits: Array<{ data: { action: string; context: Record<string, string | null> } }> = [];
    const txTokenUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    let storedEmail = "old@wind.edu.vn";

    const prisma = {
      user: {
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
            passwordHash: "hashed",
            createdAt: new Date("2026-09-15T10:26:00Z"),
          });
        }),
      },
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          user: {
            update: (args: UpdateUserCall) => {
              capturedUserUpdates.push(args);
              if (typeof args.data.email === "string") storedEmail = args.data.email;
              return Promise.resolve({});
            },
          },
          accountToken: { updateMany: txTokenUpdateMany },
          auditLog: {
            create: (entry: { data: { action: string; context: Record<string, string | null> } }) => {
              capturedAudits.push(entry);
              return Promise.resolve({});
            },
          },
        });
      }),
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      {} as EmailDeliveryService,
      {} as ObjectStorageService,
      makeConfig(),
    );

    const profile = await service.updateProfile("usr-admin", {
      displayName: "Wind Of Fall",
      email: "  New.Admin@Wind.edu.vn ",
      phone: "0901234567",
      timezone: "Asia/Bangkok",
      locale: "vi-VN",
    });

    expect(profile.username).toBe("admin@wind.edu.vn");
    expect(profile.email).toBe("new.admin@wind.edu.vn");
    expect(profile.emailVerifiedAt).toBeTruthy();
    expect(capturedUserUpdates).toHaveLength(1);
    expect(capturedUserUpdates[0]?.data.email).toBe("new.admin@wind.edu.vn");
    expect(capturedUserUpdates[0]?.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(capturedUserUpdates[0]?.data).not.toHaveProperty("username");
    expect(txTokenUpdateMany).toHaveBeenCalledTimes(1);
    expect(capturedAudits).toHaveLength(1);
    expect(capturedAudits[0]?.data).toMatchObject({
      action: "PROFILE_EMAIL_UPDATED",
      context: { previousEmail: "old@wind.edu.vn", newEmail: "new.admin@wind.edu.vn" },
    });
  });

  it("từ chối khi email mới đã thuộc về tài khoản khác", async () => {
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

    await expect(
      service.updateProfile("usr-admin", {
        displayName: "Wind Of Fall",
        email: "taken@wind.edu.vn",
        timezone: "Asia/Bangkok",
        locale: "vi-VN",
      }),
    ).rejects.toThrow(ConflictException);
  });
});
