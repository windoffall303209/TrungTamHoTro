"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import type { Guide } from "./material-study-guide";

/** Sửa nội dung có nguồn, giữ dữ liệu khi lưu lỗi và yêu cầu xác nhận trước khi bỏ thay đổi. */
export function StudyDraftEditor({ materialId, guide, onSaved, onCancel }: { materialId: string; guide: Guide & { draftId: string; editRevision: number }; onSaved: (guide: Guide) => void; onCancel: () => void }) {
  const { session } = useApp();
  const [summary, setSummary] = useState(() => guide.summary.map((item) => item.text));
  const [cards, setCards] = useState(() => guide.flashcards.map((item) => ({ front: item.front, back: item.back })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<Record<string, string>>({});
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dirty = summary.some((text, index) => text !== guide.summary[index]?.text) || cards.some((card, index) => card.front !== guide.flashcards[index]?.front || card.back !== guide.flashcards[index]?.back);
  useEffect(() => { heading.current?.focus(); return () => controller.current?.abort(); }, []);
  useEffect(() => {
    /** Cảnh báo khi rời trang có chỉnh sửa chưa lưu. */
    const leave = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);

  /** Kiểm tra nội dung trước PATCH, gửi revision đã đọc và không tự thử lại khi kết quả chưa rõ. */
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const errors: Record<string, string> = {};
    summary.forEach((text, index) => { if (!text.trim() || text.trim().length > 2000) errors[`summary-${index}`] = "Ý chính cần từ 1 đến 2.000 ký tự."; });
    const fronts = new Set<string>();
    cards.forEach((card, index) => {
      const front = card.front.trim().normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, " ").trim();
      if (!card.front.trim() || card.front.trim().length > 1000) errors[`front-${index}`] = "Câu hỏi cần từ 1 đến 1.000 ký tự.";
      else if (fronts.has(front)) errors[`front-${index}`] = "Các câu hỏi trong bộ ôn tập không được trùng nhau.";
      fronts.add(front);
      if (!card.back.trim() || card.back.trim().length > 3000) errors[`back-${index}`] = "Đáp án cần từ 1 đến 3.000 ký tự.";
    });
    setInvalid(errors); setError("");
    if (Object.keys(errors).length) { setError("Kiểm tra các ô được đánh dấu trước khi lưu."); return; }
    pending.current = true; setBusy(true);
    const request = new AbortController(); controller.current = request;
    const timeout = window.setTimeout(() => request.abort(), 30_000);
    try {
      const saved = await apiRequest<{ editedResult: Guide; editRevision: number }>(`/instructor/materials/${encodeURIComponent(materialId)}/ai-study-guides/${encodeURIComponent(guide.draftId)}`, {
        method: "PATCH", roleCode: session.roleCode, signal: request.signal,
        body: JSON.stringify({ expectedRevision: guide.editRevision, summary: summary.map((text, index) => ({ text: text.trim(), citationIds: guide.summary[index]!.citations.map((source) => source.id) })), flashcards: cards.map((card, index) => ({ front: card.front.trim(), back: card.back.trim(), citationIds: guide.flashcards[index]!.citations.map((source) => source.id) })) }),
      });
      onSaved({ ...saved.editedResult, draftId: guide.draftId, editRevision: saved.editRevision });
    } catch (cause) { setError(request.signal.aborted ? "Chưa xác nhận được việc lưu. Nội dung đang sửa vẫn được giữ; hãy mở lại bản nháp để kiểm tra trước khi lưu tiếp." : cause instanceof Error ? cause.message : "Không lưu được chỉnh sửa. Nội dung của bạn vẫn được giữ."); }
    finally { window.clearTimeout(timeout); controller.current = null; pending.current = false; setBusy(false); }
  };

  return <form onSubmit={(event) => void save(event)} className="mt-6 space-y-5" noValidate>
    <h4 ref={heading} tabIndex={-1} className="text-lg font-bold">Chỉnh sửa bộ ôn tập</h4>
    <p className="max-w-[72ch] text-sm leading-6 text-[var(--ink-soft)]">Lưu chỉnh sửa không gọi AI và không thay đổi kết quả AI gốc. Hãy bảo đảm nội dung mới vẫn phù hợp với nguồn trích dẫn. Chưa phát hành cho học viên.</p>
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      {summary.map((text, index) => <div key={index} className="space-y-2">
        <Field label={<><span>Ý chính</span> {index + 1}</>} error={invalid[`summary-${index}`]}><textarea className={`${inputClass} text-base`} rows={3} maxLength={2000} required translate="no" aria-invalid={Boolean(invalid[`summary-${index}`])} value={text} onChange={(event) => setSummary((items) => items.map((value, i) => i === index ? event.target.value : value))} /></Field>
        <EditorSources sources={guide.summary[index]!.citations} />
      </div>)}
      {cards.map((card, index) => <div key={index} className="space-y-3 border-t border-[var(--rule)] pt-5">
        <Field label={<><span>Câu hỏi</span> {index + 1}</>} error={invalid[`front-${index}`]}><textarea className={`${inputClass} text-base`} rows={2} maxLength={1000} required translate="no" aria-invalid={Boolean(invalid[`front-${index}`])} value={card.front} onChange={(event) => setCards((items) => items.map((value, i) => i === index ? { ...value, front: event.target.value } : value))} /></Field>
        <Field label={<><span>Đáp án</span> {index + 1}</>} error={invalid[`back-${index}`]}><textarea className={`${inputClass} text-base`} rows={3} maxLength={3000} required translate="no" aria-invalid={Boolean(invalid[`back-${index}`])} value={card.back} onChange={(event) => setCards((items) => items.map((value, i) => i === index ? { ...value, back: event.target.value } : value))} /></Field>
        <EditorSources sources={guide.flashcards[index]!.citations} />
      </div>)}
    </fieldset>
    {error ? <p role="alert" className="text-sm leading-6 text-[var(--danger)]">{error}</p> : null}
    <div className="flex flex-wrap gap-3"><Button type="submit" loading={busy} disabled={busy || !dirty}>Lưu chỉnh sửa</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => dirty ? setDiscard(true) : onCancel()}>Hủy chỉnh sửa</Button></div>
    {discard ? <div className="space-y-3" role="group" aria-label="Xác nhận bỏ thay đổi"><p className="text-sm">Bỏ các thay đổi chưa lưu?</p><div className="flex flex-wrap gap-3"><Button type="button" variant="danger" disabled={busy} onClick={onCancel}>Bỏ thay đổi</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => setDiscard(false)}>Tiếp tục sửa</Button></div></div> : null}
  </form>;
}

/** Đặt trích đoạn gốc ngay cạnh nội dung sửa để người duyệt đối chiếu. */
function EditorSources({ sources }: { sources: Guide["summary"][number]["citations"] }) {
  return <details><summary className="cursor-pointer py-2 text-sm font-semibold">Đối chiếu nguồn</summary>{sources.map((source) => <blockquote key={source.id} className="my-2 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-soft)]"><p><span>Trang</span> {source.page} · <span>Phiên bản</span> {source.version}</p><p translate="no">{source.text}</p></blockquote>)}</details>;
}
