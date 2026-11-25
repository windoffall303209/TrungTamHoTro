import { Test, type TestingModule } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);

suite("E06 GIN pg_trgm search indexes (chat_messages & audit_logs) on PostgreSQL", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let systemService: SystemService;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    systemService = moduleRef.get(SystemService);
  });

  afterAll(async () => {
    // audit_logs có trigger append-only chống sửa/xóa, chỉ cần đóng module sau kiểm thử.
    if (moduleRef) await moduleRef.close();
  });

  it("cài đặt hợp lệ cả hai index GIN pg_trgm và hàm bất biến wind_audit_search_text trên PostgreSQL", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ name: string; valid: boolean; ready: boolean; definition: string }>
    >`
      SELECT c.relname AS name,
             i.indisvalid AS valid,
             i.indisready AS ready,
             pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('chat_messages_content_trgm_idx', 'audit_logs_search_text_trgm_idx')
      ORDER BY c.relname ASC
    `;

    expect(indexes).toHaveLength(2);
    expect(indexes[0]).toMatchObject({
      name: "audit_logs_search_text_trgm_idx",
      valid: true,
      ready: true,
    });
    expect(indexes[0]?.definition).toContain("wind_audit_search_text");
    expect(indexes[1]).toMatchObject({
      name: "chat_messages_content_trgm_idx",
      valid: true,
      ready: true,
    });
    expect(indexes[1]?.definition).toContain("gin_trgm_ops");

    const fnRows = await prisma.$queryRaw<Array<{ provolatile: string }>>`
      SELECT p.provolatile::text AS provolatile
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'wind_audit_search_text'
    `;
    expect(fnRows[0]?.provolatile).toBe("i");
  });

  it("listAuditPage dùng prefilter GIN giữ nguyên kết quả chính xác và chặn khớp chéo ranh giới trường", async () => {
    const token = `e06audit${suffix}`;
    const row1 = await prisma.auditLog.create({
      data: {
        actorId: null,
        action: `ACTION_${token}`,
        entityType: "CLASS",
        entityId: `cls-${suffix}`,
        context: { reason: `ghi chú ${token}` },
      },
    });
    const row2 = await prisma.auditLog.create({
      data: {
        actorId: null,
        action: "OTHER_ACTION",
        entityType: "SYSTEM",
        entityId: `ent-other-${suffix}`,
        context: { note: "không khớp" },
      },
    });

    const byQuery = await systemService.listAuditPage({ query: token, page: 1, pageSize: 20 });
    expect(byQuery.items.map((item) => item.id)).toContain(String(row1.id));
    expect(byQuery.items.map((item) => item.id)).not.toContain(String(row2.id));

    const byAction = await systemService.listAuditPage({ action: `ACTION_${token}`, page: 1, pageSize: 20 });
    expect(byAction.items.map((item) => item.id)).toContain(String(row1.id));

    // Khớp chéo ranh giới trường qua ký tự xuống dòng trong wind_audit_search_text phải bị điều kiện OR từng trường loại bỏ.
    const crossField = await systemService.listAuditPage({
      query: `system\nACTION_${token}`,
      page: 1,
      pageSize: 20,
    });
    expect(crossField.items.map((item) => item.id)).not.toContain(String(row1.id));
  });
});
