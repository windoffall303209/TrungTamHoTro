import { describe, expect, it } from "vitest";
import { validateEnvironment } from "../src/config/environment.js";

describe("validateEnvironment", () => {
  it("chuẩn hóa cấu hình hợp lệ", () => {
    const config = validateEnvironment({
      DATABASE_URL: "mysql://root:secret@127.0.0.1:3306/trung_tam_giang_day",
      API_PORT: "4100",
      DATABASE_CONNECT_ON_START: "true",
    });

    expect(config.API_PORT).toBe(4100);
    expect(config.DATABASE_CONNECT_ON_START).toBe(true);
  });

  it("từ chối kết nối không phải MySQL", () => {
    expect(() => validateEnvironment({ DATABASE_URL: "postgresql://localhost/app" })).toThrow(
      "Cấu hình môi trường không hợp lệ",
    );
  });
});

