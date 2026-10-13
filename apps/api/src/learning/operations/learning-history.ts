import { id, now } from "../learning.shared.js";
import type {
  ClassMemberHistory,
  ContentReport,
  InstructorRole,
  ModerationActionRecord,
} from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Ghi action kiểm duyệt và cập nhật báo cáo trong fallback in-memory. */
export function recordMemoryModeration(
  serviceContext: LearningServiceContext,
  report: ContentReport,
  actorId: string,
  action: ModerationActionRecord["action"],
  reason: string,
  nextStatus: ContentReport["status"],
): void {
  const timestamp = now();
  const record: ModerationActionRecord = {
    id: id("mod-action"),
    reportId: report.id,
    actorId,
    action,
    reason,
    previousStatus: report.status,
    nextStatus,
    createdAt: timestamp,
  };
  serviceContext.moderationActions.unshift(record);
  report.actions.push(record);
  report.status = nextStatus;
  report.updatedAt = timestamp;
}

/** Thêm dấu vết thay đổi thành viên lớp vào lịch sử in-memory. */
export function recordMemberHistory(
  serviceContext: LearningServiceContext,
  classId: string,
  memberId: string,
  memberType: ClassMemberHistory["memberType"],
  action: string,
  actorId: string,
  detail: { role?: InstructorRole; source?: string; reason?: string },
): void {
  serviceContext.classMemberHistory.unshift({
    id: `${classId}:${id("member-history")}`,
    memberId,
    memberType,
    action,
    actorId,
    createdAt: now(),
    ...detail,
  });
}
