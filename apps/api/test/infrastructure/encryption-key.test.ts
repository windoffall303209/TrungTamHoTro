import { createCipheriv, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEncryptionKeyDeriver } from "../../src/infrastructure/encryption-key.js";
import { decryptSecret } from "../../src/infrastructure/secret-vault.js";

describe("asynchronous encryption keys", () => {
  it("coalesces requests, preserves legacy derivation and rotates configured keys", async () => {
    const derive = createEncryptionKeyDeriver("test-salt");
    const first = derive("first-secret");
    expect(derive("first-secret")).toBe(first);
    expect(await first).toEqual(scryptSync("first-secret", "test-salt", 32));
    expect(await derive("second-secret")).not.toEqual(await first);
    expect(await derive("first-secret")).toEqual(await first);
  });

  it("decrypts existing v1 records and rejects modified ciphertext", async () => {
    const secret = "existing-installation-key";
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", scryptSync(secret, "wind-edu-provider-secrets-v1", 32), iv);
    const encrypted = Buffer.concat([cipher.update("legacy-api-key"), cipher.final()]);
    const prefix = `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.`;
    expect(await decryptSecret(prefix + encrypted.toString("base64url"), secret)).toBe("legacy-api-key");
    encrypted[0] = encrypted[0]! ^ 1;
    await expect(decryptSecret(prefix + encrypted.toString("base64url"), secret)).rejects.toThrow();
  });
});
