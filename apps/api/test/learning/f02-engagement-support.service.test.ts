import { describe, expect, it } from "vitest";
import { createLearningTestRuntime } from "../../src/domains/learning/core/learning-runtime.service.js";
import { EngagementSupportService } from "../../src/domains/learning/engagement/engagement-support.service.js";

describe("F02c EngagementSupportService slice", () => {
  it("vận hành trọn vòng đời diễn đàn, phiếu hỗ trợ và biện pháp tiến độ độc lập với LearningService", async () => {
    const runtime = createLearningTestRuntime();
    const engagement = new EngagementSupportService(runtime);

    const topic = await engagement.createTopic(
      "class-web-01",
      {
        title: "Hỏi đáp lát cắt F02c",
        body: "Trao đổi tách dịch vụ tương tác học tập khỏi LearningService.",
        tags: ["f02"],
        isPinned: false,
      },
      "usr-learner",
      "LEARNER",
    );
    const post = await engagement.createPost(topic.id, "Đã kiểm tra phản hồi diễn đàn.", "usr-instructor");
    expect(post.topicId).toBe(topic.id);

    const ticket = await engagement.createTicket(
      {
        category: "TECHNICAL",
        severity: "P2",
        description: "Không mở được phòng học thử nghiệm ở lớp WEB-K01.",
      },
      "usr-learner",
    );
    const comment = await engagement.addTicketComment(
      ticket.id,
      "Đã tiếp nhận kiểm tra cấu hình phòng học.",
      "SYSTEM_ADMIN",
      "usr-admin",
    );
    expect(comment.ticketId).toBe(topic.id ? ticket.id : "");

    const resolved = await engagement.updateTicket(
      ticket.id,
      { status: "RESOLVED", resolution: "Đã cập nhật lại liên kết phòng học trực tuyến." },
      "usr-admin",
    );
    expect(resolved.status).toBe("RESOLVED");

    const closed = await engagement.closeTicketByReporter(ticket.id, "usr-learner");
    expect(closed.status).toBe("CLOSED");

    const intervention = await engagement.createProgressIntervention(
      "class-web-01",
      {
        learnerId: "usr-learner",
        title: "Nhắc hoàn thành bài tập tuần 2",
        notes: "Theo dõi tiến độ trước kỳ thi giữa kỳ.",
        dueAt: new Date(Date.now() + 72 * 60 * 60_000).toISOString(),
        assigneeId: "usr-instructor",
      },
      "usr-manager",
      "CENTER_MANAGER",
    );
    expect(intervention.status).toBe("OPEN");
    const mine = await engagement.listMyProgressInterventions("usr-instructor");
    expect(mine.some((item) => item.id === intervention.id)).toBe(true);
  });
});
