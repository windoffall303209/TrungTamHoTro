import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import {
  paginateArray,
  type PaginatedResult,
} from "../../../../common/pagination.js";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialDownload,
  QuestionSummary,
  UploadedMaterialFile,
} from "../../core/learning.shared.js";
import type {
  LearningQuestion,
  QuestionImportResult,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

export interface QuestionListFilters {
  query?: string;
  courseId?: string;
  type?: string;
  typeGroup?: "OBJECTIVE" | "ESSAY";
  difficulty?: number;
  tag?: string;
  status?: LearningQuestion["status"];
}

export interface QuestionPageFilters extends QuestionListFilters {
  page?: number;
  pageSize?: number;
}

/** Kiểm tra độ dài bộ lọc câu hỏi trước khi tạo truy vấn SQL. */
function validateQuestionFilterLengths(input: QuestionListFilters): void {
  if (
    [input.query, input.courseId, input.type, input.tag].some(
      (value) => value && value.length > 255,
    )
  ) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
}

/** Tạo điều kiện CTE chọn phiên bản mới nhất mỗi family và bộ lọc ngoài cho SQL. */
function buildQuestionLatestSqlParts(input: QuestionListFilters, scope: QuestionScope): {
  innerWhere: Prisma.Sql;
  outerWhere: Prisma.Sql;
} {
  const innerConditions: Prisma.Sql[] = [];
  if (input.status) {
    innerConditions.push(Prisma.sql`q.status::text = ${input.status}`);
  }
  if (input.courseId) {
    innerConditions.push(Prisma.sql`q.course_id = ${input.courseId}`);
  }
  const innerWhere = innerConditions.length
    ? Prisma.join(innerConditions, " AND ")
    : Prisma.sql`TRUE`;

  const tags = Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.tags) = 'array' THEN l.tags ELSE '[]'::jsonb END)`;
  // Chuẩn hóa chuỗi tìm kiếm LIKE an toàn cho truy vấn SQL.
  const contains = (value: string): string =>
    `%${value.replace(/[\\%_]/g, "\\$&")}%`;
  const outerConditions: Prisma.Sql[] = [questionScopeSql(scope)];
  if (input.type) {
    outerConditions.push(Prisma.sql`l.type::text = ${input.type}`);
  } else if (input.typeGroup === "OBJECTIVE") {
    outerConditions.push(Prisma.sql`l.type::text <> 'ESSAY'`);
  } else if (input.typeGroup === "ESSAY") {
    outerConditions.push(Prisma.sql`l.type::text = 'ESSAY'`);
  }
  if (input.difficulty) {
    outerConditions.push(Prisma.sql`l.difficulty = ${input.difficulty}`);
  }
  if (input.tag?.trim()) {
    const tag = input.tag.trim();
    outerConditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE lower(t.value) = lower(${tag}))`,
    );
  }
  const normalizedQuery = input.query?.trim();
  if (normalizedQuery) {
    const pattern = contains(normalizedQuery);
    outerConditions.push(
      Prisma.sql`(l.content ILIKE ${pattern} OR EXISTS (SELECT 1 FROM ${tags} AS t(value) WHERE t.value ILIKE ${pattern}))`,
    );
  }
  const outerWhere = outerConditions.length
    ? Prisma.join(outerConditions, " AND ")
    : Prisma.sql`TRUE`;

  return { innerWhere, outerWhere };
}

/** Người gọi danh sách/thống kê câu hỏi; giảng viên chỉ thấy câu hỏi trong phạm vi được phân công. */
export interface QuestionScope {
  actorId: string;
  actorRole: string;
}

// Cấp quản lý đọc toàn bộ ngân hàng câu hỏi; mọi vai trò khác phải được giới hạn theo phân công.
function isQuestionManager(role: string): boolean {
  return role === "CENTER_MANAGER" || role === "SYSTEM_ADMIN";
}

/**
 * Điều kiện SQL áp lên phiên bản mới nhất (alias l) của mỗi family: giảng viên chỉ thấy câu hỏi thuộc khóa học
 * của lớp mình được phân công hoặc family do chính mình soạn; vai trò khác ngoài quản lý bị từ chối.
 */
