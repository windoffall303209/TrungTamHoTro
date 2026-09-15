import { describe, expect, it, vi } from "vitest";
import { OutboxDeliveryService } from "../src/infrastructure/outbox-delivery.service.js";
import type { PrismaService } from "../src/database/prisma.service.js";
import type { EmailDeliveryService } from "../src/infrastructure/email-delivery.service.js";

/** Build a deterministic worker fixture without sending real email. */
function fixture(status = "PROCESSING", attempts = 1, ageMs = 0) {
  const candidate = { id: "job", recipientId: "recipient", dedupKey: "same-key", status, attempts, availableAt: new Date(0), event: { createdAt: new Date(Date.now() - ageMs), payload: { title: "Notice" } } };
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { outboxDelivery: { findMany: vi.fn().mockResolvedValue([candidate]), updateMany }, user: { findUnique: vi.fn().mockResolvedValue({ email: "test@example.com", status: "ACTIVE" }) } };
  const email = { isConfigured: () => true, send: vi.fn().mockResolvedValue({ providerMessageId: "sent" }) };
  const service = new OutboxDeliveryService(prisma as unknown as PrismaService, email as unknown as EmailDeliveryService);
  return { service, prisma, email, candidate, updateMany };
}

describe("outbox lease recovery", () => {
  it("reclaims an expired processing job and fences completion with the claimed attempt and lease", async () => {
    const f = fixture();
    expect(await f.service.drain()).toEqual({ processed: 1, delivered: 1, failed: 0 });
    const claim = f.updateMany.mock.calls[0]![0];
    expect(claim.where).toMatchObject({ status: "PROCESSING", attempts: 1, availableAt: f.candidate.availableAt });
    expect(claim.data.availableAt.getTime()).toBeGreaterThan(Date.now());
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
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DEAD_LETTER" }) }));
    expect(f.email.send).not.toHaveBeenCalled();
  });

  it("releases the local drain lock after a database outage", async () => {
    const f = fixture("PENDING", 0);
    f.prisma.outboxDelivery.findMany.mockRejectedValueOnce(new Error("offline"));
    await expect(f.service.drain()).rejects.toThrow("offline");
    expect((await f.service.drain()).delivered).toBe(1);
  });
});
