"use client";

import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { parseLocalDateTimeInput, toLocalDateTimeInput } from "@/lib/date-time";
import { useApp } from "@/providers/app-provider";
import { Button, Field, inputClass, Modal } from "@/shared/ui/ui";
import { FileCheck2, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type State =
  | "RETRY_AUTHORIZED"
  | "GENERATING"
  | "UNCERTAIN"
  | "READY"
  | "CLAIMED"
  | "SAVING"
  | "COMPLETED";

type Domain =
  | "grading"
  | "study"
  | "exams"
  | "document-answers"
  | "extractions";

type ExamScope = "canonical" | "unlinked" | "broken";

const scopeHelp: Record<ExamScope, string> = {
  canonical:
    "Chỉ liệt kê tác vụ sinh đề gốc có liên kết hợp lệ; không liệt kê từng mã thử lại hoặc khóa thiếu liên kết. Có bản nháp AI không đồng nghĩa đề đã được lưu hoặc phát hành.",
  unlinked:
    "Nhóm này gồm khóa chưa có liên kết nội dung khớp người tạo và yêu cầu, không gồm mã thử lại đã liên kết. Khóa có thể đang được chuẩn bị, chưa chắc là lỗi. Nếu liên kết xuất hiện trong lúc phân trang, hãy tải lại danh sách. Không tự xóa khóa hoặc gọi lại AI.",
  broken:
    "Nhóm này gồm yêu cầu có liên kết nhưng mã gốc thiếu, sai định dạng hoặc trỏ tới yêu cầu không còn hợp lệ. Nhiều mã thử lại có thể cùng bị ảnh hưởng; số hàng không phải số lần gọi AI. Giữ mã yêu cầu để đối soát, không tự sửa liên kết hoặc gọi lại AI.",
};

type Row = {
  id: string;
  ownerId: string;
  state: State;
  createdAt: string;
  updatedAt: string;
} & (
  | { submissionId: string; language: string }
  | { materialId: string; sourceVersion: number }
  | { version: number }
);

type Page = { items: Row[]; nextCursor: string | null };

const labels: Record<State, string> = {
  RETRY_AUTHORIZED: "Đã cho phép thử lại",
  GENERATING: "Đã bắt đầu xử lý",
  UNCERTAIN: "Chưa rõ kết quả",
  READY: "Đã lưu gợi ý",
  CLAIMED: "Đã giữ khóa, chưa bắt đầu sinh",
  SAVING: "Đang lưu đề hoặc bị gián đoạn",
  COMPLETED: "Đã hoàn tất lưu đề",
};

/** Trả về lớp màu chấm trạng thái ngữ nghĩa cho từng bước trong vòng đời tác vụ AI. */
function stateDotClass(state: State): string {
  switch (state) {
    case "COMPLETED":
    case "READY":
      return "bg-emerald-500";
    case "UNCERTAIN":
    case "SAVING":
      return "bg-amber-500";
    case "GENERATING":
    case "CLAIMED":
      return "bg-sky-500";
    case "RETRY_AUTHORIZED":
      return "bg-teal-500";
  }
}

/** Định dạng thời gian máy người dùng cho input datetime-local mà không làm lệch múi giờ. */
function localDateTimeValue(date = new Date()): string {
  return toLocalDateTimeInput(date);
}

/** Giới hạn bảng đối soát hàng đợi AI cho quản trị viên hệ thống có quyền cấu hình. */
export function AiGradingOperations() {
  const { session } = useApp();
  const [domain, setDomain] = useState<Domain>("grading");

  if (
    session.roleCode !== "SYSTEM_ADMIN" ||
    !session.permissions.includes("system:configure")
  ) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs">
      <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-5 md:px-6">
        <div className="max-w-md">
          <Field label="Loại tác vụ đối soát">
            <select
              className={inputClass}
              value={domain}
              onChange={(event) => setDomain(event.target.value as Domain)}
            >
              <option value="grading">Gợi ý chấm bài</option>
              <option value="study">Bộ ôn tập: tóm tắt và flashcard</option>
              <option value="exams">Sinh đề thi</option>
              <option value="document-answers">Hỏi đáp tài liệu</option>
              <option value="extractions">Trích xuất tài liệu OCR</option>
            </select>
          </Field>
        </div>
      </div>
      <OperationsPanel key={`${session.user.id}:${domain}`} domain={domain} />
    </div>
  );
}

