import { NotFoundException } from "@nestjs/common";
import type { AuthenticatedSession } from "../../auth/auth.service.js";
import { AcademicCalendarEvent } from "../academic.shared.js";
import type { AcademicServiceContext } from "../academic.context.js";

/** Hợp nhất các mốc lớp, buổi học, đề thi và bài tập rồi sắp xếp theo thời gian. */
export async function calendar(
  serviceContext: AcademicServiceContext,
  session: AuthenticatedSession,
  classId?: string,
): Promise<AcademicCalendarEvent[]> {
  const classIds = await serviceContext.accessibleClassIds(session);
  if (classId && !classIds.includes(classId))
    throw new NotFoundException(
      "Không tìm thấy lớp học trong phạm vi truy cập.",
    );
  const classes = await serviceContext.prisma.learningClass.findMany({
    where: { id: classId ?? { in: classIds } },
    include: {
      sessions: { where: { status: { not: "CANCELLED" } } },
      exams: { where: { status: { in: ["PUBLISHED", "CLOSED"] } } },
      assignments: { where: { status: { in: ["PUBLISHED", "CLOSED"] } } },
    },
  });
  const events: AcademicCalendarEvent[] = [];
  for (const item of classes) {
    events.push({
      id: `class-${item.id}`,
      classId: item.id,
      classCode: item.code,
      type: "CLASS",
      title: `Thời gian lớp ${item.name}`,
      startAt: item.startAt.toISOString(),
      endAt: item.endAt.toISOString(),
      href: `/courses/classes/${encodeURIComponent(item.id)}`,
    });
    events.push(
      ...item.sessions.map((sessionItem) => ({
        id: `session-${sessionItem.id}`,
        classId: item.id,
        classCode: item.code,
        type: "LIVE_SESSION" as const,
        title: sessionItem.title,
        startAt: sessionItem.startsAt.toISOString(),
        endAt: sessionItem.endsAt.toISOString(),
        href: `/live-classes?classId=${encodeURIComponent(item.id)}&sessionId=${encodeURIComponent(sessionItem.id)}`,
      })),
    );
    events.push(
      ...item.exams.flatMap((exam) => [
        {
          id: `exam-open-${exam.id}`,
          classId: item.id,
          classCode: item.code,
          type: "EXAM" as const,
          title: `Mở đề: ${exam.title}`,
          startAt: exam.openAt.toISOString(),
          href: `/exams?classId=${encodeURIComponent(item.id)}&examId=${encodeURIComponent(exam.id)}`,
        },
        {
          id: `exam-close-${exam.id}`,
          classId: item.id,
          classCode: item.code,
          type: "EXAM" as const,
          title: `Đóng đề: ${exam.title}`,
          startAt: exam.closeAt.toISOString(),
          href: `/exams?classId=${encodeURIComponent(item.id)}&examId=${encodeURIComponent(exam.id)}`,
        },
      ]),
    );
    events.push(
      ...item.assignments.map((assignment) => ({
        id: `assignment-${assignment.id}`,
        classId: item.id,
        classCode: item.code,
        type: "ASSIGNMENT" as const,
        title: `Hạn bài: ${assignment.title}`,
        startAt: assignment.dueAt.toISOString(),
        href: `/academic?classId=${encodeURIComponent(item.id)}&assignmentId=${encodeURIComponent(assignment.id)}`,
      })),
    );
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt));
}
