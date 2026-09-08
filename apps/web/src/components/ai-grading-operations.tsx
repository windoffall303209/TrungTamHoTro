"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

type State = "GENERATING" | "UNCERTAIN" | "READY";
type Domain = "grading" | "study";
type Row = { id: string; ownerId: string; state: State; createdAt: string; updatedAt: string } & ({ submissionId: string; language: string } | { materialId: string; sourceVersion: number });
type Page = { items: Row[]; nextCursor: string | null };
const labels: Record<State, string> = { GENERATING: "Đã bắt đầu xử lý", UNCERTAIN: "Chưa rõ kết quả", READY: "Đã lưu gợi ý" };

/** Giới hạn panel cho admin; đổi danh tính sẽ hủy trạng thái và dữ liệu phiên trước. */
export function AiGradingOperations() {
  const { session } = useApp();
  const [domain, setDomain] = useState<Domain>("grading");
  if (session.roleCode !== "SYSTEM_ADMIN" || !session.permissions.includes("system:configure")) return null;
  return <div>
    <div className="px-5 pt-6 md:px-6"><Field label="Loại tác vụ đối soát"><select className={inputClass} value={domain} onChange={(event) => setDomain(event.target.value as Domain)}>
      <option value="grading">Gợi ý chấm bài</option><option value="study">Bộ ôn tập: tóm tắt và flashcard</option>
    </select></Field></div>
    <OperationsPanel key={`${session.user.id}:${domain}`} domain={domain} />
  </div>;
}

/** Mở rộng cấu hình hiện có bằng hàng metadata đọc-only, không tạo một luồng chấm hoặc retry mới. */
function OperationsPanel({ domain }: { domain: Domain }) {
  const { session } = useApp();
  const [state, setState] = useState<State | "">("");
  const [data, setData] = useState<Page | null>(null);
  const [history, setHistory] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  /** Đọc một trang theo bộ lọc hiện tại; timeout/lỗi không giữ dữ liệu cũ dưới trạng thái mới. */
  async function load(nextHistory: string[]): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setData(null);
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (state) query.set("state", state);
      if (nextHistory.at(-1)) query.set("cursor", nextHistory.at(-1)!);
      const response = await apiRequest<Page>(`/admin/ai-operations/${domain}?${query}`, { roleCode: session.roleCode, signal: controller.signal });
      if (request.current !== controller) return;
      setData(response); setHistory(nextHistory);
    } catch (cause) {
      if (request.current === controller) setError(controller.signal.aborted ? "Đọc hàng đợi AI quá thời gian chờ. Hãy tải lại danh sách." : cause instanceof Error ? cause.message : "Không đọc được hàng đợi AI. Hãy tải lại danh sách.");
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  const title = domain === "grading" ? "Đối soát chấm AI" : "Đối soát bộ ôn tập AI";
  return <section aria-label={title} className="space-y-4 px-5 py-6 md:px-6">
    <div className="space-y-2">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Chỉ xem trạng thái và mã tác vụ, không xem bài làm, điểm hoặc nội dung bộ ôn tập. Tác vụ đã bắt đầu có thể vẫn chạy hoặc bị gián đoạn; thời gian chờ lâu không chứng minh AI chưa xử lý.</p>
      <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Không tự gọi lại hoặc xóa khóa. Giữ mã tác vụ để đối chiếu nhật ký trước khi quyết định bước tiếp theo.</p>
    </div>
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><Field label="Trạng thái tác vụ AI"><select className={inputClass} value={state} disabled={busy} onChange={(event) => { setState(event.target.value as State | ""); setData(null); setHistory([""]); setError(""); }}>
        <option value="">Đang xử lý hoặc chưa rõ kết quả</option>
        <option value="GENERATING">Đã bắt đầu xử lý</option>
        <option value="UNCERTAIN">Chưa rõ kết quả</option>
        <option value="READY">Đã lưu gợi ý</option>
      </select></Field></div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void load([""])}>Tải lại danh sách</Button>
    </div>
    {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Đang đọc hàng đợi AI…</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {!data && !busy && !error ? <p className="text-sm text-[var(--ink-soft)]">Chọn trạng thái rồi tải danh sách để bắt đầu đối soát.</p> : null}
    {data ? <>
      {!data.items.length ? <p role="status" className="text-sm text-[var(--ink-soft)]">Không có tác vụ AI trong trang và bộ lọc này.</p> : <ul className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{data.items.map((row) => <li key={row.id} className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{labels[row.state]}</p>{"language" in row ? <span translate="no" className="text-sm text-[var(--ink-soft)]">{row.language}</span> : <p className="text-sm text-[var(--ink-soft)]"><span>Phiên bản nguồn</span>: {row.sourceVersion}</p>}</div>
        <dl className="grid gap-3 text-sm md:grid-cols-3">
          <div className="min-w-0"><dt className="text-[var(--ink-soft)]">Mã tác vụ</dt><dd translate="no" className="mt-1 select-text break-all">{row.id}</dd></div>
          <div className="min-w-0"><dt className="text-[var(--ink-soft)]">Mã người tạo</dt><dd translate="no" className="mt-1 select-text break-all">{row.ownerId}</dd></div>
          <div className="min-w-0"><dt className="text-[var(--ink-soft)]">{"materialId" in row ? "Mã tài liệu" : "Mã bài nộp"}</dt><dd translate="no" className="mt-1 select-text break-all">{"materialId" in row ? row.materialId : row.submissionId}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--ink-soft)]"><p><span>Tạo lúc</span>: <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString(activeLocale())}</time></p><p><span>Cập nhật lúc</span>: <time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString(activeLocale())}</time></p></div>
      </li>)}</ul>}
      <nav aria-label="Phân trang đối soát AI" className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy || history.length < 2} onClick={() => void load(history.slice(0, -1))}>Trang trước</Button>
        <p className="text-sm"><span>Trang</span> {history.length}</p>
        <Button type="button" variant="secondary" disabled={busy || !data.nextCursor} onClick={() => void load([...history, data.nextCursor!])}>Trang sau</Button>
      </nav>
    </> : null}
  </section>;
}