/** Hiển thị danh sách metadata chỉ đọc và quy trình đối soát mở khóa bằng bằng chứng nhật ký. */
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

  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );

  /** Đọc một trang theo bộ lọc hiện tại; timeout hoặc lỗi sẽ xóa kết quả cũ để tránh hiển thị sai lệch. */
  async function load(nextHistory: string[]): Promise<void> {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setNotice("");
    setData(null);
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (domain === "exams" && scope !== "canonical") query.set("scope", scope);
      if (state) query.set("state", state);
      if (nextHistory.at(-1)) query.set("cursor", nextHistory.at(-1)!);
      const response = await apiRequest<Page>(
        `/admin/ai-operations/${domain}?${query}`,
        { roleCode: session.roleCode, signal: controller.signal },
      );
      if (request.current !== controller) return;
      setData(response);
      setHistory(nextHistory);
    } catch (cause) {
      if (request.current === controller) {
        setError(
          controller.signal.aborted
            ? "Đọc hàng đợi AI quá thời gian chờ. Hãy tải lại danh sách."
            : cause instanceof Error
              ? cause.message
              : "Không đọc được hàng đợi AI. Hãy tải lại danh sách.",
        );
      }
    } finally {
      window.clearTimeout(timer);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
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

  /** Gửi bằng chứng một lần; máy chủ dùng đúng CAS token của từng miền và audit transaction làm lớp bảo vệ có thẩm quyền. */
  async function submitReconciliation(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!reconciling || reconcileBusy) return;
    if (!confirmed) {
      setReconcileError(
        "Cần xác nhận đã kiểm tra provider trước khi mở lại tác vụ.",
      );
      return;
    }
    const verifiedAt = parseLocalDateTimeInput(checkedAt);
    if (!verifiedAt) {
      setReconcileError("Thời điểm kiểm tra bằng chứng AI không hợp lệ.");
      return;
    }
    setReconcileBusy(true);
    setReconcileError("");
    setNotice("");
    try {
      const updated = await apiRequest<Row>(
        `/admin/ai-operations/${domain}/${encodeURIComponent(reconciling.id)}/reconcile-not-processed`,
        {
          roleCode: session.roleCode,
          method: "POST",
          body: JSON.stringify({
            ...("version" in reconciling
              ? { expectedVersion: reconciling.version }
              : { expectedUpdatedAt: reconciling.updatedAt }),
            evidenceReference: evidenceReference.trim(),
            evidenceNote: evidenceNote.trim(),
            checkedAt: verifiedAt.toISOString(),
            ...(providerRequestId.trim()
              ? { providerRequestId: providerRequestId.trim() }
              : {}),
          }),
        },
      );
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : current,
      );
      setReconciling(null);
      setNotice(
        "Đã ghi audit và mở lại tác vụ. Hệ thống chưa gọi AI; người tạo phải chủ động gửi lại đúng yêu cầu cũ.",
      );
    } catch (cause) {
      setReconcileError(
        cause instanceof Error
          ? cause.message
          : "Không thể đối soát tác vụ. Hãy tải lại danh sách và kiểm tra bằng chứng.",
      );
    } finally {
      setReconcileBusy(false);
    }
  }

  const title =
    domain === "grading"
      ? "Đối soát chấm AI"
      : domain === "study"
        ? "Đối soát bộ ôn tập AI"
        : domain === "document-answers"
          ? "Đối soát hỏi đáp AI"
          : domain === "extractions"
            ? "Đối soát trích xuất OCR"
            : "Đối soát sinh đề AI";

  const reconciliationTitle =
    domain === "grading"
      ? "Đối soát chấm AI"
      : domain === "study"
        ? "Đối soát bộ ôn tập"
        : domain === "document-answers"
          ? "Đối soát hỏi đáp tài liệu"
          : domain === "extractions"
            ? "Đối soát trích xuất OCR"
            : "Đối soát tác vụ sinh đề";

  const readyLabel =
    domain === "exams"
      ? "Đã có bản nháp AI, chưa xác nhận lưu đề"
      : domain === "document-answers"
        ? "Đã lưu câu trả lời"
        : domain === "extractions"
          ? "Đã lưu trích xuất"
          : labels.READY;

  return (
    <>
      <section aria-label={title} className="space-y-5 px-5 py-6 md:px-6">
        <div className="space-y-3">
          <h3 className="font-heading text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
            {title}
          </h3>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-4 space-y-1.5 text-xs sm:text-sm leading-6 text-slate-600 dark:text-slate-300">
            <div className="flex items-start gap-2.5">
              <ShieldAlert
                aria-hidden="true"
                size={17}
                className="mt-1 shrink-0 text-sky-700 dark:text-sky-400"
              />
              <div className="space-y-1.5">
                <p>
                  Chỉ xem trạng thái và mã tác vụ, không xem bài làm, điểm hoặc nội dung bộ ôn tập. Tác vụ đã bắt đầu có thể vẫn chạy hoặc bị gián đoạn; thời gian chờ lâu không chứng minh AI chưa xử lý.
                </p>
                <p>
                  Không tự gọi lại hoặc xóa khóa. Giữ mã tác vụ để đối chiếu nhật ký trước khi quyết định bước tiếp theo.
                </p>
                {domain === "exams" ? <p>{scopeHelp[scope]}</p> : null}
                {domain === "document-answers" ? (
                  <p>
                    Hàng đợi không hiển thị câu hỏi, câu trả lời hoặc trích dẫn riêng. Đã lưu chỉ phản ánh trạng thái lưu trữ, không xác nhận nội dung đúng. Phiên bản tác vụ không phải phiên bản tài liệu.
                  </p>
                ) : null}
                {domain === "extractions" ? (
                  <p>
                    Hàng đợi không hiển thị nội dung trang OCR. Đã lưu bao gồm cache cũ, không xác nhận trích xuất đầy đủ hoặc chính xác. Phiên bản tác vụ không phải phiên bản tài liệu.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          {domain === "exams" ? (
            <Field label="Phạm vi đối soát sinh đề">
              <select
                className={inputClass}
                value={scope}
                disabled={busy}
                onChange={(event) => {
                  setScope(event.target.value as ExamScope);
                  setData(null);
                  setHistory([""]);
                  setError("");
                }}
              >
                <option value="canonical">Yêu cầu gốc đã liên kết</option>
                <option value="unlinked">Khóa thiếu liên kết</option>
                <option value="broken">Liên kết hỏng</option>
              </select>
            </Field>
          ) : null}

          <div className={domain === "exams" ? "min-w-0" : "min-w-0 sm:col-span-2 lg:col-span-2"}>
            <Field label="Trạng thái tác vụ AI">
              <select
                className={inputClass}
                value={state}
                disabled={busy}
                onChange={(event) => {
                  setState(event.target.value as State | "");
                  setData(null);
                  setHistory([""]);
                  setError("");
                }}
              >
                <option value="">
                  {domain === "exams"
                    ? "Chưa hoàn tất lưu đề"
                    : "Đang xử lý hoặc chưa rõ kết quả"}
                </option>
                {domain === "exams" ? (
                  <option value="CLAIMED">Đã giữ khóa, chưa bắt đầu sinh</option>
                ) : null}
                <option value="GENERATING">Đã bắt đầu xử lý</option>
                <option value="UNCERTAIN">Chưa rõ kết quả</option>
                {domain !== "exams" ? (
                  <option value="RETRY_AUTHORIZED">Đã cho phép thử lại</option>
                ) : null}
                <option value="READY">
                  {domain === "exams" ? "Có bản nháp AI" : readyLabel}
                </option>
                {domain === "exams" ? (
                  <>
                    <option value="SAVING">Đang lưu đề hoặc bị gián đoạn</option>
                    <option value="COMPLETED">Đã hoàn tất lưu đề</option>
                  </>
                ) : null}
              </select>
            </Field>
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void load([""])}
          >
            <RefreshCw aria-hidden="true" size={15} />
            Tải lại danh sách
          </Button>
        </div>

        {busy ? (
          <p role="status" className="text-sm text-slate-500 dark:text-slate-400">
            Đang đọc hàng đợi AI…
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-medium text-rose-800 dark:text-rose-300"
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/80 dark:bg-emerald-950/40 px-4 py-3 text-sm leading-6 text-emerald-900 dark:text-emerald-200"
          >
            {notice}
          </p>
        ) : null}
        {!data && !busy && !error ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Chọn trạng thái rồi tải danh sách để bắt đầu đối soát.
          </div>
        ) : null}

        {data ? (
          <>
            {!data.items.length ? (
              <p
                role="status"
                className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-sm text-slate-500 dark:text-slate-400"
              >
                Không có tác vụ AI trong trang và bộ lọc này.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
                {data.items.map((row) => (
                  <li key={row.id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`size-2 rounded-full ${stateDotClass(row.state)}`}
                        />
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.state === "READY" ? readyLabel : labels[row.state]}
                        </p>
                      </div>
                      {"language" in row ? (
                        <span
                          translate="no"
                          className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 font-mono text-xs font-semibold text-slate-600 dark:text-slate-300"
                        >
                          {row.language}
                        </span>
                      ) : "sourceVersion" in row ? (
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>Phiên bản nguồn</span>: {row.sourceVersion}
                        </p>
                      ) : (
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>Phiên bản tác vụ</span>: {row.version}
                        </p>
                      )}
                    </div>

                    <dl
                      className={`grid gap-3 text-xs sm:text-sm ${
                        domain === "exams" ||
                        domain === "document-answers" ||
                        domain === "extractions"
                          ? "md:grid-cols-2"
                          : "md:grid-cols-3"
                      }`}
                    >
                      <div className="min-w-0 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                        <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          Mã tác vụ
                        </dt>
                        <dd
                          translate="no"
                          className="mt-0.5 select-text break-all font-mono text-slate-800 dark:text-slate-200"
                        >
                          {row.id}
                        </dd>
                      </div>
                      <div className="min-w-0 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                        <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          Mã người tạo
                        </dt>
                        <dd
                          translate="no"
                          className="mt-0.5 select-text break-all font-mono text-slate-800 dark:text-slate-200"
                        >
                          {row.ownerId}
                        </dd>
                      </div>
                      {"materialId" in row || "submissionId" in row ? (
                        <div className="min-w-0 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                          <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {"materialId" in row ? "Mã tài liệu" : "Mã bài nộp"}
                          </dt>
                          <dd
                            translate="no"
                            className="mt-0.5 select-text break-all font-mono text-slate-800 dark:text-slate-200"
                          >
                            {"materialId" in row
                              ? row.materialId
                              : row.submissionId}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        <p>
                          <span>Tạo lúc</span>:{" "}
                          <time dateTime={row.createdAt}>
                            {new Date(row.createdAt).toLocaleString(activeLocale())}
                          </time>
                        </p>
                        <p>
                          <span>Cập nhật lúc</span>:{" "}
                          <time dateTime={row.updatedAt}>
                            {new Date(row.updatedAt).toLocaleString(activeLocale())}
                          </time>
                        </p>
                      </div>
                      {!(domain === "exams" && scope !== "canonical") &&
                      ["GENERATING", "UNCERTAIN"].includes(row.state) ? (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy || reconcileBusy}
                          onClick={() => openReconciliation(row)}
                        >
                          <FileCheck2 aria-hidden="true" size={15} />
                          Mở lại bằng bằng chứng
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <nav
              aria-label="Phân trang đối soát AI"
              className="flex flex-wrap items-center justify-between gap-3 pt-1"
            >
              <Button
                type="button"
                variant="secondary"
                disabled={busy || history.length < 2}
                onClick={() => void load(history.slice(0, -1))}
              >
                Trang trước
              </Button>
              <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                <span>Trang</span> {history.length}
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !data.nextCursor}
                onClick={() => void load([...history, data.nextCursor!])}
              >
                Trang sau
              </Button>
            </nav>
          </>
        ) : null}
      </section>

      <Modal
        open={Boolean(reconciling)}
        onClose={() => {
          if (!reconcileBusy) setReconciling(null);
        }}
        title={reconciliationTitle}
        description="Chỉ mở lại khi nhật ký provider xác nhận yêu cầu chưa được tiếp nhận, xử lý hoặc tính phí. Thao tác được ghi audit và không tự gọi AI."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void submitReconciliation(event)}
        >
          <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/40 px-3.5 py-3 text-xs sm:text-sm leading-6 text-amber-950 dark:text-amber-200">
            <p className="font-semibold">
              Tác vụ:{" "}
              <span translate="no" className="break-all font-mono font-normal">
                {reconciling?.id}
              </span>
            </p>
            <p className="mt-1 opacity-90">
              Nếu provider đã xử lý nhưng phản hồi bị mất, mở lại có thể tạo thêm chi phí và nội dung trùng.
            </p>
          </div>
          <Field label="Mã bằng chứng hoặc nhật ký">
            <input
              className={inputClass}
              maxLength={191}
              minLength={8}
              onChange={(event) => setEvidenceReference(event.target.value)}
              placeholder="VD: provider-log-20260909-001"
              required
              value={evidenceReference}
            />
          </Field>
          <Field label="Mã yêu cầu provider — nếu có">
            <input
              className={inputClass}
              maxLength={191}
              onChange={(event) => setProviderRequestId(event.target.value)}
              value={providerRequestId}
            />
          </Field>
          <Field label="Đã kiểm tra bằng chứng lúc">
            <input
              className={inputClass}
              max={latestCheckAt}
              onChange={(event) => setCheckedAt(event.target.value)}
              required
              type="datetime-local"
              value={checkedAt}
            />
          </Field>
          <Field label="Kết quả kiểm tra">
            <textarea
              className={inputClass}
              maxLength={2_000}
              minLength={20}
              onChange={(event) => setEvidenceNote(event.target.value)}
              placeholder="Nêu nguồn nhật ký đã kiểm tra và căn cứ xác nhận provider chưa xử lý yêu cầu."
              required
              rows={4}
              value={evidenceNote}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-xs sm:text-sm font-semibold leading-6 text-slate-800 dark:text-slate-200">
            <input
              checked={confirmed}
              className="mt-1 size-4 shrink-0 accent-sky-600"
              onChange={(event) => setConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>
              Tôi xác nhận đã kiểm tra provider và có bằng chứng yêu cầu này chưa được xử lý hoặc tính phí.
            </span>
          </label>
          {reconcileError ? (
            <p role="alert" className="text-sm leading-6 text-rose-600 dark:text-rose-400">
              {reconcileError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={reconcileBusy}
              onClick={() => setReconciling(null)}
            >
              Hủy
            </Button>
            <Button type="submit" loading={reconcileBusy} disabled={!confirmed}>
              Ghi bằng chứng và mở lại
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
