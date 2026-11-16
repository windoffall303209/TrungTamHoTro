import { describe, expect, it, vi, type Mock } from "vitest";
import { OutboxDeliveryService } from "../../src/infrastructure/outbox-delivery.service.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../../src/infrastructure/email-delivery.service.js";

type Mutation = { where: { id: string; status: string; attempts: number; availableAt: Date }; data: { status: string; availableAt?: Date } };
type UpdateMock = Mock<(input: Mutation) => Promise<{ count: number }>>;
type Candidate = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: { title: string };
  recipientId: string;
  channel: string;
  dedupKey: string;
  status: string;
  attempts: number;
  availableAt: Date;
  createdAt: Date;
};
type Fixture = {
  service: OutboxDeliveryService;
  candidate: Candidate;
  updateMany: UpdateMock;
  prisma: {
    outboxDelivery: { findMany: Mock<() => Promise<Candidate[]>>; updateMany: UpdateMock };
    user: { findUnique: Mock };
  };
  email: { isConfigured: () => boolean; send: Mock<() => Promise<{ providerMessageId: string }>> };
};

/** Tạo dữ liệu kiểm thử worker ổn định sau khi gộp outbox_events vào outbox_deliveries. */
function fixture(status = "PROCESSING", attempts = 1, ageMs = 0): Fixture {
  const candidate: Candidate = {
    id: "job",
    eventType: "SYSTEM_ALERT_EMAIL",
    aggregateType: "CLASS",
    aggregateId: "class-1",
    payload: { title: "Notice" },
    recipientId: "recipient",
    channel: "EMAIL",
    dedupKey: "same-key",
    status,
    attempts,
    availableAt: new Date(0),
    createdAt: new Date(Date.now() - ageMs),
  };
  const updateMany = vi.fn<(input: Mutation) => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
  const prisma = {
    outboxDelivery: { findMany: vi.fn<() => Promise<Candidate[]>>().mockResolvedValue([candidate]), updateMany },
    user: { findUnique: vi.fn().mockResolvedValue({ email: "test@example.com", status: "ACTIVE" }) },
  };
  const email = {
    isConfigured: (): boolean => true,
    send: vi.fn<() => Promise<{ providerMessageId: string }>>().mockResolvedValue({ providerMessageId: "sent" }),
  };
  const service = new OutboxDeliveryService(prisma as unknown as PrismaService, email as unknown as EmailDeliveryService);
  return { service, prisma, email, candidate, updateMany };
}

describe("outbox lease recovery", () => {
  it("reclaims an expired processing job and fences completion with the claimed attempt and lease", async () => {
    const f = fixture();
    expect(await f.service.drain()).toEqual({ processed: 1, delivered: 1, failed: 0 });
    const claim = f.updateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ status: "PROCESSING", attempts: 1, availableAt: f.candidate.availableAt });
    expect(claim.data.availableAt!.getTime()).toBeGreaterThan(Date.now());
    expect(f.updateMany.mock.calls[1]![0].where).toMatchObject({ status: "PROCESSING", attempts: 2, availableAt: claim.data.availableAt });
    expect(f.email.send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "same-key" }));
  });

  it("does not send if another worker won the atomic claim", async () => {
    const f = fixture();
    f.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await f.service.drain()).processed).toBe(0);
    expect(f.email.send).not.toHaveBeenCalled();
  });

  it("does not report success when its lease was superseded", async () => {
    const f = fixture();
    f.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await f.service.drain()).delivered).toBe(0);
  });

  it.each([[8, 0], [1, 24 * 60 * 60_000]])("dead-letters unsafe retries (%i attempts, %i age)", async (attempts, age) => {
    const f = fixture("PROCESSING", attempts, age);
    expect((await f.service.drain()).failed).toBe(1);
    expect(f.updateMany.mock.calls[0]![0].data.status).toBe("DEAD_LETTER");
    expect(f.email.send).not.toHaveBeenCalled();
  });

  it("schedules exponential backoff retry on provider error", async () => {
    const f = fixture("PENDING", 0);
    f.email.send.mockRejectedValueOnce(new Error("SMTP busy"));
    expect(await f.service.drain()).toEqual({ processed: 1, delivered: 0, failed: 1 });
    const retryUpdate = f.updateMany.mock.calls[1]![0];
    expect(retryUpdate.data.status).toBe("FAILED");
    expect(retryUpdate.data.availableAt!.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("releases the local drain lock after a database outage", async () => {
    const f = fixture("PENDING", 0);
    f.prisma.outboxDelivery.findMany.mockRejectedValueOnce(new Error("offline"));
    await expect(f.service.drain()).rejects.toThrow("offline");
    expect((await f.service.drain()).delivered).toBe(1);
  });

  it("skips in-app notification emails for learners when learner email notifications are disabled", async () => {
    const f = fixture("PENDING", 0);
    f.candidate.eventType = "NOTIFICATION_CREATED";
    f.prisma.user.findUnique.mockResolvedValueOnce({
      email: "learner@wind.edu.vn",
      status: "ACTIVE",
      roles: [{ role: { code: "LEARNER" } }],
    });
    const result = await f.service.drain();
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(f.email.send).not.toHaveBeenCalled();
    const updateCall = f.updateMany.mock.calls.find((c) => c[0].data?.status === "SKIPPED");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.status).toBe("SKIPPED");
  });
});
