import { UnauthorizedException, ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_GUARD } from "@nestjs/core";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/auth.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { ContentController } from "../src/learning/content.controller.js";
import { LearningService } from "../src/learning/learning.service.js";
import { AiProviderService } from "../src/system/ai-provider.service.js";
import { AiGenerationRequestService } from "../src/learning/ai-generation-request.service.js";
import { AiMaterialContextService } from "../src/learning/ai-material-context.service.js";

let app: INestApplication;
let url: string;
const status = vi.fn();
// Exercise real HTTP routing, DTO validation and permissions with only the context boundary mocked.
beforeAll(async () => {
  const module = await Test.createTestingModule({ controllers: [ContentController], providers: [
    { provide: LearningService, useValue: {} }, { provide: AiProviderService, useValue: {} }, { provide: AiGenerationRequestService, useValue: {} },
    { provide: AiMaterialContextService, useValue: { questionStatus: status } },
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
// Close the isolated HTTP server after the suite.
afterAll(async () => { await app?.close(); });
beforeEach(() => { vi.resetAllMocks(); status.mockResolvedValue({ state: "NOT_REQUESTED" }); });
// Keep question text in the request body, not in the URL or query string.
const read = (body: object, cookie = "allowed"): Promise<Response> => fetch(url, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });

it("returns 200/no-store and derives the requester from the authenticated session", async () => {
  const response = await read({ question: "What is HTTP?" });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ state: "NOT_REQUESTED" });
  expect(status).toHaveBeenCalledExactlyOnceWith("material-1", "teacher", "INSTRUCTOR", "What is HTTP?", "VI");
});
it.each([{}, { question: "x" }, { question: "x".repeat(2001) }, { question: "Valid?", language: "XX" }, { question: "Valid?", ownerId: "other" }, { question: "Valid?", model: "override" }])("rejects invalid or extra body fields: %j", async (body) => {
  expect((await read(body)).status).toBe(400);
  expect(status).not.toHaveBeenCalled();
});
it.each([["", 401], ["denied", 403]])("rejects unauthenticated or unprivileged calls: %s", async (cookie, code) => {
  expect((await read({ question: "Valid?" }, cookie)).status).toBe(code);
  expect(status).not.toHaveBeenCalled();
});
