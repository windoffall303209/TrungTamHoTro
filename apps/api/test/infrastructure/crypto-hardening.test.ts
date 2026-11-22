import { describe, expect, it } from "vitest";
import { decryptMfaSecret, encryptMfaSecret } from "../../src/auth/mfa.js";
import { purposeKey } from "../../src/infrastructure/purpose-key.js";
import { decryptSecret, encryptSecret } from "../../src/infrastructure/secret-vault.js";

const master = "test-encryption-secret-at-least-32-characters";

/** Cắt authentication tag của payload "v1.iv.tag.ciphertext" còn 4 byte để mô phỏng giả mạo tag ngắn. */
function truncateTag(payload: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  return [version, iv, Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url"), ciphertext].join(".");
}

describe("Cứng hóa AES-GCM và tách khóa theo mục đích", () => {
  it("từ chối authentication tag bị cắt ngắn ở SecretVault và MFA", async () => {
    const vault = await encryptSecret("sk-secret", master);
    await expect(decryptSecret(vault, master)).resolves.toBe("sk-secret");
    await expect(decryptSecret(truncateTag(vault), master)).rejects.toThrow();
    const mfa = await encryptMfaSecret("JBSWY3DPEHPK3PXP", master);
    await expect(decryptMfaSecret(mfa, master)).resolves.toBe("JBSWY3DPEHPK3PXP");
    await expect(decryptMfaSecret(truncateTag(mfa), master)).rejects.toThrow();
  });

  it("dẫn xuất khóa con khác nhau cho từng mục đích và ổn định giữa các lần gọi", () => {
    const csrf = purposeKey(master, "csrf");
    expect(csrf).toHaveLength(32);
    expect(purposeKey(master, "csrf").equals(csrf)).toBe(true);
    expect(purposeKey(master, "email-otp").equals(csrf)).toBe(false);
    expect(purposeKey(`${master}-other`, "csrf").equals(csrf)).toBe(false);
    expect(csrf.equals(Buffer.from(master).subarray(0, 32))).toBe(false);
  });
});
