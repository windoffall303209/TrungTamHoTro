"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { activeLocale } from "@/i18n/runtime";
import { useApp } from "@/providers/app-provider";

type Entry = { id: string; question: string; language: "VI" | "EN" | "BILINGUAL"; state: "READY" | "GENERATING" | "UNCERTAIN"; createdAt: string };
type Page = { items: Entry[]; nextCursor: string | null };
const labels = { READY: "Đã lưu câu trả lời", GENERATING: "Đã bắt đầu xử lý", UNCERTAIN: "Chưa rõ kết quả" };

/** Read private history on demand; selection restores input without creating a new AI request. */
export function MaterialQuestionHistory({ materialId, version, disabled, onSelect }: { materialId: string; version: number; disabled: boolean; onSelect: (entry: Pick<Entry, "question" | "language">) => void }) {
  const { session } = useApp();
  const [page, setPage] = useState<Page | null>(null);
  const [cursors, setCursors] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  /** Bound read time and discard responses after unmount; never retry or generate automatically. */
  async function load(next: string[]): Promise<void> {
    if (request.current || disabled) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setPage(null);
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const query = new URLSearchParams({ version: String(version) });
      if (next.at(-1)) query.set("cursor", next.at(-1)!);
      const result = await apiRequest<Page>(`/instructor/materials/${encodeURIComponent(materialId)}/ai-questions?${query}`, { roleCode: session.roleCode, signal: controller.signal });
      if (request.current === controller) { setPage(result); setCursors(next); }
    } catch (cause) {
      if (request.current === controller) setError(controller.signal.aborted ? "Đọc lịch sử hỏi đáp quá thời gian chờ. Hãy tải lại lịch sử." : cause instanceof Error ? cause.message : "Không đọc được lịch sử hỏi đáp.");
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  return <details className="mb-5 border-y border-[var(--rule)] py-3">
    <summary className="cursor-pointer py-2 font-semibold">Lịch sử câu hỏi của bạn</summary>
    <p className="my-3 text-sm leading-6 text-[var(--ink-soft)]"><span>Phiên bản nguồn</span>: {version}. <span>Chỉ hiện câu hỏi đã lưu lịch sử của phiên bản này. Chọn câu hỏi rồi dùng Kiểm tra kết quả để đọc lại, không gọi AI mới.</span></p>
    <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => void load([""])}>Tải lịch sử câu hỏi</Button>
    {busy ? <p role="status" className="mt-3 text-sm">Đang đọc lịch sử hỏi đáp…</p> : null}
    {error ? <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    {page ? <>
      {!page.items.length ? <p role="status" className="mt-3 text-sm">Chưa có câu hỏi trong lịch sử phiên bản này.</p> : <ul className="mt-4 divide-y divide-[var(--rule)]">{page.items.map((entry) => <li key={entry.id} className="space-y-2 py-3">
        <p translate="no" className="whitespace-pre-wrap break-words text-sm leading-6">{entry.question}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--ink-soft)]"><span>{labels[entry.state]}</span><span translate="no">{entry.language}</span><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(activeLocale())}</time></p>
        <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => onSelect(entry)}>Chọn câu hỏi này</Button>
      </li>)}</ul>}
      <nav aria-label="Phân trang lịch sử hỏi đáp" className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={disabled || busy || cursors.length < 2} onClick={() => void load(cursors.slice(0, -1))}>Trang trước</Button>
        <p className="text-sm"><span>Trang</span> {cursors.length}</p>
        <Button type="button" variant="secondary" disabled={disabled || busy || !page.nextCursor} onClick={() => void load([...cursors, page.nextCursor!])}>Trang sau</Button>
      </nav>
    </> : null}
  </details>;
}
