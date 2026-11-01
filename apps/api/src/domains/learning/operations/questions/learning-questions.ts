import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import {
  id,
  MaterialDownload,
  UploadedMaterialFile,
} from "../../core/learning.shared.js";
import type {
  LearningQuestion,
  QuestionImportResult,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Lọc phiên bản câu hỏi mới nhất theo từ khóa, khóa học, loại, độ khó, tag và trạng thái. */
export async function listQuestions(
  serviceContext: LearningServiceContext,
  filters:
    | string
    | {
        query?: string;
        courseId?: string;
        type?: string;
        difficulty?: number;
        tag?: string;
        status?: LearningQuestion["status"];
      } = {},
): Promise<LearningQuestion[]> {
  const input = typeof filters === "string" ? { query: filters } : filters;
  const normalized = input.query?.trim().toLowerCase() ?? "";
  /** Lọc câu hỏi theo nội dung, khóa học, loại, độ khó, nhãn và trạng thái. */
  const matches = (item: LearningQuestion): boolean =>
    (!normalized ||
      `${item.content} ${item.tags.join(" ")}`
        .toLowerCase()
        .includes(normalized)) &&
    (!input.courseId || item.courseId === input.courseId) &&
    (!input.type || item.type === input.type) &&
    (!input.difficulty || item.difficulty === input.difficulty) &&
    (!input.tag ||
      item.tags.some(
        (tag) => tag.toLowerCase() === input.tag!.trim().toLowerCase(),
      )) &&
    (!input.status || item.status === input.status);
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.question.findMany({
      where: input.status ? { status: input.status } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return serviceContext
      .latestQuestionVersions(
        rows.map((row) => serviceContext.mapQuestion(row)),
      )
      .filter(matches);
  }
  const candidates = input.status
    ? serviceContext.questions.filter((item) => item.status === input.status)
    : serviceContext.questions;
  return serviceContext
    .latestQuestionVersions(candidates)
    .filter(matches)
    .map((item) => serviceContext.cloneQuestion(item));
}

/** Validate nội dung/đáp án, tạo family câu hỏi và chọn trạng thái theo chế độ duyệt cấu hình. */
export async function createQuestion(
  serviceContext: LearningServiceContext,
  input: Omit<LearningQuestion, "id" | "status" | "version">,
  authorId = "usr-instructor",
): Promise<LearningQuestion> {
  const normalized = serviceContext.validateQuestionInput(input);
  const contentHash = serviceContext.questionContentHash(normalized.content);
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
    status: "DRAFT",
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
  authorId = "usr-instructor",
): Promise<LearningQuestion> {
  const normalized = serviceContext.validateQuestionInput(input);
  const contentHash = serviceContext.questionContentHash(normalized.content);
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
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
          status: "DRAFT",
          version: current.version + 1,
        },
      }),
    );
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
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
    status: "DRAFT",
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
                authorId: current.authorId,
                type: current.type,
                content: current.content,
                options: current.options as Prisma.InputJsonValue,
                correctAnswers: current.correctAnswers as Prisma.InputJsonValue,
                difficulty: current.difficulty,
                tags: current.tags as Prisma.InputJsonValue,
                status: "DRAFT",
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
          status: "DRAFT" as const,
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
): Promise<LearningQuestion> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
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
              authorId: current.authorId,
              type: current.type,
              content: current.content,
              options: current.options as Prisma.InputJsonValue,
              correctAnswers: current.correctAnswers as Prisma.InputJsonValue,
              difficulty: current.difficulty,
              tags: current.tags as Prisma.InputJsonValue,
              status: "DRAFT",
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
          status: "DRAFT" as const,
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
          status: "PUBLISHED",
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
        exam.status === "PUBLISHED" &&
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

