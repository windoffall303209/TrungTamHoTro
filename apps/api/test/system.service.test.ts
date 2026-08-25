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

  it("tăng phiên bản chính sách kiểm duyệt và chuẩn hóa từ khóa", async () => {
    const service = new SystemService();
    const policy = await service.updateModerationPolicy({ prohibitedTerms: [" Spam ", "spam", "Lừa đảo"], maxPostsPerMinute: 4, action: "FLAG" });
    expect(policy.version).toBe(2);
    expect(policy.prohibitedTerms).toEqual(["spam", "lừa đảo"]);
  });
});
