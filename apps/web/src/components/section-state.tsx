import { Inbox } from "lucide-react";

export function SectionState({ loading, empty, children }: { loading: boolean; empty: boolean; children: React.ReactNode }) {
  if (loading) return <div aria-label="Đang đồng bộ dữ liệu" className="border-y border-[#d5dfe2] bg-[#fffdfa]/65 px-5 py-6"><div className="animate-pulse space-y-4"><div className="h-4 w-44 rounded bg-[#d5dfe2]" /><div className="h-16 rounded-xl bg-[#eee8dc]" /><div className="h-16 rounded-xl bg-[#eee8dc]" /><div className="h-16 rounded-xl bg-[#eee8dc]" /></div><span className="sr-only">Đang đồng bộ dữ liệu…</span></div>;
  if (empty) return <div className="grid min-h-48 place-items-center border-y border-dashed border-[#a9bac1] bg-[#fffdfa]/65 text-center"><div><Inbox className="mx-auto text-[#a9bac1]" size={36} /><p className="mt-3 text-sm font-bold text-[#102a43]">Chưa có dữ liệu phù hợp</p><p className="mt-1 text-xs text-[#516274]">Tạo bản ghi đầu tiên để bắt đầu quy trình.</p></div></div>;
  return <>{children}</>;
}
