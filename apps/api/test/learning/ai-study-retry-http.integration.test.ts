import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { hashPassword } from "../../src/auth/password.js";
import { HttpExceptionFilter } from "../../src/common/http-exception.filter.js";
import { ResponseInterceptor } from "../../src/common/response.interceptor.js";
import type { Environment } from "../../src/config/environment.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import type { ContextChunk } from "../../src/domains/system/ai/ai-document-context.js";
import { AiProviderService } from "../../src/domains/system/ai/ai-provider.service.js";
import type { StudyGuide, StudyGuideOptions } from "../../src/domains/system/ai/ai-study-guide.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test") && process.env.DATABASE_CONNECT_ON_START === "true";
const fixtureSuffix = `${process.pid}-${Date.now().toString(36)}`;
const fixturePassword = "D01-Study-Retry-2026!";

const ids = {
  admin: `d01-admin-${fixtureSuffix}`,
  instructorA: `d01-inst-a-${fixtureSuffix}`,
  instructorB: `d01-inst-b-${fixtureSuffix}`,
  learnerA: `d01-learn-a-${fixtureSuffix}`,
  course: `d01-course-${fixtureSuffix}`,
  classA: `d01-class-a-${fixtureSuffix}`,
  classB: `d01-class-b-${fixtureSuffix}`,
  material: `d01-mat-${fixtureSuffix}`,
};

const usernames = {
  admin: `d01-adm-${fixtureSuffix}`,
  instructorA: `d01-ina-${fixtureSuffix}`,
  instructorB: `d01-inb-${fixtureSuffix}`,
  learnerA: `d01-lra-${fixtureSuffix}`,
};

interface ApiEnvelope<T> {
  data: T;
}

