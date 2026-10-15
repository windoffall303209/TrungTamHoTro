import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { HttpExceptionFilter } from "../src/common/http-exception.filter.js";
import { ResponseInterceptor } from "../src/common/response.interceptor.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { EmailDeliveryService, type SendEmailInput } from "../src/infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../src/infrastructure/object-storage.service.js";
import type { Environment } from "../src/config/environment.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const username = `verify-${suffix}`.slice(0, 32);
const email = `verify-${suffix}@e2e.wind.local`;
const correctedEmail = `verified-${suffix}@e2e.wind.local`;
const legacyOldEmail = `legacy-old-${suffix}@e2e.wind.local`;
const legacyNewEmail = `legacy-new-${suffix}@e2e.wind.local`;
const password = "Verify-E2E-2026!";

interface Envelope<T> { data: T }
interface ErrorEnvelope { error: { message: string; details?: Record<string, unknown> } }

describe("Xác minh email qua API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const sentEmails: SendEmailInput[] = [];
  let storageRoot: string | undefined;

  // Giữ HTTP, xác thực và cơ sở dữ liệu thật; dùng kho tệp local riêng thay vì Cloudinary đang hoạt động.
  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "wind-auth-storage-"));
    const storageConfig = new ConfigService<Environment, true>({ STORAGE_PROVIDER: "local", STORAGE_ROOT: storageRoot, CLOUDINARY_FOLDER: "test", CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "" });
    const emailDelivery = {
      send: vi.fn((input: SendEmailInput) => {
        sentEmails.push(input);
        return Promise.resolve({ provider: "resend" as const, providerMessageId: `e2e-${sentEmails.length}`, acceptedAt: new Date().toISOString() });
      }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailDeliveryService)
      .useValue(emailDelivery)
      .overrideProvider(ObjectStorageService)
      .useValue(new ObjectStorageService(storageConfig))
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = `${await app.getUrl()}/api/v1`;
    prisma = app.get(PrismaService);
  }, 30_000);

  // Chỉ xóa kho tệp tạm của lần chạy này, kể cả khi kiểm thử thất bại trước bước xóa ảnh đại diện.
  afterAll(async () => {
    try {
      if (prisma) await prisma.user.deleteMany({ where: { email: { in: [email, correctedEmail, legacyOldEmail, legacyNewEmail] } } });
    } finally {
      if (app) await app.close();
      if (storageRoot && dirname(resolve(storageRoot)) === resolve(tmpdir()) && resolve(storageRoot).startsWith(join(resolve(tmpdir()), "wind-auth-storage-"))) await rm(storageRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("giữ tài khoản ở trạng thái chờ cho tới khi mã 6 số hợp lệ", async () => {
    await createPendingUser(username, email);
    const firstLogin = await post("/auth/login", { username, password, rememberMe: false });
    expect(firstLogin.status).toBe(403);
    const firstLoginDetails = (firstLogin.body as ErrorEnvelope).error.details;
    expect(firstLoginDetails?.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    const verificationId = String(firstLoginDetails?.verificationId);
    expect(verificationId).toHaveLength(36);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.text).toContain("Hoặc mở liên kết sau để xác minh ngay:");

    const pendingUser = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(pendingUser.status).toBe("PENDING_VERIFICATION");
    expect(pendingUser.emailVerifiedAt).toBeNull();

    const rejectedChange = await post("/auth/verification-email/change", {
      verificationId,
      newEmail: correctedEmail,
      password: "Wrong-E2E-2026!",
    });
    expect(rejectedChange.status).toBe(401);

    const changedEmail = await post("/auth/verification-email/change", {
      verificationId,
      newEmail: correctedEmail,
      password,
    });
    expect(changedEmail.status).toBe(200);
    const changedEmailBody = changedEmail.body as Envelope<{ verificationId: string; email: string; verificationEmailSent: boolean }>;
    expect(changedEmailBody.data.email).toBe(correctedEmail);
    expect(changedEmailBody.data.verificationId).not.toBe(verificationId);
    expect(changedEmailBody.data.verificationEmailSent).toBe(true);
    expect(sentEmails).toHaveLength(2);

    const changedUser = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(changedUser.email).toBe(correctedEmail);
    expect(changedUser.username).toBe(username);

    const pendingLogin = await post("/auth/login", { username, password, rememberMe: false });
    expect(pendingLogin.status).toBe(403);
    expect((pendingLogin.body as ErrorEnvelope).error.details?.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect((pendingLogin.body as ErrorEnvelope).error.details?.verificationId).toBe(changedEmailBody.data.verificationId);
    expect((pendingLogin.body as ErrorEnvelope).error.details?.email).toBe(correctedEmail);

    const oldCode = sentEmails[0]?.text.match(/là:\s*(\d{6})/)?.[1];
    expect(oldCode).toMatch(/^\d{6}$/);
    const obsoleteVerification = await post("/auth/verify-email/code", { verificationId, code: oldCode });
    expect(obsoleteVerification.status).toBe(400);

    const code = sentEmails[1]?.text.match(/là:\s*(\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const wrongCode = await post("/auth/verify-email/code", { verificationId: changedEmailBody.data.verificationId, code: code === "999999" ? "000000" : "999999" });
    expect(wrongCode.status).toBe(401);

    const verification = await post("/auth/verify-email/code", { verificationId: changedEmailBody.data.verificationId, code });
    expect(verification.status).toBe(201);
    const activeUser = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(activeUser.status).toBe("ACTIVE");
    expect(activeUser.emailVerifiedAt).toBeInstanceOf(Date);

    const login = await post("/auth/login", { username, password, rememberMe: false });
    expect(login.status).toBe(200);
    expect(login.headers.get("set-cookie")).toContain("wind_edu_session=");
    const loginData = (login.body as Envelope<{ user: { username: string }; csrfToken: string }>).data;
    expect(loginData.user.username).toBe(username);

    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const invalidAvatar = new FormData(); invalidAvatar.append("file", new Blob(["not-an-image"], { type: "image/png" }), "avatar.png");
    const invalidAvatarResponse = await fetch(`${baseUrl}/account/avatar`, { method: "POST", headers: { cookie, "x-csrf-token": loginData.csrfToken }, body: invalidAvatar });
    expect(invalidAvatarResponse.status).toBe(400);

    const avatarBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const avatarForm = new FormData(); avatarForm.append("file", new Blob([avatarBytes], { type: "image/png" }), "avatar.png");
    const avatarUpload = await fetch(`${baseUrl}/account/avatar`, { method: "POST", headers: { cookie, "x-csrf-token": loginData.csrfToken }, body: avatarForm });
    expect(avatarUpload.status).toBe(201);
    expect(((await avatarUpload.json()) as Envelope<{ avatarUrl: string }>).data.avatarUrl).toMatch(/^\/account\/avatar\?v=\d+$/);
    const avatarDownload = await fetch(`${baseUrl}/account/avatar`, { headers: { cookie } });
    expect(avatarDownload.status).toBe(200);
    expect(avatarDownload.headers.get("content-type")).toContain("image/png");
    expect(avatarDownload.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(Buffer.from(await avatarDownload.arrayBuffer())).toEqual(avatarBytes);
    expect((await authenticatedRequest("DELETE", "/account/avatar", cookie, loginData.csrfToken)).status).toBe(200);

    const setup = await authenticatedRequest("POST", "/account/mfa/setup", cookie, loginData.csrfToken);
    expect(setup.status).toBe(201);
    const secret = (setup.body as Envelope<{ secret: string; otpauthUri: string }>).data.secret;
    expect((setup.body as Envelope<{ otpauthUri: string }>).data.otpauthUri).toContain(encodeURIComponent(username));

    const totp = generateTotp(secret);
    expect((await authenticatedRequest("POST", "/account/mfa/confirm", cookie, loginData.csrfToken, { code: totp })).status).toBe(201);
    expect((await authenticatedRequest("POST", "/account/mfa/disable-challenge", cookie, loginData.csrfToken, { password: "Wrong-E2E-2026!" })).status).toBe(401);

    const challenge = await authenticatedRequest("POST", "/account/mfa/disable-challenge", cookie, loginData.csrfToken, { password });
    expect(challenge.status).toBe(201);
    const challengeToken = (challenge.body as Envelope<{ challengeToken: string }>).data.challengeToken;
    const disabled = await authenticatedRequest("DELETE", "/account/mfa", cookie, loginData.csrfToken, { challengeToken, code: generateTotp(secret) });
    expect(disabled.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { username } })).mfaEnabledAt).toBeNull();
  }, 30_000);

  it("giữ username của tài khoản cũ đồng bộ với email đang chờ xác minh", async () => {
    const emailCountBefore = sentEmails.length;
    await createPendingUser(legacyOldEmail, legacyOldEmail);
    const pendingLogin = await post("/auth/login", { username: legacyOldEmail, password, rememberMe: false });
    expect(pendingLogin.status).toBe(403);
    const verificationId = String((pendingLogin.body as ErrorEnvelope).error.details?.verificationId);

    const changed = await post("/auth/verification-email/change", { verificationId, newEmail: legacyNewEmail, password });
    expect(changed.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: legacyNewEmail } });
    expect(user.username).toBe(legacyNewEmail);
    expect(sentEmails).toHaveLength(emailCountBefore + 2);

    const loginByEmail = await post("/auth/login", { username: legacyNewEmail, password, rememberMe: false });
    expect(loginByEmail.status).toBe(403);
    expect((loginByEmail.body as ErrorEnvelope).error.details?.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  }, 30_000);

  /** Tạo tài khoản học viên chờ xác minh email trực tiếp trong database kiểm thử. */
  async function createPendingUser(accountUsername: string, accountEmail: string): Promise<void> {
    await prisma.user.create({
      data: {
        username: accountUsername,
        email: accountEmail,
        displayName: "Người dùng xác minh E2E",
        passwordHash: await hashPassword(password),
        status: "PENDING_VERIFICATION",
        roles: { create: { role: { connect: { code: "LEARNER" } } } },
      },
    });
  }

  /** Gửi JSON bằng POST tới API kiểm thử và trả trạng thái, header cùng nội dung. */
  async function post(path: string, body: object): Promise<{ status: number; headers: Headers; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as unknown };
  }

  /** Gửi yêu cầu đã đăng nhập bằng cookie và mã CSRF của tài khoản kiểm thử. */
  async function authenticatedRequest(method: string, path: string, cookie: string, csrfToken: string, body?: object): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { cookie, "x-csrf-token": csrfToken, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as unknown };
  }
});

/** Sinh mã TOTP từ khóa Base32 và thời gian hiện tại để kiểm tra đăng nhập nhiều yếu tố. */
function generateTotp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
