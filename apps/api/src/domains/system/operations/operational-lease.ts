type Claim = { id: string; attempts: number };

/** Chỉ tiến trình đang sở hữu đúng lần thử và chưa hết hạn mới được ghi kết quả. */
export function ownedJobWhere(candidate: Claim): { id: string; status: "RUNNING"; attempts: number; availableAt: { gt: Date } } {
  return { id: candidate.id, status: "RUNNING" as const, attempts: candidate.attempts + 1, availableAt: { gt: new Date() } };
}

/** Gia hạn tuần tự và ngừng mọi ghi dữ liệu nếu đã mất quyền hoặc không thể xác minh quyền. */
export function startOperationalLease(renew: () => Promise<{ count: number }>): { assertOwned(): Promise<void>; stop(): Promise<void> } {
  let lost = false;
  let stopped = false;
  let pending: Promise<void> | undefined;
  // Gộp các yêu cầu gia hạn đồng thời, không để lỗi timer thành unhandled rejection.
  const heartbeat = (): Promise<void> => {
    if (!pending && !lost && !stopped) {
      pending = renew().then((result) => { if (result.count !== 1) lost = true; }, () => { lost = true; }).finally(() => { pending = undefined; });
    }
    return pending ?? Promise.resolve();
  };
  const timer = setInterval(() => { void heartbeat(); }, 30_000);
  timer.unref();
  return {
    /** Kiểm tra quyền ngay trước thao tác có tác động, kể cả khi chưa tới nhịp gia hạn. */
    async assertOwned(): Promise<void> {
      await heartbeat();
      if (lost || stopped) throw new Error("Tác vụ đã mất quyền xử lý; dừng tiến trình cũ.");
    },
    /** Chờ lần gia hạn cuối kết thúc trước khi giải phóng vòng xử lý. */
    async stop(): Promise<void> { stopped = true; clearInterval(timer); await pending; },
  };
}
