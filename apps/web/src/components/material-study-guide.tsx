"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

type Source = { id: string; materialId: string; version: number; name: string; page: number; text: string };
type Guide = {
  draftId?: string;
  insufficientContext: boolean;
  summary: Array<{ text: string; citations: Source[] }>;
  flashcards: Array<{ front: string; back: string; citations: Source[] }>;
  version: number;
  warning: string;
  coverage: { partial: boolean; selectedChunks: number; totalChunks: number; selectedPages: number[]; fromPage: number | null; toPage: number | null };
};
type DraftSummary = { id: string; state: "GENERATING" | "READY" | "UNCERTAIN"; sourceVersion: number; createdAt: string; options: { cardCount: number; language: "VI" | "EN" | "BILINGUAL"; fromPage?: number; toPage?: number } };
type DraftPage = { items: DraftSummary[]; nextCursor: string | null };

/** Tạo bộ ôn tập chủ động, công khai độ bao phủ và giữ đáp án thu gọn để người học tự nhớ lại. */
export function MaterialStudyGuide({ materialId, onBusyChange, openSource }: { materialId: string; onBusyChange: (busy: boolean) => void; openSource: (source: Source) => Promise<void> }) {
  const { session } = useApp();
  const [count, setCount] = useState("5");
  const [language, setLanguage] = useState<"VI" | "EN" | "BILINGUAL">(activeLocale() === "en-US" ? "EN" : "VI");
  const [fromPage, setFromPage] = useState("");
  const [toPage, setToPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState<Guide | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const [reading, setReading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<DraftPage | null>(null);
  const [historyError, setHistoryError] = useState("");
  const locked = busy || reading;
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (guide) { resultHeading.current?.focus(); resultHeading.current?.scrollIntoView?.({ block: "start" }); } }, [guide]);

  /** Đọc lịch sử hoặc kết quả đã lưu, không tạo lại nội dung và không để yêu cầu đọc chạy vô hạn. */
  const readSaved = async (draftId?: string, cursor?: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setReading(true); onBusyChange(true); setHistoryError(""); setHistoryOpen(true);
    const controller = new AbortController(); controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const path = `/instructor/materials/${encodeURIComponent(materialId)}/ai-study-guides`;
    try {
      if (draftId) {
        const draft = await apiRequest<DraftSummary & { result: Guide | null }>(`${path}/${encodeURIComponent(draftId)}`, { roleCode: session.roleCode, signal: controller.signal });
        if (draft.state !== "READY" || !draft.result) throw new Error("Bản nháp chưa có kết quả để mở. Hãy làm mới lịch sử để kiểm tra trạng thái.");
        setGuide({ ...draft.result, draftId: draft.id });
        setHistoryOpen(false);
      } else {
        const page = await apiRequest<DraftPage>(`${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { roleCode: session.roleCode, signal: controller.signal });
        setHistory((previous) => ({ ...page, items: cursor ? [...new Map([...(previous?.items ?? []), ...page.items].map((item) => [item.id, item])).values()] : page.items }));
      }
    } catch (cause) { setHistoryError(controller.signal.aborted ? "Đọc bản nháp quá thời gian chờ. Hãy thử tải lại; thao tác này không gọi AI." : cause instanceof Error ? cause.message : "Không tải được bản nháp ôn tập. Hãy thử lại."); }
    finally { window.clearTimeout(timeout); controllerRef.current = null; inFlight.current = false; setReading(false); onBusyChange(false); }
  };

  /** Kiểm tra số thẻ/khoảng trang trước khi gửi, khóa lặp và giải phóng giao diện khi hết thời gian chờ. */
  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    const cardCount = Number(count);
    const from = fromPage.trim() ? Number(fromPage) : undefined;
    const to = toPage.trim() ? Number(toPage) : undefined;
    if (!Number.isInteger(cardCount) || cardCount < 1 || cardCount > 20) { setError("Số thẻ ôn tập phải từ 1 đến 20."); return; }
    if ((from === undefined) !== (to === undefined)) { setError("Cần chọn cả trang bắt đầu và trang kết thúc."); return; }
    if (from !== undefined && to !== undefined && (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 200 || from > to)) { setError("Khoảng trang phải từ 1 đến 200 và trang kết thúc không trước trang bắt đầu."); return; }
    inFlight.current = true; setBusy(true); onBusyChange(true); setError(""); setGuide(null);
    const controller = new AbortController(); controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      setGuide(await apiRequest<Guide>(`/instructor/materials/${encodeURIComponent(materialId)}/ai-study-guide`, { method: "POST", roleCode: session.roleCode, signal: controller.signal, body: JSON.stringify({ cardCount, language, fromPage: from, toPage: to }) }));
    } catch (cause) { setError(controller.signal.aborted ? "Đã hết thời gian chờ. Bạn có thể đóng cửa sổ. Máy chủ có thể vẫn đang xử lý; gửi lại có thể phát sinh phí mới." : cause instanceof Error ? cause.message : "Không tạo được bộ ôn tập. Hãy kiểm tra cấu hình AI và thử lại."); }
    finally { window.clearTimeout(timeout); controllerRef.current = null; inFlight.current = false; setBusy(false); onBusyChange(false); }
  };

  return <div className="space-y-6">
    <p className="text-sm leading-6 text-[var(--ink-soft)]">Tạo tóm tắt và thẻ hỏi–đáp bằng model Hỏi đáp tài liệu do quản trị viên cấu hình. Không tự phát hành nội dung hoặc thay đổi ngân hàng câu hỏi.</p>
    <section className="border-y border-[var(--rule)] py-3" aria-label="Lịch sử bộ ôn tập">
      <Button type="button" variant="secondary" disabled={locked} aria-expanded={historyOpen} onClick={() => { if (historyOpen) setHistoryOpen(false); else if (history) setHistoryOpen(true); else void readSaved(); }}>Bản nháp đã lưu</Button>
      {historyOpen ? <div className="mt-4 space-y-3">
        <p className="text-sm leading-6 text-[var(--ink-soft)]">Chỉ hiển thị bản nháp riêng của bạn trong tài liệu này. Mở lịch sử không gọi AI.</p>
        <Button type="button" variant="ghost" disabled={locked} onClick={() => void readSaved()}>Làm mới lịch sử</Button>
        {reading ? <p role="status" className="text-sm">Đang đọc bản nháp…</p> : null}
        {historyError ? <p role="alert" className="text-sm text-[var(--danger)]">{historyError}</p> : null}
        {history?.items.length === 0 ? <p className="text-sm text-[var(--ink-soft)]">Chưa có bản nháp đã lưu. Tạo bộ ôn tập bên dưới để bắt đầu.</p> : null}
        <ul className="divide-y divide-[var(--rule)]">{history?.items.map((draft) => <li key={draft.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-4">
          <div className="min-w-0 space-y-1 text-sm leading-6">
            <p className="font-semibold"><time dateTime={draft.createdAt} translate="no">{new Date(draft.createdAt).toLocaleString(activeLocale())}</time></p>
            <p><span>Phiên bản</span> {draft.sourceVersion} · {draft.options.cardCount} <span>thẻ ôn tập</span> · <span>{draft.options.language === "VI" ? "Tiếng Việt" : draft.options.language === "EN" ? "English" : "Song ngữ Việt–Anh"}</span></p>
            <p className="text-[var(--ink-soft)]">{draft.options.fromPage ? <><span>Trang</span> {draft.options.fromPage}–{draft.options.toPage}</> : <span>Phạm vi: toàn tài liệu</span>}</p>
            <p>{draft.state === "READY" ? "Đã lưu kết quả" : draft.state === "UNCERTAIN" ? "Chưa rõ kết quả. Hệ thống không tự gọi lại AI để tránh phí trùng." : "Đang xử lý hoặc bị gián đoạn. Làm mới lịch sử để kiểm tra."}</p>
          </div>
          {draft.state === "READY" ? <Button type="button" variant="secondary" disabled={locked} onClick={() => void readSaved(draft.id)}>Mở bản nháp</Button> : null}
        </li>)}</ul>
        {history?.nextCursor ? <Button type="button" variant="secondary" disabled={locked} onClick={() => void readSaved(undefined, history.nextCursor!)}>Tải thêm bản nháp</Button> : null}
      </div> : null}
    </section>
    <form onSubmit={(event) => void generate(event)} className="space-y-4">
      <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Số thẻ ôn tập"><input className={inputClass} type="number" min={1} max={20} step={1} required value={count} onChange={(event) => setCount(event.target.value)} /></Field>
        <Field label="Ngôn ngữ bộ ôn tập"><select className={inputClass} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="VI">Tiếng Việt</option><option value="EN">English</option><option value="BILINGUAL">Song ngữ Việt–Anh</option></select></Field>
        <Field label="Từ trang — tùy chọn"><input className={inputClass} type="number" min={1} max={200} step={1} value={fromPage} onChange={(event) => setFromPage(event.target.value)} /></Field>
        <Field label="Đến trang — tùy chọn"><input className={inputClass} type="number" min={1} max={200} step={1} value={toPage} onChange={(event) => setToPage(event.target.value)} /></Field>
      </fieldset>
      <p className="text-sm leading-6 text-[var(--ink-soft)]">Để trống cả hai ô để lấy đoạn trải đều trong tài liệu. Tài liệu dài có thể chỉ được dùng một phần; kết quả sẽ ghi rõ phạm vi. Gửi yêu cầu có thể phát sinh phí AI.</p>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      <Button type="submit" disabled={locked} loading={busy}>{busy ? "Đang tạo bộ ôn tập…" : "Tạo bộ ôn tập"}</Button>
      {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Lần đầu có thể lâu hơn vì cần trích xuất tài liệu. Vui lòng giữ cửa sổ này mở.</p> : null}
    </form>
    {guide ? <section aria-live="polite" className="border-t border-[var(--rule)] pt-5">
      <h3 ref={resultHeading} tabIndex={-1} className="text-lg font-bold">{guide.insufficientContext ? "Chưa đủ ngữ cảnh" : "Tóm tắt và thẻ ôn tập"}</h3>
      {guide.draftId ? <p className="mt-2 text-sm text-[var(--ink-soft)]">Đã lưu bản nháp riêng. Có thể mở lại trong lịch sử; nội dung chưa được phát hành.</p> : null}
      <p className="mt-2 text-sm text-[var(--ink-soft)]"><span>Phiên bản</span> {guide.version} · <span>Đoạn nguồn đã dùng</span> {guide.coverage.selectedChunks}/{guide.coverage.totalChunks}</p>
      <p className="mt-2 text-sm leading-6">{guide.coverage.partial ? "Chỉ bao phủ một phần nội dung đã chọn. Hãy chọn khoảng trang hẹp hơn để ôn tập đầy đủ phần cần học." : "Đã dùng toàn bộ các đoạn trích xuất trong phạm vi đã chọn; vẫn cần đối chiếu bản gốc."}</p>
      <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">{guide.warning}</p>
      {guide.insufficientContext ? <p className="mt-4 text-sm leading-6">Không đủ căn cứ để tạo số thẻ yêu cầu. Hãy giảm số thẻ hoặc chọn phạm vi trang khác.</p> : <>
        <h4 className="mb-2 mt-6 font-bold">Ý chính</h4>
        <ul className="space-y-4">{guide.summary.map((item, index) => <li key={index} className="max-w-[72ch]"><p className="whitespace-pre-wrap break-words leading-7" translate="no">{item.text}</p><StudySources sources={item.citations} openSource={openSource} /></li>)}</ul>
        <h4 className="mb-1 mt-7 font-bold">Thẻ tự ôn tập</h4><p className="mb-3 text-sm text-[var(--ink-soft)]">Tự trả lời trước, sau đó mở thẻ để xem đáp án và nguồn.</p>
        <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{guide.flashcards.map((card) => <details key={card.front} className="py-3"><summary className="cursor-pointer break-words py-2 font-semibold" translate="no">{card.front}</summary><p className="my-3 max-w-[72ch] whitespace-pre-wrap break-words leading-7" translate="no">{card.back}</p><StudySources sources={card.citations} openSource={openSource} /></details>)}</div>
      </>}
    </section> : null}
  </div>;
}

/** Hiển thị nguồn sát mục học tương ứng, dùng metadata server để mở đúng phiên bản. */
function StudySources({ sources, openSource }: { sources: Source[]; openSource: (source: Source) => Promise<void> }) {
  return <details className="mt-2"><summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--ink-soft)]">Đối chiếu nguồn</summary><div className="space-y-3">{sources.map((source) => <div key={source.id}><p className="text-sm"><span>Trang</span> {source.page} · <span>Phiên bản</span> {source.version}</p><blockquote className="my-2 max-w-[72ch] whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-soft)]" translate="no">{source.text}</blockquote><Button variant="secondary" type="button" onClick={() => void openSource(source)}>Mở bản nguồn</Button></div>)}</div></details>;
}
