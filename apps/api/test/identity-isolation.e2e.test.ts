import { ValidationPipe, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { hashPassword } from "../src/auth/password.js";
import { HttpExceptionFilter } from "../src/common/http-exception.filter.js";
import { ResponseInterceptor } from "../src/common/response.interceptor.js";
import { PrismaService } from "../src/database/prisma.service.js";

const fixtureSuffix = `${process.pid}-${Date.now().toString(36)}`;
const password = "E2e-Identity-2026!";
const ids = {
  admin: `e2e-admin-${fixtureSuffix}`,
  manager: `e2e-manager-${fixtureSuffix}`,
  instructorA: `e2e-instructor-a-${fixtureSuffix}`,
  instructorB: `e2e-instructor-b-${fixtureSuffix}`,
  learnerA: `e2e-learner-a-${fixtureSuffix}`,
  learnerB: `e2e-learner-b-${fixtureSuffix}`,
  courseA: `e2e-course-a-${fixtureSuffix}`,
  courseB: `e2e-course-b-${fixtureSuffix}`,
  classA: `e2e-class-a-${fixtureSuffix}`,
  classB: `e2e-class-b-${fixtureSuffix}`,
  materialA: `e2e-material-a-${fixtureSuffix}`,
  materialB: `e2e-material-b-${fixtureSuffix}`,
  questionA: `e2e-question-a-${fixtureSuffix}`,
  questionB: `e2e-question-b-${fixtureSuffix}`,
  examA: `e2e-exam-a-${fixtureSuffix}`,
  examB: `e2e-exam-b-${fixtureSuffix}`,
  topicA: `e2e-topic-a-${fixtureSuffix}`,
  topicB: `e2e-topic-b-${fixtureSuffix}`,
  postA: `e2e-post-a-${fixtureSuffix}`,
  postB: `e2e-post-b-${fixtureSuffix}`,
  sessionA: `e2e-session-a-${fixtureSuffix}`,
  sessionB: `e2e-session-b-${fixtureSuffix}`,
  ticketA: `e2e-ticket-a-${fixtureSuffix}`,
  ticketB: `e2e-ticket-b-${fixtureSuffix}`,
};

const userIds = [ids.admin, ids.manager, ids.instructorA, ids.instructorB, ids.learnerA, ids.learnerB];
const classIds = [ids.classA, ids.classB];
const courseIds = [ids.courseA, ids.courseB];
const ticketIds = [ids.ticketA, ids.ticketB];
const usernames = {
  admin: `adm-${fixtureSuffix}`,
  manager: `mgr-${fixtureSuffix}`,
  instructorA: `ina-${fixtureSuffix}`,
  instructorB: `inb-${fixtureSuffix}`,
  learnerA: `lra-${fixtureSuffix}`,
  learnerB: `lrb-${fixtureSuffix}`,
};

interface ApiEnvelope<T> { data: T }
interface ApiError { error: { code: string; message: string } }
interface ApiItem { id: string }

describe("Cô lập danh tính qua API và PostgreSQL", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const cookies = new Map<string, string>();
  const csrfTokens = new Map<string, string>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await createFixture(prisma);

    for (const account of ["admin", "manager", "instructorA", "instructorB", "learnerA", "learnerB"] as const) {
      const session = await login(usernames[account]);
      cookies.set(account, session.cookie);
      csrfTokens.set(session.cookie, session.csrfToken);
    }
  }, 30_000);

  afterAll(async () => {
    if (prisma) await cleanupFixture(prisma);
    if (app) await app.close();
  }, 30_000);

  it("yêu cầu đăng nhập và nhận đủ bốn vai trò từ phiên thật", async () => {
    expect((await request("", "/classes")).status).toBe(401);

    const expectedRoles = {
      admin: "SYSTEM_ADMIN",
      manager: "CENTER_MANAGER",
      instructorA: "INSTRUCTOR",
      learnerA: "LEARNER",
    } as const;
    for (const [account, roleCode] of Object.entries(expectedRoles)) {
      const response = await request(cookies.get(account) ?? "", "/auth/session");
      expect(response.status).toBe(200);
      expect((response.body as ApiEnvelope<{ roleCode: string }>).data.roleCode).toBe(roleCode);
    }
  });

  it("cô lập danh sách lớp, học liệu, đề, diễn đàn và lớp online giữa hai giảng viên", async () => {
    const paths = ["/classes", "/materials", "/exams", "/forum/topics", "/sessions"];
    for (const path of paths) {
      const listA = await idsFrom(path, cookies.get("instructorA") ?? "");
      const listB = await idsFrom(path, cookies.get("instructorB") ?? "");
      expect(listA).toContain(domainId(path, "A"));
      expect(listA).not.toContain(domainId(path, "B"));
      expect(listB).toContain(domainId(path, "B"));
      expect(listB).not.toContain(domainId(path, "A"));
    }
  });

  it("phân trang tài khoản tại server và từ chối tham số vượt giới hạn", async () => {
    const cookie = cookies.get("admin") ?? "";
    const response = await request(cookie, `/admin/users?pageSize=2&query=${fixtureSuffix.toUpperCase()}`);
    expect(response.status).toBe(200);
    const data = (response.body as ApiEnvelope<{ items: ApiItem[]; total: number }>).data;
    expect(data.items).toHaveLength(2);
    expect(data.total).toBe(6);
    const next = await request(cookie, `/admin/users?page=2&pageSize=2&query=${fixtureSuffix}`);
    const nextItems = (next.body as ApiEnvelope<{ items: ApiItem[] }>).data.items;
    expect(nextItems.some((item) => data.items.some((first) => first.id === item.id))).toBe(false);
    for (const query of ["page=0", "page=1.5", "pageSize=51", "pageSize=abc", `query=${"a".repeat(201)}`]) {
      expect((await request(cookie, `/admin/users?${query}`)).status).toBe(400);
    }
  });

  it("cô lập toàn bộ không gian học tập giữa hai học viên", async () => {
    const paths = ["/classes", "/materials", "/exams", "/forum/topics", "/sessions"];
    for (const path of paths) {
      const listA = await idsFrom(path, cookies.get("learnerA") ?? "");
      const listB = await idsFrom(path, cookies.get("learnerB") ?? "");
      expect(listA).toContain(domainId(path, "A"));
      expect(listA).not.toContain(domainId(path, "B"));
      expect(listB).toContain(domainId(path, "B"));
      expect(listB).not.toContain(domainId(path, "A"));
    }
  });

  it("chặn truy cập chéo theo từng tài nguyên, không chỉ ẩn ở danh sách", async () => {
    const learnerB = cookies.get("learnerB") ?? "";
    const instructorB = cookies.get("instructorB") ?? "";
    const forbiddenRequests: Array<Promise<{ status: number; body: unknown }>> = [
      request(learnerB, `/materials/${ids.materialA}/access?action=PREVIEW`),
      request(learnerB, `/learner/exams/${ids.examA}/questions`),
      request(learnerB, `/forum/topics/${ids.topicA}/posts`),
      request(learnerB, `/learner/sessions/${ids.sessionA}/summary`),
      request(learnerB, `/support/tickets/${ids.ticketA}/comments`),
      request(instructorB, `/instructor/materials/${ids.materialA}`, { method: "PATCH", body: { folder: "Không hợp lệ" } }),
      request(instructorB, `/instructor/forum/topics/${ids.topicA}`, { method: "PATCH", body: { isPinned: true, reason: "Kiểm thử truy cập chéo" } }),
      request(instructorB, `/instructor/sessions/${ids.sessionA}/status`, { method: "PATCH", body: { status: "LIVE" } }),
    ];

    for (const response of await Promise.all(forbiddenRequests)) {
      expect(response.status).toBe(404);
      expect((response.body as ApiError).error.code).toBe("HTTP_404");
    }
  });

  it("cho quản lý nhìn toàn bộ lớp và quản trị viên xử lý toàn bộ phiếu hỗ trợ", async () => {
    const managerClasses = await idsFrom("/classes", cookies.get("manager") ?? "");
    expect(managerClasses).toEqual(expect.arrayContaining(classIds));

    const learnerATickets = await idsFrom("/support/tickets", cookies.get("learnerA") ?? "");
    const learnerBTickets = await idsFrom("/support/tickets", cookies.get("learnerB") ?? "");
    const adminTickets = await idsFrom("/support/tickets", cookies.get("admin") ?? "");
    expect(learnerATickets).toContain(ids.ticketA);
    expect(learnerATickets).not.toContain(ids.ticketB);
    expect(learnerBTickets).toContain(ids.ticketB);
    expect(learnerBTickets).not.toContain(ids.ticketA);
    expect(adminTickets).toEqual(expect.arrayContaining(ticketIds));
  });

  /** Đăng nhập tài khoản kiểm thử và xác nhận cookie cùng mã CSRF hợp lệ. */
  async function login(username: string): Promise<{ cookie: string; csrfToken: string }> {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, rememberMe: false }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const body = await response.json() as ApiEnvelope<{ csrfToken: string }>;
    expect(body.data.csrfToken).toBeTruthy();
    return { cookie: cookie ?? "", csrfToken: body.data.csrfToken };
  }

  /** Gửi yêu cầu HTTP tới máy chủ kiểm thử và thu nhận trạng thái cùng phản hồi. */
  async function request(cookie: string, path: string, options: { method?: string; body?: object } = {}): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(cookie && options.method && options.method !== "GET" ? { "x-csrf-token": csrfTokens.get(cookie) ?? "" } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json() as unknown;
    if (cookie && typeof body === "object" && body !== null && "data" in body) {
      const data = (body as ApiEnvelope<{ csrfToken?: string }>).data;
      if (data?.csrfToken) csrfTokens.set(cookie, data.csrfToken);
    }
    return { status: response.status, body };
  }

  /** Lấy danh sách mã đối tượng từ API và xác nhận yêu cầu thành công. */
  async function idsFrom(path: string, cookie: string): Promise<string[]> {
    const response = await request(cookie, path);
    expect(response.status).toBe(200);
    return (response.body as ApiEnvelope<ApiItem[]>).data.map((item) => item.id);
  }
});

