import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizeMultipartFileName } from "../../../../infrastructure/file-transfer.js";
import type {
  ExamSourceFile,
  ScannedQuestionDraft,
} from "../../../system/ai/ai-provider.service.js";
import { ExamGenerationContext, id } from "../../core/learning.shared.js";
import type { LearningExam } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { normalizeQuestionInput } from "../questions/learning-question-rules.js";

/** Thu thập tối đa sáu tệp đã phát hành của môn: tài liệu lớp mình dạy và học liệu dùng chung. */
export async function getExamGenerationContext(
  serviceContext: LearningServiceContext,
  classId: string,
  actorId = "usr-instructor",
  rawMaterialIds: string[] = [],
  skipMaterials = false,
): Promise<ExamGenerationContext> {
  const supportedMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
  ];
  const materialIds = [...new Set(rawMaterialIds)];
  if (materialIds.length !== rawMaterialIds.length)
    throw new BadRequestException(
      "Danh sách tài liệu ngữ cảnh không được trùng.",
    );
  const maxTotalBytes = 24 * 1024 * 1024;
  const prisma = serviceContext.database();
  if (prisma) {
    const classItem = await prisma.learningClass.findFirst({
      where: {
        id: classId,
        instructors: { some: { instructorId: actorId } },
      },
      include: { course: true },
    });
    if (!classItem)
      throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
    if (classItem.status === "CLOSED")
      throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
    const courseSnapshot = await prisma.courseVersion.findUnique({
      where: {
        courseId_version: {
          courseId: classItem.courseId,
          version: classItem.courseVersion,
        },
      },
    });
    if (!courseSnapshot)
      throw new ConflictException(
        "Không tìm thấy phiên bản khóa học đã ghim cho lớp.",
      );
    if (skipMaterials)
      return {
        courseId: classItem.courseId,
        courseName: courseSnapshot.name,
        courseDescription: courseSnapshot.description,
        sourceFiles: [],
      };
    const materials = await prisma.material.findMany({
      where: {
        id: materialIds.length ? { in: materialIds } : undefined,
        visibility: "PUBLISHED",
        quarantinedAt: null,
        mimeType: { in: supportedMimeTypes },
        sizeBytes: { lte: BigInt(12 * 1024 * 1024) },
        courseId: classItem.courseId,
        OR: [
          { class: { instructors: { some: { instructorId: actorId } } } },
          // Học liệu dùng chung đã phát hành thì mọi học viên đều xem được nên dùng được làm ngữ cảnh.
          { scope: "SHARED" },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        objectKey: true,
      },
    });
    if (materialIds.length && materials.length !== materialIds.length)
      throw new BadRequestException(
        "Một hoặc nhiều tài liệu đã chọn không hợp lệ, chưa phát hành hoặc ngoài phạm vi giảng dạy.",
      );
    const sourceFiles: ExamSourceFile[] = [];
    let totalBytes = 0;
    for (const material of materials) {
      const size = Number(material.sizeBytes);
      if (sourceFiles.length >= 6 || totalBytes + size > maxTotalBytes) {
        if (materialIds.length)
          throw new BadRequestException(
            "Tài liệu đã chọn vượt giới hạn 6 tệp hoặc tổng 24 MB. Hãy giảm số tệp.",
          );
        continue;
      }
      try {
        const buffer = await serviceContext.readStoredFile(material.objectKey);
        sourceFiles.push({
          id: material.id,
          name: normalizeMultipartFileName(material.name),
          mimeType: material.mimeType,
          buffer,
        });
        totalBytes += buffer.length;
      } catch {
        throw new ServiceUnavailableException(
          `Không đọc được tài liệu ngữ cảnh: ${material.name}. Hãy kiểm tra tệp trước khi tạo đề.`,
        );
      }
    }
    return {
      courseId: classItem.courseId,
      courseName: courseSnapshot.name,
      courseDescription: courseSnapshot.description,
      sourceFiles,
    };
  }
  const classItem = serviceContext.findClass(classId);
  if (!classItem.instructorIds.includes(actorId))
    throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const course = serviceContext.courseVersions.find(
    (item) =>
      item.courseId === classItem.courseId &&
      item.version === classItem.courseVersion,
  );
  if (!course)
    throw new ConflictException(
      "Không tìm thấy phiên bản khóa học đã ghim cho lớp.",
    );
  if (skipMaterials)
    return {
      courseId: classItem.courseId,
      courseName: course.name,
      courseDescription: course.description,
      sourceFiles: [],
    };
  const sourceFiles: ExamSourceFile[] = [];
  let totalBytes = 0;
  const eligibleMaterials = serviceContext.materials.filter(
    (item) =>
      (!materialIds.length || materialIds.includes(item.id)) &&
      item.visibility === "PUBLISHED" &&
      !item.quarantinedAt &&
      supportedMimeTypes.includes(item.mimeType),
  );
  if (materialIds.length && eligibleMaterials.length !== materialIds.length)
    throw new BadRequestException(
      "Một hoặc nhiều tài liệu đã chọn không hợp lệ, chưa phát hành hoặc ngoài phạm vi giảng dạy.",
    );
  for (const material of eligibleMaterials) {
    const relatedClass = serviceContext.classes.find(
      (item) => item.id === material.classId,
    );
    const stored = serviceContext.materialFiles.get(material.id);
    const inCourse =
      (material.courseId ?? relatedClass?.courseId) === classItem.courseId;
    if (
      !inCourse ||
      (material.scope !== "SHARED" &&
        !relatedClass?.instructorIds.includes(actorId)) ||
      !stored
    )
      continue;
    try {
      const buffer = await serviceContext.readStoredFile(stored.objectKey);
      if (sourceFiles.length >= 6 || totalBytes + buffer.length > maxTotalBytes)
        continue;
      sourceFiles.push({
        id: material.id,
        name: material.name,
        mimeType: material.mimeType,
        buffer,
      });
      totalBytes += buffer.length;
    } catch {
      throw new ServiceUnavailableException(
        `Không đọc được tài liệu ngữ cảnh: ${material.name}. Hãy kiểm tra tệp trước khi tạo đề.`,
      );
    }
  }
  if (materialIds.length && sourceFiles.length !== materialIds.length)
    throw new BadRequestException(
      "Một hoặc nhiều tài liệu đã chọn không thuộc môn học, ngoài phạm vi giảng dạy hoặc không còn tệp lưu trữ.",
    );
  return {
    courseId: classItem.courseId,
    courseName: course.name,
    courseDescription: course.description,
    sourceFiles,
  };
}

