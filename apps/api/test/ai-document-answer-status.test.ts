import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { ContentController } from "../src/domains/learning/content.controller.js";
import { LearningService } from "../src/domains/learning/learning.service.js";
import { AiProviderService } from "../src/domains/system/ai-provider.service.js";
import { AiGenerationRequestService } from "../src/domains/learning/ai-generation-request.service.js";
import { AiMaterialContextService } from "../src/domains/learning/ai-material-context.service.js";

let app: INestApplication;
let url: string;
const status = vi.fn();
const history = vi.fn();
// Kiểm tra tuyến HTTP, DTO và quyền thật; chỉ mô phỏng ranh giới ngữ cảnh.
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [ContentController], providers: [
    { provide: LearningService, useValue: {} }, { provide: AiProviderService, useValue: {} }, { provide: AiGenerationRequestService, useValue: {} },
    { provide: AiMaterialContextService, useValue: { questionStatus: status, questionHistory: history } },
    { provide: AuthService, useValue: { readToken: (cookie?: string): string | undefined => cookie, resolve: (token?: string): { user: { id: string }; roleCode: string; permissions: string[] } => {
      if (!token) throw new UnauthorizedException();
      return { user: { id: "teacher" }, roleCode: "INSTRUCTOR", permissions: token === "allowed" ? ["material:manage"] : [] };
    } } }, { provide: APP_GUARD, useClass: PermissionGuard },
  ] }).compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(0, "127.0.0.1");
  url = `${await app.getUrl()}/instructor/materials/material-1/ai-question/status`;
});
// Đóng máy chủ HTTP riêng sau bộ kiểm thử.
afterAll(async () => { await app?.close(); });
beforeEach(() => { vi.resetAllMocks(); status.mockResolvedValue({ state: "NOT_REQUESTED" }); history.mockResolvedValue({ items: [], nextCursor: null }); });
// Giữ nội dung câu hỏi trong body, không đưa vào URL hoặc chuỗi truy vấn.
const read = (body: object, cookie = "allowed"): Promise<Response> => fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

it("returns 200/no-store and derives the requester from the authenticated session", async () => {
  const response = await read({ question: "What is HTTP?" });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ state: "NOT_REQUESTED" });
  expect(status).toHaveBeenCalledExactlyOnceWith("material-1", "teacher", "INSTRUCTOR", "What is HTTP?", "VI", undefined);
});
it("accepts an explicit historical version only for read-only status", async () => {
  expect((await read({ question: "Historical question?", version: 2 })).status).toBe(200);
  expect(status).toHaveBeenCalledExactlyOnceWith("material-1", "teacher", "INSTRUCTOR", "Historical question?", "VI", 2);
  const response = await fetch(url.replace("/status", ""), { method: "POST", headers: { cookie: "allowed", "content-type": "application/json" }, body: JSON.stringify({ question: "Historical question?", version: 2 }) });
  expect(response.status).toBe(400);
});
it.each([0, -1, 1.5, "2", 2147483648])("rejects invalid historical version %s", async (version) => {
  expect((await read({ question: "Historical question?", version })).status).toBe(400);
  expect(status).not.toHaveBeenCalled();
});
it.each([{}, { question: "x" }, { question: "x".repeat(2001) }, { question: "Valid?", language: "XX" }, { question: "Valid?", ownerId: "other" }, { question: "Valid?", model: "override" }])("rejects invalid or extra body fields: %j", async (body) => {
  expect((await read(body)).status).toBe(400);
  expect(status).not.toHaveBeenCalled();
});
it.each([["", 401], ["denied", 403]])("rejects unauthenticated or unprivileged calls: %s", async (cookie, code) => {
  expect((await read({ question: "Valid?" }, cookie)).status).toBe(code);
  expect(status).not.toHaveBeenCalled();
});

// Đọc lịch sử mà không đưa câu hỏi vào URL hoặc cho phép bên gọi chọn chủ sở hữu.
const readHistory = (query = "?version=2", cookie = "allowed"): Promise<Response> => fetch(`${url.replace("/ai-question/status", "/ai-questions")}${query}`, { headers: { cookie } });

it("lists private history with no-store and the session owner", async () => {
  const cursor = "a".repeat(64);
  const response = await readHistory(`?version=2&cursor=${cursor}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
  expect(history).toHaveBeenCalledExactlyOnceWith("material-1", 2, "teacher", "INSTRUCTOR", cursor);
  expect(status).not.toHaveBeenCalled();
});
it.each(["", "?version=0", "?version=-1", "?version=1.5", "?version=1e1", "?version=true", "?version=2147483648", "?version=1&version=2", "?version=1&cursor=", "?version=1&cursor=invalid", "?version=1&ownerId=other", "?version=1&model=override", "?version=1&question=private", "?version=1&limit=500"])("rejects invalid history filters before the service: %s", async (query) => {
  expect((await readHistory(query)).status).toBe(400);
  expect(history).not.toHaveBeenCalled();
});
it.each([["", 401], ["denied", 403]])("requires authentication and permission for history: %s", async (cookie, code) => {
  expect((await readHistory("?version=1", cookie)).status).toBe(code);
  expect(history).not.toHaveBeenCalled();
});