/** Chọn mã đối tượng thuộc một trong hai nhóm dữ liệu dùng kiểm tra cách ly. */
function domainId(path: string, side: "A" | "B"): string {
  const suffix = side === "A" ? "A" : "B";
  if (path === "/classes") return ids[`class${suffix}`];
  if (path === "/materials") return ids[`material${suffix}`];
  if (path === "/exams") return ids[`exam${suffix}`];
  if (path === "/forum/topics") return ids[`topic${suffix}`];
  return ids[`session${suffix}`];
}

/** Tạo tài khoản, khóa học và dữ liệu liên quan riêng cho kiểm thử cách ly người dùng. */
async function createFixture(prisma: PrismaService): Promise<void> {
  const roleRows = await prisma.role.findMany({
    where: { code: { in: ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"] } },
    select: { id: true, code: true },
  });
  const roles = new Map(roleRows.map((role) => [role.code, role.id]));
  for (const code of ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"]) {
    if (!roles.has(code)) throw new Error(`Thiếu dữ liệu nền cho vai trò ${code}. Hãy chạy pnpm db:seed.`);
  }

  const passwordHash = await hashPassword(password);
  const accounts = [
    { id: ids.admin, username: usernames.admin, email: `admin-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Admin", roleCode: "SYSTEM_ADMIN" },
    { id: ids.manager, username: usernames.manager, email: `manager-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Manager", roleCode: "CENTER_MANAGER" },
    { id: ids.instructorA, username: usernames.instructorA, email: `instructora-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Instructor A", roleCode: "INSTRUCTOR" },
    { id: ids.instructorB, username: usernames.instructorB, email: `instructorb-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Instructor B", roleCode: "INSTRUCTOR" },
    { id: ids.learnerA, username: usernames.learnerA, email: `learnera-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Learner A", roleCode: "LEARNER" },
    { id: ids.learnerB, username: usernames.learnerB, email: `learnerb-${fixtureSuffix}@e2e.wind.local`, displayName: "E2E Learner B", roleCode: "LEARNER" },
  ];

  await prisma.$transaction(accounts.map((account) => prisma.user.create({
    data: {
      id: account.id,
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      passwordHash,
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: roles.get(account.roleCode) as string } },
    },
  })));

  const startsAt = new Date("2026-08-01T01:00:00.000Z");
  const endsAt = new Date("2026-12-31T10:00:00.000Z");
  await prisma.$transaction([
    prisma.course.create({ data: { id: ids.courseA, code: `E2E-A-${fixtureSuffix}`, name: "E2E Course A", description: "Khóa học kiểm thử phân quyền phía A.", outcomes: ["Kiểm thử A"], status: "PUBLISHED", ownerId: ids.manager } }),
    prisma.course.create({ data: { id: ids.courseB, code: `E2E-B-${fixtureSuffix}`, name: "E2E Course B", description: "Khóa học kiểm thử phân quyền phía B.", outcomes: ["Kiểm thử B"], status: "PUBLISHED", ownerId: ids.manager } }),
  ]);
  await prisma.$transaction([
    prisma.learningClass.create({ data: { id: ids.classA, courseId: ids.courseA, courseVersion: 1, code: `E2E-CLASS-A-${fixtureSuffix}`, name: "E2E Class A", term: fixtureSuffix, startAt: startsAt, endAt: endsAt, capacity: 10, status: "ACTIVE" } }),
    prisma.learningClass.create({ data: { id: ids.classB, courseId: ids.courseB, courseVersion: 1, code: `E2E-CLASS-B-${fixtureSuffix}`, name: "E2E Class B", term: fixtureSuffix, startAt: startsAt, endAt: endsAt, capacity: 10, status: "ACTIVE" } }),
  ]);
  await prisma.$transaction([
    prisma.classInstructor.create({ data: { classId: ids.classA, instructorId: ids.instructorA, role: "PRIMARY", assignedBy: ids.manager } }),
    prisma.classInstructor.create({ data: { classId: ids.classB, instructorId: ids.instructorB, role: "PRIMARY", assignedBy: ids.manager } }),
    prisma.classEnrollment.create({ data: { id: `e2e-enrollment-a-${fixtureSuffix}`, classId: ids.classA, learnerId: ids.learnerA } }),
    prisma.classEnrollment.create({ data: { id: `e2e-enrollment-b-${fixtureSuffix}`, classId: ids.classB, learnerId: ids.learnerB } }),
  ]);
  await prisma.$transaction([
    prisma.material.create({ data: { id: ids.materialA, classId: ids.classA, courseId: ids.courseA, ownerId: ids.instructorA, name: "Tài liệu E2E A.pdf", objectKey: `e2e/${fixtureSuffix}/a.pdf`, mimeType: "application/pdf", sizeBytes: 128n, folder: "E2E", tags: ["e2e", "a"], visibility: "PUBLISHED" } }),
    prisma.material.create({ data: { id: ids.materialB, classId: ids.classB, courseId: ids.courseB, ownerId: ids.instructorB, name: "Tài liệu E2E B.pdf", objectKey: `e2e/${fixtureSuffix}/b.pdf`, mimeType: "application/pdf", sizeBytes: 128n, folder: "E2E", tags: ["e2e", "b"], visibility: "PUBLISHED" } }),
    prisma.question.create({ data: { id: ids.questionA, courseId: ids.courseA, authorId: ids.instructorA, type: "TRUE_FALSE", content: "Câu hỏi kiểm thử phía A?", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["e2e"], status: "PUBLISHED", familyId: ids.questionA, contentHash: `hash-a-${fixtureSuffix}` } }),
    prisma.question.create({ data: { id: ids.questionB, courseId: ids.courseB, authorId: ids.instructorB, type: "TRUE_FALSE", content: "Câu hỏi kiểm thử phía B?", options: ["Đúng", "Sai"], correctAnswers: ["Đúng"], difficulty: 1, tags: ["e2e"], status: "PUBLISHED", familyId: ids.questionB, contentHash: `hash-b-${fixtureSuffix}` } }),
  ]);
  await prisma.$transaction([
    prisma.exam.create({ data: { id: ids.examA, classId: ids.classA, title: "Đề E2E A", durationMinutes: 30, totalScore: 10, openAt: startsAt, closeAt: endsAt, status: "PUBLISHED", questions: { create: { questionId: ids.questionA, position: 1, score: 10 } } } }),
    prisma.exam.create({ data: { id: ids.examB, classId: ids.classB, title: "Đề E2E B", durationMinutes: 30, totalScore: 10, openAt: startsAt, closeAt: endsAt, status: "PUBLISHED", questions: { create: { questionId: ids.questionB, position: 1, score: 10 } } } }),
    prisma.forumTopic.create({ data: { id: ids.topicA, classId: ids.classA, authorId: ids.instructorA, title: "Chủ đề E2E A", body: "Nội dung kiểm thử A", tags: ["e2e"], posts: { create: { id: ids.postA, authorId: ids.learnerA, body: "Phản hồi E2E A" } } } }),
    prisma.forumTopic.create({ data: { id: ids.topicB, classId: ids.classB, authorId: ids.instructorB, title: "Chủ đề E2E B", body: "Nội dung kiểm thử B", tags: ["e2e"], posts: { create: { id: ids.postB, authorId: ids.learnerB, body: "Phản hồi E2E B" } } } }),
  ]);
  await prisma.$transaction([
    prisma.liveSession.create({ data: { id: ids.sessionA, classId: ids.classA, hostId: ids.instructorA, title: "Phiên E2E A", startsAt, endsAt, provider: "JITSI", requestedProvider: "JITSI", hostUrl: `https://meet.local/${ids.sessionA}/host`, attendeeUrl: `https://meet.local/${ids.sessionA}` } }),
    prisma.liveSession.create({ data: { id: ids.sessionB, classId: ids.classB, hostId: ids.instructorB, title: "Phiên E2E B", startsAt, endsAt, provider: "JITSI", requestedProvider: "JITSI", hostUrl: `https://meet.local/${ids.sessionB}/host`, attendeeUrl: `https://meet.local/${ids.sessionB}` } }),
    prisma.supportTicket.create({ data: { id: ids.ticketA, reporterId: ids.learnerA, category: "E2E", severity: "P2", description: "Phiếu hỗ trợ kiểm thử danh tính phía A.", dueAt: endsAt } }),
    prisma.supportTicket.create({ data: { id: ids.ticketB, reporterId: ids.learnerB, category: "E2E", severity: "P2", description: "Phiếu hỗ trợ kiểm thử danh tính phía B.", dueAt: endsAt } }),
  ]);
}

/** Xóa đúng dữ liệu của bộ kiểm thử theo thứ tự quan hệ, giữ nguyên dữ liệu có sẵn. */
async function cleanupFixture(prisma: PrismaService): Promise<void> {
  await prisma.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
  await prisma.learningClass.deleteMany({ where: { id: { in: classIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
