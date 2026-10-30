"use client";
import { Button } from "@/shared/ui/ui";

/** Giữ thông báo lỗi tải dữ liệu và nút thử lại ngay tại màn hình, không làm mất nội dung đang nhập. */
export function RequestError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--danger)] bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger-deep)]"
    >
      <p className="min-w-0 flex-1 break-words">{message}</p>
      <Button onClick={retry} variant="secondary">
        Thử lại
      </Button>
    </div>
  );
}
