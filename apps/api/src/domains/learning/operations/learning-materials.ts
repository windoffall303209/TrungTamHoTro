import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../../generated/prisma/client.js";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialSearchResult,
  now,
  UploadedMaterialFile,
} from "../learning.shared.js";
import type { LearningMaterial } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";
import { canEditMaterial } from "./learning-access.js";

/** Trả một trang có giới hạn cho client dùng mảng cũ; API tìm kiếm cung cấp thêm tổng số kết quả. */
export async function listMaterials(
  serviceContext: LearningServiceContext,
  role: string,
  query?: string,
  actorId = serviceContext.userIdForRole(role),
  page = 1,
  materialId?: string,
): Promise<LearningMaterial[]> {
  return (
    await serviceContext.searchAccessibleMaterials(
      { query, materialId, page, pageSize: 50 },
      actorId,
      role,
    )
  ).items;
}

/** Tìm học liệu đã công bố của học viên bằng bộ lọc và phân trang có giới hạn. */
export async function searchAccessibleMaterials(
  serviceContext: LearningServiceContext,
  input: {
    query?: string;
    materialId?: string;
    classId?: string;
    courseId?: string;
    scope?: string;
    visibility?: string;
    aiOnly?: boolean;
    folder?: string;
    mimeType?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  },
  learnerId = "usr-learner",
  role = "LEARNER",
): Promise<MaterialSearchResult> {
  const page =
    Number.isSafeInteger(input.page) &&
    (input.page ?? 0) > 0 &&
    (input.page ?? 0) <= 1_000_000
      ? (input.page as number)
      : 1;
  const pageSize =
    Number.isInteger(input.pageSize) && (input.pageSize ?? 0) > 0
      ? Math.min(input.pageSize as number, 50)
      : 12;
  const query = input.query?.trim();
  if (
    [
      query,
      input.tag,
      input.folder,
      input.materialId,
      input.classId,
      input.courseId,
      input.mimeType,
    ].some((value) => value && value.length > 255)
  )
    throw new BadRequestException(
      "Search filters must not exceed 255 characters.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    const conditions: Prisma.Sql[] = [];
    // Học viên xem học liệu chung của mọi lớp và học liệu riêng của lớp mình đang học.
    if (role === "LEARNER")
      conditions.push(
        Prisma.sql`m.visibility = 'PUBLISHED' AND m.quarantined_at IS NULL AND ((m.scope = 'SHARED' AND m.class_id IS NULL) OR EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = m.class_id AND e.learner_id = ${learnerId} AND e.status = 'ACTIVE'))`,
      );
    // Giảng viên xem học liệu của lớp mình dạy, học liệu mình tải lên và học liệu được cấp quyền sửa.
    else if (role === "INSTRUCTOR")
      conditions.push(
        Prisma.sql`(EXISTS (SELECT 1 FROM class_instructors i WHERE i.class_id = m.class_id AND i.instructor_id = ${learnerId}) OR m.owner_id = ${learnerId} OR EXISTS (SELECT 1 FROM material_editors me WHERE me.material_id = m.id AND me.user_id = ${learnerId}))`,
      );
    else if (!["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(role))
      conditions.push(Prisma.sql`FALSE`);
    if (input.materialId)
      conditions.push(Prisma.sql`m.id = ${input.materialId}`);
    if (input.classId)
      conditions.push(Prisma.sql`m.class_id = ${input.classId}`);
    if (input.courseId)
      conditions.push(Prisma.sql`m.course_id = ${input.courseId}`);
    if (input.scope)
      conditions.push(Prisma.sql`m.scope::text = ${input.scope}`);
    if (input.mimeType)
      conditions.push(Prisma.sql`m.mime_type = ${input.mimeType}`);
    if (input.visibility)
      conditions.push(Prisma.sql`m.visibility::text = ${input.visibility}`);
    if (input.aiOnly)
      conditions.push(
        Prisma.sql`m.mime_type IN ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png', 'image/jpeg')`,
      );
    // Thoát ký tự đặc biệt của LIKE: tìm kiếm người dùng là chuỗi con nguyên nghĩa, không phải mẫu SQL.
    const contains = (value: string): string =>
      `%${value.replace(/[\\%_]/g, "\\$&")}%`;
    if (input.folder)
      conditions.push(Prisma.sql`m.folder ILIKE ${contains(input.folder)}`);
    const tags = Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.tags) = 'array' THEN m.tags ELSE '[]'::jsonb END)`;
    if (input.tag?.trim())
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE lower(t.value) = lower(${input.tag.trim()}))`,
      );
    if (query)
      conditions.push(
        Prisma.sql`(m.name ILIKE ${contains(query)} OR m.folder ILIKE ${contains(query)} OR EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE t.value ILIKE ${contains(query)}))`,
      );
    const where = conditions.length
      ? Prisma.join(conditions, " AND ")
      : Prisma.sql`TRUE`;
    const { rows, total } = await prisma.$transaction(
      async (transaction) => {
        const ids = await transaction.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT m.id FROM materials m WHERE ${where} ORDER BY m.created_at DESC, m.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const counts = await transaction.$queryRaw<{ count: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS count FROM materials m WHERE ${where}`,
        );
        const rows = await transaction.material.findMany({
          where: { id: { in: ids.map((item) => item.id) } },
          include: { editors: { select: { userId: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        });
        return { rows, total: Number(counts[0]?.count ?? 0n) };
      },
      { isolationLevel: "RepeatableRead" },
    );
    const items = rows.map((row) => ({
      ...serviceContext.mapMaterial(row),
      editorIds: row.editors.map((item) => item.userId),
    }));
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
  const normalized = query?.toLowerCase() ?? "";
  const tag = input.tag?.trim().toLowerCase() ?? "";
  const filtered = serviceContext.materials
    .filter((item) =>
      serviceContext.canAccessMemoryMaterial(item, role, learnerId),
    )
    .filter((item) => !input.materialId || item.id === input.materialId)
    .filter((item) => !input.classId || item.classId === input.classId)
    .filter((item) => !input.courseId || item.courseId === input.courseId)
    .filter((item) => !input.scope || item.scope === input.scope)
    .filter((item) => !input.visibility || item.visibility === input.visibility)
    .filter(
      (item) =>
        !input.aiOnly ||
        [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "image/png",
          "image/jpeg",
        ].includes(item.mimeType),
    )
    .filter(
      (item) =>
        !input.folder ||
        item.folder.toLowerCase().includes(input.folder.toLowerCase()),
    )
    .filter((item) => !input.mimeType || item.mimeType === input.mimeType)
    .filter(
      (item) => !tag || item.tags.some((value) => value.toLowerCase() === tag),
    )
    .filter(
      (item) =>
        !normalized ||
        `${item.name} ${item.folder} ${item.tags.join(" ")}`
          .toLowerCase()
          .includes(normalized),
    );
  const items = filtered
    .slice((page - 1) * pageSize, page * pageSize)
    .map((item) => ({ ...item, tags: [...item.tags] }));
  return {
    items,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

/** Kiểm tra quyền lớp/chính sách tệp, quét virus, lưu object và tạo version đầu tiên; classId rỗng là học liệu dùng chung theo môn. */
export async function createMaterial(
  serviceContext: LearningServiceContext,
  classId: string | null,
  input: Pick<
    LearningMaterial,
    "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
  > & { scope?: LearningMaterial["scope"]; courseId?: string },
  upload?: UploadedMaterialFile,
  actorId = "usr-instructor",
): Promise<LearningMaterial> {
  const prisma = serviceContext.database();
  const policy = prisma
    ? await serviceContext.getStoragePolicy(prisma)
    : {
        maxFileSizeMb: 50,
        storageQuotaMb: 10_240,
        allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
      };
  if (input.sizeBytes > policy.maxFileSizeMb * 1_000_000)
    throw new BadRequestException(
      `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
    );
  if (!policy.allowedMimeTypes.includes(input.mimeType))
    throw new BadRequestException(
      "Loại MIME không được chính sách lưu trữ cho phép.",
    );
  const quarantineReason = upload
    ? await serviceContext.scanUpload(upload)
    : undefined;
  // Học liệu theo môn luôn dùng chung; học liệu trong lớp do giảng viên của lớp chọn phạm vi.
  const scope = classId ? input.scope ?? "SHARED" : "SHARED";
  if (!classId && !input.courseId && prisma) {
    const firstCourse = await prisma.course.findFirst({ select: { id: true } });
    if (firstCourse) input.courseId = firstCourse.id;
  }
  if (!classId && !input.courseId)
    throw new BadRequestException("Cần chọn môn học cho học liệu dùng chung.");
  if (prisma) {
    let courseId: string;
    if (classId) {
      const classItem = await prisma.learningClass.findUnique({
        where: { id: classId },
        include: { instructors: true },
      });
      if (!classItem) throw new NotFoundException("Không tìm thấy lớp học.");
      if (!classItem.instructors.some((item) => item.instructorId === actorId))
        throw new NotFoundException(
          "Giảng viên không được phân công vào lớp học này.",
        );
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      courseId = classItem.courseId;
    } else {
      const course = await prisma.course.findUnique({
        where: { id: input.courseId },
        select: { id: true, status: true },
      });
      if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
      if (course.status === "ARCHIVED")
        throw new ConflictException(
          "Khóa học đã ngừng sử dụng nên không nhận học liệu mới.",
        );
      courseId = course.id;
    }
    const usage = await prisma.material.aggregate({
      _sum: { sizeBytes: true },
    });
    if (
      (usage._sum.sizeBytes ?? 0n) + BigInt(input.sizeBytes) >
      BigInt(policy.storageQuotaMb) * 1_000_000n
    )
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const materialId = id("material");
    const storageFolder = classId ?? `course-${courseId}`;
    const stored = upload
      ? await serviceContext.storeUpload(
          storageFolder,
          materialId,
          upload,
          Boolean(quarantineReason),
        )
      : {
          objectKey: `metadata/${storageFolder}/${materialId}`,
          checksum: undefined,
        };
    try {
      return prisma.$transaction(async (transaction) => {
        const material = await transaction.material.create({
          data: {
            id: materialId,
            classId,
            courseId,
            ownerId: actorId,
            name: input.name.trim(),
            objectKey: stored.objectKey,
            checksum: stored.checksum,
            mimeType: input.mimeType,
            sizeBytes: BigInt(input.sizeBytes),
            folder: input.folder.trim(),
            tags: input.tags,
            visibility: quarantineReason ? "HIDDEN" : "DRAFT",
            scope,
            quarantinedAt: quarantineReason ? new Date() : null,
            quarantineReason,
          },
        });
        await transaction.materialVersion.create({
          data: {
            id: id("material-version"),
            materialId,
            version: 1,
            name: material.name,
            objectKey: material.objectKey,
            mimeType: material.mimeType,
            sizeBytes: material.sizeBytes,
            checksum: material.checksum,
            folder: material.folder,
            tags: serviceContext.toStringArray(material.tags),
            visibility: material.visibility,
            createdBy: actorId,
          },
        });
        if (quarantineReason) {
          await transaction.notification.create({
            data: {
              id: id("notification"),
              recipientId: actorId,
              type: "MATERIAL_QUARANTINED",
              title: `Tệp ${input.name.trim()} đã bị cách ly`,
              entityType: "MATERIAL",
              entityId: materialId,
              dedupKey: `material-quarantine:${materialId}:${actorId}`,
            },
          });
        }
        return serviceContext.mapMaterial(material);
      });
    } catch (error) {
      if (upload) await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
  }
  const classItem = classId ? serviceContext.findClass(classId) : undefined;
  if (classItem && !classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp học này.",
    );
  if (classItem?.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const item: LearningMaterial = {
    ...input,
    id: id("material"),
    classId,
    courseId: classItem?.courseId ?? input.courseId,
    ownerId: actorId,
    version: 1,
    visibility: quarantineReason ? "HIDDEN" : "DRAFT",
    scope,
    quarantinedAt: quarantineReason ? now() : undefined,
    quarantineReason,
    createdAt: now(),
  };
  if (upload) {
    const stored = await serviceContext.storeUpload(
      classId ?? `course-${item.courseId}`,
      item.id,
      upload,
      Boolean(quarantineReason),
    );
    serviceContext.materialFiles.set(item.id, {
      objectKey: stored.objectKey,
      checksum: stored.checksum,
    });
  }
  serviceContext.materials.unshift(item);
  const storedFile = serviceContext.materialFiles.get(item.id);
  serviceContext.materialVersions.unshift({
    ...item,
    id: id("material-version"),
    materialId: item.id,
    createdBy: actorId,
    objectKey: storedFile?.objectKey,
    checksum: storedFile?.checksum,
  });
  if (quarantineReason)
    serviceContext.notifications.unshift({
      id: id("notification"),
      recipientId: actorId,
      type: "MATERIAL_QUARANTINED",
      title: `Tệp ${input.name.trim()} đã bị cách ly`,
      entityType: "MATERIAL",
      entityId: item.id,
      createdAt: now(),
    });
  return { ...item, tags: [...item.tags] };
}

/** Giảng viên tự phát hành và quản lý học liệu; tệp bị cách ly không được phát hành. */
function assertInstructorVisibility(
  material: { quarantinedAt?: Date | string | null },
  visibility?: LearningMaterial["visibility"],
): void {
  if (material.quarantinedAt && visibility && visibility !== "HIDDEN")
    throw new BadRequestException(
      "Tệp đang bị cách ly nên không thể thay đổi trạng thái.",
    );
}

/** Cập nhật metadata/visibility của học liệu và ghi audit thay đổi. */
export async function updateMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility" | "scope">> & {
    classId?: string | null;
    name?: string;
  },
  actorId = "usr-instructor",
): Promise<LearningMaterial> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: true, editors: { select: { userId: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
    if (!canEditMaterial(current, actorId))
      throw new NotFoundException("Không tìm thấy học liệu.");
    if (current.class?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (input.scope === "CLASS" && !current.classId && !input.classId)
      throw new BadRequestException(
        "Học liệu dùng chung theo môn không thuộc lớp nào nên không thể chuyển sang riêng lớp.",
      );
    assertInstructorVisibility(current, input.visibility);
    return prisma.$transaction(async (transaction) => {
      const nextScope = input.classId ? "CLASS" : input.classId === null ? "SHARED" : input.scope;
      const updated = await transaction.material.update({
        where: { id: materialId },
        data: {
          name: input.name ? input.name.trim() : undefined,
          folder: input.folder !== undefined ? input.folder?.trim() : undefined,
          classId: input.classId !== undefined ? (input.classId || null) : undefined,
          tags: input.tags,
          visibility: input.visibility,
          scope: nextScope,
          version: { increment: 1 },
        },
      });
      await transaction.materialVersion.create({
        data: {
          id: id("material-version"),
          materialId,
          version: updated.version,
          name: updated.name,
          objectKey: updated.objectKey,
          mimeType: updated.mimeType,
          sizeBytes: updated.sizeBytes,
          checksum: updated.checksum,
          folder: updated.folder,
          tags: serviceContext.toStringArray(updated.tags),
          visibility: updated.visibility,
          createdBy: actorId,
        },
      });
      return serviceContext.mapMaterial(updated);
    });
  }
  const item = serviceContext.materials.find(
    (material) => material.id === materialId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
  if (
    item.classId &&
    !serviceContext.findClass(item.classId).instructorIds.includes(actorId) &&
    !canEditMaterial(item, actorId)
  )
    throw new NotFoundException("Không tìm thấy học liệu.");
  if (!canEditMaterial(item, actorId))
    throw new ForbiddenException(
      "Chỉ người tải lên hoặc người được cấp quyền mới sửa được học liệu này.",
    );
  if (item.classId && serviceContext.findClass(item.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (input.scope === "CLASS" && !item.classId && !input.classId)
    throw new BadRequestException(
      "Học liệu dùng chung theo môn không thuộc lớp nào nên không thể chuyển sang riêng lớp.",
    );
  assertInstructorVisibility(item, input.visibility);
  if (input.classId !== undefined) {
    item.classId = input.classId || null;
    item.scope = input.classId ? "CLASS" : "SHARED";
  }
  if (input.name) item.name = input.name.trim();
  if (input.folder !== undefined) item.folder = input.folder.trim();
  if (input.tags) item.tags = input.tags;
  if (input.visibility) item.visibility = input.visibility;
  if (input.scope && input.classId === undefined) item.scope = input.scope;
  item.version += 1;
  const stored = serviceContext.materialFiles.get(materialId);
  serviceContext.materialVersions.unshift({
    ...item,
    id: id("material-version"),
    materialId,
    createdBy: actorId,
    objectKey: stored?.objectKey,
    checksum: stored?.checksum,
    tags: [...item.tags],
  });
  return { ...item, tags: [...item.tags] };
}

/** Xóa tại chỗ các phần tử khớp vì mảng bộ nhớ của service chỉ có getter. */
function removeWhere<T>(list: T[], match: (item: T) => boolean): void {
  list.splice(0, list.length, ...list.filter((item) => !match(item)));
}

/** Người tải lên xóa hẳn học liệu cùng mọi phiên bản; nhật ký hệ thống vẫn giữ dấu vết. */
export async function deleteMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  actorId: string,
): Promise<void> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: true, versions: { select: { objectKey: true } } },
    });
    if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
    if (current.ownerId !== actorId)
      throw new ForbiddenException("Chỉ người tải lên mới xóa được học liệu này.");
    if (current.class?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    await prisma.$transaction(async (transaction) => {
      if (await transaction.forumPostAttachment.count({ where: { materialId } }))
        throw new ConflictException(
          "Học liệu đang được đính kèm trong diễn đàn nên chưa thể xóa.",
        );
      await transaction.material.delete({ where: { id: materialId } });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "MATERIAL_DELETED",
          entityType: "material",
          entityId: materialId,
          context: {
            name: current.name,
            courseId: current.courseId,
            classId: current.classId,
            versions: current.versions.length,
          },
        },
      });
    });
    // Xóa tệp sau khi giao dịch thành công; lỗi kho không làm hỏng thao tác xóa.
    const keys = new Set([
      current.objectKey,
      ...current.versions.map((item) => item.objectKey),
    ]);
    await Promise.all(
      [...keys]
        .filter((key) => key.startsWith("quarantine/") || serviceContext.isMaterialObjectKey(key))
        .map((key) => serviceContext.removeStoredFile(key).catch(() => undefined)),
    );
    return;
  }
  const item = serviceContext.materials.find(
    (material) => material.id === materialId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
  if (
    item.classId &&
    !serviceContext.findClass(item.classId).instructorIds.includes(actorId) &&
    !canEditMaterial(item, actorId)
  )
    throw new NotFoundException("Không tìm thấy học liệu.");
  if (item.ownerId !== actorId)
    throw new ForbiddenException("Chỉ người tải lên mới xóa được học liệu này.");
  if (item.classId && serviceContext.findClass(item.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  removeWhere(serviceContext.materials, (material) => material.id === materialId);
  removeWhere(serviceContext.materialVersions, (version) => version.materialId === materialId);
  removeWhere(serviceContext.materialReviews, (review) => review.materialId === materialId);
  serviceContext.materialFiles.delete(materialId);
}
