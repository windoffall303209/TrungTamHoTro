import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { deleteTestAuditLogs } from "../support/audit-maintenance.js";

describe.skipIf(!(process.env.DB_NAME ?? "").endsWith("_test"))("đóng phiếu hỗ trợ đồng thời không ghi trùng audit (D06)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let learning: LearningService;
  let reporterId: string;
  let otherUserId: string;
  const ticketId = `d06-ticket-${randomUUID()}`;

  // Tạo phiếu hỗ trợ đã ở trạng thái RESOLVED với đầy đủ resolution để kiểm thử đóng đồng thời.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, take: 2, orderBy: { id: "asc" } });
    expect(users).toHaveLength(2);
    reporterId = users[0]!.id;
    otherUserId = users[1]!.id;
    await prisma.supportTicket.create({
      data: {
        id: ticketId,
        reporterId,
        assigneeId: otherUserId,
        category: "TECHNICAL",
        severity: "P2",
        status: "RESOLVED",
        description: "Mô tả chi tiết để kiểm thử đóng phiếu nguyên tử D06.",
        resolution: "Đã xử lý triệt để sự cố.",
        dueAt: new Date(Date.now() + 86_400_000),
      },
    });
  });

  // Dọn phiếu và bản ghi audit đã tạo trong bài test.
  afterAll(async () => {
    if (prisma) {
      await deleteTestAuditLogs(prisma, { entityId: ticketId });
      await prisma.supportTicket.deleteMany({ where: { id: ticketId } });
    }
    await moduleRef?.close();
  });

  it("từ chối người không phải reporter và chỉ cho đúng một yêu cầu closeTicketByReporter thành công khi gửi song song", async () => {
    await expect(learning.closeTicketByReporter(ticketId, otherUserId)).rejects.toMatchObject({ status: 404 });

    const settled = await Promise.allSettled([
      learning.closeTicketByReporter(ticketId, reporterId),
      learning.closeTicketByReporter(ticketId, reporterId),
      learning.closeTicketByReporter(ticketId, reporterId),
      learning.closeTicketByReporter(ticketId, reporterId),
    ]);

    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ status: 409 });
    }
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("CLOSED");
    expect(await prisma.auditLog.count({ where: { entityId: ticketId, action: "SUPPORT_TICKET_CLOSED_BY_REPORTER" } })).toBe(1);
  });
});