interface HttpSession {
  cookie: string;
  csrfToken: string;
  roleCode: "SYSTEM_ADMIN" | "INSTRUCTOR" | "LEARNER";
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

interface StudyOperationItem {
  id: string;
  ownerId: string;
  materialId: string;
  sourceVersion: number;
  state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN";
  createdAt: string;
  updatedAt: string;
}

interface StudyGuideResponse {
  draftId: string;
  version: number;
  insufficientContext: boolean;
  summary: Array<{ text: string }>;
  flashcards: Array<{ front: string; back: string }>;
}

/** Tạo promise có thể chủ động mở khóa để giữ đồng thời các request HTTP tại ranh giới provider. */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Tạo kết quả bộ ôn tập hợp lệ kèm trích dẫn từ chính đoạn ngữ cảnh server đã chọn. */
function buildStudyGuide(chunks: ContextChunk[], options: StudyGuideOptions): StudyGuide & { model?: string } {
  const source = chunks[0];
  if (!source) {
    return { insufficientContext: true, summary: [], flashcards: [], model: "d01-study-model" };
  }
  const flashcards = Array.from({ length: options.cardCount }, (_, index) => ({
    front: `Câu hỏi ôn tập ${index + 1} (v${source.version})`,
    back: `Đáp án dựa trên nguồn trang ${source.page} (v${source.version})`,
    citations: [source],
  }));
  return {
    insufficientContext: false,
    summary: [{ text: `Tóm tắt học liệu phiên bản ${source.version}`, citations: [source] }],
    flashcards,
    model: "d01-study-model",
  };
}

describe.skipIf(!enabled)("Nghiệm thu retry bộ ôn tập AI từ HTTP đến PostgreSQL (D01)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: ObjectStorageService;
  let storageRoot: string;
  let baseUrl: string;

  const sessions = new Map<keyof typeof usernames, HttpSession>();
  const createdAuditClaimIds = new Set<string>();

  const aiProvider = {
    resolveTask: vi.fn(),
    extractDocumentPages: vi.fn(),
    createStudyGuide: vi.fn(),
  };

  /** Khởi chạy Nest HTTP đầy đủ kèm PostgreSQL thật, chỉ giả lập ranh giới gọi model AI và kho file tạm. */
  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "wind-d01-study-storage-"));
    const storageConfig = new ConfigService<Environment, true>({
      STORAGE_PROVIDER: "local",
      STORAGE_ROOT: storageRoot,
      CLOUDINARY_FOLDER: "test",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
    });
    storage = new ObjectStorageService(storageConfig);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorageService)
      .useValue(storage)
      .overrideProvider(AiProviderService)
      .useValue(aiProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    await app.listen(0, "127.0.0.1");

    baseUrl = `${await app.getUrl()}/api/v1`;
    prisma = app.get(PrismaService);
    await createTestFixture(prisma, storage);

    sessions.set("admin", await loginAccount(baseUrl, usernames.admin, "SYSTEM_ADMIN"));
    sessions.set("instructorA", await loginAccount(baseUrl, usernames.instructorA, "INSTRUCTOR"));
    sessions.set("instructorB", await loginAccount(baseUrl, usernames.instructorB, "INSTRUCTOR"));
    sessions.set("learnerA", await loginAccount(baseUrl, usernames.learnerA, "LEARNER"));
  }, 30_000);

  /** Đặt lại mock provider về mặc định trước mỗi ca kiểm thử để đếm chính xác từng lượt gọi. */
  beforeEach(() => {
    aiProvider.resolveTask.mockReset().mockResolvedValue({ providerId: "gemini", model: "d01-model" });
    aiProvider.extractDocumentPages.mockReset().mockImplementation((file: { buffer: Buffer }) =>
      Promise.resolve([{ page: 1, text: `Nội dung trích xuất từ tệp: ${file.buffer.toString("utf8").trim()}` }]),
    );
    aiProvider.createStudyGuide.mockReset().mockImplementation((chunks: ContextChunk[], options: StudyGuideOptions) =>
      Promise.resolve(buildStudyGuide(chunks, options)),
    );
  });

  /** Dọn toàn bộ bản ghi fixture trong PostgreSQL và thư mục kho file tạm sau khi kết thúc. */
  afterAll(async () => {
    if (prisma) {
      await cleanupTestFixture(prisma, createdAuditClaimIds);
    }
    if (app) await app.close();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  }, 30_000);

  it("chặn tự gọi lại trạng thái UNCERTAIN và chỉ cho phép quản trị viên đối soát qua HTTP", async () => {
    const instructorSession = sessions.get("instructorA")!;
    const outsiderSession = sessions.get("instructorB")!;
    const learnerSession = sessions.get("learnerA")!;
    const payload = { cardCount: 2, language: "VI" as const };

    // Lần gọi đầu bị lỗi ở provider -> bản nháp phải chuyển sang UNCERTAIN.
    aiProvider.createStudyGuide.mockRejectedValueOnce(new Error("provider response lost"));
    const failed = await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: payload,
    });
    expect(failed.status).toBe(500);
    expect(aiProvider.extractDocumentPages).toHaveBeenCalledTimes(1);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(1);

    const uncertainRow = await prisma.aiStudyDraft.findFirstOrThrow({
      where: { ownerId: ids.instructorA, materialId: ids.material, sourceVersion: 1 },
    });
    expect(uncertainRow.state).toBe("UNCERTAIN");

    // 4 request HTTP đồng thời khi chưa đối soát đều phải bị chặn 409, không OCR lại và không gọi AI.
    const repeated = await Promise.all(
      Array.from({ length: 4 }, () =>
        sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
          method: "POST",
          body: payload,
        }),
      ),
    );
    expect(repeated.map((res) => res.status)).toEqual([409, 409, 409, 409]);
    expect(aiProvider.extractDocumentPages).toHaveBeenCalledTimes(1);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(1);

    // Học viên và giảng viên không có quyền đối soát quản trị hoặc tạo bộ ôn tập ngoài lớp.
    const evidence = buildReconcileEvidence(uncertainRow.updatedAt, "unauthorized");
    const instructorReconcile = await sendApiRequest(
      baseUrl,
      instructorSession,
      `/admin/ai-operations/study/${uncertainRow.id}/reconcile-not-processed`,
      { method: "POST", body: evidence },
    );
    const learnerReconcile = await sendApiRequest(
      baseUrl,
      learnerSession,
      `/admin/ai-operations/study/${uncertainRow.id}/reconcile-not-processed`,
      { method: "POST", body: evidence },
    );
    const learnerStudy = await sendApiRequest(baseUrl, learnerSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: payload,
    });
    const outsiderStudy = await sendApiRequest(baseUrl, outsiderSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: payload,
    });

    expect(instructorReconcile.status).toBe(403);
    expect(learnerReconcile.status).toBe(403);
    expect(learnerStudy.status).toBe(403);
    expect(outsiderStudy.status).toBe(404);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(1);
    expect(await prisma.auditLog.count({ where: { entityId: uncertainRow.id, action: "AI_STUDY_RETRY_AUTHORIZED" } })).toBe(0);
  });

  it("chỉ cấp đúng một claim và một lần gọi provider khi năm request đồng thời retry RETRY_AUTHORIZED", async () => {
    const adminSession = sessions.get("admin")!;
    const instructorSession = sessions.get("instructorA")!;
    const payload = { cardCount: 2, language: "VI" as const };

    // Admin đọc danh sách đối soát (không chứa nội dung nháp) rồi cấp quyền thử lại một lần.
    const listResponse = await sendApiRequest<ApiEnvelope<{ items: StudyOperationItem[] }>>(
      baseUrl,
      adminSession,
      "/admin/ai-operations/study?limit=50&state=UNCERTAIN",
    );
    expect(listResponse.status).toBe(200);
    const target = listResponse.body.data.items.find((item) => item.materialId === ids.material && item.ownerId === ids.instructorA);
    expect(target).toBeDefined();
    expect(target).not.toHaveProperty("options");
    expect(target).not.toHaveProperty("result");
    createdAuditClaimIds.add(target!.id);

    const reconciled = await reconcileStudyByAdmin(baseUrl, adminSession, target!.id, new Date(target!.updatedAt), "concurrent-retry");
    expect(reconciled.status).toBe(201);

    const providerEntered = createDeferred<void>();
    const providerGate = createDeferred<void>();
    aiProvider.createStudyGuide.mockImplementation(async (chunks: ContextChunk[], options: StudyGuideOptions) => {
      providerEntered.resolve();
      await providerGate.promise;
      return buildStudyGuide(chunks, options);
    });

    // Bắn 5 request HTTP đồng thời vào cùng bộ ôn tập vừa được cấp RETRY_AUTHORIZED.
    const inflight = Array.from({ length: 5 }, () =>
      sendApiRequest<ApiEnvelope<StudyGuideResponse>>(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
        method: "POST",
        body: payload,
      }),
    );

    // Chờ một request vào được provider và các request cạnh tranh trả 409 trước khi mở khóa provider.
    await providerEntered.promise;
    const conflictWaiter = createDeferred<void>();
    let conflicts = 0;
    for (const pending of inflight) {
      void pending.then((response) => {
        if (response.status === 409) {
          conflicts += 1;
          if (conflicts === 4) conflictWaiter.resolve();
        }
      });
    }
    await conflictWaiter.promise;
    providerGate.resolve();

    const outcomes = await Promise.all(inflight);
    const succeeded = outcomes.filter((response) => response.status === 201);
    const rejected = outcomes.filter((response) => response.status === 409);

    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(succeeded[0]!.body.data.draftId).toBe(target!.id);
    expect(succeeded[0]!.body.data.version).toBe(1);
    expect(aiProvider.extractDocumentPages).toHaveBeenCalledTimes(0);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(1);

    const storedDrafts = await prisma.aiStudyDraft.findMany({
      where: { ownerId: ids.instructorA, materialId: ids.material, sourceVersion: 1 },
    });
    expect(storedDrafts).toHaveLength(1);
    expect(storedDrafts[0]).toMatchObject({ id: target!.id, state: "READY", publishedAt: null });
    expect(await prisma.auditLog.count({ where: { entityId: target!.id, action: "AI_STUDY_RETRY_AUTHORIZED" } })).toBe(1);

    // Gửi lại sau khi READY phải replay bản đã lưu, không gọi provider thêm lần nào.
    const replayed = await sendApiRequest<ApiEnvelope<StudyGuideResponse>>(
      baseUrl,
      instructorSession,
      `/instructor/materials/${ids.material}/ai-study-guide`,
      { method: "POST", body: payload },
    );
    expect(replayed.status).toBe(201);
    expect(replayed.body.data.draftId).toBe(target!.id);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(1);
  });

  it("kiểm soát phiên bản học liệu và thu hồi quyền giảng viên trong suốt vòng đời retry", async () => {
    const adminSession = sessions.get("admin")!;
    const instructorSession = sessions.get("instructorA")!;

    // 1. Tạo bản nháp v1 bị UNCERTAIN rồi cấp quyền RETRY_AUTHORIZED.
    const optionsV1 = { cardCount: 3, language: "EN" as const };
    aiProvider.createStudyGuide.mockRejectedValueOnce(new Error("v1 provider timeout"));
    const failV1 = await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: optionsV1,
    });
    expect(failV1.status).toBe(500);

    const draftV1 = await prisma.aiStudyDraft.findFirstOrThrow({
      where: { ownerId: ids.instructorA, materialId: ids.material, sourceVersion: 1, state: "UNCERTAIN" },
    });
    createdAuditClaimIds.add(draftV1.id);
    expect((await reconcileStudyByAdmin(baseUrl, adminSession, draftV1.id, draftV1.updatedAt, "version-bump")).status).toBe(201);

    // 2. Thay học liệu lên phiên bản 2 trước khi retry -> không tiêu thụ RETRY_AUTHORIZED của v1 và chặn mở bản cũ.
    await replaceMaterialVersion(prisma, storage, ids.material, 2);
    const createdV2 = await sendApiRequest<ApiEnvelope<StudyGuideResponse>>(
      baseUrl,
      instructorSession,
      `/instructor/materials/${ids.material}/ai-study-guide`,
      { method: "POST", body: optionsV1 },
    );
    expect(createdV2.status).toBe(201);
    expect(createdV2.body.data.version).toBe(2);
    expect(createdV2.body.data.draftId).not.toBe(draftV1.id);
    expect((await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: draftV1.id } })).state).toBe("RETRY_AUTHORIZED");

    const openStaleV1 = await sendApiRequest(
      baseUrl,
      instructorSession,
      `/instructor/materials/${ids.material}/ai-study-guides/${draftV1.id}`,
    );
    expect(openStaleV1.status).toBe(404);

    // 3. Học liệu nâng từ v2 -> v3 ngay trong lúc provider đang chạy retry -> từ chối trả bản lỗi thời (409).
    const optionsMidFlight = { cardCount: 4, language: "VI" as const };
    aiProvider.createStudyGuide.mockRejectedValueOnce(new Error("v2 provider timeout"));
    expect((await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: optionsMidFlight,
    })).status).toBe(500);

    const draftV2 = await prisma.aiStudyDraft.findFirstOrThrow({
      where: { ownerId: ids.instructorA, materialId: ids.material, sourceVersion: 2, state: "UNCERTAIN" },
    });
    createdAuditClaimIds.add(draftV2.id);
    expect((await reconcileStudyByAdmin(baseUrl, adminSession, draftV2.id, draftV2.updatedAt, "mid-flight-version")).status).toBe(201);

    aiProvider.createStudyGuide.mockImplementationOnce(async (chunks: ContextChunk[], options: StudyGuideOptions) => {
      await replaceMaterialVersion(prisma, storage, ids.material, 3);
      return buildStudyGuide(chunks, options);
    });
    const staleMidFlight = await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: optionsMidFlight,
    });
    expect(staleMidFlight.status).toBe(409);

    // 4. Thu hồi phân công giảng viên khi v3 đang RETRY_AUTHORIZED -> bị chặn 404 trước khi đụng vào DB claim hay AI.
    const optionsRevoked = { cardCount: 5, language: "VI" as const };
    aiProvider.createStudyGuide.mockRejectedValueOnce(new Error("v3 provider timeout"));
    expect((await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: optionsRevoked,
    })).status).toBe(500);

    const draftV3 = await prisma.aiStudyDraft.findFirstOrThrow({
      where: { ownerId: ids.instructorA, materialId: ids.material, sourceVersion: 3, state: "UNCERTAIN" },
    });
    createdAuditClaimIds.add(draftV3.id);
    expect((await reconcileStudyByAdmin(baseUrl, adminSession, draftV3.id, draftV3.updatedAt, "revoked-access")).status).toBe(201);

    await prisma.classInstructor.deleteMany({ where: { classId: ids.classA, instructorId: ids.instructorA } });
    const callsBeforeRevokedRetry = aiProvider.createStudyGuide.mock.calls.length;
    const revokedRetry = await sendApiRequest(baseUrl, instructorSession, `/instructor/materials/${ids.material}/ai-study-guide`, {
      method: "POST",
      body: optionsRevoked,
    });
    expect(revokedRetry.status).toBe(404);
    expect(aiProvider.createStudyGuide).toHaveBeenCalledTimes(callsBeforeRevokedRetry);
    expect((await prisma.aiStudyDraft.findUniqueOrThrow({ where: { id: draftV3.id } })).state).toBe("RETRY_AUTHORIZED");
  });
});