/** Tìm đề đã hoàn tất theo khóa idempotency trước khi gọi lại provider AI. */
export async function getGeneratedExamByRequest(
  serviceContext: LearningServiceContext,
  clientRequestId: string,
  classId: string,
  actorId = "usr-instructor",
): Promise<LearningExam | undefined> {
  const prisma = serviceContext.database();
  if (!prisma) return undefined;
  const row = await prisma.exam.findFirst({
    where: {
      generationRequestId: clientRequestId,
      classId,
      class: { instructors: { some: { instructorId: actorId } } },
    },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  return row ? serviceContext.mapExam(row) : undefined;
}

/** Lưu câu hỏi AI và đề nháp trong một giao dịch; câu trùng hoặc sai cấu trúc vẫn được lưu để giảng viên sửa. */
export async function createGeneratedExam(
  serviceContext: LearningServiceContext,
  input: Omit<LearningExam, "id" | "status" | "version" | "questionIds">,
  questions: ScannedQuestionDraft[],
  courseId: string,
  generationContext: {
    mode: "COURSE_MATERIALS" | "WEB_SEARCH";
    materialIds: string[];
    sources: Array<{ title: string; url: string }>;
    providerId?: string;
    provider?: string;
    model?: string;
    warnings?: string[];
  },
  clientRequestId: string = randomUUID(),
  actorId = "usr-instructor",
): Promise<LearningExam> {
  if (new Date(input.closeAt) <= new Date(input.openAt))
    throw new BadRequestException("Thời gian đóng đề phải sau thời gian mở.");
  if (!questions.length || questions.length > 50)
    throw new BadRequestException("Đề AI cần từ 1 đến 50 câu hỏi.");
  const sourceTag =
    generationContext.mode === "COURSE_MATERIALS"
      ? "nguồn-tài-liệu"
      : "nguồn-web";
  const normalizedQuestions = questions.map((question) =>
    normalizeQuestionInput({
      courseId,
      type: question.type,
      content: question.content,
      options: question.options,
      correctAnswers: question.correctAnswers,
      difficulty: question.difficulty,
      tags: [...new Set([...question.tags, "ai-generated", sourceTag])],
    }),
  );
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const classItem = await transaction.learningClass.findFirst({
        where: {
          id: input.classId,
          courseId,
          instructors: { some: { instructorId: actorId } },
        },
      });
      if (!classItem)
        throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
      // Trả lại kết quả của yêu cầu lặp vẫn phải kiểm tra quyền hiện tại đối với cùng lớp và khóa học.
      const existingExam = await transaction.exam.findUnique({
        where: { generationRequestId: clientRequestId },
        include: { questions: { orderBy: { position: "asc" } } },
      });
      if (existingExam) {
        if (existingExam.classId !== input.classId)
          throw new ConflictException(
            "Mã yêu cầu AI đã được dùng cho lớp khác.",
          );
        return serviceContext.mapExam(existingExam);
      }
      if (classItem.status === "CLOSED")
        throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
      const questionIds: string[] = [];
      for (const question of normalizedQuestions) {
        const contentHash = serviceContext.questionContentHash(
          question.content,
        );
        const candidates = await transaction.question.findMany({
          where: {
            courseId,
            contentHash,
            status: "PUBLISHED",
            type: question.type,
            difficulty: question.difficulty,
            imageObjectKey: null,
          },
          orderBy: { version: "desc" },
        });
        // Một câu ngân hàng chỉ gắn vào đề một lần; câu AI lặp lại được lưu riêng để cảnh báo trùng.
        const existing = candidates.find(
          (candidate) =>
            !questionIds.includes(candidate.id) &&
            serviceContext.sameGeneratedQuestion(candidate, question),
        );
        if (existing) {
          questionIds.push(existing.id);
          continue;
        }
        const questionId = id("question");
        await transaction.question.create({
          data: {
            id: questionId,
            familyId: questionId,
            contentHash,
            courseId,
            authorId: actorId,
            type: question.type,
            content: question.content,
            options: question.options,
            correctAnswers: question.correctAnswers,
            difficulty: question.difficulty,
            tags: question.tags,
            status: "DRAFT",
          },
        });
        questionIds.push(questionId);
      }
      const exam = await transaction.exam.create({
        data: {
          id: id("exam"),
          classId: input.classId,
          title: input.title.trim(),
          durationMinutes: input.durationMinutes,
          totalScore: input.totalScore,
          openAt: new Date(input.openAt),
          closeAt: new Date(input.closeAt),
          attemptLimit: input.attemptLimit,
          shuffleQuestions: input.shuffleQuestions ?? false,
          randomSeed: input.randomSeed?.trim(),
          aiContext: generationContext,
          generationRequestId: clientRequestId,
        },
      });
      const questionScores = serviceContext.resolveExamScoreAllocations(
        questionIds,
        input.totalScore,
      );
      await transaction.examQuestion.createMany({
        data: questionIds.map((questionId, position) => ({
          examId: exam.id,
          questionId,
          position: position + 1,
          score: questionScores[questionId]!,
        })),
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "AI_EXAM_DRAFT_CREATED",
          entityType: "exam",
          entityId: exam.id,
          context: {
            courseId,
            questionCount: questionIds.length,
            contextMode: generationContext.mode,
            materialIds: generationContext.materialIds,
            sources: generationContext.sources,
          },
        },
      });
      return serviceContext.getDatabaseExam(transaction, exam.id);
    });
  }
  const classItem = serviceContext.findClass(input.classId);
  if (
    !classItem.instructorIds.includes(actorId) ||
    classItem.courseId !== courseId
  )
    throw new NotFoundException("Không tìm thấy lớp học được phép tạo đề.");
  if (classItem.status === "CLOSED")
    throw new ConflictException("Lớp đã lưu trữ và chỉ cho phép đọc.");
  const questionIds: string[] = [];
  for (const question of normalizedQuestions) {
    const contentHash = serviceContext.questionContentHash(question.content);
    const existing = serviceContext.questions.find(
      (item) =>
        !questionIds.includes(item.id) &&
        item.courseId === courseId &&
        item.status === "PUBLISHED" &&
        serviceContext.questionContentHash(item.content) === contentHash &&
        !item.imageUrl &&
        !item.imageName &&
        serviceContext.sameGeneratedQuestion(item, question),
    );
    if (existing) {
      questionIds.push(existing.id);
      continue;
    }
    const questionId = id("question");
    serviceContext.questions.unshift({
      ...question,
      id: questionId,
      familyId: questionId,
      status: "DRAFT",
      version: 1,
    });
    questionIds.push(questionId);
  }
  const questionScores = serviceContext.resolveExamScoreAllocations(
    questionIds,
    input.totalScore,
  );
  const exam: LearningExam = {
    ...input,
    questionIds,
    questionScores,
    aiContext: structuredClone(generationContext),
    id: id("exam"),
    status: "DRAFT",
    version: 1,
  };
  serviceContext.exams.unshift(exam);
  return { ...exam, questionIds: [...exam.questionIds] };
}
