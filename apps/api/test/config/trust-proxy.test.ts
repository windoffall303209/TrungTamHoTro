import { describe, expect, it } from "vitest";
import { parseTrustProxy } from "../../src/config/trust-proxy.js";
import { validateEnvironment } from "../../src/config/environment.js";

describe("Cấu hình TRUST_PROXY", () => {
  it("chuyển giá trị sang tham số trust proxy của Express", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("false")).toBe(false);
    expect(parseTrustProxy("0")).toBe(false);
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("loopback, 10.0.0.0/8 ,fd00::/8")).toEqual(["loopback", "10.0.0.0/8", "fd00::/8"]);
  });

  it("từ chối tin mọi proxy hoặc giá trị lạ", () => {
    expect(() => parseTrustProxy("true")).toThrow("TRUST_PROXY=true");
    expect(() => parseTrustProxy("evil.example")).toThrow("không hợp lệ");
    expect(() => validateEnvironment({ DB_HOST: "localhost", DB_USER: "postgres", DB_PASSWORD: "", DB_NAME: "app_test", TRUST_PROXY: "true" })).toThrow("TRUST_PROXY");
  });
});
