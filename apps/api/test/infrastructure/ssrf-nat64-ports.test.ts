import { describe, expect, it } from "vitest";
import { assertSafeProviderUrl, isPublicIp } from "../../src/infrastructure/safe-provider-fetch.js";

describe("SSRF: NAT64 cục bộ và cổng không chuẩn", () => {
  it("coi dải NAT64 cục bộ 64:ff9b:1::/48 là không công khai", () => {
    expect(isPublicIp("64:ff9b:1::a00:1")).toBe(false);
    expect(isPublicIp("64:ff9b::10.0.0.1")).toBe(false);
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2001:4860:4860::8888")).toBe(true);
  });

  it("chỉ cho phép cổng 443 với host công khai", () => {
    expect(() => assertSafeProviderUrl("https://api.example.com/v1")).not.toThrow();
    expect(() => assertSafeProviderUrl("https://api.example.com:443/v1")).not.toThrow();
    expect(() => assertSafeProviderUrl("https://api.example.com:8443/v1")).toThrow("443");
    expect(() => assertSafeProviderUrl("https://api.example.com:6379/")).toThrow("443");
    expect(() => assertSafeProviderUrl("https://[64:ff9b:1::a00:1]/v1")).toThrow();
  });

  it("vẫn cho phép localhost với cổng phát triển khi không ở production", () => {
    expect(() => assertSafeProviderUrl("http://localhost:11434/v1/chat/completions")).not.toThrow();
  });
});
