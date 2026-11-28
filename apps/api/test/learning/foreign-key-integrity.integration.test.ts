import { Test, type TestingModule } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";

const enabled = (process.env.DB_NAME ?? "").endsWith("_test");
const suite = describe.skipIf(!enabled);

suite("Khóa ngoại toàn vẹn cho các cột tham chiếu người dùng/lớp", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  // Kiểm trực tiếp catalog PostgreSQL vì ràng buộc nằm ở database, không ở tầng ứng dụng.
  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  // Đóng kết nối Nest/Prisma sau khi kiểm tra.
  afterAll(async () => {
    await moduleRef.close();
  });

  it("có FK với hành vi xóa đúng và không còn default cứng usr-manager", async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string; action: string }>>`
      SELECT conname AS name, confdeltype::text AS action FROM pg_constraint
      WHERE contype = 'f' AND conname IN (
        'progress_interventions_class_id_fkey', 'progress_interventions_learner_id_fkey', 'progress_interventions_owner_id_fkey',
        'progress_interventions_created_by_id_fkey', 'chat_message_mentions_mentioned_user_id_fkey',
        'regrade_requests_assigned_to_id_fkey', 'regrade_requests_resolved_by_id_fkey',
        'assignments_closed_by_id_fkey', 'class_instructors_assigned_by_fkey')`;
    const actions = Object.fromEntries(rows.map((row) => [row.name, row.action]));
    // c = CASCADE, r = RESTRICT, n = SET NULL
    expect(actions).toEqual({
      progress_interventions_class_id_fkey: "c",
      progress_interventions_learner_id_fkey: "r",
      progress_interventions_owner_id_fkey: "r",
      progress_interventions_created_by_id_fkey: "r",
      chat_message_mentions_mentioned_user_id_fkey: "c",
      regrade_requests_assigned_to_id_fkey: "n",
      regrade_requests_resolved_by_id_fkey: "n",
      assignments_closed_by_id_fkey: "n",
      class_instructors_assigned_by_fkey: "n",
    });
    const [column] = await prisma.$queryRaw<Array<{ fallback: string | null; nullable: string }>>`
      SELECT column_default AS fallback, is_nullable AS nullable FROM information_schema.columns
      WHERE table_name = 'class_instructors' AND column_name = 'assigned_by'`;
    expect(column).toEqual({ fallback: null, nullable: "YES" });
  });
});
