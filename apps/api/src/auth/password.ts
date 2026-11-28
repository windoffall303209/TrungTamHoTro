import { ServiceUnavailableException } from "@nestjs/common";
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;

/** Tính trần đồng thời và trần hàng đợi scrypt an toàn theo UV_THREADPOOL_SIZE để không bỏ đói fs/dns/zlib. */
export function resolveScryptLimits(env: NodeJS.ProcessEnv = process.env): {
  threadpoolSize: number;
  maxConcurrentHashes: number;
  maxWaitingHashes: number;
} {
  const parsedPool = Number(env.UV_THREADPOOL_SIZE);
  const threadpoolSize = Number.isInteger(parsedPool) && parsedPool >= 2 && parsedPool <= 128 ? parsedPool : 4;
  // Luôn chừa tối thiểu 1 luồng libuv cho I/O tệp, nén và phân giải DNS; mặc định dùng nửa threadpool.
  const maxSafeConcurrent = Math.max(1, threadpoolSize - 1);
  const parsedConcurrent = Number(env.SCRYPT_MAX_CONCURRENCY);
  const requestedConcurrent =
    Number.isInteger(parsedConcurrent) && parsedConcurrent >= 1
      ? parsedConcurrent
      : Math.max(1, Math.floor(threadpoolSize / 2));
  const maxConcurrentHashes = Math.min(requestedConcurrent, maxSafeConcurrent);

  const parsedWaiting = Number(env.SCRYPT_MAX_WAITING);
  const maxWaitingHashes =
    Number.isInteger(parsedWaiting) && parsedWaiting >= 1 && parsedWaiting <= 2_000
      ? parsedWaiting
      : 256;
  return { threadpoolSize, maxConcurrentHashes, maxWaitingHashes };
}

let activeHashes = 0;
let rejectedOverloadCount = 0;
const waitingHashes: Array<() => void> = [];

/** Chụp trạng thái hàng đợi băm mật khẩu hiện tại phục vụ chẩn đoán và kiểm thử quá tải. */
export function getPasswordHashQueueStats(): {
  activeHashes: number;
  waitingHashes: number;
  rejectedOverloadCount: number;
  limits: ReturnType<typeof resolveScryptLimits>;
} {
  return {
    activeHashes,
    waitingHashes: waitingHashes.length,
    rejectedOverloadCount,
    limits: resolveScryptLimits(),
  };
}

/** Chạy một phép băm khi còn slot, xếp hàng FIFO khi chạm trần và trả 503 có Retry-After khi hàng đợi đầy. */
async function withHashSlot<T>(task: () => Promise<T>): Promise<T> {
  const { maxConcurrentHashes, maxWaitingHashes } = resolveScryptLimits();
  if (activeHashes >= maxConcurrentHashes && waitingHashes.length >= maxWaitingHashes) {
    rejectedOverloadCount += 1;
    throw new ServiceUnavailableException({
      message: "Hệ thống đang xử lý quá nhiều lượt đăng nhập. Vui lòng thử lại sau ít giây.",
      retryAfterSeconds: 2,
    });
  }
  if (activeHashes >= maxConcurrentHashes) await new Promise<void>((resolve) => waitingHashes.push(resolve));
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
