import { id, now } from "../../core/learning.shared.js";
import type { ClassMemberHistory, InstructorRole } from "../../core/learning.types.js";
import type { LearningServiceContext } from "../../core/learning.context.js";

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
