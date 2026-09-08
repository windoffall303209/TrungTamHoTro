"use client";

import { useRef, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

type Source = { id: string; materialId: string; version: number; name: string; page: number; text: string };
type Guide = {
  insufficientContext: boolean;
  summary: Array<{ text: string; citations: Source[] }>;
  flashcards: Array<{ front: string; back: string; citations: Source[] }>;
  version: number;
  warning: string;
  coverage: { partial: boolean; selectedChunks: number; totalChunks: number; selectedPages: number[]; fromPage: number | null; toPage: number | null };
};

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
  const inFlight = useRef(false);

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
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      setGuide(await apiRequest<Guide>(`/instructor/materials/${encodeURIComponent(materialId)}/ai-study-guide`, { method: "POST", roleCode: session.roleCode, signal: controller.signal, body: JSON.stringify({ cardCount, language, fromPage: from, toPage: to }) }));
    } catch (cause) { setError(controller.signal.aborted ? "Đã hết thời gian chờ. Bạn có thể đóng cửa sổ. Máy chủ có thể vẫn đang xử lý; gửi lại có thể phát sinh phí mới." : cause instanceof Error ? cause.message : "Không tạo được bộ ôn tập. Hãy kiểm tra cấu hình AI và thử lại."); }
    finally { window.clearTimeout(timeout); inFlight.current = false; setBusy(false); onBusyChange(false); }
  };

  return <div className="space-y-6">
    <p className="text-sm leading-6 text-[var(--ink-soft)]">Tạo tóm tắt và thẻ hỏi–đáp bằng model Hỏi đáp tài liệu do quản trị viên cấu hình. Không tự phát hành nội dung hoặc thay đổi ngân hàng câu hỏi.</p>
    <form onSubmit={(event) => void generate(event)} className="space-y-4">
      <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Số thẻ ôn tập"><input className={inputClass} type="number" min={1} max={20} step={1} required value={count} onChange={(event) => setCount(event.target.value)} /></Field>
        <Field label="Ngôn ngữ bộ ôn tập"><select className={inputClass} value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}><option value="VI">Tiếng Việt</option><option value="EN">English</option><option value="BILINGUAL">Song ngữ Việt–Anh</option></select></Field>
        <Field label="Từ trang — tùy chọn"><input className={inputClass} type="number" min={1} max={200} step={1} value={fromPage} onChange={(event) => setFromPage(event.target.value)} /></Field>
        <Field label="Đến trang — tùy chọn"><input className={inputClass} type="number" min={1} max={200} step={1} value={toPage} onChange={(event) => setToPage(event.target.value)} /></Field>
      </fieldset>
      <p className="text-sm leading-6 text-[var(--ink-soft)]">Để trống cả hai ô để lấy đoạn trải đều trong tài liệu. Tài liệu dài có thể chỉ được dùng một phần; kết quả sẽ ghi rõ phạm vi. Gửi yêu cầu có thể phát sinh phí AI.</p>
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      <Button type="submit" disabled={busy} loading={busy}>{busy ? "Đang tạo bộ ôn tập…" : "Tạo bộ ôn tập"}</Button>
      {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Lần đầu có thể lâu hơn vì cần trích xuất tài liệu. Vui lòng giữ cửa sổ này mở.</p> : null}
    </form>
    {guide ? <section aria-live="polite" className="border-t border-[var(--rule)] pt-5">
      <h3 className="text-lg font-bold">{guide.insufficientContext ? "Chưa đủ ngữ cảnh" : "Tóm tắt và thẻ ôn tập"}</h3>
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
