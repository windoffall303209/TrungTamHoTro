import { describe, expect, it } from "vitest";
import { resolveNotificationHref } from "@/shared/layout/workspace-shell";

describe("ánh xạ deep-link thông báo theo từng loại thực thể (D07)", () => {
  it.each([
    [{ entityType: "CLASS", entityId: "cls-01", type: "CLASS_ARCHIVED" }, "/courses/classes/cls-01"],
    [{ entityType: "MATERIAL", entityId: "mat-01", type: "MATERIAL_PUBLISHED" }, "/materials?materialId=mat-01"],
    [{ entityType: "QUESTION", entityId: "q-01", type: "QUESTION_UPDATED" }, "/questions?questionId=q-01"],
    [{ entityType: "EXAM", entityId: "exam-01", type: "EXAM_PUBLISHED" }, "/exams?examId=exam-01"],
    [{ entityType: "EXAM_ATTEMPT", entityId: "att-01", type: "REGRADE_RESOLVED" }, "/exams?attemptId=att-01"],
    [{ entityType: "ASSIGNMENT", entityId: "asg-01", type: "ASSIGNMENT_GRADED" }, "/academic?assignmentId=asg-01"],
    [{ entityType: "CLASS_ANNOUNCEMENT", entityId: "ann-01", type: "CLASS_ANNOUNCEMENT" }, "/academic?announcementId=ann-01"],
    [{ entityType: "LIVE_SESSION", entityId: "ses-01", type: "SESSION_SCHEDULED" }, "/live-classes?sessionId=ses-01"],
    [{ entityType: "SUPPORT_TICKET", entityId: "tkt-01", type: "SUPPORT_UPDATED" }, "/support?ticketId=tkt-01"],
    [{ entityType: "CHAT_CONVERSATION", entityId: "conv-01", type: "CHAT_MESSAGE" }, "/messages?conversationId=conv-01"],
    [{ entityType: "FORUM_TOPIC", entityId: "top-01", type: "FORUM_TOPIC_CREATED" }, "/forum?topicId=top-01"],
    [{ entityType: "FORUM_POST", entityId: "post-01", type: "FORUM_MENTION" }, "/forum?postId=post-01"],
  ])("điều hướng đúng cho %o", (item, expected) => {
    expect(resolveNotificationHref(item)).toBe(expected);
  });

  it("điều hướng thông báo lịch học vào tab Lịch học trong lớp cho học sinh, quản lý và quản trị viên", () => {
    const liveItem = {
      entityType: "LIVE_SESSION",
      entityId: "ses-01",
      classId: "cls-01",
      type: "LIVE_SESSION_SCHEDULED",
    };
    expect(resolveNotificationHref(liveItem, "INSTRUCTOR")).toBe(
      "/live-classes?classId=cls-01&sessionId=ses-01",
    );
    expect(resolveNotificationHref(liveItem, "LEARNER")).toBe(
      "/courses/classes/cls-01?tab=schedule&sessionId=ses-01",
    );
    expect(resolveNotificationHref(liveItem, "CENTER_MANAGER")).toBe(
      "/courses/classes/cls-01?tab=schedule&sessionId=ses-01",
    );
    expect(resolveNotificationHref(liveItem, "SYSTEM_ADMIN")).toBe(
      "/courses/classes/cls-01?tab=schedule&sessionId=ses-01",
    );
  });

  it("mã hóa an toàn entityId chứa ký tự đặc biệt và xử lý fallback hợp lệ", () => {
    expect(resolveNotificationHref({ entityType: "ASSIGNMENT", entityId: "id/1&x=2", type: "ASSIGNMENT_GRADED" })).toBe(
      "/academic?assignmentId=id%2F1%26x%3D2",
    );
    expect(resolveNotificationHref({ entityType: "UNKNOWN", entityId: "top-99", type: "FORUM_REPLY" })).toBe(
      "/forum?topicId=top-99",
    );
    expect(resolveNotificationHref({ entityType: "UNKNOWN", entityId: "misc", type: "SYSTEM_NOTICE" })).toBe(
      "/dashboard",
    );
  });
});
