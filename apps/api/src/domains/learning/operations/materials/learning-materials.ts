import { checkFolder, isLectureContent } from "./class-folders.js";
import { visibleMaterialTags } from "./material-visible-tags.js";
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialSearchResult,
  MaterialSummaryBucket,
  now,
  UploadedMaterialFile,
} from "../../core/learning.shared.js";
import type { LearningMaterial } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { canEditMaterial } from "../access/learning-access.js";
import { readWithoutTransaction } from "../../../../database/read-without-transaction.js";

const AI_SEARCH_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
]);

const LECTURE_LINK_MIME = "text/uri-list";
const YOUTUBE_LECTURE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const FACEBOOK_LECTURE_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"]);

/** Xác thực URL bài giảng và metadata trên server để ngăn liên kết giả mạo hoặc nguy hiểm. */
function validateLectureLinkTags(tags: readonly string[], requireLink = false): string | undefined {
  const matches = tags.filter((tag) => tag.startsWith("lecture-url:"));
  if (matches.length > 1 || (requireLink && matches.length !== 1)) throw new BadRequestException("Bài giảng cần đúng một liên kết hợp lệ.");
  if (!matches.length) return undefined;
  if (!tags.includes("LECTURE")) throw new BadRequestException("Liên kết phải được gắn loại bài giảng.");
  const source = matches[0]!.slice("lecture-url:".length);
  if (source.length > 2048 || source.length < 12 || source !== source.trim()) throw new BadRequestException("Đường dẫn bài giảng không hợp lệ.");
  let url: URL;
  try { url = new URL(source); } catch { throw new BadRequestException("Đường dẫn bài giảng không hợp lệ."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new BadRequestException("Liên kết bài giảng phải dùng HTTPS và không chứa thông tin đăng nhập.");
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_LECTURE_HOSTS.has(host)) {
    const videoId = host === "youtu.be" ? url.pathname.split("/")[1] : url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:embed|shorts|live|v)\//.test(url.pathname) ? url.pathname.split("/")[2] : null;
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new BadRequestException("Liên kết YouTube phải chứa mã video hợp lệ.");
  } else if (!((FACEBOOK_LECTURE_HOSTS.has(host) || host === "drive.google.com") && url.pathname !== "/")) {
    throw new BadRequestException("Chỉ hỗ trợ liên kết YouTube, Facebook hoặc Google Drive.");
  }
  return source;
}

