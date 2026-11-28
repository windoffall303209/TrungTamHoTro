import "reflect-metadata";
import { Body, Controller, HttpCode, Post, VersioningType, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppThrottlerGuard, AuthRateLimit, AUTH_THROTTLER, IP_THROTTLER, authAccountKey, sessionKey } from "../../src/auth/auth-rate-limit.js";

@Controller("probe")
/** Controller thử nghiệm có một route xác thực bị giới hạn chặt và một route thường. */
class ProbeController {
  @Post("login")
  @AuthRateLimit()
  @HttpCode(200)
  /** Route giả lập đăng nhập. */
  login(@Body() body: { username: string }): { username: string } { return { username: body.username }; }

  @Post("open")
  @HttpCode(200)
  /** Route thường chỉ chịu giới hạn mặc định. */
  open(): { ok: true } { return { ok: true }; }
}

describe("Giới hạn tốc độ riêng cho route xác thực", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60_000, limit: 5 }, { name: IP_THROTTLER, ttl: 60_000, limit: 10 }, { name: AUTH_THROTTLER, ttl: 60_000, limit: 2 }] })],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => { await app.close(); });

  // Gửi POST JSON tới route thử nghiệm (có thể kèm cookie phiên) và trả mã trạng thái.
  async function post(path: string, body: object, cookie?: string): Promise<number> {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    return response.status;
  }

  it("chặn sau giới hạn theo cặp IP + tài khoản nhưng không ảnh hưởng tài khoản khác cùng IP", async () => {
    expect(await post("/probe/login", { username: "victim" })).toBe(200);
    expect(await post("/probe/login", { username: "VICTIM " })).toBe(200);
    expect(await post("/probe/login", { username: "victim" })).toBe(429);
    expect(await post("/probe/login", { username: "classmate" })).toBe(200);
  });

  it("đếm giới hạn mặc định theo phiên đăng nhập để người dùng chung NAT không khóa nhau, có trần theo IP", async () => {
    for (let index = 0; index < 5; index += 1) expect(await post("/probe/open", {}, "wind_edu_session=alice")).toBe(200);
    expect(await post("/probe/open", {}, "wind_edu_session=alice")).toBe(429);
    // Người dùng khác cùng IP vẫn dùng được vì có phiên riêng.
    expect(await post("/probe/open", {}, "wind_edu_session=bob")).toBe(200);
    // Xoay cookie giả không lách được trần 10 request/IP của route (đã dùng 7 request ở trên).
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) statuses.push(await post("/probe/open", {}, `wind_edu_session=rotate-${index}`));
    expect(statuses).toContain(429);
    expect(sessionKey("a=1; wind_edu_session=abc")).toBe(sessionKey("wind_edu_session=abc"));
    expect(sessionKey("a=1")).toBeUndefined();
  });

  it("chuẩn hóa định danh tài khoản trước khi băm", () => {
    expect(authAccountKey({ username: " Admin " })).toBe(authAccountKey({ username: "admin" }));
    expect(authAccountKey({ email: "a@b.c" })).not.toBe(authAccountKey({ username: "a@b.c" }));
    expect(authAccountKey(undefined)).toBe("anonymous");
  });
});
