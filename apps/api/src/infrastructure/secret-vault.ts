import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createEncryptionKeyDeriver } from "./encryption-key.js";

const VERSION = "v1";
const SALT = "wind-edu-provider-secrets-v1";
const deriveKey = createEncryptionKeyDeriver(SALT);

/**
 * Mã hóa secret bằng AES-256-GCM với IV ngẫu nhiên và key dẫn xuất qua scrypt.
 * Payload chứa version, IV, authentication tag và ciphertext để có thể luân chuyển format.
 */
export async function encryptSecret(value: string, encryptionSecret: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await deriveKey(encryptionSecret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Xác thực và giải mã payload của `encryptSecret`; GCM sẽ từ chối dữ liệu bị chỉnh sửa. */
export async function decryptSecret(payload: string, encryptionSecret: string): Promise<string> {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Dữ liệu khóa API không hợp lệ.");
  const key = await deriveKey(encryptionSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}
