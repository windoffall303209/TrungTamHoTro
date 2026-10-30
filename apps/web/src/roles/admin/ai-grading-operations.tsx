"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass, Modal } from "@/shared/ui/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

type State = "RETRY_AUTHORIZED" | "GENERATING" | "UNCERTAIN" | "READY" | "CLAIMED" | "SAVING" | "COMPLETED";
type Domain = "grading" | "study" | "exams" | "document-answers" | "extractions";
type ExamScope = "canonical" | "unlinked" | "broken";
const scopeHelp: Record<ExamScope, string> = {
  canonical: "Chỉ liệt kê tác vụ sinh đề gốc có liên kết hợp lệ; không liệt kê từng mã thử lại hoặc khóa thiếu liên kết. Có bản nháp AI không đồng nghĩa đề đã được lưu hoặc phát hành.",
  unlinked: "Nhóm này gồm khóa chưa có liên kết nội dung khớp người tạo và yêu cầu, không gồm mã thử lại đã liên kết. Khóa có thể đang được chuẩn bị, chưa chắc là lỗi. Nếu liên kết xuất hiện trong lúc phân trang, hãy tải lại danh sách. Không tự xóa khóa hoặc gọi lại AI.",
  broken: "Nhóm này gồm yêu cầu có liên kết nhưng mã gốc thiếu, sai định dạng hoặc trỏ tới yêu cầu không còn hợp lệ. Nhiều mã thử lại có thể cùng bị ảnh hưởng; số hàng không phải số lần gọi AI. Giữ mã yêu cầu để đối soát, không tự sửa liên kết hoặc gọi lại AI.",
};
type Row = { id: string; ownerId: string; state: State; createdAt: string; updatedAt: string } & ({ submissionId: string; language: string } | { materialId: string; sourceVersion: number } | { version: number });
type Page = { items: Row[]; nextCursor: string | null };
const labels: Record<State, string> = { RETRY_AUTHORIZED: "Đã cho phép thử lại", GENERATING: "Đã bắt đầu xử lý", UNCERTAIN: "Chưa rõ kết quả", READY: "Đã lưu gợi ý", CLAIMED: "Đã giữ khóa, chưa bắt đầu sinh", SAVING: "Đang lưu đề hoặc bị gián đoạn", COMPLETED: "Đã hoàn tất lưu đề" };

