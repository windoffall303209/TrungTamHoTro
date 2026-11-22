import { createHash, hkdfSync } from "node:crypto";

const HKDF_SALT = "wind-edu-hkdf-v1";
const cache = new Map<string, Buffer>();

/**
 * Dẫn xuất khóa con 32 byte độc lập cho từng mục đích (CSRF, OTP, mã khôi phục MFA, biên nhận nộp bài…) từ khóa chủ
 * bằng HKDF-SHA256 (RFC 5869). Lộ một khóa con hay một bản băm không giúp tính được khóa của mục đích khác.
 */
export function purposeKey(masterSecret: string, purpose: string): Buffer {
  const cacheKey = `${createHash("sha256").update(masterSecret).digest("hex")}:${purpose}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const key = Buffer.from(hkdfSync("sha256", masterSecret, HKDF_SALT, `wind-edu:${purpose}`, 32));
  cache.set(cacheKey, key);
  return key;
}
