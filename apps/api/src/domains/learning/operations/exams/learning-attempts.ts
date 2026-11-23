import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { id, now } from "../../core/learning.shared.js";
import type { ExamAttempt, LearnerResult, LearningExam } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

/** Ẩn điểm của lượt chưa công bố (ví dụ phần trắc nghiệm của đề có tự luận đang chờ chấm) khỏi phản hồi cho học viên. */
export function redactAttemptForLearner(attempt: ExamAttempt): ExamAttempt {
  if (attempt.gradePublishedAt) return attempt;
  const redacted = { ...attempt };
  delete redacted.score;
  return redacted;
}

/** Kiểm tra ghi danh, cửa sổ thi, giới hạn lượt rồi tạo hoặc tiếp tục lượt đang làm. */
export async function startAttempt(
  serviceContext: LearningServiceContext,
  examId: string,
  learnerId: string,
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    const active = await prisma.examAttempt.findFirst({
      where: { examId, learnerId, status: "IN_PROGRESS" },
      include: { exam: true },
    });
    if (
      active && !active.exam.hidden &&
      serviceContext.attemptDeadline(
        active.startedAt,
        active.exam.durationMinutes,
        active.exam.closeAt,
      ) <= new Date()
    )
      await serviceContext.submitAttempt(active.id, learnerId, "SYSTEM");
    return prisma.$transaction(async (transaction) => {
      const exam = await transaction.exam.findUnique({
        where: { id: examId },
        include: {
          class: {
            include: {
              enrollments: { where: { learnerId, status: "ACTIVE" } },
            },
          },
        },
      });
      if (!exam) throw new NotFoundException("Không tìm thấy đề.");
      if (exam.hidden) throw new NotFoundException("Không tìm thấy đề.");
    if (exam.status !== "PUBLISHED")
        throw new BadRequestException("Đề chưa được phát hành.");
      if (!exam.class.enrollments.length)
        throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
      const timestamp = new Date();
      if (timestamp < exam.openAt || timestamp > exam.closeAt)
        throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
      const attempts = await transaction.examAttempt.findMany({
        where: { examId, learnerId },
        include: { answers: true },
        orderBy: { attemptNo: "asc" },
      });
      const existing = attempts.find((item) => item.status === "IN_PROGRESS");
      if (existing) {
        return serviceContext.mapAttempt(existing);
      }
      if (attempts.length >= exam.attemptLimit)
        throw new BadRequestException("Đã hết số lần làm bài.");
      const created = await transaction.examAttempt.create({
        data: {
          id: id("attempt"),
          examId,
          learnerId,
          attemptNo: attempts.length + 1,
        },
        include: { answers: true },
      });
      return serviceContext.mapAttempt(created);
    });
  }
  const exam = serviceContext.findExam(examId);
  if (exam.hidden) throw new NotFoundException("Không tìm thấy đề.");
  if (exam.status !== "PUBLISHED")
    throw new BadRequestException("Đề chưa được phát hành.");
  const timestamp = new Date();
  if (timestamp < new Date(exam.openAt) || timestamp > new Date(exam.closeAt))
    throw new BadRequestException("Đề chưa mở hoặc đã đóng.");
  const classItem = serviceContext.findClass(exam.classId);
  if (!classItem.learnerIds.includes(learnerId))
    throw new NotFoundException("Học viên không thuộc lớp được giao đề.");
  const attempts = serviceContext.attempts.filter(
    (item) => item.examId === examId && item.learnerId === learnerId,
  );
  const existing = attempts.find((item) => item.status === "IN_PROGRESS");
  if (existing) {
    if (
      serviceContext.attemptDeadline(
        new Date(existing.startedAt),
        exam.durationMinutes,
        new Date(exam.closeAt),
      ) <= timestamp
    )
      await serviceContext.submitAttempt(existing.id, learnerId, "SYSTEM");
    else return { ...existing, answers: { ...existing.answers } };
  }
  if (attempts.length >= exam.attemptLimit)
    throw new BadRequestException("Đã hết số lần làm bài.");
  const item: ExamAttempt = {
    id: id("attempt"),
    attemptNo: attempts.length + 1,
    examId,
    learnerId,
    answers: {},
    status: "IN_PROGRESS",
    startedAt: now(),
  };
  serviceContext.attempts.push(item);
  return { ...item, answers: {} };
}

