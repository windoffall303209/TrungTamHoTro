import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../../src/auth/auth.service.js";
import { ContentController } from "../../src/domains/learning/content/content.controller.js";

describe("Route AI học liệu của giảng viên", () => {
  it("từ chối mọi vai trò khác giảng viên trước khi chạm vào service AI", () => {
    const materialAi = new Proxy({}, { get: (): unknown => vi.fn((): Promise<object> => Promise.resolve({})) });
    const controller = new ContentController({} as never, {} as never, {} as never, materialAi as never);
    const learner = { roleCode: "LEARNER", user: { id: "usr-learner" }, permissions: ["material:manage"] } as unknown as AuthenticatedSession;
    const calls: Array<() => unknown> = [
      (): unknown => controller.questionHistory("mat-1", { version: 1 } as never, learner),
      (): unknown => controller.prepareMaterialContext("mat-1", {} as never, learner),
      (): unknown => controller.askMaterial("mat-1", { question: "Câu hỏi", language: "VI" } as never, learner),
      (): unknown => controller.questionStatus("mat-1", { question: "Câu hỏi", language: "VI" } as never, learner),
      (): unknown => controller.studyMaterial("mat-1", {} as never, learner),
      (): unknown => controller.listStudyDrafts("mat-1", {} as never, learner),
      (): unknown => controller.getStudyDraft("mat-1", "draft-1", learner),
      (): unknown => controller.editStudyDraft("mat-1", "draft-1", {} as never, learner),
      (): unknown => controller.publishStudyDraft("mat-1", "draft-1", {} as never, learner),
      (): unknown => controller.unpublishStudyDraft("mat-1", "draft-1", { expectedPublicationRevision: 1 } as never, learner),
    ];
    for (const call of calls) expect(call).toThrow(ForbiddenException);
  });
});