/** Tạo bằng chứng đối soát hợp lệ theo hợp đồng HTTP của endpoint admin AI operations. */
function buildReconcileEvidence(updatedAt: Date, tag: string): {
  expectedUpdatedAt: string;
  evidenceReference: string;
  evidenceNote: string;
  checkedAt: string;
} {
  return {
    expectedUpdatedAt: updatedAt.toISOString(),
    evidenceReference: `provider-log-${tag}-${fixtureSuffix}`.slice(0, 120),
    evidenceNote: "Provider dashboard confirms this study request was not accepted or billed.",
    checkedAt: new Date(updatedAt.getTime() + 1_000).toISOString(),
  };
}

/** Gửi yêu cầu đối soát mở quyền retry từ phiên quản trị viên thật qua HTTP. */
async function reconcileStudyByAdmin(
  baseUrl: string,
  adminSession: HttpSession,
  draftId: string,
  updatedAt: Date,
  tag: string,
): Promise<{ status: number; body: unknown }> {
  return sendApiRequest(baseUrl, adminSession, `/admin/ai-operations/study/${draftId}/reconcile-not-processed`, {
    method: "POST",
    body: buildReconcileEvidence(updatedAt, tag),
  });
}

/** Đăng nhập qua HTTP thật để lấy cookie phiên và CSRF token hợp lệ cho từng vai trò. */
async function loginAccount(
  baseUrl: string,
  username: string,
  roleCode: HttpSession["roleCode"],
): Promise<HttpSession> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: fixturePassword, rememberMe: false }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  expect(cookie).toBeTruthy();
  const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
  expect(body.data.csrfToken).toBeTruthy();
  return { cookie: cookie ?? "", csrfToken: body.data.csrfToken, roleCode };
}

