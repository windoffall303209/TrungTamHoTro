import { randomUUID } from "node:crypto";

export const AI_GENERATION_LEASE_MS = 180_000;
export const AI_CLAIM_LEASE_OPTIONS = Symbol("AI_CLAIM_LEASE_OPTIONS");

const AI_FAILURE_DISPOSITION = Symbol.for("wind.ai.failureDisposition");

export type AiFailureDisposition =
  | "PRE_DISPATCH_REJECTED"
  | "PROVIDER_REJECTED_UNBILLED"
  | "REQUIRES_RECONCILIATION";

export interface AiClaimLeaseOptions {
  leaseMs?: number;
  now?: () => Date;
}

export interface AiClaimLease {
  leaseToken: string;
  leaseExpiresAt: Date;
}

export interface AiJsonLease {
  leaseToken?: string;
  leaseExpiresAt?: string;
}

/** Gắn phân loại rủi ro tính phí nội bộ lên lỗi mà không làm thay đổi mã HTTP hay payload phản hồi. */
export function markAiFailure<T extends Error>(error: T, disposition: AiFailureDisposition): T {
  Object.defineProperty(error, AI_FAILURE_DISPOSITION, {
    value: disposition,
    enumerable: false,
    configurable: true,
  });
  return error;
}

/** Phân loại lỗi theo nguyên tắc fail-closed: mọi lỗi mơ hồ hoặc không có nhãn tường minh đều yêu cầu đối soát. */
export function classifyAiFailure(error: unknown): AiFailureDisposition {
  if (error && typeof error === "object" && AI_FAILURE_DISPOSITION in error) {
    const disposition = (error as Record<symbol, unknown>)[AI_FAILURE_DISPOSITION];
    if (
      disposition === "PRE_DISPATCH_REJECTED" ||
      disposition === "PROVIDER_REJECTED_UNBILLED" ||
      disposition === "REQUIRES_RECONCILIATION"
    ) {
      return disposition;
    }
  }
  return "REQUIRES_RECONCILIATION";
}

/** Chỉ cho mở lại claim cho lần gọi tường minh kế tiếp khi chắc chắn nhà cung cấp chưa xử lý hay tính phí. */
export function canReopenAiClaimAfterFailure(error: unknown): boolean {
  const disposition = classifyAiFailure(error);
  return disposition === "PRE_DISPATCH_REJECTED" || disposition === "PROVIDER_REJECTED_UNBILLED";
}

/** Lấy thời điểm hiện tại theo clock cấu hình để các store và test dùng chung mốc kiểm tra lease. */
export function currentAiClaimTime(options?: AiClaimLeaseOptions): Date {
  return options?.now ? options.now() : new Date();
}

/** Tạo fencing token duy nhất và mốc hết hạn lease cho một lượt xử lý AI đang ở trạng thái GENERATING. */
export function createAiClaimLease(options?: AiClaimLeaseOptions): AiClaimLease {
  const leaseMs = options?.leaseMs ?? AI_GENERATION_LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new Error("Thời lượng lease xử lý AI phải là số nguyên dương tính theo mili giây.");
  }
  const startedAt = currentAiClaimTime(options);
  return {
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(startedAt.getTime() + leaseMs),
  };
}

/** Xác định lease của tác vụ GENERATING đã hết hạn chưa; bản ghi cũ không có hạn lease không tự hết hạn. */
export function isAiLeaseExpired(leaseExpiresAt: Date | string | null | undefined, now: Date): boolean {
  if (!leaseExpiresAt) return false;
  const parsed = leaseExpiresAt instanceof Date ? leaseExpiresAt : new Date(leaseExpiresAt);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.getTime() <= now.getTime();
}

/** Kiểm tra tính hợp lệ của cặp trường lease tùy chọn trong các bản ghi JSON lưu ở system_settings. */
export function hasValidJsonLease(record: Record<string, unknown>): boolean {
  const token = record.leaseToken;
  const expiresAt = record.leaseExpiresAt;
  if (token === undefined && expiresAt === undefined) return true;
  if (typeof token !== "string" || !token.trim() || token.length > 64) return false;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return false;
  return true;
}
