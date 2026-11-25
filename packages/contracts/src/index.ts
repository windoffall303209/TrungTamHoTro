/** Hợp đồng phản hồi thành công, luôn gắn request ID và thời điểm xử lý. */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
}

/** Hợp đồng lỗi ổn định để client hiển thị và truy vết mà không phụ thuộc framework API. */
export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
  };
}

export * from "./primitives.js";
export * from "./pagination.js";
export * from "./auth.js";
export * from "./exam.js";
export * from "./academic.js";
export * from "./learning.js";
export * from "./system.js";