/** Gửi HTTP request kèm cookie, vai trò và mã CSRF thật tới máy chủ NestJS đang nghe trên localhost. */
async function sendApiRequest<T = unknown>(
  baseUrl: string,
  session: HttpSession,
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: object } = {},
): Promise<{ status: number; body: T }> {
  const method = options.method ?? "GET";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      "x-role-code": session.roleCode,
      ...(method !== "GET" ? { "x-csrf-token": session.csrfToken } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json()) as T;
  if (typeof body === "object" && body !== null && "data" in body) {
    const data = (body as ApiEnvelope<{ csrfToken?: string }>).data;
    if (data?.csrfToken) session.csrfToken = data.csrfToken;
  }
  return { status: response.status, body };
}

/** Tạo bộ tài khoản, lớp học và tệp học liệu cục bộ độc lập cho kiểm thử tích hợp D01. */
async function createTestFixture(prisma: PrismaService, storage: ObjectStorageService): Promise<void> {
  const roleRows = await prisma.role.findMany({
    where: { code: { in: ["SYSTEM_ADMIN", "INSTRUCTOR", "LEARNER"] } },
    select: { id: true, code: true },
  });
  const roles = new Map(roleRows.map((row) => [row.code, row.id]));
  for (const code of ["SYSTEM_ADMIN", "INSTRUCTOR", "LEARNER"]) {
    if (!roles.has(code)) throw new Error(`Thiếu dữ liệu vai trò ${code} trong database test.`);
  }

  const passwordHash = await hashPassword(fixturePassword);
  const accounts = [
    { id: ids.admin, username: usernames.admin, email: `${usernames.admin}@d01.wind.local`, displayName: "D01 Admin", roleCode: "SYSTEM_ADMIN" },
    { id: ids.instructorA, username: usernames.instructorA, email: `${usernames.instructorA}@d01.wind.local`, displayName: "D01 Instructor A", roleCode: "INSTRUCTOR" },
    { id: ids.instructorB, username: usernames.instructorB, email: `${usernames.instructorB}@d01.wind.local`, displayName: "D01 Instructor B", roleCode: "INSTRUCTOR" },
    { id: ids.learnerA, username: usernames.learnerA, email: `${usernames.learnerA}@d01.wind.local`, displayName: "D01 Learner A", roleCode: "LEARNER" },
  ];

  await prisma.$transaction(
    accounts.map((account) =>
      prisma.user.create({
        data: {
          id: account.id,
          username: account.username,
          email: account.email,
          displayName: account.displayName,
          passwordHash,
          emailVerifiedAt: new Date(),
          roles: { create: { roleId: roles.get(account.roleCode)! } },
        },
      }),
    ),
  );

  const startsAt = new Date("2026-01-01T00:00:00.000Z");
  const endsAt = new Date("2027-12-31T23:59:59.000Z");
  await prisma.course.create({
    data: {
      id: ids.course,
      code: `D01-${fixtureSuffix}`,
      name: "Khóa học kiểm thử retry AI D01",
      description: "Khóa học fixture độc lập cho D01.",
      outcomes: ["Kiểm thử retry bộ ôn tập AI"],
      status: "PUBLISHED",
      ownerId: ids.admin,
    },
  });

  await prisma.$transaction([
    prisma.learningClass.create({
      data: {
        id: ids.classA,
        courseId: ids.course,
        courseVersion: 1,
        code: `D01-A-${fixtureSuffix}`,
        name: "Lớp D01 A",
        term: fixtureSuffix,
        startAt: startsAt,
        endAt: endsAt,
        capacity: 20,
        status: "ACTIVE",
      },
    }),
    prisma.learningClass.create({
      data: {
        id: ids.classB,
        courseId: ids.course,
        courseVersion: 1,
        code: `D01-B-${fixtureSuffix}`,
        name: "Lớp D01 B",
        term: fixtureSuffix,
        startAt: startsAt,
        endAt: endsAt,
        capacity: 20,
        status: "ACTIVE",
      },
    }),
  ]);

  await prisma.$transaction([
    prisma.classInstructor.create({ data: { classId: ids.classA, instructorId: ids.instructorA, role: "PRIMARY", assignedBy: ids.admin } }),
    prisma.classInstructor.create({ data: { classId: ids.classB, instructorId: ids.instructorB, role: "PRIMARY", assignedBy: ids.admin } }),
    prisma.classEnrollment.create({ data: { id: `d01-enroll-${fixtureSuffix}`, classId: ids.classA, learnerId: ids.learnerA } }),
  ]);

  const bufferV1 = Buffer.from(`%PDF-1.4\n% Wind EDU D01 material v1 (${fixtureSuffix})\n`);
  const storedV1 = await storage.put(`files/d01-${fixtureSuffix}/v1.pdf`, bufferV1);
  await prisma.material.create({
    data: {
      id: ids.material,
      classId: ids.classA,
      courseId: ids.course,
      ownerId: ids.instructorA,
      name: "D01-Study-Retry.pdf",
      objectKey: storedV1.objectKey,
      checksum: storedV1.checksum,
      mimeType: "application/pdf",
      sizeBytes: BigInt(bufferV1.length),
      folder: "D01",
      tags: ["MATERIAL"],
      visibility: "PUBLISHED",
      version: 1,
    },
  });
}

