import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SystemService } from "../../src/domains/system/core/system.service.js";

describe("SystemService", () => {
  it("không giả lập backup khi hạ tầng thật chưa hoạt động", async () => {
    const service = new SystemService();
    await expect(service.runBackup("FULL")).rejects.toThrow("yêu cầu kết nối database");
    await expect(service.runBackup("INCREMENTAL")).rejects.toThrow("binary log");
    await expect(service.restoreBackup("backup-unknown", "")).rejects.toThrow(BadRequestException);
  });

  it("không coi credential reference là health check và chỉ tạo phòng thật bằng provider sẵn sàng", async () => {
    const service = new SystemService();
    await expect(service.configureIntegration({ provider: "GOOGLE_MEET" })).rejects.toThrow("credential");
    const configured = await service.configureIntegration({ provider: "GOOGLE_MEET", credentialReference: "vault://meeting/google", webhookUrl: "https://hooks.wind.edu.vn/meet" });
    expect(configured.maskedCredential).toBe("••••••••");
    expect(JSON.stringify(configured)).not.toContain("vault://meeting/google");
    await expect(service.updateIntegration(configured.id, true)).rejects.toThrow("health check");
    await expect(service.testIntegration(configured.id)).rejects.toThrow("OAuth và webhook thật");
    const jitsi = (await service.listIntegrations()).find((item) => item.provider === "JITSI")!;
    expect((await service.testIntegration(jitsi.id)).healthStatus).toBe("HEALTHY");
    expect((await service.updateIntegration(jitsi.id, true)).enabled).toBe(true);
    expect((await service.setDefaultIntegration(jitsi.id)).isDefault).toBe(true);
    const room = await service.createTestMeeting(jitsi.id);
    expect(room.provider).toBe("JITSI");
    expect(room.attendeeUrl).toMatch(/^https:\/\/meet\.jit\.si\/wind-test-/);
    await expect(service.configureIntegration({ provider: "ZOOM", credentialReference: "vault://zoom", webhookUrl: "http://unsafe.local" })).rejects.toThrow("HTTPS");
  });

  it("lập phiên bản cấu hình theo thời điểm hiệu lực và giữ lịch sử", async () => {
    const service = new SystemService();
    expect((await service.getSettings()).questionApprovalMode).toBe("AUTO");
    await expect(service.updateSettings({ timezone: "Mars/Olympus" })).rejects.toThrow("Múi giờ");
    const scheduled = await service.updateSettings({ timezone: "Asia/Ho_Chi_Minh", effectiveAt: "2030-01-01T00:00:00.000Z" });
    expect(scheduled).toMatchObject({ version: 2, updatedBy: "usr-admin" });
    expect((await service.getSettings()).timezone).toBe("Asia/Bangkok");
    expect(await service.listSettingRevisions()).toHaveLength(2);
    const active = await service.updateSettings({ locale: "en-US" });
    expect(active.version).toBe(3);
    expect((await service.getSettings()).locale).toBe("en-US");
    expect((await service.updateSettings({ questionApprovalMode: "MANUAL" })).questionApprovalMode).toBe("MANUAL");
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
    const firstHold = await service.createLegalHold("AUDIT", "Phục vụ cuộc kiểm toán đang mở") as { id: string };
    await service.createLegalHold("AUDIT", "Giữ độc lập cho yêu cầu pháp chế");
    const preview = await service.previewRetention("AUDIT");
    expect(preview.legalHoldRows).toBe(preview.estimatedRows);
    const job = await service.runRetention(policy.id, "Nguyễn Admin");
    expect(job).toMatchObject({ status: "PENDING", affectedRows: 0 });
    await expect(service.approveRetention(job.id, "Nguyễn Admin")).rejects.toThrow();
    expect(await service.approveRetention(job.id, "Trưởng tuân thủ")).toMatchObject({ approvedBy: "Trưởng tuân thủ", status: "PENDING" });
    await expect(service.approveRetention(job.id, "Người thứ ba")).rejects.toThrow();
    expect(await service.releaseLegalHold(firstHold.id, "Cuộc kiểm toán đã hoàn tất")).toMatchObject({ active: false, releasedBy: "usr-admin" });
    expect((await service.previewRetention("AUDIT")).legalHoldRows).toBe(preview.estimatedRows);
  });

  it("chạy retention theo đúng policy được chọn và chặn policy chưa hiệu lực", async () => {
    const service = new SystemService();
    const selected = await service.createRetentionPolicy({ category: "LEARNING", retentionDays: 30, action: "DELETE", approvedBy: "Trưởng dữ liệu" });
    await service.createRetentionPolicy({ category: "LEARNING", retentionDays: 365, action: "ARCHIVE", approvedBy: "Trưởng dữ liệu" });
    const job = await service.runRetention(selected.id, "Người yêu cầu");
    const cutoffAt = new Date(String(job.evidence.cutoffAt));
    expect(Math.round((Date.now() - cutoffAt.getTime()) / 86_400_000)).toBe(30);
    expect(job.evidence.action).toBe("DELETE");
    const future = await service.createRetentionPolicy({ category: "AUDIT", retentionDays: 90, action: "ARCHIVE", approvedBy: "Trưởng dữ liệu", effectiveAt: "2030-01-01T00:00:00.000Z" });
    await expect(service.runRetention(future.id, "Người yêu cầu")).rejects.toThrow("chưa đến thời điểm hiệu lực");
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
