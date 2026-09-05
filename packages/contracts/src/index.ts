/** Các phân hệ dùng chung mà client và API có thể tham chiếu bằng khóa ổn định. */
export type ModuleKey = "storage" | "question-bank" | "forum" | "live-class";

export type ModuleReadiness = "foundation-ready" | "planned";

/** Metadata tối thiểu mô tả trạng thái sẵn sàng của một phân hệ giảng dạy. */
export interface TeachingModule {
  key: ModuleKey;
  name: string;
  description: string;
  readiness: ModuleReadiness;
}

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

