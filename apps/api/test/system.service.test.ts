import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SystemService } from "../src/system/system.service.js";

describe("SystemService", () => {
  it("tạo backup có checksum và chỉ phục hồi khi có người phê duyệt", async () => {
    const service = new SystemService();
    const backup = await service.runBackup("FULL");
    expect(backup.checksum).toMatch(/^sha256:/);
    await expect(service.restoreBackup(backup.id, "")).rejects.toThrow(BadRequestException);
    expect((await service.restoreBackup(backup.id, "Wind Of Fall")).verification).toContain("hợp lệ");
  });

  it("chặn mã script trong mẫu thông báo", async () => {
    const service = new SystemService();
    await expect(service.saveTemplate({ eventCode: "TEST", locale: "vi-VN", subject: "Kiểm tra", body: "<script>alert(1)</script>" })).rejects.toThrow(BadRequestException);
  });

  it("kiểm soát biến, giữ phiên bản và gửi thử mẫu thông báo", async () => {
    const service = new SystemService();
    await expect(service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề {{unknown}}", body: "Mở lúc {{openAt}}" })).rejects.toThrow("không được phép");
    const first = await service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề {{examTitle}}", body: "Lớp {{className}} mở lúc {{openAt}} và đóng lúc {{closeAt}}" });
    const second = await service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề mới {{examTitle}}", body: "Lớp {{className}} mở {{openAt}}, đóng {{closeAt}}" });
    expect(second.version).toBe(first.version + 1);
    expect((await service.listTemplates()).find((item) => item.eventCode === "EXAM_PUBLISHED")?.id).toBe(second.id);
    const delivery = await service.sendTemplateTest(second.id, "admin@wind.edu.vn", { examTitle: "Giữa kỳ", className: "WEB-K01", openAt: "08:00", closeAt: "09:00" });
    expect(delivery.status).toBe("DELIVERED");
    expect(delivery.subject).toContain("Giữa kỳ");
    await expect(service.sendTemplateTest(second.id, "admin@wind.edu.vn", {})).rejects.toThrow("Chưa cung cấp biến");
  });

  it("chỉ bật provider sau health check và tạo phòng thử bằng provider mặc định", async () => {
    const service = new SystemService();
    await expect(service.configureIntegration({ provider: "GOOGLE_MEET" })).rejects.toThrow("credential");
    const configured = await service.configureIntegration({ provider: "GOOGLE_MEET", credentialReference: "vault://meeting/google", webhookUrl: "https://hooks.wind.edu.vn/meet" });
    expect(configured.maskedCredential).toBe("••••••••");
    expect(JSON.stringify(configured)).not.toContain("vault://meeting/google");
    await expect(service.updateIntegration(configured.id, true)).rejects.toThrow("health check");
    expect((await service.testIntegration(configured.id)).healthStatus).toBe("HEALTHY");
    expect((await service.updateIntegration(configured.id, true)).enabled).toBe(true);
    expect((await service.setDefaultIntegration(configured.id)).isDefault).toBe(true);
    const room = await service.createTestMeeting(configured.id);
    expect(room.provider).toBe("GOOGLE_MEET");
    expect(room.attendeeUrl).not.toContain("vault");
    await expect(service.configureIntegration({ provider: "ZOOM", credentialReference: "vault://zoom", webhookUrl: "http://unsafe.local" })).rejects.toThrow("HTTPS");
  });

  it("tăng phiên bản chính sách kiểm duyệt và chuẩn hóa từ khóa", async () => {
    const service = new SystemService();
    const policy = await service.updateModerationPolicy({ prohibitedTerms: [" Spam ", "spam", "Lừa đảo"], maxPostsPerMinute: 4, action: "FLAG" });
    expect(policy.version).toBe(2);
    expect(policy.prohibitedTerms).toEqual(["spam", "lừa đảo"]);
  });
});
