import { BadRequestException, NotFoundException } from "@nestjs/common";
import type {
  LearnerExamSummary,
  LearningExam,
  LearningQuestion,
} from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";
import { examQuestionIssues } from "../questions/learning-question-rules.js";

/**
 * Ẩn cấu trúc đề trước khi học viên mở lượt làm: danh sách câu, điểm từng câu, seed xáo trộn và ngữ cảnh AI
 * (học liệu nguồn, URL tham khảo). Điểm từng câu chỉ trả kèm bộ câu hỏi của lượt đang làm.
 */
export function redactExamForLearner<T extends LearningExam>(exam: T): T {
  const redacted: T = { ...exam, questionIds: [] };
  delete redacted.questionScores;
  delete redacted.randomSeed;
  delete redacted.aiContext;
  return redacted;
}

/** Gắn lỗi từng câu để giảng viên thấy câu nào cần sửa trước khi gửi duyệt. */
function withQuestionIssues(questions: LearningQuestion[]): LearningQuestion[] {
  const issues = examQuestionIssues(questions);
  return questions.map((question, index) =>
    issues[index]?.length ? { ...question, issues: issues[index] } : question,
  );
}

/** Liệt kê đề theo vai trò và quan hệ lớp, không trả đề ngoài phạm vi giảng dạy/ghi danh. */
export async function listExams(
  serviceContext: LearningServiceContext,
  role: string,
  actorId: string,
): Promise<LearningExam[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.exam.findMany({
      where:
        role === "LEARNER"
          ? {
              hidden: false, status: "PUBLISHED",
              class: {
                enrollments: {
                  some: { learnerId: actorId, status: "ACTIVE" },
                },
              },
            }
          : role === "INSTRUCTOR"
            ? { class: { instructors: { some: { instructorId: actorId } } } }
            : undefined,
      include: { questions: { orderBy: { position: "asc" } } },
      orderBy: { openAt: "desc" },
    });
    const mapped = rows.map((row) => serviceContext.mapExam(row));
    return role === "LEARNER" ? mapped.map((exam) => redactExamForLearner(exam)) : mapped;
  }
  return serviceContext.exams
    .filter((item) => {
      const classItem = serviceContext.classes.find(
        (candidate) => candidate.id === item.classId,
      );
      if (role === "LEARNER")
        return (
          !item.hidden && item.status === "PUBLISHED" && classItem?.learnerIds.includes(actorId)
        );
      if (role === "INSTRUCTOR")
        return classItem?.instructorIds.includes(actorId);
      return true;
    })
    .map((item) => {
      const copy = { ...item, questionIds: [...item.questionIds] };
      return role === "LEARNER" ? redactExamForLearner(copy) : copy;
    });
}

/** Ghép đề đã công bố với số lượt và thời gian để tính trạng thái khả dụng cho học viên. */
export async function listLearnerExamSummaries(
  serviceContext: LearningServiceContext,
  classId: string | undefined,
  learnerId: string,
): Promise<LearnerExamSummary[]> {
  const timestamp = new Date();
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.exam.findMany({
      where: {
        hidden: false, status: "PUBLISHED",
        classId: classId || undefined,
        class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
      },
      include: {
        questions: { orderBy: { position: "asc" } },
        attempts: { where: { learnerId }, orderBy: { attemptNo: "asc" } },
      },
      orderBy: { openAt: "desc" },
    });
    return rows.map((row) => {
      const exam = serviceContext.mapExam(row);
      const active = row.attempts.some(
        (attempt) => attempt.status === "IN_PROGRESS",
      );
      return {
        ...redactExamForLearner(exam),
        questionCount: row.questions.length,
        availabilityStatus: serviceContext.examAvailability(
          exam,
          row.attempts.length,
          active,
          timestamp,
        ),
        remainingAttempts: Math.max(0, exam.attemptLimit - row.attempts.length),
        serverTime: timestamp.toISOString(),
      };
    });
  }
  return serviceContext.exams
    .filter((exam) => !exam.hidden && exam.status === "PUBLISHED")
    .filter((exam) => !classId || exam.classId === classId)
    .filter((exam) =>
      serviceContext.classes.some(
        (classItem) =>
          classItem.id === exam.classId &&
          classItem.learnerIds.includes(learnerId),
      ),
    )
    .map((exam) => {
      const attempts = serviceContext.attempts.filter(
        (attempt) =>
          attempt.examId === exam.id && attempt.learnerId === learnerId,
      );
      return {
        ...redactExamForLearner(exam),
        questionCount: exam.questionIds.length,
        availabilityStatus: serviceContext.examAvailability(
          exam,
          attempts.length,
          attempts.some((attempt) => attempt.status === "IN_PROGRESS"),
          timestamp,
        ),
        remainingAttempts: Math.max(0, exam.attemptLimit - attempts.length),
        serverTime: timestamp.toISOString(),
      };
    });
}

