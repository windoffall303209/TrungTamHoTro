import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);

suite("Business concurrency on dedicated test database", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let system: SystemService;
  let objectStorage: ObjectStorageService;
  const classId = `class-race-${process.pid}-${Date.now()}`;
  const notificationId = `notification-outbox-${process.pid}-${Date.now()}`;
  const ticketRequestId = randomUUID();
  let exportJobId: string | undefined;

  // Khởi tạo service thật trên database có hậu tố _test và tạo lớp sức chứa một chỗ.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    system = moduleRef.get(SystemService);
    objectStorage = moduleRef.get(ObjectStorageService);
    const course = await prisma.course.findFirstOrThrow({ where: { status: "PUBLISHED" } });
    await prisma.learningClass.create({
      data: {
        id: classId,
        courseId: course.id,
        courseVersion: course.version,
        code: `RACE-${Date.now()}`,
        name: "Kiểm thử tranh chỗ cuối",
        term: "TEST",
        startAt: new Date(Date.now() + 3_600_000),
        endAt: new Date(Date.now() + 86_400_000),
        capacity: 1,
        timezone: "Asia/Bangkok",
        status: "ACTIVE",
      },
    });
  });

  // Dọn đúng lớp test và các bản ghi cascade, không tác động dữ liệu seed khác.
  afterAll(async () => {
    if (exportJobId) {
      const exportJob = await prisma.dataExportJob.findUnique({ where: { id: exportJobId } });
      if (exportJob?.objectKey) await objectStorage.remove(exportJob.objectKey);
      await prisma.dataExportJob.deleteMany({ where: { id: exportJobId } });
    }
    await prisma.notification.deleteMany({ where: { entityType: "CLASS", entityId: classId } });
    await prisma.notification.deleteMany({ where: { id: notificationId } });
    await prisma.outboxEvent.deleteMany({ where: { id: `notification:${notificationId}` } });
    await prisma.supportTicket.deleteMany({ where: { clientRequestId: ticketRequestId } });
    await prisma.learningClass.deleteMany({ where: { id: classId } });
    await moduleRef.close();
  });

  // Hai transaction đồng thời chỉ được cấp đúng một chỗ cuối sau khóa hàng FOR UPDATE.
  it("không vượt sức chứa khi hai học viên ghi danh đồng thời", async () => {
    const learners = await prisma.user.findMany({
      where: { status: "ACTIVE", roles: { some: { role: { code: "LEARNER" } } } },
      select: { id: true },
      take: 2,
      orderBy: { id: "asc" },
    });
    expect(learners).toHaveLength(2);
    const results = await Promise.allSettled(learners.map((learner) => learning.enrollLearner(classId, learner.id, "usr-admin")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.classEnrollment.count({ where: { classId, status: "ACTIVE" } })).toBe(1);
  });

  // Trigger ghi event và delivery cùng transaction với notification để worker có thể retry độc lập.
  it("tạo outbox delivery đúng một lần cho notification đã commit", async () => {
    const recipient = await prisma.user.findFirstOrThrow({ where: { status: "ACTIVE" }, select: { id: true } });
    await prisma.notification.create({ data: { id: notificationId, recipientId: recipient.id, type: "TEST_OUTBOX", title: "Kiểm tra outbox", entityType: "SYSTEM", entityId: notificationId, dedupKey: notificationId } });
    const event = await prisma.outboxEvent.findUnique({ where: { id: `notification:${notificationId}` }, include: { deliveries: true } });
    expect(event?.deliveries).toHaveLength(1);
    expect(event?.deliveries[0]).toMatchObject({ recipientId: recipient.id, channel: "EMAIL", status: "PENDING", attempts: 0 });
  });

  // Hai request đồng thời với cùng khóa chỉ tạo và trả về một phiếu hỗ trợ.
  it("chống tạo trùng phiếu khi double-click hoặc retry sau timeout", async () => {
    const input = {
      clientRequestId: ticketRequestId,
      category: "TECHNICAL",
      severity: "P2" as const,
      description: "Kiểm thử idempotency khi phản hồi mạng bị gián đoạn",
      contextId: classId,
    };
    const [first, second] = await Promise.all([
      learning.createTicket(input, "usr-learner"),
      learning.createTicket(input, "usr-learner"),
    ]);
    expect(second.id).toBe(first.id);
    expect(await prisma.supportTicket.count({ where: { reporterId: "usr-learner", clientRequestId: ticketRequestId } })).toBe(1);
  });

  // Xác minh export được enqueue, worker claim đúng một lần và chỉ hoàn tất sau khi checksum object khớp.
  it("xử lý export bằng hàng đợi vận hành bền vững", async () => {
    const queued = await system.runExport("USERS", "JSON", "usr-admin");
    exportJobId = queued.id;
    expect(queued).toMatchObject({ status: "PENDING", attempts: 0, progress: 0 });

    await system.drainOperationalJobs();
    const completed = await prisma.dataExportJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(completed).toMatchObject({ status: "COMPLETED", attempts: 1, progress: 100 });
    expect(completed.objectKey).toBeTruthy();
    expect(completed.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Number(completed.sizeBytes)).toBeGreaterThan(0);
  }, 15_000);
});
