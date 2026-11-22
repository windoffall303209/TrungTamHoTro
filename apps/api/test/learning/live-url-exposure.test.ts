import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";
import { assertPublicHttpsUrl } from "../../src/infrastructure/safe-provider-fetch.js";

describe("Không lộ link phòng học, bản ghi và chặn SSRF ở URL cấu hình", () => {
  it("chỉ nhận URL HTTPS tới host công khai", () => {
    expect(assertPublicHttpsUrl(" https://drive.example.com/rec ", "x")).toBe("https://drive.example.com/rec");
    for (const value of ["http://drive.example.com/rec", "javascript:alert(1)", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/hook", "https://user:pass@example.com", "https://svc.internal/x", "không phải URL"])
      expect(() => assertPublicHttpsUrl(value, "Sai")).toThrow(BadRequestException);
  });

  it("học viên không nhận attendeeUrl/hostUrl/recordingUrl trong danh sách buổi học", async () => {
    const service = new LearningService();
    const learnerSessions = await service.listSessions("LEARNER", "usr-learner");
    expect(learnerSessions.length).toBeGreaterThan(0);
    for (const session of learnerSessions) expect(session).toMatchObject({ hostUrl: "", attendeeUrl: "" });
    expect(learnerSessions.every((session) => session.recordingUrl === undefined)).toBe(true);
    const instructorSessions = await service.listSessions("INSTRUCTOR", "usr-instructor");
    expect(instructorSessions.some((session) => session.attendeeUrl)).toBe(true);
  });

  it("từ chối gắn bản ghi trỏ vào mạng nội bộ", async () => {
    const service = new LearningService();
    await service.transitionSession("session-web-01", "LIVE", "usr-instructor");
    await service.transitionSession("session-web-01", "COMPLETED", "usr-instructor");
    await expect(service.attachRecording("session-web-01", "http://169.254.169.254/latest", "usr-instructor")).rejects.toThrow("HTTPS");
    await expect(service.attachRecording("session-web-01", "https://recording.example/ok", "usr-instructor")).resolves.toMatchObject({ recordingStatus: "PROCESSING" });
  });

  it("webhook tích hợp không được trỏ tới IP nội bộ", async () => {
    const service = new SystemService();
    await expect(service.configureIntegration({ provider: "ZOOM", credentialReference: "vault://zoom", webhookUrl: "https://10.1.2.3/hook" }, "usr-admin")).rejects.toThrow("HTTPS");
    await expect(service.configureIntegration({ provider: "ZOOM", credentialReference: "vault://zoom", webhookUrl: "https://hooks.wind.edu.vn/zoom" }, "usr-admin")).resolves.toMatchObject({ webhookConfigured: true });
  });
});