/** Xây dựng biểu thức SQL kiểm tra quyền xem học liệu theo vai trò trong bảng materials. */
function buildMaterialRoleCondition(role: string, actorId: string): Prisma.Sql {
  if (role === "LEARNER") {
    return Prisma.sql`m.visibility = 'PUBLISHED' AND m.quarantined_at IS NULL AND EXISTS (SELECT 1 FROM class_enrollments e WHERE e.class_id = m.class_id AND e.learner_id = ${actorId} AND e.status = 'ACTIVE')`;
  }
  if (role === "INSTRUCTOR") {
    return Prisma.sql`EXISTS (SELECT 1 FROM class_instructors i WHERE i.class_id = m.class_id AND i.instructor_id = ${actorId} AND i.role IN ('PRIMARY', 'CO_INSTRUCTOR'))`;
  }
  if (["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(role)) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`FALSE`;
}

/** Tạo subquery tách từng phần tử chuỗi trong cột JSONB tags của bảng materials. */
function buildMaterialTagsSql(): Prisma.Sql {
  return Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(m.tags) = 'array' THEN m.tags ELSE '[]'::jsonb END)`;
}

/** Tạo biểu thức SQL phân biệt bài giảng (video/audio/tag bài giảng) với tài liệu thường. */
function buildMaterialLectureSql(tags = buildMaterialTagsSql()): Prisma.Sql {
  return Prisma.sql`(m.mime_type LIKE 'video/%' OR m.mime_type LIKE 'audio/%' OR EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE t.value ~* '(lecture|video|bài giảng)'))`;
}

/** Trả một trang có giới hạn cho client dùng mảng cũ; API tìm kiếm cung cấp thêm tổng số kết quả. */
export async function listMaterials(
  serviceContext: LearningServiceContext,
  role: string,
  query: string | undefined,
  actorId: string,
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

/** Tổng hợp nhanh số lượng học liệu theo lớp, thư mục và loại nội dung trực tiếp bằng GROUP BY SQL. */
export async function getMaterialSummary(
  serviceContext: LearningServiceContext,
  actorId: string,
  role: string,
  classId?: string,
): Promise<MaterialSummaryBucket[]> {
  if (classId && classId.length > 255) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const prisma = serviceContext.database();
  if (prisma) {
    const tags = buildMaterialTagsSql();
    const lecturePredicate = buildMaterialLectureSql(tags);
    const conditions: Prisma.Sql[] = [buildMaterialRoleCondition(role, actorId)];
    if (classId) conditions.push(Prisma.sql`m.class_id = ${classId}`);
    const where = Prisma.join(conditions, " AND ");
    const rows = await prisma.$queryRaw<
      Array<{ classId: string; folder: string; kind: "materials" | "lectures"; count: bigint | number }>
    >(Prisma.sql`
      SELECT
        m.class_id AS "classId",
        m.folder AS "folder",
        CASE WHEN ${lecturePredicate} THEN 'lectures' ELSE 'materials' END AS "kind",
        COUNT(*) AS "count"
      FROM materials m
      WHERE ${where}
      GROUP BY m.class_id, m.folder, CASE WHEN ${lecturePredicate} THEN 'lectures' ELSE 'materials' END
    `);
    return rows.map((row) => ({
      classId: row.classId,
      folder: row.folder,
      kind: row.kind === "lectures" ? "lectures" : "materials",
      count: Number(row.count ?? 0),
    }));
  }

  const buckets = new Map<string, MaterialSummaryBucket>();
  for (const item of serviceContext.materials) {
    if (!serviceContext.canAccessMemoryMaterial(item, role, actorId)) continue;
    if (classId && item.classId !== classId) continue;
    if (!item.classId) continue;
    const kind: "materials" | "lectures" = isLectureContent(item.tags, item.mimeType) ? "lectures" : "materials";
    const key = `${item.classId}\u0000${kind}\u0000${item.folder}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      buckets.set(key, { classId: item.classId, folder: item.folder, kind, count: 1 });
    }
  }
  return [...buckets.values()];
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
    folderExact?: boolean;
    kind?: "materials" | "lectures";
    mimeType?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  },
  learnerId: string,
  role: string,
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
    const tags = buildMaterialTagsSql();
    const lecturePredicate = buildMaterialLectureSql(tags);
    const conditions: Prisma.Sql[] = [buildMaterialRoleCondition(role, learnerId)];
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
    if (input.kind === "lectures")
      conditions.push(lecturePredicate);
    else if (input.kind === "materials")
      conditions.push(Prisma.sql`NOT ${lecturePredicate}`);
    // Thoát ký tự đặc biệt của LIKE: tìm kiếm người dùng là chuỗi con nguyên nghĩa, không phải mẫu SQL.
    const contains = (value: string): string =>
      `%${value.replace(/[\\%_]/g, "\\$&")}%`;
    if (input.folder)
      conditions.push(
        input.folderExact
          ? Prisma.sql`m.folder = ${input.folder}`
          : Prisma.sql`m.folder ILIKE ${contains(input.folder)}`,
      );
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
    const { rows, total } = await readWithoutTransaction(prisma,
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
      }
    );
    const items = rows.map((row) => ({
      ...serviceContext.mapMaterial(row),
      tags: visibleMaterialTags(serviceContext.toStringArray(row.tags), role, row.visibility),
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
  const folder = input.folder?.toLowerCase();
  const filtered = serviceContext.materials.filter((item) =>
    serviceContext.canAccessMemoryMaterial(item, role, learnerId) &&
    (!input.materialId || item.id === input.materialId) &&
    (!input.classId || item.classId === input.classId) &&
    (!input.courseId || item.courseId === input.courseId) &&
    (!input.scope || item.scope === input.scope) &&
    (!input.visibility || item.visibility === input.visibility) &&
    (!input.aiOnly || AI_SEARCH_MIME_TYPES.has(item.mimeType)) &&
    (!input.kind || (input.kind === "lectures") === isLectureContent(item.tags, item.mimeType)) &&
    (!input.folder ||
      (input.folderExact
        ? item.folder === input.folder
        : item.folder.toLowerCase().includes(folder ?? ""))) &&
    (!input.mimeType || item.mimeType === input.mimeType) &&
    (!tag || item.tags.some((value) => value.toLowerCase() === tag)) &&
    (!normalized || `${item.name} ${item.folder} ${item.tags.join(" ")}`
      .toLowerCase().includes(normalized)),
  );
  const items = filtered
    .slice((page - 1) * pageSize, page * pageSize)
    .map((item) => ({ ...item, tags: visibleMaterialTags(item.tags, role, item.visibility) }));
  return {
    items,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

/** Kiểm tra quyền lớp, thư mục hợp lệ, chính sách tệp, quét virus và lưu học liệu mới gắn chặt với lớp. */
export async function createMaterial(
  serviceContext: LearningServiceContext,
  classId: string | null,
  input: Pick<
    LearningMaterial,
    "name" | "mimeType" | "sizeBytes" | "folder" | "tags"
  > & { scope?: LearningMaterial["scope"]; courseId?: string; visibility?: "PUBLISHED" | "HIDDEN" },
  upload: UploadedMaterialFile | undefined,
  actorId: string,
  actorRole: string,
): Promise<LearningMaterial> {
  void actorRole;
  const normalizedClassId = classId?.trim() ?? "";
  if (!normalizedClassId)
    throw new BadRequestException("Học liệu bắt buộc phải thuộc một lớp học.");
  if ((input.scope as string | undefined) === "SHARED")
    throw new BadRequestException("Không hỗ trợ học liệu dùng chung ngoài lớp.");
  const lectureUrl = validateLectureLinkTags(input.tags, input.mimeType === LECTURE_LINK_MIME);
  if (lectureUrl && input.mimeType !== LECTURE_LINK_MIME)
    throw new BadRequestException("Liên kết bài giảng phải có MIME text/uri-list.");
  const isLectureLink = !upload && input.mimeType === LECTURE_LINK_MIME && Boolean(lectureUrl);
  if (input.mimeType === LECTURE_LINK_MIME && !isLectureLink)
    throw new BadRequestException("Chỉ được tạo bài giảng bằng liên kết trong lớp.");
  if (isLectureLink && input.sizeBytes !== Buffer.byteLength(lectureUrl!, "utf8"))
    throw new BadRequestException("Dung lượng metadata liên kết không khớp URL.");
  // Dung lượng tính quota do máy chủ xác định: tệp lấy số byte thực đã ghi, liên kết tính theo độ dài URL,
  // metadata không kèm tệp tính 0 — client không thể khai khống sizeBytes để làm cạn quota toàn hệ thống.
  const sizeBytes = upload ? upload.size : isLectureLink ? Buffer.byteLength(lectureUrl!, "utf8") : 0;
  const prisma = serviceContext.database();
  const policy = prisma
    ? await serviceContext.getStoragePolicy(prisma)
    : {
        maxFileSizeMb: 50,
        storageQuotaMb: 10_240,
        allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
      };
  if (sizeBytes > policy.maxFileSizeMb * 1_000_000)
    throw new BadRequestException(
      `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
    );
  if (!isLectureLink && !policy.allowedMimeTypes.includes(input.mimeType))
    throw new BadRequestException(
      "Loại MIME không được chính sách lưu trữ cho phép.",
    );
  if (prisma) {
    const classItem = await prisma.learningClass.findUnique({
      where: { id: normalizedClassId },
      include: { instructors: true },
    });
    if (
      !classItem ||
      !classItem.instructors.some(
        (item) =>
          item.instructorId === actorId &&
          (item.role === "PRIMARY" || item.role === "CO_INSTRUCTOR"),
      )
    )
      throw new NotFoundException(
        "Giảng viên không được phân công vào lớp học này.",
      );
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    await checkFolder(serviceContext, normalizedClassId, input.folder, input.tags, input.mimeType);
    const quarantineReason = upload
      ? await serviceContext.scanUpload(upload)
      : undefined;
    const courseId = classItem.courseId;
    const usage = await prisma.material.aggregate({
      _sum: { sizeBytes: true },
    });
    if (
      (usage._sum.sizeBytes ?? 0n) + BigInt(sizeBytes) >
      BigInt(policy.storageQuotaMb) * 1_000_000n
    )
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    const materialId = id("material");
    const stored = upload
      ? await serviceContext.storeUpload(
          normalizedClassId,
          materialId,
          upload,
          Boolean(quarantineReason),
        )
      : {
          objectKey: `metadata/${normalizedClassId}/${materialId}`,
          checksum: undefined,
        };
    try {
      return prisma.$transaction(async (transaction) => {
        const material = await transaction.material.create({
          data: {
            id: materialId,
            classId: normalizedClassId,
            courseId,
            ownerId: actorId,
            name: input.name.trim(),
            objectKey: stored.objectKey,
            checksum: stored.checksum,
            mimeType: input.mimeType,
            sizeBytes: BigInt(sizeBytes),
            folder: input.folder.trim(),
            tags: input.tags,
            visibility: quarantineReason ? "HIDDEN" : (input.visibility === "HIDDEN" ? "HIDDEN" : "PUBLISHED"),
            scope: "CLASS",
            quarantinedAt: quarantineReason ? new Date() : null,
            quarantineReason,
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
  const classItem = serviceContext.findClass(normalizedClassId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException(
      "Giảng viên không được phân công vào lớp học này.",
    );
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  await checkFolder(serviceContext, normalizedClassId, input.folder, input.tags, input.mimeType);
  const quarantineReason = upload
    ? await serviceContext.scanUpload(upload)
    : undefined;
  const item: LearningMaterial = {
    ...input,
    sizeBytes,
    id: id("material"),
    classId: normalizedClassId,
    courseId: classItem.courseId,
    ownerId: actorId,
    version: 1,
    visibility: quarantineReason ? "HIDDEN" : (input.visibility === "HIDDEN" ? "HIDDEN" : "PUBLISHED"),
    scope: "CLASS",
    quarantinedAt: quarantineReason ? now() : undefined,
    quarantineReason,
    createdAt: now(),
  };
  if (upload) {
    const stored = await serviceContext.storeUpload(
      normalizedClassId,
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

/** Cập nhật metadata/visibility/vị trí lớp-thư mục của học liệu theo quyền class_instructors. */
export async function updateMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility" | "scope">> & {
    classId?: string | null;
    name?: string;
  },
  actorId: string,
  actorRole: string,
): Promise<LearningMaterial> {
  void actorRole;
  if ((input.scope as string | undefined) === "SHARED")
    throw new BadRequestException("Không hỗ trợ học liệu dùng chung ngoài lớp.");
  if (input.classId !== undefined && (!input.classId || !input.classId.trim()))
    throw new BadRequestException("Học liệu bắt buộc phải thuộc một lớp học.");
  const targetClassIdInput = input.classId?.trim();
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: { include: { instructors: true } } },
    });
    if (!current || !canEditMaterial(current, actorId))
      throw new NotFoundException("Không tìm thấy học liệu.");
    const updatedLectureUrl = input.tags === undefined ? undefined : validateLectureLinkTags(input.tags, current.mimeType === LECTURE_LINK_MIME);
    if (updatedLectureUrl && current.mimeType !== LECTURE_LINK_MIME)
      throw new BadRequestException("Không thể gắn liên kết bài giảng vào học liệu dạng tệp.");
    if (current.class?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const nextVisibility = input.visibility === "DRAFT" ? "PUBLISHED" : input.visibility;
    assertInstructorVisibility(current, nextVisibility);
    const targetClass =
      targetClassIdInput && targetClassIdInput !== current.classId
        ? await prisma.learningClass.findUnique({
            where: { id: targetClassIdInput },
            include: { instructors: true },
          })
        : null;
    if (
      targetClassIdInput &&
      targetClassIdInput !== current.classId &&
      (!targetClass ||
        !targetClass.instructors.some(
          (item) =>
            item.instructorId === actorId &&
            (item.role === "PRIMARY" || item.role === "CO_INSTRUCTOR"),
        ))
    )
      throw new NotFoundException("Giảng viên không được phân công vào lớp học này.");
    if (targetClass?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const destinationClassId = targetClassIdInput ?? current.classId;
    if (input.folder !== undefined || input.classId !== undefined || input.tags !== undefined)
      await checkFolder(
        serviceContext,
        destinationClassId,
        input.folder ?? current.folder,
        input.tags ?? serviceContext.toStringArray(current.tags),
        current.mimeType,
      );
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.material.update({
        where: { id: materialId },
        data: {
          name: input.name ? input.name.trim() : undefined,
          folder: input.folder !== undefined ? input.folder.trim() : undefined,
          classId: targetClassIdInput,
          courseId: targetClass?.courseId,
          tags: input.tags,
          sizeBytes: updatedLectureUrl ? BigInt(Buffer.byteLength(updatedLectureUrl, "utf8")) : undefined,
          visibility: nextVisibility,
          scope: "CLASS",
          version: { increment: 1 },
        },
      });
      return serviceContext.mapMaterial(updated);
    });
  }
  const item = serviceContext.materials.find(
    (material) => material.id === materialId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
  const sourceClass = serviceContext.classes.find((cls) => cls.id === item.classId);
  if (!sourceClass || !sourceClass.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy học liệu.");
  const updatedLectureUrl = input.tags === undefined ? undefined : validateLectureLinkTags(input.tags, item.mimeType === LECTURE_LINK_MIME);
  if (updatedLectureUrl && item.mimeType !== LECTURE_LINK_MIME)
    throw new BadRequestException("Không thể gắn liên kết bài giảng vào học liệu dạng tệp.");
  if (sourceClass.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const nextVisibility = input.visibility === "DRAFT" ? "PUBLISHED" : input.visibility;
  assertInstructorVisibility(item, nextVisibility);
  const targetClass =
    targetClassIdInput && targetClassIdInput !== item.classId
      ? serviceContext.findClass(targetClassIdInput)
      : undefined;
  if (targetClass && !targetClass.instructorIds.includes(actorId))
    throw new NotFoundException("Giảng viên không được phân công vào lớp học này.");
  if (targetClass?.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const destinationClassId = targetClassIdInput ?? item.classId;
  if (input.folder !== undefined || input.classId !== undefined || input.tags !== undefined)
    await checkFolder(
      serviceContext,
      destinationClassId,
      input.folder ?? item.folder,
      input.tags ?? serviceContext.toStringArray(item.tags),
      item.mimeType,
    );
  if (targetClass) {
    item.classId = targetClass.id;
    item.courseId = targetClass.courseId;
  }
  item.scope = "CLASS";
  if (input.name) item.name = input.name.trim();
  if (input.folder !== undefined) item.folder = input.folder.trim();
  if (input.tags) item.tags = input.tags;
  if (updatedLectureUrl) item.sizeBytes = Buffer.byteLength(updatedLectureUrl, "utf8");
  if (nextVisibility) item.visibility = nextVisibility;
  item.version += 1;
  return { ...item, tags: [...item.tags] };
}

/** Quét và thay trực tiếp tệp hiện tại của học liệu, xóa ngay tệp cũ sau khi lưu xong. */
export async function replaceMaterialFile(
  serviceContext: LearningServiceContext,
  materialId: string,
  input: Pick<LearningMaterial, "folder" | "tags">,
  upload: UploadedMaterialFile,
  actorId: string,
): Promise<LearningMaterial> {
  const prisma = serviceContext.database();
  const policy = prisma
    ? await serviceContext.getStoragePolicy(prisma)
    : {
        maxFileSizeMb: 50,
        storageQuotaMb: 10_240,
        allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES],
      };
  if (upload.size > policy.maxFileSizeMb * 1_000_000)
    throw new BadRequestException(
      `Tệp vượt giới hạn ${policy.maxFileSizeMb} MB.`,
    );
  if (!policy.allowedMimeTypes.includes(upload.mimeType))
    throw new BadRequestException(
      "Loại MIME không được chính sách lưu trữ cho phép.",
    );
  const quarantineReason = await serviceContext.scanUpload(upload);
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: { include: { instructors: true } } },
    });
    if (!current || !canEditMaterial(current, actorId))
      throw new NotFoundException("Không tìm thấy học liệu.");
    if (current.class?.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const usage = await prisma.material.aggregate({
      _sum: { sizeBytes: true },
    });
    const replacedStoredSize = serviceContext.isMaterialObjectKey(current.objectKey)
      ? current.sizeBytes
      : 0n;
    if (
      (usage._sum.sizeBytes ?? 0n) - replacedStoredSize + BigInt(upload.size) >
      BigInt(policy.storageQuotaMb) * 1_000_000n
    )
      throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
    await checkFolder(serviceContext, current.classId, input.folder, input.tags, upload.mimeType);
    const nextVersion = current.version + 1;
    const previousObjectKey = current.objectKey;
    const stored = await serviceContext.storeUpload(
      current.classId,
      `${materialId}-v${nextVersion}-${randomUUID()}`,
      upload,
      Boolean(quarantineReason),
    );
    let material: LearningMaterial;
    try {
      const updated = await prisma.material.update({
        where: { id: materialId },
        data: {
          name: upload.originalName.trim(),
          objectKey: stored.objectKey,
          checksum: stored.checksum,
          mimeType: upload.mimeType,
          sizeBytes: BigInt(upload.size),
          folder: input.folder.trim(),
          tags: input.tags,
          version: nextVersion,
          visibility: quarantineReason
            ? "HIDDEN"
            : current.visibility === "HIDDEN"
              ? "HIDDEN"
              : "PUBLISHED",
          quarantinedAt: quarantineReason ? new Date() : null,
          quarantineReason,
        },
      });
      material = serviceContext.mapMaterial(updated);
    } catch (error) {
      await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
    if (
      previousObjectKey &&
      previousObjectKey !== stored.objectKey &&
      (previousObjectKey.startsWith("quarantine/") ||
        serviceContext.isMaterialObjectKey(previousObjectKey))
    ) {
      await serviceContext
        .removeStoredFile(previousObjectKey)
        .catch((error: unknown) => {
          Logger.warn(
            `Không thể dọn tệp học liệu cũ ${previousObjectKey}: ${error instanceof Error ? error.message : String(error)}`,
            "LearningMaterials",
          );
        });
    }
    return material;
  }
  const current = serviceContext.materials.find(
    (item) => item.id === materialId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy học liệu.");
  const currentClass = serviceContext.classes.find((cls) => cls.id === current.classId);
  if (!currentClass || !currentClass.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy học liệu.");
  if (currentClass.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  await checkFolder(serviceContext, current.classId, input.folder, input.tags, upload.mimeType);
  const usedBytes = serviceContext.materials
    .filter((item) => serviceContext.materialFiles.has(item.id))
    .reduce((sum, item) => sum + item.sizeBytes, 0);
  const replacedBytes = serviceContext.materialFiles.has(materialId)
    ? current.sizeBytes
    : 0;
  if (usedBytes - replacedBytes + upload.size > policy.storageQuotaMb * 1_000_000)
    throw new BadRequestException("Kho lưu trữ đã vượt quota hệ thống.");
  const nextVersion = current.version + 1;
  const previousFile = serviceContext.materialFiles.get(materialId);
  const stored = await serviceContext.storeUpload(
    current.classId,
    `${materialId}-v${nextVersion}-${randomUUID()}`,
    upload,
    Boolean(quarantineReason),
  );
  Object.assign(current, {
    name: upload.originalName.trim(),
    mimeType: upload.mimeType,
    sizeBytes: upload.size,
    folder: input.folder.trim(),
    tags: [...input.tags],
    version: nextVersion,
    visibility: quarantineReason
      ? "HIDDEN"
      : current.visibility === "HIDDEN"
        ? "HIDDEN"
        : "PUBLISHED",
    quarantinedAt: quarantineReason ? now() : undefined,
    quarantineReason,
  });
  serviceContext.materialFiles.set(materialId, stored);
  if (
    previousFile?.objectKey &&
    previousFile.objectKey !== stored.objectKey &&
    (previousFile.objectKey.startsWith("quarantine/") ||
      serviceContext.isMaterialObjectKey(previousFile.objectKey))
  ) {
    await serviceContext
      .removeStoredFile(previousFile.objectKey)
      .catch((error: unknown) => {
        Logger.warn(
          `Không thể dọn tệp học liệu cũ ${previousFile.objectKey}: ${error instanceof Error ? error.message : String(error)}`,
          "LearningMaterials",
        );
      });
  }
  return { ...current, tags: [...current.tags] };
}

/** Xóa tại chỗ các phần tử khớp vì mảng bộ nhớ của service chỉ có getter. */
function removeWhere<T>(list: T[], match: (item: T) => boolean): void {
  list.splice(0, list.length, ...list.filter((item) => !match(item)));
}

/** Giảng viên được phân công trong lớp xóa hẳn học liệu cùng tệp lưu trữ; nhật ký hệ thống vẫn giữ dấu vết. */
export async function deleteMaterial(
  serviceContext: LearningServiceContext,
  materialId: string,
  actorId: string,
  actorRole: string,
): Promise<void> {
  void actorRole;
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.material.findUnique({
      where: { id: materialId },
      include: { class: { include: { instructors: true } } },
    });
    if (!current || !canEditMaterial(current, actorId))
      throw new NotFoundException("Không tìm thấy học liệu.");
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
          },
        },
      });
    });
    // Xóa tệp sau khi giao dịch thành công; lỗi kho không làm hỏng thao tác xóa.
    if (
      current.objectKey &&
      (current.objectKey.startsWith("quarantine/") ||
        serviceContext.isMaterialObjectKey(current.objectKey))
    ) {
      await serviceContext
        .removeStoredFile(current.objectKey)
        .catch((error: unknown) => {
          Logger.warn(
            `Không thể dọn tệp học liệu ${current.objectKey}: ${error instanceof Error ? error.message : String(error)}`,
            "LearningMaterials",
          );
        });
    }
    return;
  }
  const item = serviceContext.materials.find(
    (material) => material.id === materialId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy học liệu.");
  const itemClass = serviceContext.classes.find((cls) => cls.id === item.classId);
  if (!itemClass || !itemClass.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy học liệu.");
  if (itemClass.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  removeWhere(serviceContext.materials, (material) => material.id === materialId);
  serviceContext.materialFiles.delete(materialId);
}