/** Ghi tệp bytes mới vào kho local và nâng số phiên bản học liệu trong PostgreSQL để kiểm thử xung đột version. */
async function replaceMaterialVersion(
  prisma: PrismaService,
  storage: ObjectStorageService,
  materialId: string,
  nextVersion: number,
): Promise<void> {
  const buffer = Buffer.from(`%PDF-1.4\n% Wind EDU D01 material v${nextVersion} (${fixtureSuffix})\n`);
  const stored = await storage.put(`files/d01-${fixtureSuffix}/v${nextVersion}.pdf`, buffer);
  await prisma.material.update({
    where: { id: materialId },
    data: {
      objectKey: stored.objectKey,
      checksum: stored.checksum,
      sizeBytes: BigInt(buffer.length),
      version: nextVersion,
    },
  });
}

/** Xóa toàn bộ dữ liệu fixture, khóa OCR trong ai_document_extractions và nhật ký kiểm toán phát sinh trong bài test. */
async function cleanupTestFixture(prisma: PrismaService, claimIds: Set<string>): Promise<void> {
  const userIds = [ids.admin, ids.instructorA, ids.instructorB, ids.learnerA];
  await prisma.aiDocumentExtraction.deleteMany({
    where: { ownerId: { in: userIds } },
  });
  for (const claimId of claimIds) {
    await deleteTestAuditLogs(prisma, { entityId: claimId, action: "AI_STUDY_RETRY_AUTHORIZED" });
  }
  await deleteTestAuditLogs(prisma, { actorId: { in: userIds } });
  await prisma.material.deleteMany({ where: { id: ids.material } });
  await prisma.learningClass.deleteMany({ where: { id: { in: [ids.classA, ids.classB] } } });
  await prisma.course.deleteMany({ where: { id: ids.course } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
