import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client.js";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../infrastructure/file-transfer.js";
import {
  id,
  MaterialSearchResult,
  now,
  UploadedMaterialFile,
} from "../learning.shared.js";
import type { LearningMaterial } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Trả một trang có giới hạn cho client dùng mảng cũ; API tìm kiếm cung cấp thêm tổng số kết quả. */
export async function listMaterials(
  serviceContext: LearningServiceContext,
  role: string,
  query?: string,
  actorId = serviceContext.userIdForRole(role),
  page = 1,
): Promise<LearningMaterial[]> {
  return (
    await serviceContext.searchAccessibleMaterials(
      { query, page, pageSize: 50 },
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
    classId?: string;
    courseId?: string;
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
    if (role === "LEARNER")
      conditions.push(
        Prisma.sql`m.visibility = 'PUBLISHED' AND m.quarantined_at IS NULL AND EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = m.class_id AND e.learner_id = ${learnerId} AND e.status = 'ACTIVE')`,
      );
    else if (role === "INSTRUCTOR")
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM class_instructors i WHERE i.class_id = m.class_id AND i.instructor_id = ${learnerId})`,
      );
    else if (!["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(role))
      conditions.push(Prisma.sql`FALSE`);
    if (input.classId)
      conditions.push(Prisma.sql`m.class_id = ${input.classId}`);
    if (input.courseId)
      conditions.push(Prisma.sql`m.course_id = ${input.courseId}`);
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
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        });
        return { rows, total: Number(counts[0]?.count ?? 0n) };
      },
      { isolationLevel: "RepeatableRead" },
    );
    const items = rows.map((row) => serviceContext.mapMaterial(row));
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
    .filter((item) => !input.classId || item.classId === input.classId)
    .filter((item) => !input.courseId || item.courseId === input.courseId)
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

/** Kiểm tra quyền lớp/chính sách tệp, quét virus, lưu object và tạo version đầu tiên. */
export async function createMaterial(
  serviceContext: LearningServiceContext,
  classId: string,
  input: Pick<
    LearningMaterial,
    "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
  >,
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
  if (prisma) {
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
    const usage = await prisma.material.aggregate({
      _sum: { sizeBytes: true },
    });
    if (
      (usage._sum.sizeBytes ?? 0n) + BigInt(input.sizeBytes) >
      BigInt(policy.storageQuotaMb) * 1_000_000n
    )
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const materialId = id("material");
    const stored = upload
      ? await serviceContext.storeUpload(
          classId,
          materialId,
          upload,
          Boolean(quarantineReason),
        )
      : {
          objectKey: `metadata/${classId}/${materialId}`,
          checksum: undefined,
        };
    try {
      return prisma.$transaction(async (transaction) => {
        const material = await transaction.material.create({
          data: {
            id: materialId,
            classId,
            courseId: classItem.courseId,
            ownerId: actorId,
            name: input.name.trim(),
            objectKey: stored.objectKey,
            checksum: stored.checksum,
            mimeType: input.mimeType,
            sizeBytes: BigInt(input.sizeBytes),
            folder: input.folder.trim(),
            tags: input.tags,
            visibility: quarantineReason ? "HIDDEN" : "DRAFT",
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
  const classItem = serviceContext.findClass(classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp học này.",
    );
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const item: LearningMaterial = {
    ...input,
    id: id("material"),
    classId,
    courseId: classItem.courseId,
    ownerId: actorId,
    version: 1,
    visibility: quarantineReason ? "HIDDEN" : "DRAFT",
    quarantinedAt: quarantineReason ? now() : undefined,
    quarantineReason,
    createdAt: now(),
  };
  if (upload) {
    const stored = await serviceContext.storeUpload(
      classId,
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

/** Cập nhật metadata/visibility của học liệu và ghi audit thay đổi. */
export async function updateMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility">>,
  actorId = "usr-instructor",
): Promise<LearningMaterial> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: { include: { instructors: true } } },
    });
    if (
      !current ||
      !current.class.instructors.some((item) => item.instructorId === actorId)
    )
      throw new NotFoundException(
        "Không tìm thấy học liệu được phép cập nhật.",
      );
    if (current.class.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    if (current.quarantinedAt && input.visibility === "PUBLISHED")
      throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.material.update({
        where: { id: materialId },
        data: {
          folder: input.folder?.trim(),
          tags: input.tags,
          visibility: input.visibility,
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
  if (
    !item ||
    !serviceContext.findClass(item.classId).instructorIds.includes(actorId)
  )
    throw new NotFoundException("Không tìm thấy học liệu được phép cập nhật.");
  if (serviceContext.findClass(item.classId).status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  if (item.quarantinedAt && input.visibility === "PUBLISHED")
    throw new BadRequestException("Không thể phát hành tệp đang bị cách ly.");
  Object.assign(item, input);
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
