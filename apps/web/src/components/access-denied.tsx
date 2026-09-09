import { ShieldX } from "lucide-react";
import Link from "next/link";

/** Hiển thị trạng thái từ chối quyền mà không làm lộ dữ liệu hay thao tác của màn hình đích. */
export function AccessDenied() {
  return <div className="mx-auto grid min-h-[calc(100dvh-4.5rem)] max-w-2xl place-items-center px-5 py-12"><div className="text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]"><ShieldX size={26} /></div><h1 className="mt-5 font-heading text-3xl font-extrabold tracking-tight">Trang này không thuộc vai trò hiện tại</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--ink-soft)]">Hệ thống đã ẩn toàn bộ dữ liệu và thao tác quản trị. Hãy quay về tổng quan hoặc chuyển sang vai trò được cấp quyền.</p><Link className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[var(--action)] px-4 text-sm font-bold text-[var(--action-ink)] transition-transform hover:-translate-y-px active:translate-y-px active:scale-[0.98]" href="/dashboard">Về tổng quan</Link></div></div>;
}
