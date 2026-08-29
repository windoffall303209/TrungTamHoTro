import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { EmailDeliveryService } from "../src/infrastructure/email-delivery.service.js";
import { SystemService } from "../src/system/system.service.js";

describe("SystemService", () => {
  it("không giả lập backup khi hạ tầng thật chưa hoạt động", async () => {
    const service = new SystemService();
    await expect(service.runBackup("FULL")).rejects.toThrow("yêu cầu kết nối database");
    await expect(service.runBackup("INCREMENTAL")).rejects.toThrow("binary log");
    await expect(service.restoreBackup("backup-unknown", "")).rejects.toThrow(BadRequestException);
  });

  it("chặn mã script trong mẫu thông báo", async () => {
    const service = new SystemService();
    await expect(service.saveTemplate({ eventCode: "TEST", locale: "vi-VN", subject: "Kiểm tra", body: "<script>alert(1)</script>" })).rejects.toThrow(BadRequestException);
  });

  it("kiểm soát biến, giữ phiên bản và gửi thử mẫu thông báo", async () => {
    const send = vi.fn().mockResolvedValue({ provider: "resend", providerMessageId: "email-test-01", acceptedAt: "2026-08-29T00:00:00.000Z" });
    const emailDelivery = {
      send,
    } as unknown as EmailDeliveryService;
    const service = new SystemService(undefined, emailDelivery);
    await expect(service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề {{unknown}}", body: "Mở lúc {{openAt}}" })).rejects.toThrow("không được phép");
    const first = await service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề {{examTitle}}", body: "Lớp {{className}} mở lúc {{openAt}} và đóng lúc {{closeAt}}" });
    const second = await service.saveTemplate({ eventCode: "EXAM_PUBLISHED", locale: "vi-VN", subject: "Đề mới {{examTitle}}", body: "Lớp {{className}} mở {{openAt}}, đóng {{closeAt}}" });
    expect(second.version).toBe(first.version + 1);
    expect((await service.listTemplates()).find((item) => item.eventCode === "EXAM_PUBLISHED")?.id).toBe(second.id);
    const delivery = await service.sendTemplateTest(second.id, "admin@wind.edu.vn", { examTitle: "Giữa kỳ", className: "WEB-K01", openAt: "08:00", closeAt: "09:00" });
    expect(delivery.status).toBe("SENT");
    expect(delivery.providerMessageId).toBe("email-test-01");
    expect(delivery.subject).toContain("Giữa kỳ");
    expect(send).toHaveBeenCalledOnce();
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

  it("lập phiên bản cấu hình theo thời điểm hiệu lực và giữ lịch sử", async () => {
    const service = new SystemService();
    await expect(service.updateSettings({ timezone: "Mars/Olympus" })).rejects.toThrow("Múi giờ");
    const scheduled = await service.updateSettings({ timezone: "Asia/Ho_Chi_Minh", effectiveAt: "2030-01-01T00:00:00.000Z" });
    expect(scheduled).toMatchObject({ version: 2, updatedBy: "usr-admin" });
    expect((await service.getSettings()).timezone).toBe("Asia/Bangkok");
    expect(await service.listSettingRevisions()).toHaveLength(2);
    const active = await service.updateSettings({ locale: "en-US" });
    expect(active.version).toBe(3);
    expect((await service.getSettings()).locale).toBe("en-US");
  });

  it("lọc audit, xuất audit có hạn và che thông tin nhạy cảm khỏi log", async () => {
    const service = new SystemService();
    await service.configureIntegration({ provider: "ZOOM", credentialReference: "vault://zoom-secret", webhookUrl: "https://hooks.wind.edu.vn/zoom" }, "admin-real");
    const events = await service.listAudit({ action: "INTEGRATION_CONFIGURED", actor: "admin-real" });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("vault://zoom-secret");
    expect((await service.runExport("AUDIT", "CSV")).expiresAt).toBeTruthy();
    await expect(service.listAudit({ from: "2030-01-02", to: "2030-01-01" })).rejects.toThrow("bắt đầu");
  });

  it("mô phỏng retention, bảo vệ legal hold và tách người duyệt job", async () => {
    const service = new SystemService();
    const policy = await service.createRetentionPolicy({ category: "AUDIT", retentionDays: 365, action: "ARCHIVE", approvedBy: "Trưởng quản trị" });
    await service.createLegalHold("AUDIT", "Phục vụ cuộc kiểm toán đang mở");
    const preview = await service.previewRetention("AUDIT");
    expect(preview.legalHoldRows).toBe(preview.estimatedRows);
    await expect(service.runRetention(policy.id, "Nguyễn Admin", "Nguyễn Admin")).rejects.toThrow("phải khác");
    const job = await service.runRetention(policy.id, "Nguyễn Admin", "Trưởng tuân thủ");
    expect(job).toMatchObject({ status: "COMPLETED", affectedRows: 0, skippedRows: preview.estimatedRows });
  });

  it("chống cảnh báo trùng và quản lý nhận việc, im lặng, phục hồi", async () => {
    const service = new SystemService();
    await service.healthOverview();
    await service.healthOverview();
    const alerts = await service.listAlerts();
    expect(alerts.filter((item) => item.fingerprint === "database:disabled")).toHaveLength(1);
    const acknowledged = await service.updateAlert(alerts[0]!.id, "ACKNOWLEDGE");
    expect(acknowledged.status).toBe("ACKNOWLEDGED");
    expect((await service.updateAlert(alerts[0]!.id, "MUTE", "usr-admin", 30)).status).toBe("MUTED");
    expect((await service.updateAlert(alerts[0]!.id, "RESOLVE")).recoveredAt).toBeTruthy();
  });
});
