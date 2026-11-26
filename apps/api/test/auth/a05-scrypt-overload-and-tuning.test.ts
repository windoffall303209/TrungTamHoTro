import { ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import {
  getPasswordHashQueueStats,
  hashPassword,
  resolveScryptLimits,
  verifyPassword,
} from "../../src/auth/password.js";
import { validateEnvironment } from "../../src/config/environment.js";

const savedConcurrency = process.env.SCRYPT_MAX_CONCURRENCY;
const savedWaiting = process.env.SCRYPT_MAX_WAITING;

afterEach(() => {
  if (savedConcurrency === undefined) delete process.env.SCRYPT_MAX_CONCURRENCY;
  else process.env.SCRYPT_MAX_CONCURRENCY = savedConcurrency;
  if (savedWaiting === undefined) delete process.env.SCRYPT_MAX_WAITING;
  else process.env.SCRYPT_MAX_WAITING = savedWaiting;
});

describe("A05 Điều chỉnh giới hạn scrypt/pool và xả tải 503 có Retry-After", () => {
  it("không cho SCRYPT_MAX_CONCURRENCY vượt trần libuv threadpool (luôn chừa >= 1 luồng cho I/O)", () => {
    expect(resolveScryptLimits({ UV_THREADPOOL_SIZE: "4" })).toEqual({
      threadpoolSize: 4,
      maxConcurrentHashes: 2,
      maxWaitingHashes: 256,
    });
    expect(resolveScryptLimits({ UV_THREADPOOL_SIZE: "12", SCRYPT_MAX_CONCURRENCY: "6", SCRYPT_MAX_WAITING: "128" })).toEqual({
      threadpoolSize: 12,
      maxConcurrentHashes: 6,
      maxWaitingHashes: 128,
    });
    // Cấu hình đặt quá cao (20 trên threadpool 8) vẫn bị kẹp về 7 để không bỏ đói fs/dns/zlib.
    expect(resolveScryptLimits({ UV_THREADPOOL_SIZE: "8", SCRYPT_MAX_CONCURRENCY: "20" })).toEqual({
      threadpoolSize: 8,
      maxConcurrentHashes: 7,
      maxWaitingHashes: 256,
    });
  });

  it("xác thực biến môi trường SCRYPT_MAX_CONCURRENCY và SCRYPT_MAX_WAITING qua validateEnvironment", () => {
    const valid = validateEnvironment({
      DB_HOST: "127.0.0.1",
      DB_USER: "postgres",
      DB_PASSWORD: "secret",
      DB_NAME: "wind_test",
      DB_POOL_MAX: "25",
      SCRYPT_MAX_CONCURRENCY: "6",
      SCRYPT_MAX_WAITING: "120",
    });
    expect(valid.DB_POOL_MAX).toBe(25);
    expect(valid.SCRYPT_MAX_CONCURRENCY).toBe(6);
    expect(valid.SCRYPT_MAX_WAITING).toBe(120);
  });

  it("xả tải ngay bằng 503 + retryAfterSeconds=2 khi hàng đợi scrypt đầy và phục hồi sạch sau đợt burst", async () => {
    const stored = await hashPassword("WindEdu@2026!");
    process.env.SCRYPT_MAX_CONCURRENCY = "1";
    process.env.SCRYPT_MAX_WAITING = "2";
    const beforeRejected = getPasswordHashQueueStats().rejectedOverloadCount;

    // 1 slot chạy + 2 slot chờ = tối đa 3 phép đồng thời; 8 phép bắn cùng lúc phải xả tải phần thừa bằng 503.
    const settled = await Promise.allSettled(
      Array.from({ length: 8 }, () => verifyPassword("WindEdu@2026!", stored)),
    );
    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item) => item.status === "rejected");

    expect(fulfilled.length).toBeGreaterThanOrEqual(3);
    expect(fulfilled.every((item) => item.value === true)).toBe(true);
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    for (const item of rejected) {
      expect(item.reason).toBeInstanceOf(ServiceUnavailableException);
      const body = (item.reason as ServiceUnavailableException).getResponse() as {
        retryAfterSeconds?: number;
      };
      expect(body.retryAfterSeconds).toBe(2);
    }

    const afterStats = getPasswordHashQueueStats();
    expect(afterStats.activeHashes).toBe(0);
    expect(afterStats.waitingHashes).toBe(0);
    expect(afterStats.rejectedOverloadCount).toBe(beforeRejected + rejected.length);
  });
});
