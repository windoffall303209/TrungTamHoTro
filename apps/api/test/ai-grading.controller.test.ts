import { ConflictException, UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademicController } from "../src/domains/learning/academic.controller.js";
import { AcademicService } from "../src/domains/learning/academic.service.js";
import { AiGradingAssistService } from "../src/domains/learning/ai-grading-assist.service.js";
import { AuthService, type AuthenticatedSession } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";

const session = { roleCode: "INSTRUCTOR", permissions: ["exam:manage"], user: { id: "teacher" } } as AuthenticatedSession;
const input = { expectedSubmissionRevision: 2, language: "VI" };

describe("AI grading HTTP contract with real validation and permission guard", () => {
  let app: INestApplication;
  let url: string;
  const suggest = vi.fn();
  const inspect = vi.fn();
  const grade = vi.fn();

  // Khởi chạy HTTP thật với guard/pipeline thật; thay biên xác thực và dịch vụ AI bằng fixture.
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AcademicController],
      providers: [
        { provide: AcademicService, useValue: { gradeSubmission: grade } },
        { provide: AiGradingAssistService, useValue: { suggest, inspect } },
        { provide: AuthService, useValue: {
          readToken: (cookie?: string): string | undefined => cookie,
          resolve: (token?: string): Promise<AuthenticatedSession> => {
            if (!token) return Promise.reject(new UnauthorizedException());
            return Promise.resolve(token === "learner" ? { ...session, roleCode: "LEARNER", permissions: ["exam:view"] } : session);
          },
        } },
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, "127.0.0.1");
    url = `${await app.getUrl()}/instructor/assignment-submissions/submission/ai-suggestion`;
  });

  // Đóng server test để không để lại cổng hoặc tiến trình nền.
  afterAll(async () => { if (app) await app.close(); });

  // Mỗi ca kiểm thử có kết quả và số lần gọi độc lập.
  beforeEach(() => {
    vi.resetAllMocks();
    suggest.mockResolvedValue({ suggestionId: "saved", requiresHumanReview: true });
    inspect.mockResolvedValue({ state: "NOT_REQUESTED" });
  });

  // Gửi JSON qua HTTP để kiểm chứng DTO thay vì gọi controller trực tiếp.
  function post(body: unknown, cookie = "teacher"): Promise<Response> {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  }

  it("passes only the authorized session, source revision and language to generation", async () => {
    const response = await post(input);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ suggestionId: "saved", requiresHumanReview: true });
    expect(suggest).toHaveBeenCalledExactlyOnceWith("submission", 2, "VI", session);
    expect(grade).not.toHaveBeenCalled();
  });

  it("reads status without generation, accepting a decimal integer query", async () => {
    const response = await fetch(`${url}?expectedSubmissionRevision=2&language=EN`, { headers: { cookie: "teacher" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ state: "NOT_REQUESTED" });
    expect(inspect).toHaveBeenCalledExactlyOnceWith("submission", 2, "EN", session);
    expect(suggest).not.toHaveBeenCalled();
    expect(grade).not.toHaveBeenCalled();
  });

  it.each([{}, { ...input, expectedSubmissionRevision: 0 }, { ...input, expectedSubmissionRevision: -1 },
    { ...input, expectedSubmissionRevision: 1.5 }, { ...input, expectedSubmissionRevision: "2" },
    { ...input, expectedSubmissionRevision: true }, { ...input, expectedSubmissionRevision: 2_147_483_648 },
    { ...input, language: "FR" }, { ...input, language: null },
    { ...input, model: "caller-model" }, { ...input, rubric: [] }, { ...input, answer: "replacement" },
  ])("rejects invalid or caller-controlled input %j", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it.each(["", "0", "-1", "1.5", "true", "1e2", "0x10", "2147483648", "2&expectedSubmissionRevision=3"])("rejects malformed query revision %s", async (revision) => {
    const response = await fetch(`${url}?expectedSubmissionRevision=${revision}&language=VI`, { headers: { cookie: "teacher" } });
    expect(response.status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("requires a session and exam management permission on both methods", async () => {
    for (const cookie of ["", "learner"]) {
      const expected = cookie ? 403 : 401;
      expect((await post(input, cookie)).status).toBe(expected);
      expect((await fetch(`${url}?expectedSubmissionRevision=2&language=VI`, { headers: { cookie } })).status).toBe(expected);
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("accepts bilingual output and the largest database revision but rejects query injection", async () => {
    expect((await post({ expectedSubmissionRevision: 2_147_483_647, language: "BILINGUAL" })).status).toBe(201);
    expect(suggest).toHaveBeenCalledExactlyOnceWith("submission", 2_147_483_647, "BILINGUAL", session);
    expect((await fetch(`${url}?expectedSubmissionRevision=2&language=VI&model=override`, { headers: { cookie: "teacher" } })).status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("preserves service conflicts without retrying or writing grades", async () => {
    suggest.mockRejectedValueOnce(new ConflictException("Already generating"));
    expect((await post(input)).status).toBe(409);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(grade).not.toHaveBeenCalled();
  });
});
