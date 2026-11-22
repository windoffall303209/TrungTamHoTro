import "reflect-metadata";
import { Body, Controller, HttpCode, Post, VersioningType, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppThrottlerGuard, AuthRateLimit, AUTH_THROTTLER, authAccountKey } from "../../src/auth/auth-rate-limit.js";

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
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60_000, limit: 100 }, { name: AUTH_THROTTLER, ttl: 60_000, limit: 2 }] })],
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

  // Gửi POST JSON tới route thử nghiệm và trả mã trạng thái.
  async function post(path: string, body: object): Promise<number> {
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return response.status;
  }

  it("chặn sau giới hạn theo cặp IP + tài khoản nhưng không ảnh hưởng tài khoản khác cùng IP hay route thường", async () => {
    expect(await post("/probe/login", { username: "victim" })).toBe(200);
    expect(await post("/probe/login", { username: "VICTIM " })).toBe(200);
    expect(await post("/probe/login", { username: "victim" })).toBe(429);
    expect(await post("/probe/login", { username: "classmate" })).toBe(200);
    for (let index = 0; index < 5; index += 1) expect(await post("/probe/open", {})).toBe(200);
  });

  it("chuẩn hóa định danh tài khoản trước khi băm", () => {
    expect(authAccountKey({ username: " Admin " })).toBe(authAccountKey({ username: "admin" }));
    expect(authAccountKey({ email: "a@b.c" })).not.toBe(authAccountKey({ username: "a@b.c" }));
    expect(authAccountKey(undefined)).toBe("anonymous");
  });
});
