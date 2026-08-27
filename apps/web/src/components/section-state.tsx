import { Inbox, LoaderCircle } from "lucide-react";

export function SectionState({ loading, empty, children }: { loading: boolean; empty: boolean; children: React.ReactNode }) {
  if (loading) return <div className="grid min-h-48 place-items-center border-y border-[#d5dfe2] bg-[#fffdfa]/65 text-sm font-semibold text-[#516274]"><LoaderCircle className="animate-spin text-[#c75b39]" size={24} />Đang đồng bộ dữ liệu…</div>;
  if (empty) return <div className="grid min-h-48 place-items-center border-y border-dashed border-[#a9bac1] bg-[#fffdfa]/65 text-center"><div><Inbox className="mx-auto text-[#a9bac1]" size={36} /><p className="mt-3 text-sm font-bold text-[#102a43]">Chưa có dữ liệu phù hợp</p><p className="mt-1 text-xs text-[#516274]">Tạo bản ghi đầu tiên để bắt đầu quy trình.</p></div></div>;
  return <>{children}</>;
}
