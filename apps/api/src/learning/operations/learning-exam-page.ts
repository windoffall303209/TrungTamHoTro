import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import type { LearningServiceContext } from "../learning.context.js";
import type { LearningExam, LearnerExamSummary } from "../learning.types.js";
import { listExams, listLearnerExamSummaries } from "./learning-exams.js";

export interface ExamPageQuery { page: number; pageSize: number; classId?: string; focusId?: string }
export interface ExamPage { items: Array<LearningExam | LearnerExamSummary>; total: number; page: number; pageSize: number }

/** Chuẩn hóa query phân trang, từ chối số không nguyên, mảng và giá trị vượt giới hạn. */
export function parseExamPageQuery(raw: Record<string, unknown>): ExamPageQuery {
  /** Chỉ chấp nhận chuỗi số nguyên dương trong giới hạn của từng tham số. */
  const numeric = (key: string, fallback: number, max: number): number => {
    const value = raw[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
    return Number(value);
  };
  /** Giữ định danh nguyên vẹn và từ chối kiểu dữ liệu hoặc độ dài không hợp lệ. */
  const identifier = (key: string): string | undefined => {
    const value = raw[key];
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || value.length > 191 || value.trim() !== value)
      throw new BadRequestException(`Tham số ${key} không hợp lệ.`);
    return value;
  };
  return { page: numeric("page", 1, 100_000), pageSize: numeric("pageSize", 20, 100), classId: identifier("classId"), focusId: identifier("focusId") };
}

/** Lấy một trang đề trong đúng phạm vi vai trò; học viên chỉ đọc count và trạng thái lượt đang làm. */
export async function listExamPage(context: LearningServiceContext, role: string, actorId: string, query: ExamPageQuery): Promise<ExamPage> {
  if (!["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(role)) throw new ForbiddenException();
  const learner = role === "LEARNER";
  const database = context.database();
  if (!database) {
    const all = learner ? await listLearnerExamSummaries(context, query.classId, actorId) : await listExams(context, role, actorId);
    const visible = all.filter((item) => !query.classId || item.classId === query.classId)
      .sort((a, b) => b.openAt.localeCompare(a.openAt) || b.id.localeCompare(a.id));
    const index = query.focusId ? visible.findIndex((item) => item.id === query.focusId) : -1;
    const page = index >= 0 ? Math.floor(index / query.pageSize) + 1 : Math.min(query.page, Math.max(1, Math.ceil(visible.length / query.pageSize)));
    return { items: visible.slice((page - 1) * query.pageSize, page * query.pageSize), total: visible.length, page, pageSize: query.pageSize };
  }
  const where: Prisma.ExamWhereInput = {
    classId: query.classId,
    ...(learner ? { status: "PUBLISHED", class: { enrollments: { some: { learnerId: actorId, status: "ACTIVE" } } } }
      : role === "INSTRUCTOR" ? { class: { instructors: { some: { instructorId: actorId } } } } : {}),
  };
  return database.$transaction(async (transaction) => {
    const total = await transaction.exam.count({ where });
    let page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    if (query.focusId) {
      const focus = await transaction.exam.findFirst({ where: { ...where, id: query.focusId }, select: { id: true, openAt: true } });
      if (focus) {
        const before = await transaction.exam.count({ where: { AND: [where, { OR: [{ openAt: { gt: focus.openAt } }, { openAt: focus.openAt, id: { gt: focus.id } }] }] } });
        page = Math.floor(before / query.pageSize) + 1;
      }
    }
    const window = { where, skip: (page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ openAt: "desc" as const }, { id: "desc" as const }] };
    if (learner) {
      const rows = await transaction.exam.findMany({ ...window, include: {
        _count: { select: { questions: true, attempts: { where: { learnerId: actorId } } } },
        attempts: { where: { learnerId: actorId, status: "IN_PROGRESS" }, select: { id: true }, take: 1 },
      } });
      const timestamp = new Date();
      const items = rows.map((row) => {
        const exam = context.mapExam({ ...row, questions: [] });
        return { ...exam, questionCount: row._count.questions,
          availabilityStatus: context.examAvailability(exam, row._count.attempts, row.attempts.length > 0, timestamp),
          remainingAttempts: Math.max(0, row.attemptLimit - row._count.attempts), serverTime: timestamp.toISOString() };
      });
      return { items, total, page, pageSize: query.pageSize };
    }
    const rows = await transaction.exam.findMany({ ...window, include: { questions: { orderBy: { position: "asc" } } } });
    return { items: rows.map((row) => context.mapExam(row)), total, page, pageSize: query.pageSize };
  }, { isolationLevel: "RepeatableRead" });
}
