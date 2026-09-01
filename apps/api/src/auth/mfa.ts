import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;

export function createMfaSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function createTotpUri(secret: string, email: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString()}`;
}

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

export function encryptMfaSecret(secret: string, encryptionSecret: string): string {
  const iv = randomBytes(12);
  const key = scryptSync(encryptionSecret, "wind-edu-mfa-v1", 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMfaSecret(payload: string, encryptionSecret: string): string {
  const [version, encodedIv, encodedTag, encodedCiphertext] = payload.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext) throw new Error("Dữ liệu MFA không hợp lệ.");
  const key = scryptSync(encryptionSecret, "wind-edu-mfa-v1", 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function createRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(5).toString("hex").toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5)}`;
  });
}

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
