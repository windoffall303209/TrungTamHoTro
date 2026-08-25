import { Inbox, LoaderCircle } from "lucide-react";

export function SectionState({ loading, empty, children }: { loading: boolean; empty: boolean; children: React.ReactNode }) {
  if (loading) return <div className="grid min-h-48 place-items-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-500"><LoaderCircle className="animate-spin text-sky-600" size={24} />Đang đồng bộ dữ liệu…</div>;
  if (empty) return <div className="grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white text-center"><div><Inbox className="mx-auto text-slate-300" size={36} /><p className="mt-3 text-sm font-bold text-slate-600">Chưa có dữ liệu phù hợp</p><p className="mt-1 text-xs text-slate-400">Tạo bản ghi đầu tiên để bắt đầu quy trình.</p></div></div>;
  return <>{children}</>;
}

