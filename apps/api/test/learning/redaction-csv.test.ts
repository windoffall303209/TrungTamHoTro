import { describe, expect, it } from "vitest";
import { csvSafeText, redactSensitive, redactSensitiveValue } from "../../src/common/redaction.js";
import { serializeExport } from "../../src/domains/system/operations/storage/system-export-format.js";
import { SystemService } from "../../src/domains/system/core/system.service.js";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3ItMSJ9.c2lnbmF0dXJlLXZhbHVl";

describe("Che token nhạy cảm trong audit và bản xuất", () => {
  it("che cả JWT phía sau Authorization: Bearer", () => {
    const text = redactSensitive(`Authorization: Bearer ${jwt} password=hunter2 api_key: sk-abcdefghijklmnop1234 url=/reset?token=abc123&x=1`);
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk-abcdefghijklmnop1234");
    expect(text).not.toContain("abc123");
    expect(text).toContain("x=1");
    expect(redactSensitive(`lỗi gọi API với ${jwt}`)).toBe("lỗi gọi API với [REDACTED_JWT]");
  });

  it("che đệ quy theo khóa nhạy cảm nhưng giữ cờ boolean", () => {
    expect(redactSensitiveValue({ detail: "token=abc", nested: { apiKey: "AIzaSyD-1234567890abcdefghijklmnopqrst", apiKeyChanged: true }, list: [{ password: "x" }] })).toEqual({
      detail: "token=[REDACTED]",
      nested: { apiKey: "[REDACTED]", apiKeyChanged: true },
      list: [{ password: "[REDACTED]" }],
    });
  });

  it("ghi audit in-memory đã che secret ngay khi lưu", async () => {
    const service = new SystemService();
    await service.configureIntegration({ provider: "JITSI" }, "usr-admin");
    const events = await service.listAudit({ action: "INTEGRATION_CONFIGURED" });
    expect(events.length).toBeGreaterThan(0);
    expect(redactSensitive(`Authorization: Basic dXNlcjpwYXNzd29yZA==`)).toBe("Authorization=[REDACTED]");
  });
});

describe("Chống CSV Formula Injection", () => {
  it("thêm nháy đơn cho ô văn bản bắt đầu bằng ký tự công thức", () => {
    for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "  =HYPERLINK(\"x\")", "\tdata", "\rdata"]) expect(csvSafeText(value)).toBe(`'${value}`);
    expect(csvSafeText("Bình thường")).toBe("Bình thường");
  });

  it("bản xuất CSV không để ô văn bản thành công thức nhưng giữ số âm", () => {
    const csv = serializeExport([{ entity: "user", displayName: "=HYPERLINK(\"https://evil.example\",\"x\")", score: -5 }], "CSV").toString("utf8");
    expect(csv).toContain("\"'=HYPERLINK(");
    expect(csv).toContain("\"-5\"");
  });
});