/** Trả câu hỏi cho học viên theo thứ tự seed nếu xáo trộn và loại dữ liệu đáp án đúng. */
export async function getExamQuestions(
  serviceContext: LearningServiceContext,
  examId: string,
  learnerId: string,
): Promise<LearningQuestion[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        hidden: false, status: "PUBLISHED",
        class: { enrollments: { some: { learnerId, status: "ACTIVE" } } },
        attempts: { some: { learnerId, status: "IN_PROGRESS" } },
      },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: "asc" },
        },
        attempts: { where: { learnerId, status: "IN_PROGRESS" }, take: 1 },
      },
    });
    if (!exam)
      throw new NotFoundException(
        "Không tìm thấy lượt làm bài đang mở cho đề này.",
      );
    const activeAttempt = exam.attempts[0];
    if (
      !activeAttempt ||
      serviceContext.attemptDeadline(
        activeAttempt.startedAt,
        exam.durationMinutes,
        exam.closeAt,
      ) <= new Date()
    ) {
      throw new BadRequestException("Lượt làm bài đã hết thời gian.");
    }
    const original = exam.questions.map(({ question, score }) => ({
      ...serviceContext.mapQuestion(question),
      points: Number(score),
    }));
    // Thứ tự xáo trộn gắn với từng lượt làm (id ngẫu nhiên do server sinh) nên không dự đoán trước được từ seed của đề.
    const questionIds = exam.shuffleQuestions
      ? serviceContext.seededOrder(
          original.map((question) => question.id),
          `${exam.randomSeed ?? "wind-exam-default"}:${activeAttempt.id}`,
        )
      : original.map((question) => question.id);
    const byId = new Map(original.map((question) => [question.id, question]));
    return questionIds.map((questionId) => ({
      ...byId.get(questionId)!,
      correctAnswers: [],
    }));
  }
  const exam = serviceContext.findExam(examId);
  if (exam.hidden || exam.status !== "PUBLISHED")
    throw new BadRequestException("Đề chưa được phát hành.");
  const classItem = serviceContext.findClass(exam.classId);
  if (!classItem.learnerIds.includes(learnerId))
    throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
  if (
    !serviceContext.attempts.some(
      (attempt) =>
        attempt.examId === examId &&
        attempt.learnerId === learnerId &&
        attempt.status === "IN_PROGRESS",
    )
  ) {
    throw new NotFoundException(
      "Không tìm thấy lượt làm bài đang mở cho đề này.",
    );
  }
  const activeAttempt = serviceContext.attempts.find(
    (attempt) =>
      attempt.examId === examId &&
      attempt.learnerId === learnerId &&
      attempt.status === "IN_PROGRESS",
  );
  if (
    !activeAttempt ||
    serviceContext.attemptDeadline(
      new Date(activeAttempt.startedAt),
      exam.durationMinutes,
      new Date(exam.closeAt),
    ) <= new Date()
  ) {
    throw new BadRequestException("Lượt làm bài đã hết thời gian.");
  }
  const questionIds = exam.shuffleQuestions
    ? serviceContext.seededOrder(
        exam.questionIds,
        `${exam.randomSeed ?? "wind-exam-default"}:${activeAttempt.id}`,
      )
    : exam.questionIds;
  return questionIds.map((questionId) => {
    const question = serviceContext.questions.find(
      (item) => item.id === questionId,
    );
    if (!question)
      throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
    return {
      ...question,
      options: [...question.options],
      correctAnswers: [],
      tags: [...question.tags],
      ...(exam.questionScores?.[questionId] !== undefined ? { points: exam.questionScores[questionId] } : {}),
    };
  });
}

/** Xác minh giảng viên phụ trách rồi trả câu hỏi theo đúng thứ tự gốc của đề. */
export async function getInstructorExamPreview(
  serviceContext: LearningServiceContext,
  examId: string,
  instructorId: string,
): Promise<LearningQuestion[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const exam = await prisma.exam.findFirst({
      where: {
        id: examId,
        class: { instructors: { some: { instructorId } } },
      },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!exam)
      throw new NotFoundException("Không tìm thấy đề thi được phép xem.");
    return withQuestionIssues(
      exam.questions.map(({ question }) => serviceContext.mapQuestion(question)),
    );
  }
  const exam = serviceContext.findExam(examId);
  if (
    !serviceContext.findClass(exam.classId).instructorIds.includes(instructorId)
  )
    throw new NotFoundException("Không tìm thấy đề thi được phép xem.");
  return withQuestionIssues(
    exam.questionIds.map((questionId) => {
      const question = serviceContext.questions.find(
        (item) => item.id === questionId,
      );
      if (!question)
        throw new NotFoundException("Đề chứa câu hỏi không tồn tại.");
      return {
        ...question,
        options: [...question.options],
        correctAnswers: [...question.correctAnswers],
        tags: [...question.tags],
      };
    }),
  );
}

/** Trả nội dung đề đã công bố (kèm đáp án) cho quản lý và ghi audit mỗi lần mở xem. */
export async function getReviewerExamPreview(
  serviceContext: LearningServiceContext,
  examId: string,
  actorId: string,
): Promise<LearningQuestion[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const exam = await prisma.exam.findFirst({
      where: { id: examId, hidden: false, status: "PUBLISHED" },
      include: {
        questions: {
          include: { question: true },
          orderBy: { position: "asc" },
        },
      },
    });
    if (!exam)
      throw new NotFoundException("Không tìm thấy đề đã công bố.");
    await prisma.auditLog.create({
      data: { actorId, action: "EXAM_PREVIEWED_BY_REVIEWER", entityType: "exam", entityId: examId, context: { classId: exam.classId, questionCount: exam.questions.length } },
    });
    return exam.questions.map(({ question }) =>
      serviceContext.mapQuestion(question),
    );
  }
  const exam = serviceContext.findExam(examId);
  if (exam.hidden || exam.status !== "PUBLISHED")
    throw new NotFoundException("Không tìm thấy đề đã công bố.");
  return exam.questionIds.map((questionId) =>
    serviceContext.cloneQuestion(
      serviceContext.questions.find((question) => question.id === questionId)!,
    ),
  );
}
