import { ShieldX } from "lucide-react";
import Link from "next/link";

export function AccessDenied() {
  return <div className="mx-auto grid min-h-[calc(100vh-4.5rem)] max-w-2xl place-items-center px-5 py-12"><div className="text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-50 text-rose-600"><ShieldX size={26} /></div><p className="mt-5 text-[11px] font-extrabold uppercase tracking-[0.18em] text-rose-600">Không có quyền truy cập</p><h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight">Trang này không thuộc vai trò hiện tại</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">Hệ thống đã ẩn toàn bộ dữ liệu và thao tác quản trị. Hãy quay về tổng quan hoặc chuyển sang vai trò được cấp quyền.</p><Link className="mt-6 inline-flex min-h-10 items-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-sky-700" href="/dashboard">Về tổng quan</Link></div></div>;
}