/** Công bố câu hỏi theo cấu hình, hoặc công bố ngay khi thuộc luồng tạo bài đã xác nhận. */
export async function publishQuestion(
  serviceContext: LearningServiceContext,
  questionId: string,
  actorId = "usr-instructor",
  immediate = false,
): Promise<LearningQuestion> {
  const approvalMode = await serviceContext.getQuestionApprovalMode();
  const nextStatus: LearningQuestion["status"] =
    immediate || approvalMode === "AUTO" ? "PUBLISHED" : "PENDING_REVIEW";
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
    if (current.status === "PUBLISHED")
      return serviceContext.mapQuestion(current);
    if (current.status === "PENDING_REVIEW" && !immediate)
      return serviceContext.mapQuestion(current);
    const latest = await prisma.question.findFirst({
      where: { familyId: current.familyId },
      orderBy: { version: "desc" },
    });
    if (latest?.id !== current.id)
      throw new ConflictException(
        "Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.",
      );
    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.question.update({
        where: { id: questionId },
        data: { status: nextStatus },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action:
            immediate || approvalMode === "AUTO"
              ? "QUESTION_AUTO_APPROVED"
              : "QUESTION_SUBMITTED_FOR_REVIEW",
          entityType: "question",
          entityId: questionId,
          context: { version: current.version, approvalMode, immediate },
        },
      });
      return serviceContext.mapQuestion(updated);
    });
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
  if (current.status === "PUBLISHED")
    return serviceContext.cloneQuestion(current);
  if (current.status === "PENDING_REVIEW" && !immediate)
    return serviceContext.cloneQuestion(current);
  const familyId = current.familyId ?? current.id;
  const latest = serviceContext.questions
    .filter((item) => (item.familyId ?? item.id) === familyId)
    .sort((a, b) => b.version - a.version)[0];
  if (latest?.id !== current.id)
    throw new ConflictException(
      "Chỉ có thể xuất bản phiên bản mới nhất của câu hỏi.",
    );
  current.status = nextStatus;
  return serviceContext.cloneQuestion(current);
}

/** Áp dụng quyết định duyệt tay, bắt buộc ghi chú khi trả lại và lưu audit. */
export async function reviewQuestion(
  serviceContext: LearningServiceContext,
  questionId: string,
  decision: "APPROVE" | "RETURN",
  rawNote?: string,
  reviewerId = "usr-admin",
): Promise<LearningQuestion> {
  const reviewNote = rawNote?.trim();
  if (decision === "RETURN" && (!reviewNote || reviewNote.length < 5))
    throw new BadRequestException(
      "Cần lý do ít nhất 5 ký tự khi trả lại câu hỏi.",
    );
  const nextStatus: LearningQuestion["status"] =
    decision === "APPROVE" ? "PUBLISHED" : "DRAFT";
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const current = await transaction.question.findUnique({
        where: { id: questionId },
      });
      if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
      if (current.status !== "PENDING_REVIEW")
        throw new ConflictException(
          "Câu hỏi không ở trạng thái chờ phê duyệt.",
        );
      const reviewId = id("question-review");
      const updated = await transaction.question.update({
        where: { id: questionId },
        data: { status: nextStatus },
      });
      await transaction.auditLog.create({
        data: {
          actorId: reviewerId,
          action: `QUESTION_${decision}`,
          entityType: "question",
          entityId: questionId,
          context: {
            version: current.version,
            reviewNote: reviewNote ?? "Đạt yêu cầu",
          },
        },
      });
      await transaction.notification.create({
        data: {
          id: id("notification"),
          recipientId: current.authorId,
          type: "QUESTION_REVIEWED",
          title:
            decision === "APPROVE"
              ? "Câu hỏi đã được phê duyệt"
              : `Câu hỏi đã được trả lại: ${reviewNote}`,
          entityType: "QUESTION",
          entityId: questionId,
          dedupKey: `${reviewId}:${current.authorId}`,
        },
      });
      return serviceContext.mapQuestion(updated);
    });
  }
  const current = serviceContext.questions.find(
    (item) => item.id === questionId,
  );
  if (!current) throw new NotFoundException("Không tìm thấy câu hỏi.");
  if (current.status !== "PENDING_REVIEW")
    throw new ConflictException("Câu hỏi không ở trạng thái chờ phê duyệt.");
  current.status = nextStatus;
  return serviceContext.cloneQuestion(current);
}

/** Nhập từng câu độc lập để lỗi một mục không hủy toàn bộ lô. */
export async function importQuestions(
  serviceContext: LearningServiceContext,
  inputs: Array<Omit<LearningQuestion, "id" | "status" | "version">>,
  authorId = "usr-instructor",
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
