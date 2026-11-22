import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import type { PrismaService } from "../../../../database/prisma.service.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

export const DEFAULT_CLASS_FOLDERS: Record<"lectures" | "materials" | "assignments", readonly string[]> = {
  lectures: ["Bài giảng chung", "Bài giảng"],
  materials: ["Tài liệu chung", "Tài liệu", "Bài tập tự luận"],
  assignments: [],
};

/** Xác định học liệu thuộc nhóm bài giảng hay tài liệu từ tag và MIME. */
export function isLectureContent(tags: readonly string[], mimeType = ""): boolean {
  return /^(audio|video)\//.test(mimeType) || tags.some((tag) => /lecture|video|bài giảng/i.test(tag));
}

/** Tạo bộ thư mục một cấp mặc định trong bảng class_folders hoặc bộ nhớ tạm khi khởi tạo lớp. */
export async function seedDefaultClassFolders(
  target:
    | { database?: PrismaService | Prisma.TransactionClient; folderRegistry?: Map<string, Set<string>> }
    | LearningServiceContext,
  classId: string,
  extraFolders: ReadonlyArray<{ kind: "lectures" | "materials" | "assignments"; name: string }> = [],
): Promise<void> {
  const entries: Array<{ classId: string; kind: "lectures" | "materials" | "assignments"; name: string }> = [
    ...DEFAULT_CLASS_FOLDERS.materials.map((name) => ({ classId, kind: "materials" as const, name })),
    ...DEFAULT_CLASS_FOLDERS.lectures.map((name) => ({ classId, kind: "lectures" as const, name })),
    ...extraFolders.map((entry) => ({ classId, kind: entry.kind, name: entry.name })),
  ];
  const db = "database" in target && typeof target.database === "function"
    ? target.database()
    : "database" in target && typeof target.database !== "function"
      ? target.database
      : undefined;
  if (db) {
    await db.classFolder.createMany({ data: entries, skipDuplicates: true });
    return;
  }
  const registry = "folderRegistry" in target ? target.folderRegistry : undefined;
  if (!registry) return;
  for (const entry of entries) {
    const key = JSON.stringify([classId, entry.kind]);
    const existing = registry.get(key) ?? new Set<string>();
    existing.add(entry.name);
    registry.set(key, existing);
  }
}

/** Đọc danh sách thư mục một cấp đã đăng ký trong class_folders cho lớp học. */
async function names(ctx: LearningServiceContext, classId: string, kind: string): Promise<string[]> {
  const db = ctx.database();
  if (db) {
    const registered = await db.classFolder.findMany({
      where: { classId, kind },
      select: { name: true },
    });
    return registered
      .map((row) => row.name)
      .sort((a, b) => a.localeCompare(b, "vi"));
  }
  const memoryEntries = ctx.folderRegistry.get(JSON.stringify([classId, kind]));
  return [...(memoryEntries ?? [])].sort((a, b) => a.localeCompare(b, "vi"));
}

/** Kiểm tra thư mục tồn tại trong đúng lớp học và khớp loại nội dung (bài giảng / tài liệu). */
export async function checkFolder(
  ctx: LearningServiceContext,
  classId: string | null | undefined,
  folder: string,
  tags: readonly string[],
  mimeType: string,
): Promise<void> {
  if (!classId || !classId.trim()) {
    throw new BadRequestException("Học liệu bắt buộc phải thuộc một lớp học.");
  }
  const trimmedFolder = folder.trim();
  if (!trimmedFolder) {
    throw new BadRequestException("Thư mục không tồn tại trong lớp học.");
  }
  const kind = isLectureContent(tags, mimeType) ? "lectures" : "materials";
  if (!(await names(ctx, classId, kind)).includes(trimmedFolder)) {
    throw new BadRequestException("Thư mục không tồn tại hoặc không thuộc loại nội dung tương ứng trong lớp học.");
  }
}

/** Kiểm tra giảng viên hiện có bản ghi phân công hợp lệ trong class_instructors của lớp hay không. */
export async function isAssignedClassInstructor(
  ctx: LearningServiceContext,
  classId: string,
  actorId: string,
): Promise<{ assigned: boolean; status?: string }> {
  const db = ctx.database();
  if (db) {
    const assignment = await db.classInstructor.findFirst({
      where: {
        classId,
        instructorId: actorId,
        role: { in: ["PRIMARY", "CO_INSTRUCTOR"] },
      },
      select: { class: { select: { status: true } } },
    });
    if (!assignment) return { assigned: false };
    return { assigned: true, status: assignment.class.status };
  }
  const cls = ctx.classes.find((item) => item.id === classId);
  if (!cls || !cls.instructorIds.includes(actorId)) return { assigned: false };
  return { assigned: true, status: cls.status };
}

/** Kiểm tra quyền đọc hoặc tạo thư mục một cấp của lớp học trong class_folders. */
export async function classFolders(
  ctx: LearningServiceContext,
  classId: string,
  actorId: string,
  input: { kind: string; name: string } | undefined,
  actorRole: string,
): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
  const db = ctx.database();
  if (input) {
    const auth = await isAssignedClassInstructor(ctx, classId, actorId);
    if (!auth.assigned) throw new NotFoundException("Không tìm thấy lớp học.");
    if (auth.status === "CLOSED") throw new ConflictException("Lớp đã lưu trữ.");
    const name = input.name.trim();
    const kind = input.kind;
    if (!Object.hasOwn(DEFAULT_CLASS_FOLDERS, kind) || !name || name.length > 255 || name === "__ALL__") {
      throw new BadRequestException("Tên hoặc loại thư mục không hợp lệ.");
    }
    if (db) {
      await db.classFolder.upsert({
        where: { classId_kind_name: { classId, kind, name } },
        create: { classId, kind, name },
        update: {},
      });
    } else {
      const key = JSON.stringify([classId, kind]);
      const entries = ctx.folderRegistry.get(key) ?? new Set<string>();
      entries.add(name);
      ctx.folderRegistry.set(key, entries);
    }
  } else if (db) {
    const canViewAll = actorRole === "SYSTEM_ADMIN" || actorRole === "CENTER_MANAGER";
    const cls = await db.learningClass.findFirst({
      where: canViewAll
        ? { id: classId }
        : {
            id: classId,
            OR: [
              { instructors: { some: { instructorId: actorId } } },
              { enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } },
            ],
          },
      select: { id: true },
    });
    if (!cls) throw new NotFoundException("Không tìm thấy lớp học.");
  } else {
    const cls = ctx.classes.find((item) => item.id === classId);
    const canViewAll = actorRole === "SYSTEM_ADMIN" || actorRole === "CENTER_MANAGER";
    if (!cls || (!canViewAll && !cls.instructorIds.includes(actorId) && !cls.learnerIds.includes(actorId))) {
      throw new NotFoundException("Không tìm thấy lớp học.");
    }
  }
  const [materials, lectures, assignments] = await Promise.all(
    ["materials", "lectures", "assignments"].map((kind) => names(ctx, classId, kind)),
  );
  return { materials: materials ?? [], lectures: lectures ?? [], assignments: assignments ?? [] };
}