/** Validate đáp án thuộc đề và upsert câu trả lời khi lượt thi còn trong hạn. */
export async function saveAnswer(
  serviceContext: LearningServiceContext,
  attemptId: string,
  questionId: string,
  answers: string[],
  learnerId: string,
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
      // Hậu kiểm mỗi lần lưu: học viên bị đình chỉ, đề bị thu hồi hoặc lớp đã đóng thì không ghi tiếp.
      const attempt = await transaction.examAttempt.findFirst({
        where: { id: attemptId, learnerId, exam: activeExamForLearner(learnerId) },
        include: { exam: true },
      });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS")
        throw new BadRequestException("Bài làm đã khóa.");
      if (
        serviceContext.attemptDeadline(
          attempt.startedAt,
          attempt.exam.durationMinutes,
          attempt.exam.closeAt,
        ) <= new Date()
      )
        throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
      const examQuestion = await transaction.examQuestion.findUnique({
        where: { examId_questionId: { examId: attempt.examId, questionId } },
        include: { question: true },
      });
      if (!examQuestion)
        throw new BadRequestException("Câu hỏi không thuộc đề.");
      const normalizedAnswers = serviceContext.validateSubmittedAnswers(
        serviceContext.mapQuestion(examQuestion.question),
        answers,
      );
      await transaction.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        update: { answerData: normalizedAnswers },
        create: { attemptId, questionId, answerData: normalizedAnswers },
      });
      return redactAttemptForLearner(await serviceContext.getDatabaseAttempt(transaction, attemptId));
    });
  }
  const item = serviceContext.attempts.find(
    (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  if (item.status !== "IN_PROGRESS")
    throw new BadRequestException("Bài làm đã khóa.");
  const exam = serviceContext.findExam(item.examId);
  assertMemoryExamActiveForLearner(serviceContext, exam, learnerId);
  if (
    serviceContext.attemptDeadline(
      new Date(item.startedAt),
      exam.durationMinutes,
      new Date(exam.closeAt),
    ) <= new Date()
  )
    throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
  if (!exam.questionIds.includes(questionId))
    throw new BadRequestException("Câu hỏi không thuộc đề.");
  const question = serviceContext.questions.find(
    (candidate) => candidate.id === questionId,
  );
  if (!question) throw new BadRequestException("Câu hỏi không tồn tại.");
  item.answers[questionId] = serviceContext.validateSubmittedAnswers(
    question,
    answers,
  );
  item.lastSavedAt = now();
  return redactAttemptForLearner({ ...item, answers: { ...item.answers }, serverTime: now() });
}

/**
 * Lưu gộp nhiều câu trả lời trong một transaction: khóa lượt thi một lần, kiểm hạn một lần và nạp các câu hỏi
 * của đề bằng một truy vấn, thay cho N request PATCH (dễ chạm rate limit đúng lúc nộp bài).
 */
export async function saveAnswers(
  serviceContext: LearningServiceContext,
  attemptId: string,
  entries: Array<{ questionId: string; answers: string[] }>,
  learnerId: string,
): Promise<void> {
  if (!entries.length) return;
  const prisma = serviceContext.database();
  if (!prisma) {
    for (const entry of entries) await saveAnswer(serviceContext, attemptId, entry.questionId, entry.answers, learnerId);
    return;
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
    const attempt = await transaction.examAttempt.findFirst({
      where: { id: attemptId, learnerId, exam: activeExamForLearner(learnerId) },
      include: { exam: true },
    });
    if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
    if (attempt.status !== "IN_PROGRESS")
      throw new BadRequestException("Bài làm đã khóa.");
    if (serviceContext.attemptDeadline(attempt.startedAt, attempt.exam.durationMinutes, attempt.exam.closeAt) <= new Date())
      throw new BadRequestException("Đã hết thời gian lưu câu trả lời.");
    const examQuestions = await transaction.examQuestion.findMany({
      where: { examId: attempt.examId, questionId: { in: entries.map((entry) => entry.questionId) } },
      include: { question: true },
    });
    const byId = new Map(examQuestions.map((item) => [item.questionId, item]));
    for (const entry of entries) {
      const examQuestion = byId.get(entry.questionId);
      if (!examQuestion) throw new BadRequestException("Câu hỏi không thuộc đề.");
      const normalizedAnswers = serviceContext.validateSubmittedAnswers(serviceContext.mapQuestion(examQuestion.question), entry.answers);
      await transaction.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: entry.questionId } },
        update: { answerData: normalizedAnswers },
        create: { attemptId, questionId: entry.questionId, answerData: normalizedAnswers },
      });
    }
  });
}