/** Định dạng thời gian máy người dùng cho input datetime-local mà không làm lệch múi giờ. */
function localDateTimeValue(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Giới hạn panel cho admin; đổi danh tính sẽ hủy trạng thái và dữ liệu phiên trước. */
export function AiGradingOperations() {
  const { session } = useApp();
  const [domain, setDomain] = useState<Domain>("grading");
  if (session.roleCode !== "SYSTEM_ADMIN" || !session.permissions.includes("system:configure")) return null;
  return <div>
    <div className="px-5 pt-6 md:px-6"><Field label="Loại tác vụ đối soát"><select className={inputClass} value={domain} onChange={(event) => setDomain(event.target.value as Domain)}>
      <option value="grading">Gợi ý chấm bài</option><option value="study">Bộ ôn tập: tóm tắt và flashcard</option><option value="exams">Sinh đề thi</option><option value="document-answers">Hỏi đáp tài liệu</option><option value="extractions">Trích xuất tài liệu OCR</option>
    </select></Field></div>
    <OperationsPanel key={`${session.user.id}:${domain}`} domain={domain} />
  </div>;
}

/** Mở rộng cấu hình hiện có bằng hàng metadata đọc-only, không tạo một luồng chấm hoặc retry mới. */
function OperationsPanel({ domain }: { domain: Domain }) {
  const { session } = useApp();
  const [state, setState] = useState<State | "">("");
  const [scope, setScope] = useState<ExamScope>("canonical");
  const [data, setData] = useState<Page | null>(null);
  const [history, setHistory] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reconciling, setReconciling] = useState<Row | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [reconcileError, setReconcileError] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [providerRequestId, setProviderRequestId] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [checkedAt, setCheckedAt] = useState(localDateTimeValue);
  const [latestCheckAt, setLatestCheckAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  /** Đọc một trang theo bộ lọc hiện tại; timeout/lỗi không giữ dữ liệu cũ dưới trạng thái mới. */
  async function load(nextHistory: string[]): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setNotice(""); setData(null);
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (domain === "exams" && scope !== "canonical") query.set("scope", scope);
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

  /** Mở biểu mẫu với dữ liệu trống để bằng chứng của tác vụ trước không bị dùng lại nhầm. */
  function openReconciliation(row: Row): void {
    setReconciling(row);
    setEvidenceReference("");
    setProviderRequestId("");
    setEvidenceNote("");
    const now = new Date();
    setCheckedAt(localDateTimeValue(now));
    setLatestCheckAt(localDateTimeValue(new Date(now.getTime() + 5 * 60_000)));
    setConfirmed(false);
    setReconcileError("");
  }

  /** Gửi bằng chứng một lần; server dùng đúng CAS token của từng miền và audit transaction làm lớp bảo vệ có thẩm quyền. */
  async function submitReconciliation(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!reconciling || reconcileBusy) return;
    if (!confirmed) { setReconcileError("Cần xác nhận đã kiểm tra provider trước khi mở lại tác vụ."); return; }
    const verifiedAt = new Date(checkedAt);
    if (!Number.isFinite(verifiedAt.getTime())) { setReconcileError("Thời điểm kiểm tra bằng chứng AI không hợp lệ."); return; }
    setReconcileBusy(true); setReconcileError(""); setNotice("");
    try {
      const updated = await apiRequest<Row>(`/admin/ai-operations/${domain}/${encodeURIComponent(reconciling.id)}/reconcile-not-processed`, {
        roleCode: session.roleCode,
        method: "POST",
        body: JSON.stringify({
          ...("version" in reconciling ? { expectedVersion: reconciling.version } : { expectedUpdatedAt: reconciling.updatedAt }),
          evidenceReference: evidenceReference.trim(),
          evidenceNote: evidenceNote.trim(),
          checkedAt: verifiedAt.toISOString(),
          ...(providerRequestId.trim() ? { providerRequestId: providerRequestId.trim() } : {}),
        }),
      });
      setData((current) => current ? { ...current, items: current.items.map((item) => item.id === updated.id ? updated : item) } : current);
      setReconciling(null);
      setNotice("Đã ghi audit và mở lại tác vụ. Hệ thống chưa gọi AI; người tạo phải chủ động gửi lại đúng yêu cầu cũ.");
    } catch (cause) {
      setReconcileError(cause instanceof Error ? cause.message : "Không thể đối soát tác vụ. Hãy tải lại danh sách và kiểm tra bằng chứng.");
    } finally { setReconcileBusy(false); }
  }

  const title = domain === "grading" ? "Đối soát chấm AI" : domain === "study" ? "Đối soát bộ ôn tập AI" : domain === "document-answers" ? "Đối soát hỏi đáp AI" : domain === "extractions" ? "Đối soát trích xuất OCR" : "Đối soát sinh đề AI";
  const reconciliationTitle = domain === "grading" ? "Đối soát chấm AI" : domain === "study" ? "Đối soát bộ ôn tập" : domain === "document-answers" ? "Đối soát hỏi đáp tài liệu" : domain === "extractions" ? "Đối soát trích xuất OCR" : "Đối soát tác vụ sinh đề";
  const readyLabel = domain === "exams" ? "Đã có bản nháp AI, chưa xác nhận lưu đề" : domain === "document-answers" ? "Đã lưu câu trả lời" : domain === "extractions" ? "Đã lưu trích xuất" : labels.READY;
  return <><section aria-label={title} className="space-y-4 px-5 py-6 md:px-6">
    <div className="space-y-2">
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Chỉ xem trạng thái và mã tác vụ, không xem bài làm, điểm hoặc nội dung bộ ôn tập. Tác vụ đã bắt đầu có thể vẫn chạy hoặc bị gián đoạn; thời gian chờ lâu không chứng minh AI chưa xử lý.</p>
      <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Không tự gọi lại hoặc xóa khóa. Giữ mã tác vụ để đối chiếu nhật ký trước khi quyết định bước tiếp theo.</p>
      {domain === "exams" ? <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{scopeHelp[scope]}</p> : null}
      {domain === "document-answers" ? <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Hàng đợi không hiển thị câu hỏi, câu trả lời hoặc trích dẫn riêng. Đã lưu chỉ phản ánh trạng thái lưu trữ, không xác nhận nội dung đúng. Phiên bản tác vụ không phải phiên bản tài liệu.</p> : null}
      {domain === "extractions" ? <p className="max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">Hàng đợi không hiển thị nội dung trang OCR. Đã lưu bao gồm cache cũ, không xác nhận trích xuất đầy đủ hoặc chính xác. Phiên bản tác vụ không phải phiên bản tài liệu.</p> : null}
    </div>
    {domain === "exams" ? <Field label="Phạm vi đối soát sinh đề"><select className={inputClass} value={scope} disabled={busy} onChange={(event) => { setScope(event.target.value as ExamScope); setData(null); setHistory([""]); setError(""); }}>
      <option value="canonical">Yêu cầu gốc đã liên kết</option>
      <option value="unlinked">Khóa thiếu liên kết</option>
      <option value="broken">Liên kết hỏng</option>
    </select></Field> : null}
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><Field label="Trạng thái tác vụ AI"><select className={inputClass} value={state} disabled={busy} onChange={(event) => { setState(event.target.value as State | ""); setData(null); setHistory([""]); setError(""); }}>
        <option value="">{domain === "exams" ? "Chưa hoàn tất lưu đề" : "Đang xử lý hoặc chưa rõ kết quả"}</option>
        {domain === "exams" ? <option value="CLAIMED">Đã giữ khóa, chưa bắt đầu sinh</option> : null}
        <option value="GENERATING">Đã bắt đầu xử lý</option>
        <option value="UNCERTAIN">Chưa rõ kết quả</option>
        {domain !== "exams" ? <option value="RETRY_AUTHORIZED">Đã cho phép thử lại</option> : null}
        <option value="READY">{domain === "exams" ? "Có bản nháp AI" : readyLabel}</option>
        {domain === "exams" ? <><option value="SAVING">Đang lưu đề hoặc bị gián đoạn</option><option value="COMPLETED">Đã hoàn tất lưu đề</option></> : null}
      </select></Field></div>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void load([""])}>Tải lại danh sách</Button>
    </div>
    {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Đang đọc hàng đợi AI…</p> : null}
    {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
    {notice ? <p role="status" className="border-y border-[var(--rule)] bg-[var(--surface-muted)] px-3 py-3 text-sm leading-6 text-[var(--ink)]">{notice}</p> : null}
    {!data && !busy && !error ? <p className="text-sm text-[var(--ink-soft)]">Chọn trạng thái rồi tải danh sách để bắt đầu đối soát.</p> : null}
    {data ? <>
      {!data.items.length ? <p role="status" className="text-sm text-[var(--ink-soft)]">Không có tác vụ AI trong trang và bộ lọc này.</p> : <ul className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{data.items.map((row) => <li key={row.id} className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{row.state === "READY" ? readyLabel : labels[row.state]}</p>{"language" in row ? <span translate="no" className="text-sm text-[var(--ink-soft)]">{row.language}</span> : "sourceVersion" in row ? <p className="text-sm text-[var(--ink-soft)]"><span>Phiên bản nguồn</span>: {row.sourceVersion}</p> : <p className="text-sm text-[var(--ink-soft)]"><span>Phiên bản tác vụ</span>: {row.version}</p>}</div>
        <dl className={`grid gap-3 text-sm ${domain === "exams" || domain === "document-answers" || domain === "extractions" ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
          <div className="min-w-0"><dt className="text-[var(--ink-soft)]">Mã tác vụ</dt><dd translate="no" className="mt-1 select-text break-all">{row.id}</dd></div>
          <div className="min-w-0"><dt className="text-[var(--ink-soft)]">Mã người tạo</dt><dd translate="no" className="mt-1 select-text break-all">{row.ownerId}</dd></div>
          {"materialId" in row || "submissionId" in row ? <div className="min-w-0"><dt className="text-[var(--ink-soft)]">{"materialId" in row ? "Mã tài liệu" : "Mã bài nộp"}</dt><dd translate="no" className="mt-1 select-text break-all">{"materialId" in row ? row.materialId : row.submissionId}</dd></div> : null}
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--ink-soft)]"><p><span>Tạo lúc</span>: <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString(activeLocale())}</time></p><p><span>Cập nhật lúc</span>: <time dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString(activeLocale())}</time></p></div>
        {(!((domain === "exams") && scope !== "canonical")) && ["GENERATING", "UNCERTAIN"].includes(row.state) ? <div><Button type="button" variant="secondary" disabled={busy || reconcileBusy} onClick={() => openReconciliation(row)}>Mở lại bằng bằng chứng</Button></div> : null}
      </li>)}</ul>}
      <nav aria-label="Phân trang đối soát AI" className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={busy || history.length < 2} onClick={() => void load(history.slice(0, -1))}>Trang trước</Button>
        <p className="text-sm"><span>Trang</span> {history.length}</p>
        <Button type="button" variant="secondary" disabled={busy || !data.nextCursor} onClick={() => void load([...history, data.nextCursor!])}>Trang sau</Button>
      </nav>
    </> : null}
  </section>
    <Modal open={Boolean(reconciling)} onClose={() => { if (!reconcileBusy) setReconciling(null); }} title={reconciliationTitle} description="Chỉ mở lại khi nhật ký provider xác nhận yêu cầu chưa được tiếp nhận, xử lý hoặc tính phí. Thao tác được ghi audit và không tự gọi AI.">
      <form className="space-y-4" onSubmit={(event) => void submitReconciliation(event)}>
        <div className="border-y border-[var(--rule)] bg-[var(--surface-muted)] px-3 py-3 text-sm leading-6">
          <p className="font-semibold">Tác vụ: <span translate="no" className="break-all font-normal">{reconciling?.id}</span></p>
          <p className="mt-1 text-[var(--ink-soft)]">Nếu provider đã xử lý nhưng phản hồi bị mất, mở lại có thể tạo thêm chi phí và nội dung trùng.</p>
        </div>
        <Field label="Mã bằng chứng hoặc nhật ký">
          <input className={inputClass} maxLength={191} minLength={8} onChange={(event) => setEvidenceReference(event.target.value)} placeholder="VD: provider-log-20260909-001" required value={evidenceReference} />
        </Field>
        <Field label="Mã yêu cầu provider — nếu có">
          <input className={inputClass} maxLength={191} onChange={(event) => setProviderRequestId(event.target.value)} value={providerRequestId} />
        </Field>
        <Field label="Đã kiểm tra bằng chứng lúc">
          <input className={inputClass} max={latestCheckAt} onChange={(event) => setCheckedAt(event.target.value)} required type="datetime-local" value={checkedAt} />
        </Field>
        <Field label="Kết quả kiểm tra">
          <textarea className={inputClass} maxLength={2_000} minLength={20} onChange={(event) => setEvidenceNote(event.target.value)} placeholder="Nêu nguồn nhật ký đã kiểm tra và căn cứ xác nhận provider chưa xử lý yêu cầu." required rows={4} value={evidenceNote} />
        </Field>
        <label className="flex items-start gap-3 border-y border-[var(--rule)] py-3 text-sm font-semibold leading-6">
          <input checked={confirmed} className="mt-1 size-5 shrink-0 accent-[var(--accent)]" onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" />
          <span>Tôi xác nhận đã kiểm tra provider và có bằng chứng yêu cầu này chưa được xử lý hoặc tính phí.</span>
        </label>
        {reconcileError ? <p role="alert" className="text-sm leading-6 text-[var(--danger)]">{reconcileError}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={reconcileBusy} onClick={() => setReconciling(null)}>Hủy</Button>
          <Button type="submit" loading={reconcileBusy} disabled={!confirmed}>Ghi bằng chứng và mở lại</Button>
        </div>
      </form>
    </Modal>
  </>;
}
