import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module.js";
import { HttpExceptionFilter } from "../src/common/http-exception.filter.js";
import { ResponseInterceptor } from "../src/common/response.interceptor.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { EmailDeliveryService, type SendEmailInput } from "../src/infrastructure/email-delivery.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const username = `verify-${suffix}`.slice(0, 32);
const email = `verify-${suffix}@e2e.wind.local`;
const correctedEmail = `verified-${suffix}@e2e.wind.local`;
const legacyOldEmail = `legacy-old-${suffix}@e2e.wind.local`;
const legacyNewEmail = `legacy-new-${suffix}@e2e.wind.local`;
const password = "Verify-E2E-2026!";

interface Envelope<T> { data: T }
interface ErrorEnvelope { error: { message: string; details?: Record<string, unknown> } }

describe("Đăng ký và xác minh email qua API", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const sentEmails: SendEmailInput[] = [];

  beforeAll(async () => {
    const emailDelivery = {
      send: vi.fn((input: SendEmailInput) => {
        sentEmails.push(input);
        return Promise.resolve({ provider: "resend" as const, providerMessageId: `e2e-${sentEmails.length}`, acceptedAt: new Date().toISOString() });
      }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailDeliveryService)
      .useValue(emailDelivery)
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

  afterAll(async () => {
    if (prisma) await prisma.user.deleteMany({ where: { email: { in: [email, correctedEmail, legacyOldEmail, legacyNewEmail] } } });
    if (app) await app.close();
  }, 30_000);

  it("giữ tài khoản ở trạng thái chờ cho tới khi mã 6 số hợp lệ", async () => {
    const registration = await post("/auth/register", { username, displayName: "Người dùng xác minh E2E", email, password });
    expect(registration.status).toBe(201);
    const registrationBody = registration.body as Envelope<{ verificationRequired: boolean; verificationId: string }>;
    expect(registrationBody.data.verificationRequired).toBe(true);
    expect(registrationBody.data.verificationId).toHaveLength(36);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.text).toContain("Hoặc mở liên kết sau để xác minh ngay:");

    const pendingUser = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(pendingUser.status).toBe("PENDING_VERIFICATION");
    expect(pendingUser.emailVerifiedAt).toBeNull();

    const duplicate = await post("/auth/register", { username: `${username.slice(0, 28)}-2`, displayName: "Tài khoản khác", email, password });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as ErrorEnvelope).error.details?.code).toBe("EMAIL_PENDING_VERIFICATION");

    const rejectedChange = await post("/auth/verification-email/change", {
      verificationId: registrationBody.data.verificationId,
      newEmail: correctedEmail,
      password: "Wrong-E2E-2026!",
    });
    expect(rejectedChange.status).toBe(401);

    const changedEmail = await post("/auth/verification-email/change", {
      verificationId: registrationBody.data.verificationId,
      newEmail: correctedEmail,
      password,
    });
    expect(changedEmail.status).toBe(200);
    const changedEmailBody = changedEmail.body as Envelope<{ verificationId: string; email: string; verificationEmailSent: boolean }>;
    expect(changedEmailBody.data.email).toBe(correctedEmail);
    expect(changedEmailBody.data.verificationId).not.toBe(registrationBody.data.verificationId);
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
    const obsoleteVerification = await post("/auth/verify-email/code", { verificationId: registrationBody.data.verificationId, code: oldCode });
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
    const initialUsername = `legacy-${suffix}`.slice(0, 32);
    const emailCountBefore = sentEmails.length;
    const registration = await post("/auth/register", {
      username: initialUsername,
      displayName: "Tài khoản cũ E2E",
      email: legacyOldEmail,
      password,
    });
    expect(registration.status).toBe(201);
    const verificationId = (registration.body as Envelope<{ verificationId: string }>).data.verificationId;
    await prisma.user.update({ where: { email: legacyOldEmail }, data: { username: legacyOldEmail } });

    const changed = await post("/auth/verification-email/change", { verificationId, newEmail: legacyNewEmail, password });
    expect(changed.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: legacyNewEmail } });
    expect(user.username).toBe(legacyNewEmail);
    expect(sentEmails).toHaveLength(emailCountBefore + 2);

    const loginByEmail = await post("/auth/login", { username: legacyNewEmail, password, rememberMe: false });
    expect(loginByEmail.status).toBe(403);
    expect((loginByEmail.body as ErrorEnvelope).error.details?.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  }, 30_000);

  async function post(path: string, body: object): Promise<{ status: number; headers: Headers; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as unknown };
  }

  async function authenticatedRequest(method: string, path: string, cookie: string, csrfToken: string, body?: object): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { cookie, "x-csrf-token": csrfToken, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as unknown };
  }
});

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
