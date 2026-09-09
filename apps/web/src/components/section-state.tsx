import { Inbox } from "lucide-react";

/** Chuẩn hóa ba trạng thái loading, empty và nội dung của các danh sách. */
export function SectionState({ loading, empty, children }: { loading: boolean; empty: boolean; children: React.ReactNode }) {
  if (loading) return <div aria-label="Đang đồng bộ dữ liệu" className="border-y border-[var(--rule)] bg-[var(--surface)]/65 px-5 py-6" role="status"><div aria-hidden="true" className="animate-pulse space-y-4"><div className="h-4 w-44 rounded bg-[var(--rule)]" /><div className="h-16 rounded-xl bg-[var(--surface-muted)]" /><div className="h-16 rounded-xl bg-[var(--surface-muted)]" /><div className="h-16 rounded-xl bg-[var(--surface-muted)]" /></div><span className="sr-only">Đang đồng bộ dữ liệu…</span></div>;
  if (empty) return <div className="grid min-h-48 place-items-center border-y border-dashed border-[var(--rule-strong)] bg-[var(--surface)]/65 text-center"><div><Inbox className="mx-auto text-[var(--rule-strong)]" size={36} /><p className="mt-3 text-sm font-bold text-[var(--ink)]">Chưa có dữ liệu phù hợp</p><p className="mt-1 text-xs text-[var(--ink-soft)]">Tạo bản ghi đầu tiên để bắt đầu quy trình.</p></div></div>;
  return <>{children}</>;
}
