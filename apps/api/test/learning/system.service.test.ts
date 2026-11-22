import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SystemService } from "../../src/domains/system/core/system.service.js";

describe("SystemService", () => {
  it("không giả lập backup khi hạ tầng thật chưa hoạt động", async () => {
    const service = new SystemService();
    await expect(service.runBackup("FULL", "usr-admin")).rejects.toThrow("yêu cầu kết nối database");
    await expect(service.runBackup("INCREMENTAL", "usr-admin")).rejects.toThrow("binary log");
    await expect(service.restoreBackup("backup-unknown", "", "usr-admin")).rejects.toThrow(BadRequestException);
  });

  it("không coi credential reference là health check và chỉ tạo phòng thật bằng provider sẵn sàng", async () => {
    const service = new SystemService();
    await expect(service.configureIntegration({ provider: "GOOGLE_MEET" }, "usr-admin")).rejects.toThrow("credential");
    const configured = await service.configureIntegration({
      provider: "GOOGLE_MEET",
      credentialReference: "vault://meeting/google",
      webhookUrl: "https://hooks.wind.edu.vn/meet",
    }, "usr-admin");
    expect(configured.maskedCredential).toBe("••••••••");
    expect(JSON.stringify(configured)).not.toContain("vault://meeting/google");
    await expect(service.updateIntegration(configured.id, true, "usr-admin")).rejects.toThrow("health check");
    await expect(service.testIntegration(configured.id, "usr-admin")).rejects.toThrow("OAuth và webhook thật");
    const jitsi = (await service.listIntegrations()).find((item) => item.provider === "JITSI")!;
    expect((await service.testIntegration(jitsi.id, "usr-admin")).healthStatus).toBe("HEALTHY");
    expect((await service.updateIntegration(jitsi.id, true, "usr-admin")).enabled).toBe(true);
    expect((await service.setDefaultIntegration(jitsi.id, "usr-admin")).isDefault).toBe(true);
    const room = await service.createTestMeeting(jitsi.id, "usr-admin");
    expect(room.provider).toBe("JITSI");
    expect(room.attendeeUrl).toMatch(/^https:\/\/meet\.jit\.si\/wind-test-/);
    await expect(
      service.configureIntegration({
        provider: "ZOOM",
        credentialReference: "vault://zoom",
        webhookUrl: "http://unsafe.local",
      }, "usr-admin"),
    ).rejects.toThrow("HTTPS");
  });

  it("cập nhật cấu hình trực tiếp, tăng version và ghi audit log", async () => {
    const service = new SystemService();
    await expect(service.updateSettings({ timezone: "Mars/Olympus" }, "usr-admin")).rejects.toThrow("Múi giờ");
    const active = await service.updateSettings({
      timezone: "Asia/Ho_Chi_Minh",
      locale: "en-US",
    }, "usr-admin");
    expect(active).toMatchObject({
      version: 2,
      timezone: "Asia/Ho_Chi_Minh",
      locale: "en-US",
      updatedBy: "usr-admin",
    });
    expect((await service.getSettings()).locale).toBe("en-US");
    const audits = await service.listAudit({ action: "SETTINGS_UPDATED" });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("lọc audit, xuất audit có hạn và che thông tin nhạy cảm khỏi log", async () => {
    const service = new SystemService();
    await service.configureIntegration(
      {
        provider: "ZOOM",
        credentialReference: "vault://zoom-secret",
        webhookUrl: "https://hooks.wind.edu.vn/zoom",
      },
      "admin-real",
    );
    const events = await service.listAudit({ action: "INTEGRATION_CONFIGURED", actor: "admin-real" });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("vault://zoom-secret");
    expect((await service.runExport("AUDIT", "CSV", "usr-admin")).expiresAt).toBeTruthy();
    await expect(service.listAudit({ from: "2030-01-02", to: "2030-01-01" })).rejects.toThrow("bắt đầu");
  });

  it("trả về chỉ số health-overview ngay cả khi DB không kết nối", async () => {
    const service = new SystemService();
    const health = await service.healthOverview();
    expect(health).toMatchObject({
      status: "degraded",
      database: "disabled",
      queueDepth: 0,
    });
  });
});
