import { describe, expect, it } from "vitest";
import { createMfaSecret, createRecoveryCodes, decryptMfaSecret, encryptMfaSecret, verifyTotp } from "../../src/auth/mfa.js";

describe("MFA TOTP", () => {
  it("xác minh mã TOTP theo vector chuẩn và từ chối mã sai", () => {
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(verifyTotp(rfcSecret, "287082", 59_000)).toBe(true);
    expect(verifyTotp(rfcSecret, "000000", 59_000)).toBe(false);
  });

  it("mã hóa bí mật MFA có xác thực và giải mã đúng khóa", async () => {
    const secret = createMfaSecret();
    const key = "test-auth-encryption-secret-at-least-32-characters";
    const encrypted = await encryptMfaSecret(secret, key);
    expect(encrypted).not.toContain(secret);
    expect(await decryptMfaSecret(encrypted, key)).toBe(secret);
    await expect(decryptMfaSecret(encrypted, `${key}-wrong`)).rejects.toThrow();
  });

  it("tạo mã khôi phục duy nhất đúng định dạng", () => {
    const codes = createRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(code))).toBe(true);
  });
});