function questionScopeSql(scope: QuestionScope): Prisma.Sql {
  if (isQuestionManager(scope.actorRole)) return Prisma.sql`TRUE`;
  if (scope.actorRole !== "INSTRUCTOR") throw new ForbiddenException("Không có quyền xem ngân hàng câu hỏi.");
  return Prisma.sql`(
    l.course_id IN (
      SELECT lc.course_id FROM learning_classes lc
      JOIN class_instructors ci ON ci.class_id = lc.id
      WHERE ci.instructor_id = ${scope.actorId}
    )
    OR EXISTS (SELECT 1 FROM questions qa WHERE qa.family_id = l.family_id AND qa.author_id = ${scope.actorId})
  )`;
}

/** Tập khóa học của các lớp giảng viên được phân công trên kho nhớ fallback. */
function memoryInstructorCourseIds(serviceContext: LearningServiceContext, actorId: string): Set<string> {
  return new Set(serviceContext.classes.filter((item) => item.instructorIds.includes(actorId)).map((item) => item.courseId));
}

/** Bộ lọc phạm vi câu hỏi trên kho nhớ: quản lý thấy hết, giảng viên chỉ thấy khóa học được phân công. */
function memoryQuestionVisible(serviceContext: LearningServiceContext, scope: QuestionScope): (item: LearningQuestion) => boolean {
  if (isQuestionManager(scope.actorRole)) return () => true;
  if (scope.actorRole !== "INSTRUCTOR") throw new ForbiddenException("Không có quyền xem ngân hàng câu hỏi.");
  const courseIds = memoryInstructorCourseIds(serviceContext, scope.actorId);
  return (item) => courseIds.has(item.courseId);
}

/** Chặn giảng viên tạo câu hỏi vào khóa học không có lớp nào mình được phân công. */
async function assertQuestionCourseAccess(serviceContext: LearningServiceContext, courseId: string, actorId: string): Promise<void> {
  const prisma = serviceContext.database();
  const allowed = prisma
    ? (await prisma.learningClass.count({ where: { courseId, instructors: { some: { instructorId: actorId } } } })) > 0
    : memoryInstructorCourseIds(serviceContext, actorId).has(courseId);
  if (!allowed) throw new NotFoundException("Không tìm thấy khóa học.");
}

/** Chặn sửa/đổi ảnh câu hỏi ngoài phạm vi: phải là tác giả của family hoặc được phân công dạy khóa học. */
async function assertQuestionFamilyAccess(
  serviceContext: LearningServiceContext,
  question: { familyId?: string | null; id: string; courseId: string },
  actorId: string,
): Promise<void> {
  const prisma = serviceContext.database();
  if (prisma) {
    const familyId = question.familyId || question.id;
    const [authored, assigned] = await Promise.all([
      prisma.question.count({ where: { familyId, authorId: actorId } }),
      prisma.learningClass.count({ where: { courseId: question.courseId, instructors: { some: { instructorId: actorId } } } }),
    ]);
    if (!authored && !assigned) throw new NotFoundException("Không tìm thấy câu hỏi.");
    return;
  }
  if (!memoryInstructorCourseIds(serviceContext, actorId).has(question.courseId)) throw new NotFoundException("Không tìm thấy câu hỏi.");
}

/** Lọc phiên bản câu hỏi mới nhất trong bộ nhớ fallback theo bộ lọc đầu vào. */
function filterMemoryQuestions(
  serviceContext: LearningServiceContext,
  input: QuestionListFilters,
  scope: QuestionScope,
): LearningQuestion[] {
  const visible = memoryQuestionVisible(serviceContext, scope);
  const normalized = input.query?.trim().toLowerCase() ?? "";
  const normalizedTag = input.tag?.trim().toLowerCase() ?? "";
  const candidates = input.status
    ? serviceContext.questions.filter((item) => item.status === input.status)
    : serviceContext.questions;
  return serviceContext
    .latestQuestionVersions(candidates)
    .filter(
      (item) =>
        visible(item) &&
        (!normalized ||
          `${item.content} ${item.tags.join(" ")}`
            .toLowerCase()
            .includes(normalized)) &&
        (!input.courseId || item.courseId === input.courseId) &&
        (!input.type || item.type === input.type) &&
        (!input.typeGroup ||
          (input.typeGroup === "ESSAY"
            ? item.type === "ESSAY"
            : item.type !== "ESSAY")) &&
        (!input.difficulty || item.difficulty === input.difficulty) &&
        (!normalizedTag ||
          item.tags.some((tag) => tag.toLowerCase() === normalizedTag)),
    )
    .map((item) => serviceContext.cloneQuestion(item));
}

/** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
export async function listQuestions(
  serviceContext: LearningServiceContext,
  filters: string | QuestionListFilters,
  scope: QuestionScope,
): Promise<LearningQuestion[]> {
  const input: QuestionListFilters =
    typeof filters === "string" ? { query: filters } : filters;
  validateQuestionFilterLengths(input);
  const prisma = serviceContext.database();
  if (prisma) {
    const { innerWhere, outerWhere } = buildQuestionLatestSqlParts(input, scope);
    const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON (q.family_id)
          q.id,
          q.course_id,
          q.family_id,
          q.type,
          q.content,
          q.tags,
          q.difficulty,
          q.status,
          q.version,
          q.created_at
        FROM questions q
        WHERE ${innerWhere}
        ORDER BY q.family_id, q.version DESC, q.created_at DESC, q.id ASC
      )
      SELECT l.id
      FROM latest l
      WHERE ${outerWhere}
      ORDER BY l.version DESC, l.created_at DESC, l.id ASC
    `);
    if (ids.length === 0) return [];
    const rows = await prisma.question.findMany({
      where: { id: { in: ids.map((item) => item.id) } },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    });
    return rows.map((row) => serviceContext.mapQuestion(row));
  }
  return filterMemoryQuestions(serviceContext, input, scope);
}

/** Trả về một trang câu hỏi (phiên bản mới nhất mỗi family) bằng truy vấn SQL COUNT + LIMIT/OFFSET. */
export async function listQuestionsPage(
  serviceContext: LearningServiceContext,
  filters: QuestionPageFilters,
  scope: QuestionScope,
): Promise<PaginatedResult<LearningQuestion>> {
  validateQuestionFilterLengths(filters);
  const page =
    Number.isSafeInteger(filters.page) &&
    (filters.page ?? 0) > 0 &&
    (filters.page ?? 0) <= 100_000
      ? (filters.page as number)
      : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && (filters.pageSize ?? 0) > 0
      ? Math.min(filters.pageSize as number, 100)
      : 20;
  const prisma = serviceContext.database();
  if (prisma) {
    const { innerWhere, outerWhere } = buildQuestionLatestSqlParts(filters, scope);
    const { rows, total, safePage, totalPages } = await prisma.$transaction(
      async (transaction) => {
        const counts = await transaction.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          WITH latest AS (
            SELECT DISTINCT ON (q.family_id)
              q.id,
              q.course_id,
              q.family_id,
              q.type,
              q.content,
              q.tags,
              q.difficulty,
              q.status,
              q.version,
              q.created_at
            FROM questions q
            WHERE ${innerWhere}
            ORDER BY q.family_id, q.version DESC, q.created_at DESC, q.id ASC
          )
          SELECT COUNT(*) AS count
          FROM latest l
          WHERE ${outerWhere}
        `);
        const total = Number(counts[0]?.count ?? 0n);
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, totalPages);
        if (total === 0) {
          return { rows: [], total: 0, safePage, totalPages };
        }
        const offset = (safePage - 1) * pageSize;
        const ids = await transaction.$queryRaw<{ id: string }[]>(Prisma.sql`
          WITH latest AS (
            SELECT DISTINCT ON (q.family_id)
              q.id,
              q.course_id,
              q.family_id,
              q.type,
              q.content,
              q.tags,
              q.difficulty,
              q.status,
              q.version,
              q.created_at
            FROM questions q
            WHERE ${innerWhere}
            ORDER BY q.family_id, q.version DESC, q.created_at DESC, q.id ASC
          )
          SELECT l.id
          FROM latest l
          WHERE ${outerWhere}
          ORDER BY l.version DESC, l.created_at DESC, l.id ASC
          LIMIT ${pageSize} OFFSET ${offset}
        `);
        const rows =
          ids.length === 0
            ? []
            : await transaction.question.findMany({
                where: { id: { in: ids.map((item) => item.id) } },
                orderBy: [{ version: "desc" }, { createdAt: "desc" }, { id: "asc" }],
              });
        return { rows, total, safePage, totalPages };
      },
      { isolationLevel: "RepeatableRead" },
    );
    return {
      items: rows.map((row) => serviceContext.mapQuestion(row)),
      total,
      page: safePage,
      pageSize,
      totalPages,
    };
  }
  const matched = filterMemoryQuestions(serviceContext, filters, scope);
  return paginateArray(matched, page, pageSize);
}

/** Thống kê nhanh tổng câu hỏi, trắc nghiệm và tự luận mới nhất theo từng khóa học bằng SQL. */
export async function getQuestionSummary(
  serviceContext: LearningServiceContext,
  courseId: string | undefined,
  scope: QuestionScope,
): Promise<QuestionSummary> {
  if (courseId && courseId.length > 255) {
    throw new BadRequestException("Search filters must not exceed 255 characters.");
  }
  const prisma = serviceContext.database();
  if (prisma) {
    const innerWhere = courseId
      ? Prisma.sql`q.course_id = ${courseId}`
      : Prisma.sql`TRUE`;
    const rows = await prisma.$queryRaw<
      Array<{ total: bigint | number; multipleChoice: bigint | number; essay: bigint | number }>
    >(Prisma.sql`
      WITH latest AS (
        SELECT DISTINCT ON (q.family_id) q.id, q.type, q.course_id, q.family_id
        FROM questions q
        WHERE ${innerWhere}
        ORDER BY q.family_id, q.version DESC, q.created_at DESC, q.id ASC
      )
      SELECT
        COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE l.type::text <> 'ESSAY') AS "multipleChoice",
        COUNT(*) FILTER (WHERE l.type::text = 'ESSAY') AS "essay"
      FROM latest l
      WHERE ${questionScopeSql(scope)}
    `);
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      multipleChoice: Number(row?.multipleChoice ?? 0),
      essay: Number(row?.essay ?? 0),
    };
  }
  const candidates = courseId
    ? serviceContext.questions.filter((item) => item.courseId === courseId)
    : serviceContext.questions;
  const latest = serviceContext.latestQuestionVersions(candidates).filter(memoryQuestionVisible(serviceContext, scope));
  const essay = latest.filter((item) => item.type === "ESSAY").length;
  return {
    total: latest.length,
    multipleChoice: latest.length - essay,
    essay,
  };
}

/** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt cấu hình. */
export async function createQuestion(
  serviceContext: LearningServiceContext,
  input: Omit<LearningQuestion, "id" | "status" | "version">,
  authorId: string,
): Promise<LearningQuestion> {
  const normalized = serviceContext.validateQuestionInput(input);
  const contentHash = serviceContext.questionContentHash(normalized.content);
  await assertQuestionCourseAccess(serviceContext, normalized.courseId, authorId);
  const prisma = serviceContext.database();
  if (prisma) {
    const course = await prisma.course.findUnique({
      where: { id: normalized.courseId },
    });
    if (!course) throw new NotFoundException("Không tìm thấy khóa học.");
    const duplicate = await prisma.question.findFirst({
      where: { courseId: normalized.courseId, contentHash },
    });
    if (duplicate)
      throw new ConflictException(
        "Nội dung câu hỏi đã tồn tại trong khóa học.",
      );
    const questionId = id("question");
    return serviceContext.mapQuestion(
      await prisma.question.create({
        data: {
          id: questionId,
          familyId: questionId,
          status: "PUBLISHED",
          contentHash,
          courseId: normalized.courseId,
          authorId,
          type: normalized.type,
          content: normalized.content,
          options: normalized.options,
          correctAnswers: normalized.correctAnswers,
          difficulty: normalized.difficulty,
          tags: normalized.tags,
        },
      }),
    );
  }
  if (
    serviceContext.questions.some(
      (item) =>
        item.courseId === normalized.courseId &&
        serviceContext.questionContentHash(item.content) === contentHash,
    )
  )
    throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
  const questionId = id("question");
  const item: LearningQuestion = {
    ...normalized,
    id: questionId,
    familyId: questionId,
    status: "PUBLISHED",
    version: 1,
  };
  serviceContext.questions.unshift(item);
  return serviceContext.cloneQuestion(item);
}

/** Tạo version kế tiếp của câu hỏi thay vì sửa bản đã dùng, đồng thời chống nội dung trùng. */
export async function updateQuestion(
  serviceContext: LearningServiceContext,
  questionId: string,
  input: Omit<LearningQuestion, "id" | "status" | "version">,
  authorId: string,
): Promise<LearningQuestion> {
  const normalized = serviceContext.validateQuestionInput(input);
  const contentHash = serviceContext.questionContentHash(normalized.content);
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    await assertQuestionFamilyAccess(serviceContext, current, authorId);
    // Giữ nguyên khóa học của cả family để chuỗi phiên bản không bị chuyển sang khóa học khác.
    if (normalized.courseId !== current.courseId) throw new BadRequestException("Không thể chuyển câu hỏi sang khóa học khác.");
    const familyId = current.familyId || current.id;
    const duplicate = await prisma.question.findFirst({
      where: {
        courseId: normalized.courseId,
        contentHash,
        familyId: { not: familyId },
      },
    });
    if (duplicate)
      throw new ConflictException(
        "Nội dung câu hỏi đã tồn tại trong khóa học.",
      );
    const latest = await prisma.question.findFirst({
      where: { familyId },
      orderBy: { version: "desc" },
    });
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể sửa phiên bản mới nhất của câu hỏi.",
      );
    return serviceContext.mapQuestion(
      await prisma.question.create({
        data: {
          id: id("question"),
          familyId,
          supersedesId: current.id,
          contentHash,
          courseId: normalized.courseId,
          authorId,
          type: normalized.type,
          content: normalized.content,
          options: normalized.options,
          correctAnswers: normalized.correctAnswers,
          difficulty: normalized.difficulty,
          tags: normalized.tags,
          imageObjectKey: current.imageObjectKey,
          imageName: current.imageName,
          imageMimeType: current.imageMimeType,
          imageSizeBytes: current.imageSizeBytes,
          imageChecksum: current.imageChecksum,
          status: "PUBLISHED",
          version: current.version + 1,
        },
      }),
    );
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
  await assertQuestionFamilyAccess(serviceContext, current, authorId);
  if (normalized.courseId !== current.courseId) throw new BadRequestException("Không thể chuyển câu hỏi sang khóa học khác.");
  const familyId = current.familyId ?? current.id;
  const latest = serviceContext.questions
    .filter((item) => (item.familyId ?? item.id) === familyId)
    .sort((a, b) => b.version - a.version)[0];
  if (latest?.id !== current.id)
    throw new ConflictException(
      "Chỉ có thể sửa phiên bản mới nhất của câu hỏi.",
    );
  if (
    serviceContext.questions.some(
      (item) =>
        item.courseId === normalized.courseId &&
        (item.familyId ?? item.id) !== familyId &&
        serviceContext.questionContentHash(item.content) === contentHash,
    )
  )
    throw new ConflictException("Nội dung câu hỏi đã tồn tại trong khóa học.");
  const next: LearningQuestion = {
    ...normalized,
    id: id("question"),
    familyId,
    supersedesId: current.id,
    status: "PUBLISHED",
    version: current.version + 1,
    imageUrl: current.imageUrl,
    imageName: current.imageName,
    imageMimeType: current.imageMimeType,
    imageSizeBytes: current.imageSizeBytes,
  };
  serviceContext.questions.unshift(next);
  const currentImage = serviceContext.questionImages.get(current.id);
  if (currentImage) {
    serviceContext.questionImages.set(next.id, currentImage);
    next.imageUrl = `/question-bank/questions/${next.id}/image?v=${encodeURIComponent(currentImage.checksum)}`;
  }
  return serviceContext.cloneQuestion(next);
}

/** Kiểm tra ảnh thật, lưu object mới và dọn ảnh cũ khi không còn version nào tham chiếu. */
export async function uploadQuestionImage(
  serviceContext: LearningServiceContext,
  questionId: string,
  upload: UploadedMaterialFile,
  actorId: string,
): Promise<LearningQuestion> {
  await serviceContext.validateQuestionImage(upload);
  const fileName = normalizeMultipartFileName(upload.originalName);
  const extension =
    upload.mimeType === "image/png"
      ? ".png"
      : upload.mimeType === "image/webp"
        ? ".webp"
        : ".jpg";
  const checksum = `sha256:${createHash("sha256").update(upload.buffer).digest("hex")}`;
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    await assertQuestionFamilyAccess(serviceContext, current, actorId);
    const latest = await prisma.question.findFirst({
      where: { familyId: current.familyId },
      orderBy: { version: "desc" },
    });
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể đổi ảnh trên phiên bản mới nhất của câu hỏi.",
      );
    const targetId = current.status === "DRAFT" ? current.id : id("question");
    const objectKey = `question-images/${targetId}/${randomUUID()}${extension}`;
    const stored = await serviceContext.writeStoredFile(
      objectKey,
      upload.buffer,
    );
    try {
      const updated =
        current.status === "DRAFT"
          ? await prisma.question.update({
              where: { id: questionId },
              data: {
                imageObjectKey: stored.objectKey,
                imageName: fileName,
                imageMimeType: upload.mimeType,
                imageSizeBytes: BigInt(upload.size),
                imageChecksum: stored.checksum,
              },
            })
          : await prisma.question.create({
              data: {
                id: targetId,
                courseId: current.courseId,
                authorId: actorId,
                type: current.type,
                content: current.content,
                options: current.options as Prisma.InputJsonValue,
                correctAnswers: current.correctAnswers as Prisma.InputJsonValue,
                difficulty: current.difficulty,
                tags: current.tags as Prisma.InputJsonValue,
                status: "PUBLISHED",
                version: current.version + 1,
                familyId: current.familyId,
                supersedesId: current.id,
                contentHash: current.contentHash,
                imageObjectKey: stored.objectKey,
                imageName: fileName,
                imageMimeType: upload.mimeType,
                imageSizeBytes: BigInt(upload.size),
                imageChecksum: stored.checksum,
              },
            });
      if (
        current.status === "DRAFT" &&
        current.imageObjectKey &&
        current.imageObjectKey !== stored.objectKey
      )
        await serviceContext.removeQuestionObjectIfUnreferenced(
          current.imageObjectKey,
        );
      return serviceContext.mapQuestion(updated);
    } catch (error) {
      await serviceContext.removeStoredFile(stored.objectKey);
      throw error;
    }
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
  await assertQuestionFamilyAccess(serviceContext, current, actorId);
  const familyId = current.familyId ?? current.id;
  const latest = serviceContext.questions
    .filter((item) => (item.familyId ?? item.id) === familyId)
    .sort((left, right) => right.version - left.version)[0];
  if (latest?.id !== current.id)
    throw new ConflictException(
      "Chỉ có thể đổi ảnh trên phiên bản mới nhất của câu hỏi.",
    );
  const target =
    current.status === "DRAFT"
      ? current
      : {
          ...serviceContext.cloneQuestion(current),
          id: id("question"),
          familyId,
          supersedesId: current.id,
          status: "PUBLISHED" as const,
          version: current.version + 1,
        };
  if (target !== current) serviceContext.questions.unshift(target);
  const objectKey = `question-images/${target.id}/${randomUUID()}${extension}`;
  serviceContext.questionImages.set(target.id, {
    objectKey,
    fileName,
    mimeType: upload.mimeType,
    sizeBytes: upload.size,
    checksum,
    buffer: Buffer.from(upload.buffer),
  });
  target.imageUrl = `/question-bank/questions/${target.id}/image?v=${encodeURIComponent(checksum)}`;
  target.imageName = fileName;
  target.imageMimeType = upload.mimeType;
  target.imageSizeBytes = upload.size;
  return serviceContext.cloneQuestion(target);
}

/** Xóa liên kết ảnh của câu hỏi rồi dọn object nếu không còn tham chiếu. */
export async function removeQuestionImage(
  serviceContext: LearningServiceContext,
  questionId: string,
  actorId: string,
): Promise<LearningQuestion> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    await assertQuestionFamilyAccess(serviceContext, current, actorId);
    const latest = await prisma.question.findFirst({
      where: { familyId: current.familyId },
      orderBy: { version: "desc" },
    });
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể gỡ ảnh trên phiên bản mới nhất của câu hỏi.",
      );
    const updated =
      current.status === "DRAFT"
        ? await prisma.question.update({
            where: { id: questionId },
            data: {
              imageObjectKey: null,
              imageName: null,
              imageMimeType: null,
              imageSizeBytes: null,
              imageChecksum: null,
            },
          })
        : await prisma.question.create({
            data: {
              id: id("question"),
              courseId: current.courseId,
              authorId: actorId,
              type: current.type,
              content: current.content,
              options: current.options as Prisma.InputJsonValue,
              correctAnswers: current.correctAnswers as Prisma.InputJsonValue,
              difficulty: current.difficulty,
              tags: current.tags as Prisma.InputJsonValue,
              status: "PUBLISHED",
              version: current.version + 1,
              familyId: current.familyId,
              supersedesId: current.id,
              contentHash: current.contentHash,
            },
          });
    if (current.status === "DRAFT" && current.imageObjectKey)
      await serviceContext.removeQuestionObjectIfUnreferenced(
        current.imageObjectKey,
      );
    return serviceContext.mapQuestion(updated);
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
  await assertQuestionFamilyAccess(serviceContext, current, actorId);
  const familyId = current.familyId ?? current.id;
  const latest = serviceContext.questions
    .filter((item) => (item.familyId ?? item.id) === familyId)
    .sort((left, right) => right.version - left.version)[0];
  if (latest?.id !== current.id)
    throw new ConflictException(
      "Chỉ có thể gỡ ảnh trên phiên bản mới nhất của câu hỏi.",
    );
  const target =
    current.status === "DRAFT"
      ? current
      : {
          ...serviceContext.cloneQuestion(current),
          id: id("question"),
          familyId,
          supersedesId: current.id,
          status: "PUBLISHED" as const,
          version: current.version + 1,
        };
  if (target !== current) serviceContext.questions.unshift(target);
  serviceContext.questionImages.delete(target.id);
  delete target.imageUrl;
  delete target.imageName;
  delete target.imageMimeType;
  delete target.imageSizeBytes;
  return serviceContext.cloneQuestion(target);
}

/** Cho người quản lý hoặc thành viên đề/lớp hợp lệ đọc ảnh câu hỏi mà không lộ object key. */
export async function readQuestionImage(
  serviceContext: LearningServiceContext,
  questionId: string,
  role: string,
  actorId: string,
): Promise<MaterialDownload> {
  const prisma = serviceContext.database();
  if (prisma) {
    if (role === "LEARNER") {
      const exam = await prisma.exam.findFirst({
        where: {
          hidden: false, status: "PUBLISHED",
          questions: { some: { questionId } },
          class: {
            enrollments: { some: { learnerId: actorId, status: "ACTIVE" } },
          },
          attempts: { some: { learnerId: actorId, status: "IN_PROGRESS" } },
        },
        include: {
          attempts: { where: { learnerId: actorId, status: "IN_PROGRESS" } },
        },
      });
      if (
        !exam ||
        !exam.attempts.some(
          (attempt) =>
            serviceContext.attemptDeadline(
              attempt.startedAt,
              exam.durationMinutes,
              exam.closeAt,
            ) > new Date(),
        )
      )
        throw new NotFoundException(
          "Không tìm thấy ảnh câu hỏi được phép xem.",
        );
    }
    const question = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (
      !question?.imageObjectKey ||
      !question.imageName ||
      !question.imageMimeType
    )
      throw new NotFoundException("Không tìm thấy ảnh câu hỏi được phép xem.");
    return {
      fileName: normalizeMultipartFileName(question.imageName),
      mimeType: question.imageMimeType,
      buffer: await serviceContext.readStoredFile(question.imageObjectKey),
    };
  }
  const question = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  const canRead =
    role !== "LEARNER" ||
    serviceContext.exams.some(
      (exam) =>
        !exam.hidden && exam.status === "PUBLISHED" &&
        exam.questionIds.includes(questionId) &&
        serviceContext.findClass(exam.classId).learnerIds.includes(actorId) &&
        serviceContext.attempts.some(
          (attempt) =>
            attempt.examId === exam.id &&
            attempt.learnerId === actorId &&
            attempt.status === "IN_PROGRESS" &&
            serviceContext.attemptDeadline(
              new Date(attempt.startedAt),
              exam.durationMinutes,
              new Date(exam.closeAt),
            ) > new Date(),
        ),
    );
  const image = serviceContext.questionImages.get(questionId);
  if (!question || !canRead || !image)
    throw new NotFoundException("Không tìm thấy ảnh câu hỏi được phép xem.");
  return {
    fileName: image.fileName,
    mimeType: image.mimeType,
    buffer: Buffer.from(image.buffer),
  };
}

/** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
export async function importQuestions(
  serviceContext: LearningServiceContext,
  inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
  authorId: string,
): Promise<QuestionImportResult[]> {
  const results: QuestionImportResult[] = [];
  for (const [index, input] of inputs.entries()) {
    try {
      const question = await serviceContext.createQuestion(input, authorId);
      results.push({
        row: index + 1,
        status: "IMPORTED",
        questionId: question.id,
        message: "Đã nhập câu hỏi.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể nhập câu hỏi.";
      results.push({ row: index + 1, status: "FAILED", message });
    }
  }
  return results;
}