/** Chốt lượt thi nguyên tử, tự chấm câu khách quan và phát receipt chống nhầm lẫn. */
export async function submitAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
  learnerId: string,
  trigger: "LEARNER" | "SYSTEM" = "LEARNER",
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM exam_attempts WHERE id = ${attemptId} FOR UPDATE`;
      // Học viên tự nộp phải còn ghi danh ACTIVE trên đề đang phát hành của lớp chưa đóng; tiến trình hệ thống
      // vẫn chốt được lượt quá hạn để không để lượt IN_PROGRESS treo vĩnh viễn.
      const attempt = await transaction.examAttempt.findFirst({
        where: { id: attemptId, learnerId, exam: trigger === "SYSTEM" ? { hidden: false } : activeExamForLearner(learnerId) },
        include: {
          answers: true,
          exam: { include: { questions: { include: { question: true } } } },
        },
      });
      if (!attempt) throw new NotFoundException("Không tìm thấy lượt làm bài.");
      if (attempt.status !== "IN_PROGRESS")
        return redactAttemptForLearner(serviceContext.mapAttempt(attempt));
      const submittedAt = new Date();
      const claimed = await transaction.examAttempt.updateMany({
        where: { id: attemptId, learnerId, status: "IN_PROGRESS" },
        data: { status: "SUBMITTED", submittedAt },
      });
      if (!claimed.count)
        return redactAttemptForLearner(await serviceContext.getDatabaseAttempt(transaction, attemptId));
      let score = 0;
      let requiresManualGrade = false;
      const answersByQuestion = new Map(attempt.answers.map((item) => [item.questionId, item]));
      const scoredQuestionIds: string[] = [];
      const scoredValues: number[] = [];
      for (const examQuestion of attempt.exam.questions) {
        const requiresManualAnswer = ["SHORT_ANSWER", "ESSAY"].includes(
          examQuestion.question.type,
        );
        if (requiresManualAnswer) {
          requiresManualGrade = true;
          continue;
        }
        const answer = answersByQuestion.get(examQuestion.questionId);
        const submitted = serviceContext.toStringArray(
          answer?.answerData ?? [],
        );
        const isCorrect = serviceContext.isQuestionAnswerCorrect(
          serviceContext.mapQuestion(examQuestion.question),
          submitted,
        );
        const awarded = isCorrect ? Number(examQuestion.score) : 0;
        score += awarded;
        if (answer) {
          scoredQuestionIds.push(examQuestion.questionId);
          scoredValues.push(awarded);
        }
      }
      // Ghi điểm mọi câu khách quan bằng một lệnh thay vì N lệnh tuần tự giữ khóa transaction.
      if (scoredQuestionIds.length)
        await transaction.$executeRaw`
          UPDATE attempt_answers AS answer
          SET score = scored.score, updated_at = NOW()
          FROM unnest(${scoredQuestionIds}::text[], ${scoredValues}::numeric[]) AS scored(question_id, score)
          WHERE answer.attempt_id = ${attemptId} AND answer.question_id = scored.question_id`;
      const updated = await transaction.examAttempt.update({
        where: { id: attemptId },
        data: {
          score,
          submittedAt,
          status: requiresManualGrade ? "SUBMITTED" : "GRADED",
          gradePublishedAt: requiresManualGrade ? null : submittedAt,
          feedback: requiresManualGrade
            ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
            : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.",
        },
        include: { answers: true },
      });
      return redactAttemptForLearner(serviceContext.mapAttempt(updated));
    });
  }
  const item = serviceContext.attempts.find(
    (attempt) => attempt.id === attemptId && attempt.learnerId === learnerId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy lượt làm bài.");
  if (item.status !== "IN_PROGRESS")
    return redactAttemptForLearner({ ...item, answers: { ...item.answers } });
  const exam = serviceContext.findExam(item.examId);
  if (exam.hidden) throw new NotFoundException("Không tìm thấy đề.");
  if (trigger === "LEARNER") assertMemoryExamActiveForLearner(serviceContext, exam, learnerId);
  let objectiveScore = 0;
  let requiresManualGrade = false;
  exam.questionIds.forEach((questionId) => {
    const question = serviceContext.questions.find(
      (candidate) => candidate.id === questionId,
    );
    if (!question) return;
    if (["SHORT_ANSWER", "ESSAY"].includes(question.type)) {
      requiresManualGrade = true;
      return;
    }
    if (
      serviceContext.isQuestionAnswerCorrect(
        question,
        item.answers[questionId] ?? [],
      )
    )
      objectiveScore += serviceContext.examQuestionScore(exam, questionId);
  });
  item.score = Math.round(objectiveScore * 100) / 100;
  item.status = requiresManualGrade ? "SUBMITTED" : "GRADED";
  item.submittedAt = now();
  item.submissionReceipt = serviceContext.submissionReceipt(
    item,
    item.submittedAt,
  );
  item.gradePublishedAt = requiresManualGrade ? undefined : now();
  item.feedback = requiresManualGrade
    ? "Bài đang chờ giảng viên chấm câu tự luận hoặc câu trả lời ngắn."
    : "Bài đã được chấm tự động. Giảng viên có thể bổ sung nhận xét.";
  return redactAttemptForLearner({ ...item, answers: { ...item.answers } });
}

/** Tìm lượt IN_PROGRESS quá hạn theo lô và nộp tự động bằng cùng logic submit. */
export async function reconcileExpiredAttempts(
  serviceContext: LearningServiceContext,
  limit = 100,
): Promise<number> {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const prisma = serviceContext.database();
  if (prisma) {
    const candidates = await prisma.examAttempt.findMany({
      where: { status: "IN_PROGRESS", exam: { hidden: false } },
      include: { exam: true },
      orderBy: { startedAt: "asc" },
      take: 500,
    });
    const timestamp = new Date();
    const expired = candidates
      .filter(
        (attempt) =>
          serviceContext.attemptDeadline(
            attempt.startedAt,
            attempt.exam.durationMinutes,
            attempt.exam.closeAt,
          ) <= timestamp,
      )
      .slice(0, boundedLimit);
    const results = await Promise.allSettled(
      expired.map((attempt) =>
        serviceContext.submitAttempt(attempt.id, attempt.learnerId, "SYSTEM"),
      ),
    );
    return results.filter((result) => result.status === "fulfilled").length;
  }
  const timestamp = new Date();
  const expired = serviceContext.attempts
    .filter((attempt) => {
      const exam = serviceContext.findExam(attempt.examId);
      return (
        !exam.hidden && attempt.status === "IN_PROGRESS" &&
        serviceContext.attemptDeadline(
          new Date(attempt.startedAt),
          exam.durationMinutes,
          new Date(exam.closeAt),
        ) <= timestamp
      );
    })
    .slice(0, boundedLimit);
  for (const attempt of expired)
    await serviceContext.submitAttempt(attempt.id, attempt.learnerId, "SYSTEM");
  return expired.length;
}

/** Đọc một lượt thi và ánh xạ đáp án từ Prisma hoặc kho nhớ. */
export async function getAttempt(
  serviceContext: LearningServiceContext,
  attemptId: string,
): Promise<ExamAttempt> {
  const prisma = serviceContext.database();
  if (prisma) return serviceContext.getDatabaseAttempt(prisma, attemptId);
  const item = serviceContext.findAttempt(attemptId);
  return { ...item, answers: { ...item.answers } };
}

/** Liệt kê kết quả đã nộp/chấm của học viên cùng trạng thái phúc khảo. */
export async function listLearnerResults(
  serviceContext: LearningServiceContext,
  learnerId: string,
): Promise<LearnerResult[]> {
  return collectLearnerResults(serviceContext, learnerId, "BEST");
}

/** Chọn lượt đại diện của mỗi đề: điểm cao nhất (như sổ điểm), hòa điểm thì lấy lượt mới hơn. */
function pickBestAttempts<T>(rows: T[], key: (row: T) => { examId: string; score: number; attemptNo: number }): T[] {
  const best = new Map<string, { row: T; score: number; attemptNo: number }>();
  for (const row of rows) {
    const { examId, score, attemptNo } = key(row);
    const current = best.get(examId);
    if (!current || score > current.score || (score === current.score && attemptNo > current.attemptNo)) best.set(examId, { row, score, attemptNo });
  }
  return [...best.values()].map((item) => item.row);
}

/**
 * Gom kết quả đã công bố của học viên. "BEST" trả một lượt điểm cao nhất mỗi đề (trước đây lấy lượt mới nhất nên thi
 * lại điểm thấp hơn làm "mất" kết quả tốt); "ALL" trả mọi lượt để xem chi tiết lượt cũ không còn bị 404.
 */
async function collectLearnerResults(
  serviceContext: LearningServiceContext,
  learnerId: string,
  mode: "BEST" | "ALL",
): Promise<LearnerResult[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.examAttempt.findMany({
      where: { learnerId, exam: { hidden: false }, status: "GRADED", gradePublishedAt: { not: null } },
      include: {
        answers: true,
        exam: {
          include: {
            questions: {
              include: { question: true },
              orderBy: { position: "asc" },
            },
          },
        },
        regradeRequests: {
          where: { learnerId },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ examId: "asc" }, { attemptNo: "desc" }],
    });
    const selected = mode === "ALL" ? rows : pickBestAttempts(rows, (row) => ({ examId: row.examId, score: Number(row.score ?? 0), attemptNo: row.attemptNo }));
    const timestamp = new Date();
    return selected.sort((a, b) => b.gradePublishedAt!.getTime() - a.gradePublishedAt!.getTime()).map((row) => withBreakdownPolicy({
      attempt: serviceContext.mapAttempt(row),
      exam: {
        id: row.exam.id,
        title: row.exam.title,
        totalScore: Number(row.exam.totalScore),
        closeAt: row.exam.closeAt.toISOString(),
      },
      answerBreakdown: row.exam.questions.map((examQuestion) => {
        const answer = row.answers.find(
          (item) => item.questionId === examQuestion.questionId,
        );
        return {
          questionId: examQuestion.questionId,
          content: examQuestion.question.content,
          submittedAnswers: serviceContext.toStringArray(
            answer?.answerData ?? [],
          ),
          awardedScore: Number(answer?.score ?? 0),
          maxScore: Number(examQuestion.score),
        };
      }),
      regradeRequest: row.regradeRequests[0]
        ? serviceContext.mapRegradeRequest(row.regradeRequests[0])
        : undefined,
    }, timestamp));
  }
  const published = serviceContext.attempts.filter(
    (attempt) => attempt.learnerId === learnerId && attempt.status === "GRADED" && Boolean(attempt.gradePublishedAt),
  );
  const chosen: ExamAttempt[] = mode === "ALL"
    ? published
    : pickBestAttempts(published, (attempt) => ({ examId: attempt.examId, score: attempt.score ?? 0, attemptNo: attempt.attemptNo ?? 0 }));
  return chosen
    .filter(
      (attempt) =>
        !serviceContext.findExam(attempt.examId).hidden,
    )
    .sort((left, right) =>
      (right.gradePublishedAt ?? "").localeCompare(left.gradePublishedAt ?? ""),
    )
    .map((attempt) => {
      const exam = serviceContext.findExam(attempt.examId);
      return withBreakdownPolicy({
        attempt: { ...attempt, answers: structuredClone(attempt.answers) },
        exam: {
          id: exam.id,
          title: exam.title,
          totalScore: exam.totalScore,
          closeAt: exam.closeAt,
        },
        answerBreakdown: exam.questionIds.map((questionId) => ({
          questionId,
          content:
            serviceContext.questions.find(
              (question) => question.id === questionId,
            )?.content ?? "Câu hỏi không còn tồn tại",
          submittedAnswers: [...(attempt.answers[questionId] ?? [])],
          awardedScore: serviceContext.isMemoryAnswerCorrect(
            questionId,
            attempt.answers[questionId] ?? [],
          )
            ? serviceContext.examQuestionScore(exam, questionId)
            : 0,
          maxScore: serviceContext.examQuestionScore(exam, questionId),
        })),
        regradeRequest: serviceContext.regradeRequests.find(
          (request) =>
            request.attemptId === attempt.id && request.learnerId === learnerId,
        ),
      }, new Date());
    });
}

/**
 * Chính sách công bố mặc định: tổng điểm trả ngay, điểm từng câu chỉ trả khi đề đã đóng; trước đó gỡ awardedScore
 * để học viên không dùng lượt trước dò đáp án cho lượt sau hoặc chuyển đáp án cho bạn đang thi.
 */
function withBreakdownPolicy(result: LearnerResult, timestamp: Date): LearnerResult {
  if (timestamp >= new Date(result.exam.closeAt)) return result;
  return {
    ...result,
    answerBreakdown: result.answerBreakdown.map((item) => {
      const visible = { ...item };
      delete visible.awardedScore;
      return visible;
    }),
    breakdownVisibleAt: result.exam.closeAt,
  };
}

/** Điều kiện Prisma cho đề mà học viên còn được làm: đang phát hành, không ẩn, lớp chưa đóng và ghi danh ACTIVE. */
function activeExamForLearner(learnerId: string): Prisma.ExamWhereInput {
  return {
    hidden: false,
    status: "PUBLISHED",
    class: { status: { not: "CLOSED" }, enrollments: { some: { learnerId, status: "ACTIVE" } } },
  };
}

/** Bản in-memory của activeExamForLearner cho chế độ dữ liệu mẫu. */
function assertMemoryExamActiveForLearner(serviceContext: LearningServiceContext, exam: LearningExam, learnerId: string): void {
  if (exam.hidden || exam.status !== "PUBLISHED") throw new NotFoundException("Không tìm thấy đề.");
  const classItem = serviceContext.findClass(exam.classId);
  if (classItem.status === "CLOSED" || !classItem.learnerIds.includes(learnerId)) throw new NotFoundException("Không tìm thấy lượt làm bài.");
}

/** Trả đúng kết quả thuộc học viên, từ chối truy cập chéo lượt thi. */
export async function getLearnerResult(
  serviceContext: LearningServiceContext,
  attemptId: string,
  learnerId: string,
): Promise<LearnerResult> {
  const result = (await collectLearnerResults(serviceContext, learnerId, "ALL")).find(
    (item) => item.attempt.id === attemptId,
  );
  if (!result)
    throw new NotFoundException(
      "Kết quả chưa được công bố hoặc không thuộc học viên hiện tại.",
    );
  return result;
}
