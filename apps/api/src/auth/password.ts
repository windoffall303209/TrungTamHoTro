import { ServiceUnavailableException } from "@nestjs/common";
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

// scrypt chạy trên threadpool libuv dùng chung với fs/zlib/dns; chỉ cho băm chiếm tối đa một nửa số luồng.
const THREADPOOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || 4;
const MAX_CONCURRENT_HASHES = Math.max(1, Math.floor(THREADPOOL_SIZE / 2));
/** Trần hàng đợi băm: vượt ngưỡng thì trả 503 có Retry-After thay vì để request treo tới timeout của proxy. */
const MAX_WAITING_HASHES = 256;
let activeHashes = 0;
const waitingHashes: Array<() => void> = [];

/** Chạy một phép băm khi còn slot, xếp hàng FIFO khi đã đủ MAX_CONCURRENT_HASHES tác vụ đồng thời. */
async function withHashSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeHashes >= MAX_CONCURRENT_HASHES && waitingHashes.length >= MAX_WAITING_HASHES)
    throw new ServiceUnavailableException({ message: "Hệ thống đang xử lý quá nhiều lượt đăng nhập. Vui lòng thử lại sau ít giây.", retryAfterSeconds: 2 });
  if (activeHashes >= MAX_CONCURRENT_HASHES) await new Promise<void>((resolve) => waitingHashes.push(resolve));
  else activeHashes += 1;
  try {
    return await task();
  } finally {
    // Chuyển slot thẳng cho tác vụ đang chờ để không tác vụ mới nào chen ngang hàng đợi.
    const next = waitingHashes.shift();
    if (next) next();
    else activeHashes -= 1;
  }
}

let dummyHash: Promise<string> | undefined;

/** Hash scrypt giả (tạo một lần) để so khớp khi không có tài khoản, giữ thời gian phản hồi đăng nhập đồng đều. */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}

/** Băm mật khẩu bằng scrypt với salt riêng và lưu kèm phiên bản thuật toán. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await withHashSlot(() => scrypt(password, salt, KEY_LENGTH) as Promise<Buffer>);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/** Xác minh mật khẩu bằng scrypt và so sánh constant-time để hạn chế rò rỉ thời gian. */
export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, salt, encoded] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !encoded || encoded.length !== KEY_LENGTH * 2) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = await withHashSlot(() => scrypt(password, salt, KEY_LENGTH) as Promise<Buffer>);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
