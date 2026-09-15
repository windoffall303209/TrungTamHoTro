import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createEncryptionKeyDeriver } from "../infrastructure/encryption-key.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const deriveKey = createEncryptionKeyDeriver("wind-edu-mfa-v1");

/** Sinh bí mật Base32 tương thích với ứng dụng TOTP phổ biến. */
export function createMfaSecret(): string {
  return encodeBase32(randomBytes(20));
}

/** Đóng gói bí mật MFA thành URI otpauth để ứng dụng xác thực quét hoặc nhập. */
export function createTotpUri(secret: string, email: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Kiểm tra TOTP theo thời gian hiện tại và cho phép lệch một chu kỳ ở mỗi phía. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const supplied = Buffer.from(normalized);
  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(generateTotp(secret, Math.floor(now / 1000 / TOTP_STEP_SECONDS) + offset));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

/** Mã hóa bí mật MFA bằng AES-256-GCM trước khi lưu, kèm IV và authentication tag. */
export async function encryptMfaSecret(secret: string, encryptionSecret: string): Promise<string> {
  const iv = randomBytes(12);
  const key = await deriveKey(encryptionSecret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Giải mã và xác thực toàn vẹn payload MFA phiên bản v1. */
export async function decryptMfaSecret(payload: string, encryptionSecret: string): Promise<string> {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Dữ liệu MFA không hợp lệ.");
  const key = await deriveKey(encryptionSecret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}

/** Sinh bộ mã khôi phục dùng một lần; AuthService chỉ lưu bản băm của các mã này. */
export function createRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(5).toString("hex").toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

/** Tạo mã HOTP sáu chữ số cho bộ đếm thời gian theo RFC 4226/6238. */
function generateTotp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Mã hóa byte ngẫu nhiên sang Base32 không padding để dùng làm bí mật TOTP. */
function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Giải mã bí mật Base32 và từ chối ký tự ngoài bảng chữ cái hợp lệ. */
function decodeBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const raw of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(raw);
    if (index < 0) throw new Error("Mã bí mật MFA không hợp lệ.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
