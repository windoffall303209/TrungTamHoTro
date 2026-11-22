import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const migrationSqlPath = resolve(
  process.cwd(),
  "prisma/migrations/20261116050000_require_material_class_and_drop_editors/migration.sql",
);

/** Trích xuất khối kiểm tra DO $$ ... $$ từ file migration thực tế để kiểm thử trên dữ liệu thật. */
function extractPreConstraintMigrationBlock(sql: string): string {
  const match = sql.match(/DO \$\$[\s\S]*?END \$\$;/);
  if (!match) throw new Error("Không tìm thấy khối DO $$ ... END $$; trong migration.");
  return match[0];
}

describe("material governance and folder integration", () => {
  let prisma: PrismaService;
  let learning: LearningService;
  const createdClassIds: string[] = [];
  const createdMaterialIds: string[] = [];
  const createdUserIds: string[] = [];
  let instructorRoleId = "";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    learning = moduleRef.get(LearningService);

    const role = await prisma.role.findUniqueOrThrow({ where: { code: "INSTRUCTOR" } });
    instructorRoleId = role.id;

    for (const [key, name] of [
      ["co", "Giảng viên Đồng phụ trách"],
      ["outsider", "Giảng viên Ngoài lớp"],
    ] as const) {
      const userId = `usr-mat-${key}-${suffix}`;
      await prisma.user.create({
        data: {
          id: userId,
          username: `mat-${key}-${suffix}`,
          email: `mat-${key}-${suffix}@wind.test`,
          displayName: name,
          status: "ACTIVE",
        },
      });
      await prisma.userRole.create({
        data: { userId, roleId: instructorRoleId },
      });
      createdUserIds.push(userId);
    }
  });

  afterAll(async () => {
    for (const materialId of createdMaterialIds) {
      await prisma.material.deleteMany({ where: { id: materialId } });
    }
    for (const classId of createdClassIds) {
      await prisma.classFolder.deleteMany({ where: { classId } });
      await prisma.classInstructor.deleteMany({ where: { classId } });
      await prisma.learningClass.deleteMany({ where: { id: classId } });
    }
    for (const userId of createdUserIds) {
      await prisma.userRole.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("enforces class_instructors (PRIMARY & CO_INSTRUCTOR) permissions and removes owner-only/admin write bypass", async () => {
    const coId = createdUserIds[0]!;
    const outsiderId = createdUserIds[1]!;

    const classA = await learning.createClass({
      courseId: "course-web",
      code: `MAT-PERM-A-${suffix}`,
      name: "Lớp kiểm quyền học liệu A",
      term: "2027-HK1",
      startAt: "2027-01-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 30,
    }, "usr-manager");
    const classB = await learning.createClass({
      courseId: "course-web",
      code: `MAT-PERM-B-${suffix}`,
      name: "Lớp kiểm quyền học liệu B",
      term: "2027-HK2",
      startAt: "2027-01-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 30,
    }, "usr-manager");
    createdClassIds.push(classA.id, classB.id);

    await learning.assignInstructor(classA.id, "usr-instructor", "PRIMARY", "usr-manager");
    await learning.assignInstructor(classA.id, coId, "CO_INSTRUCTOR", "usr-manager");
    await learning.assignInstructor(classB.id, outsiderId, "PRIMARY", "usr-manager");

    // 1. Giảng viên chính và đồng giảng viên tạo thư mục và học liệu hợp lệ trong classA
    await learning.classFolders(classA.id, "usr-instructor", { kind: "materials", name: "Chuyên đề A" }, "INSTRUCTOR");
    const mat = await learning.createMaterial(
      classA.id,
      {
        name: "Tài liệu chung lớp A.pdf",
        mimeType: "application/pdf",
        sizeBytes: 120,
        folder: "Chuyên đề A",
        tags: ["MATERIAL"],
      },
      undefined,
      "usr-instructor",
      "INSTRUCTOR",
    );
    createdMaterialIds.push(mat.id);

    // 2. Đồng giảng viên cùng lớp sửa, thay tệp và cập nhật trạng thái thành công
    const coUpdated = await learning.updateMaterial(
      mat.id,
      { name: "Tài liệu đồng phụ trách sửa.pdf", visibility: "HIDDEN" },
      coId,
      "INSTRUCTOR",
    );
    expect(coUpdated).toMatchObject({ name: "Tài liệu đồng phụ trách sửa.pdf", visibility: "HIDDEN", scope: "CLASS" });

    // 3. Người ngoài lớp, admin hệ thống và quản lý trung tâm KHÔNG có quyền tạo/sửa/xóa trên classA
    await expect(
      learning.classFolders(classA.id, outsiderId, { kind: "materials", name: "Trái phép" }, "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      learning.createMaterial(
        classA.id,
        { name: "Admin tạo.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Chuyên đề A", tags: ["MATERIAL"] },
        undefined,
        "usr-admin",
        "SYSTEM_ADMIN",
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      learning.updateMaterial(mat.id, { name: "Admin sửa" }, "usr-admin", "SYSTEM_ADMIN"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      learning.deleteMaterial(mat.id, outsiderId, "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);

    // 4. Từ chối di chuyển sang lớp đích mà giảng viên không được phân công
    await expect(
      learning.updateMaterial(mat.id, { classId: classB.id, folder: "Tài liệu chung" }, coId, "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);

    // 5. Khi người tải lên (ownerId) bị gỡ khỏi class_instructors, người đó cũng mất quyền sửa/xóa
    await prisma.classInstructor.deleteMany({ where: { classId: classA.id, instructorId: "usr-instructor" } });
    await expect(
      learning.updateMaterial(mat.id, { name: "Owner cũ sửa" }, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);
    await expect(
      learning.deleteMaterial(mat.id, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(NotFoundException);

    // 6. Đồng giảng viên còn lại vẫn có quyền xóa sạch học liệu
    await expect(learning.deleteMaterial(mat.id, coId, "INSTRUCTOR")).resolves.toBeUndefined();
  });

  it("validates class_id and strict class_folders existence & content kind across uploads and updates", async () => {
    const classA = await learning.createClass({
      courseId: "course-web",
      code: `MAT-FLD-A-${suffix}`,
      name: "Lớp kiểm thư mục A",
      term: "2027-HK3",
      startAt: "2027-01-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 25,
    }, "usr-manager");
    const classB = await learning.createClass({
      courseId: "course-web",
      code: `MAT-FLD-B-${suffix}`,
      name: "Lớp kiểm thư mục B",
      term: "2027-HK4",
      startAt: "2027-01-01T00:00:00.000Z",
      endAt: "2027-06-01T00:00:00.000Z",
      capacity: 25,
    }, "usr-manager");
    createdClassIds.push(classA.id, classB.id);
    await learning.assignInstructor(classA.id, "usr-instructor", "PRIMARY", "usr-manager");
    await learning.assignInstructor(classB.id, "usr-instructor", "PRIMARY", "usr-manager");

    await learning.classFolders(classA.id, "usr-instructor", { kind: "materials", name: "Mục Tài liệu" }, "INSTRUCTOR");
    await learning.classFolders(classA.id, "usr-instructor", { kind: "lectures", name: "Mục Bài giảng" }, "INSTRUCTOR");
    await learning.classFolders(classB.id, "usr-instructor", { kind: "materials", name: "Thư mục riêng lớp B" }, "INSTRUCTOR");

    // Thiếu class_id bị từ chối
    await expect(
      learning.createMaterial(null, { name: "Không lớp.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Tài liệu chung", tags: ["MATERIAL"] }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);

    // Thư mục chưa tồn tại bị từ chối
    await expect(
      learning.createMaterial(classA.id, { name: "Sai thư mục.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Chưa tạo", tags: ["MATERIAL"] }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);

    // Thư mục thuộc lớp khác bị từ chối
    await expect(
      learning.createMaterial(classA.id, { name: "Thư mục lớp B.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Thư mục riêng lớp B", tags: ["MATERIAL"] }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);

    // Sai loại nội dung (MATERIAL vào thư mục lectures hoặc LECTURE vào thư mục materials) bị từ chối
    await expect(
      learning.createMaterial(classA.id, { name: "Nhầm loại tài liệu.pdf", mimeType: "application/pdf", sizeBytes: 100, folder: "Mục Bài giảng", tags: ["MATERIAL"] }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);
    await expect(
      learning.createMaterial(classA.id, { name: "Nhầm loại bài giảng.mp4", mimeType: "video/mp4", sizeBytes: 100, folder: "Mục Tài liệu", tags: ["LECTURE"] }, undefined, "usr-instructor", "INSTRUCTOR"),
    ).rejects.toThrow(BadRequestException);

    // Đúng lớp, đúng thư mục, đúng loại nội dung được chấp nhận và không thể chuyển ra ngoài lớp
    const okMat = await learning.createMaterial(classA.id, {
      name: "Tài liệu đúng chỗ.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      folder: "Mục Tài liệu",
      tags: ["MATERIAL"],
    }, undefined, "usr-instructor", "INSTRUCTOR");
    createdMaterialIds.push(okMat.id);
    expect(okMat).toMatchObject({ classId: classA.id, folder: "Mục Tài liệu", scope: "CLASS" });

    // Không cho phép chuyển tệp ra khỏi lớp hoặc sang thư mục chưa đăng ký của lớp B
    await expect(learning.updateMaterial(okMat.id, { classId: null }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(learning.updateMaterial(okMat.id, { classId: classB.id, folder: "Mục Tài liệu" }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);

    // Di chuyển sang đúng thư mục của lớp B phải thành công
    const moved = await learning.updateMaterial(okMat.id, { classId: classB.id, folder: "Thư mục riêng lớp B" }, "usr-instructor", "INSTRUCTOR");
    expect(moved).toMatchObject({ classId: classB.id, folder: "Thư mục riêng lớp B", scope: "CLASS" });
  });

  it("migration script assigns uniquely determinable class_id=NULL records and halts with report when ambiguous", async () => {
    const sqlBlock = extractPreConstraintMigrationBlock(readFileSync(migrationSqlPath, "utf8"));
    const poolClient = await prisma.$transaction(async (tx) => {
      // Tạm mở ràng buộc trong giao dịch test cô lập (sẽ rollback) để kiểm chứng khối migration thực tế.
      await tx.$executeRawUnsafe(`ALTER TABLE "materials" ALTER COLUMN "class_id" DROP NOT NULL`);

      const uniqueCourseId = `crs-uniq-${suffix}`;
      const uniqueClassId = `cls-uniq-${suffix}`;
      const uniqMatId = `mat-uniq-${suffix}`;
      await tx.course.create({
        data: { id: uniqueCourseId, code: `UNIQ-${suffix}`.slice(0, 40), name: "Môn duy nhất", description: "Mô tả", outcomes: ["O1"], ownerId: "usr-manager", status: "PUBLISHED" },
      });
      await tx.learningClass.create({
        data: { id: uniqueClassId, courseId: uniqueCourseId, courseVersion: 1, code: `UNIQ-C-${suffix}`.slice(0, 40), name: "Lớp duy nhất", term: "2027", startAt: new Date("2027-01-01T00:00:00.000Z"), endAt: new Date("2027-06-01T00:00:00.000Z"), capacity: 20 },
      });
      await tx.$executeRawUnsafe(
        `INSERT INTO materials (id, class_id, course_id, owner_id, name, object_key, mime_type, size_bytes, folder, tags, scope, visibility, updated_at)
         VALUES ($1, NULL, $2, 'usr-instructor', 'Tài liệu duy nhất.pdf', $3, 'application/pdf', 100, 'Tài liệu', '[]'::jsonb, 'SHARED', 'PUBLISHED', NOW())`,
        uniqMatId,
        uniqueCourseId,
        `test/uniq/${suffix}.pdf`,
      );

      // Chạy khối migration thật: bản ghi duy nhất phải được tự gán vào uniqueClassId
      await tx.$executeRawUnsafe(sqlBlock);
      const assigned = await tx.material.findUniqueOrThrow({ where: { id: uniqMatId } });
      expect(assigned.classId).toBe(uniqueClassId);
      expect(assigned.scope).toBe("CLASS");

      // Chèn một bản ghi mơ hồ (khóa học có 0 lớp / không xác định được duy nhất) và kiểm tra migration phải DỪNG kèm báo cáo bản ghi
      const ambigCourseId = `crs-ambig-${suffix}`;
      const ambigMatId = `mat-ambig-${suffix}`;
      await tx.course.create({
        data: { id: ambigCourseId, code: `AMBIG-${suffix}`.slice(0, 40), name: "Môn mơ hồ", description: "Mô tả", outcomes: ["O1"], ownerId: "usr-manager", status: "PUBLISHED" },
      });
      await tx.$executeRawUnsafe(
        `INSERT INTO materials (id, class_id, course_id, owner_id, name, object_key, mime_type, size_bytes, folder, tags, scope, visibility, updated_at)
         VALUES ($1, NULL, $2, 'usr-instructor', 'Học liệu mơ hồ cần xử lý tay.pdf', $3, 'application/pdf', 100, 'Tài liệu', '[]'::jsonb, 'SHARED', 'PUBLISHED', NOW())`,
        ambigMatId,
        ambigCourseId,
        `test/ambig/${suffix}.pdf`,
      );

      await tx.$executeRawUnsafe(`SAVEPOINT before_ambiguous_migration`);
      let migrationError = "";
      try {
        await tx.$executeRawUnsafe(sqlBlock);
      } catch (err) {
        migrationError = err instanceof Error ? err.message : String(err);
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT before_ambiguous_migration`);
      }
      expect(migrationError).toContain("Dừng migration");
      expect(migrationError).toContain(ambigMatId);
      expect(migrationError).toContain("Học liệu mơ hồ cần xử lý tay.pdf");

      // Không tự xóa tệp / bản ghi dù migration bị dừng
      const stillExists = await tx.material.findUnique({ where: { id: ambigMatId } });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.classId).toBeNull();

      // Hoàn tác toàn bộ thay đổi giả lập trong test
      throw new Error("__ROLLBACK_TEST_TRANSACTION__");
    }).catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("__ROLLBACK_TEST_TRANSACTION__")) {
        return "rolled_back";
      }
      throw error;
    });

    expect(poolClient).toBe("rolled_back");
  });
});
