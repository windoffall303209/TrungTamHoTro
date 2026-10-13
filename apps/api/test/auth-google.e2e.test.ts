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
const googleEmail = `google-${suffix}@gmail.com`;
const unverifiedEmail = `google-unverified-${suffix}@gmail.com`;
const googleSubject = `google-subject-${suffix}`;
const newPassword = "Google-E2E-2026!";

interface Envelope<T> { data: T }
interface HttpResult { status: number; headers: Headers; body: unknown }

describe("Google OAuth và xác minh tăng cường bằng email", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let profileVerified = true;
  const sentEmails: SendEmailInput[] = [];
  const nativeFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://oauth2.googleapis.com/token") {
        if (!(init?.body instanceof URLSearchParams) && typeof init?.body !== "string") throw new Error("Google token request không dùng form URL encoded.");
        const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams(init.body);
        expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
        expect(body.get("grant_type")).toBe("authorization_code");
        return Response.json({ access_token: "google-e2e-access-token", token_type: "Bearer" });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({ sub: googleSubject, email: profileVerified ? googleEmail : unverifiedEmail, email_verified: profileVerified, name: "Học viên Google E2E" });
      }
      return nativeFetch(input, init);
    });

    const emailDelivery = {
      send: vi.fn((input: SendEmailInput) => {
        sentEmails.push(input);
        return Promise.resolve({ provider: "resend" as const, providerMessageId: `google-e2e-${sentEmails.length}`, acceptedAt: new Date().toISOString() });
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
    if (prisma) await prisma.user.deleteMany({ where: { OR: [{ googleSubject }, { email: { in: [googleEmail, unverifiedEmail] } }] } });
    if (app) await app.close();
    vi.restoreAllMocks();
  }, 30_000);

  it("tạo tài khoản không mật khẩu, xác minh email và đặt username bằng Gmail", async () => {
    const start = await request("GET", "/auth/google/start?rememberMe=true", undefined, undefined, true);
    expect(start.status).toBe(302);
    const authorizationUrl = new URL(start.headers.get("location") ?? "");
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("scope")).toBe("openid email profile");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    const stateCookie = cookieByName(start.headers, "wind_edu_google_state");
    expect(stateCookie).toContain("wind_edu_google_state=");

    const callback = await request("GET", `/auth/google/callback?code=e2e-code&state=${encodeURIComponent(state ?? "")}`, undefined, stateCookie, true);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("http://localhost:3000/dashboard");
    const sessionCookie = cookieByName(callback.headers, "wind_edu_session");
    expect(sessionCookie).toContain("wind_edu_session=");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: googleEmail } });
    expect(user.username).toBe(googleEmail);
    expect(user.googleSubject).toBe(googleSubject);
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);

    const session = await request("GET", "/auth/session", undefined, sessionCookie);
    expect(session.status).toBe(200);
    const csrfToken = (session.body as Envelope<{ csrfToken: string }>).data.csrfToken;
    const profile = await authenticatedRequest("GET", "/account/profile", sessionCookie, csrfToken);
    expect((profile.body as Envelope<{ username: string; hasPassword: boolean; googleConnected: boolean }>).data).toMatchObject({ username: googleEmail, hasPassword: false, googleConnected: true });

    const passwordLogin = await request("POST", "/auth/login", { username: googleEmail, password: newPassword, rememberMe: false });
    expect(passwordLogin.status).toBe(401);

    const passwordChallenge = await authenticatedRequest("POST", "/account/security-email-challenges", sessionCookie, csrfToken, { purpose: "PASSWORD_CHANGE" });
    expect(passwordChallenge.status).toBe(201);
    const passwordChallengeData = (passwordChallenge.body as Envelope<{ challengeId: string }>).data;
    const passwordCode = latestEmailCode("đặt hoặc đổi mật khẩu");
    const wrongCode = passwordCode === "999999" ? "000000" : "999999";
    expect((await authenticatedRequest("PATCH", "/account/password", sessionCookie, csrfToken, { challengeId: passwordChallengeData.challengeId, code: wrongCode, newPassword })).status).toBe(401);
    expect((await authenticatedRequest("PATCH", "/account/password", sessionCookie, csrfToken, { challengeId: passwordChallengeData.challengeId, code: passwordCode, newPassword })).status).toBe(200);
    expect((await authenticatedRequest("PATCH", "/account/password", sessionCookie, csrfToken, { challengeId: passwordChallengeData.challengeId, code: passwordCode, newPassword: "Google-E2E-2027!" })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: googleEmail } })).passwordHash).not.toBeNull();

    const localLogin = await request("POST", "/auth/login", { username: googleEmail, password: newPassword, rememberMe: false });
    expect(localLogin.status).toBe(200);
  }, 30_000);

  it("yêu cầu OTP email đúng mục đích trước khi bật và tắt 2FA", async () => {
    const login = await request("POST", "/auth/login", { username: googleEmail, password: newPassword, rememberMe: false });
    expect(login.status).toBe(200);
    const sessionCookie = cookieByName(login.headers, "wind_edu_session");
    const csrfToken = (login.body as Envelope<{ csrfToken: string }>).data.csrfToken;

    const setupWithoutOtp = await authenticatedRequest("POST", "/account/mfa/setup", sessionCookie, csrfToken, {});
    expect(setupWithoutOtp.status).toBe(400);
    const setupChallenge = await authenticatedRequest("POST", "/account/security-email-challenges", sessionCookie, csrfToken, { purpose: "MFA_SETUP" });
    const setupChallengeId = (setupChallenge.body as Envelope<{ challengeId: string }>).data.challengeId;
    const setupCode = latestEmailCode("bật xác thực hai bước");
    const setup = await authenticatedRequest("POST", "/account/mfa/setup", sessionCookie, csrfToken, { challengeId: setupChallengeId, code: setupCode });
    expect(setup.status).toBe(201);
    const secret = (setup.body as Envelope<{ secret: string; otpauthUri: string }>).data.secret;
    expect((setup.body as Envelope<{ otpauthUri: string }>).data.otpauthUri).toContain(encodeURIComponent(googleEmail));
    expect((await authenticatedRequest("POST", "/account/mfa/confirm", sessionCookie, csrfToken, { code: generateTotp(secret) })).status).toBe(201);

    const disableWithPassword = await authenticatedRequest("POST", "/account/mfa/disable-challenge", sessionCookie, csrfToken, { password: newPassword });
    expect(disableWithPassword.status).toBe(400);
    const disableChallenge = await authenticatedRequest("POST", "/account/security-email-challenges", sessionCookie, csrfToken, { purpose: "MFA_DISABLE" });
    const disableChallengeId = (disableChallenge.body as Envelope<{ challengeId: string }>).data.challengeId;
    const disableCode = latestEmailCode("tắt xác thực hai bước");
    const verified = await authenticatedRequest("POST", "/account/mfa/disable-challenge", sessionCookie, csrfToken, { challengeId: disableChallengeId, code: disableCode });
    expect(verified.status).toBe(201);
    const challengeToken = (verified.body as Envelope<{ challengeToken: string }>).data.challengeToken;
    expect((await authenticatedRequest("DELETE", "/account/mfa", sessionCookie, csrfToken, { challengeToken, code: generateTotp(secret) })).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: googleEmail } })).mfaEnabledAt).toBeNull();
  }, 30_000);

  it("từ chối callback nếu Google không xác nhận email", async () => {
    profileVerified = false;
    const start = await request("GET", "/auth/google/start", undefined, undefined, true);
    const authorizationUrl = new URL(start.headers.get("location") ?? "");
    const callback = await request("GET", `/auth/google/callback?code=e2e-unverified&state=${encodeURIComponent(authorizationUrl.searchParams.get("state") ?? "")}`, undefined, cookieByName(start.headers, "wind_edu_google_state"), true);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("http://localhost:3000/login?googleError=provider_failed");
    expect(await prisma.user.findUnique({ where: { email: unverifiedEmail } })).toBeNull();
    profileVerified = true;
  }, 30_000);

  /** Gửi yêu cầu HTTP tới máy chủ kiểm thử và thu nhận trạng thái cùng phản hồi. */
  async function request(method: string, path: string, body?: object, cookie?: string, manualRedirect = false): Promise<HttpResult> {
    const response = await nativeFetch(`${baseUrl}${path}`, {
      method,
      redirect: manualRedirect ? "manual" : "follow",
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await parseBody(response) };
  }

  /** Gửi yêu cầu đã đăng nhập bằng cookie và mã CSRF của tài khoản kiểm thử. */
  function authenticatedRequest(method: string, path: string, cookie: string, csrfToken: string, body?: object): Promise<HttpResult> {
    return requestWithHeaders(method, path, { cookie, "x-csrf-token": csrfToken }, body);
  }

  /** Gửi yêu cầu kiểm thử với các header chỉ định và đọc phản hồi theo định dạng trả về. */
  async function requestWithHeaders(method: string, path: string, headers: Record<string, string>, body?: object): Promise<HttpResult> {
    const response = await nativeFetch(`${baseUrl}${path}`, {
      method,
      headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, body: await parseBody(response) };
  }

  /** Lấy mã xác nhận sáu chữ số từ email mô phỏng mới nhất ứng với hành động. */
  function latestEmailCode(action: string): string {
    const email = [...sentEmails].reverse().find((item) => item.text.includes(action));
    const code = email?.text.match(/là:\s*(\d{6})/)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    return code ?? "";
  }
});

/** Đọc phản hồi JSON hoặc văn bản và xử lý trường hợp body rỗng. */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  if (!response.headers.get("content-type")?.includes("application/json")) return text;
  return JSON.parse(text) as unknown;
}

/** Tìm cookie theo tên trong các header Set-Cookie của phản hồi. */
function cookieByName(headers: Headers, name: string): string {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie") ?? ""];
  const cookie = values.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(";", 1)[0] ?? "";
}

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
