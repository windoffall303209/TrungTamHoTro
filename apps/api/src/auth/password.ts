import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, salt, encoded] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !encoded || encoded.length !== KEY_LENGTH * 2) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
