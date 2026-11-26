"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { Button, Field, inputClass } from "@/shared/ui/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import type { Assignment, AssignmentSubmission } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type Suggestion = {
  insufficientEvidence: boolean; feedback: string; suggestedTotal: number | null;
  requiresHumanReview: true; model: string; submissionRevision: number; assignmentVersion: number;
  criteria: Array<{ criterionId: string; suggestedPoints: number; reasoning: string; evidence: string[] }>;
  sources?: Array<{ attachmentId: string | null; name: string; checksum: string | null; text: string }>;
};
type Status = { state: "NOT_REQUESTED" | "GENERATING" | "READY" | "UNCERTAIN"; result?: Suggestion | null };
type Props = { assignment: Assignment; submission: AssignmentSubmission; onUse: (scores: Record<string, number>, feedback: string) => void };
const OCR_TYPES: Record<string, RegExp> = { "application/pdf": /\.pdf$/i, "image/png": /\.png$/i, "image/jpeg": /\.jpe?g$/i, "image/webp": /\.webp$/i };
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Chuẩn hóa tên tiêu chí mặc định cũ sang nhãn phần tự luận thống nhất.
function formatCriterionTitle(title: string | undefined): string {
  if (!title) return "";
  return title === "Mức độ hoàn thành" || title === "Nội dung" ? "Phần tự luận" : title;
}

/** Hiển thị sớm giới hạn tệp đính kèm tương ứng với server; server vẫn quyết định tính hợp lệ. */
function supportedAttachment(file: AssignmentSubmission["attachments"][number]): boolean {
  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) return false;
  if (file.mimeType === "text/plain" && /\.txt$/i.test(file.originalName)) return file.sizeBytes <= 80_000;
  if (file.mimeType === DOCX_TYPE && /\.docx$/i.test(file.originalName)) return file.sizeBytes <= 12 * 1024 * 1024;
  return Boolean(Object.hasOwn(OCR_TYPES, file.mimeType) && OCR_TYPES[file.mimeType]!.test(file.originalName) && file.sizeBytes <= 12 * 1024 * 1024);
}

/** Tách vòng đời theo bài nộp/phiên bản để không mang gợi ý của bài trước sang bài tiếp theo. */
export function AssignmentAiGrading(props: Props) {
  const { session } = useApp();
  if (session.roleCode !== "INSTRUCTOR" || !session.permissions.includes("exam:manage")) return null;
  return <GradingPanel key={`${session.user.id}:${props.submission.id}:${props.submission.revision}:${props.assignment.version}`} {...props} />;
}

/** Đối chiếu snapshot và bằng chứng trước khi cho chuyển điểm gợi ý vào biểu mẫu thủ công. */
function matchesSource(value: Suggestion, assignment: Assignment, submission: AssignmentSubmission): boolean {
  if (value.submissionRevision !== submission.revision || value.assignmentVersion !== assignment.version || value.requiresHumanReview !== true) return false;
  const texts = verifiedSourceTexts(value, submission);
  if (!texts) return false;
  if (value.insufficientEvidence) return true;
  if (!Array.isArray(value.criteria) || value.criteria.length !== assignment.rubric.length || new Set(value.criteria.map((item) => item.criterionId)).size !== assignment.rubric.length) return false;
  return value.criteria.every((item) => {
    const criterion = assignment.rubric.find((entry) => entry.id === item.criterionId);
    return criterion && Number.isFinite(item.suggestedPoints) && item.suggestedPoints >= 0 && item.suggestedPoints <= criterion.maxPoints && Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.every((quote) => typeof quote === "string" && quote.trim() && texts.some((text) => text.includes(quote)));
  });
}

/** Đối chiếu danh sách nguồn từ server với bài đang xem; không chấp nhận thiếu, trùng hoặc thêm tệp lạ. */
function verifiedSourceTexts(value: Suggestion, submission: AssignmentSubmission): string[] | null {
  if (!submission.attachments.length && value.sources === undefined) return [submission.content];
  const sources = value.sources;
  if (!Array.isArray(sources) || sources.length !== submission.attachments.length + (submission.content.trim() ? 1 : 0) || new Set(sources.map((source) => source.attachmentId)).size !== sources.length) return null;
  if (!sources.every((source) => {
    if (typeof source.text !== "string" || !source.text.trim() || source.text.length > 20000) return false;
    if (source.attachmentId === null) return Boolean(submission.content.trim()) && source.text === submission.content && source.checksum === null;
    const file = submission.attachments.find((item) => item.id === source.attachmentId);
    return file && source.name === file.originalName && typeof source.checksum === "string" && /^sha256:[a-f0-9]{64}$/.test(source.checksum);
  })) return null;
  const texts = sources.map((source) => source.text);
  return texts.join("\n\n").length <= 20000 ? texts : null;
}

/** Mở kết quả riêng theo yêu cầu; chỉ POST khi chưa có claim và không bao giờ tự ghi điểm. */
function GradingPanel({ assignment, submission, onUse }: Props) {
  const { session } = useApp();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<"VI" | "EN" | "BILINGUAL">(activeLocale() === "en-US" ? "EN" : "VI");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [used, setUsed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const hasOcrSource = submission.attachments.some((file) => Object.hasOwn(OCR_TYPES, file.mimeType));
  const hasDocxSource = submission.attachments.some((file) => file.mimeType === DOCX_TYPE);
  const unavailable = submission.attachments.length > 5 || submission.attachments.some((file) => !supportedAttachment(file)) || submission.attachments.reduce((sum, file) => sum + file.sizeBytes, 0) > 24 * 1024 * 1024 || (!submission.attachments.length && !submission.content.trim());
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  /** GET đối soát trạng thái; POST chỉ tạo từ trạng thái chưa yêu cầu, timeout buộc đọc lại thay vì gửi lặp. */
  async function load(generate: boolean): Promise<void> {
    if (request.current || unavailable || (generate && status?.state !== "NOT_REQUESTED")) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(""); setStatus(null); setReviewed(false); setUsed(false);
    const timeout = window.setTimeout(() => controller.abort(), generate ? 120_000 : 30_000);
    try {
      const path = `/instructor/assignment-submissions/${encodeURIComponent(submission.id)}/ai-suggestion`;
      const body = { expectedSubmissionRevision: submission.revision, language };
      const response = generate
        ? { state: "READY" as const, result: await apiRequest<Suggestion>(path, { method: "POST", roleCode: session.roleCode, signal: controller.signal, body: JSON.stringify(body) }) }
        : await apiRequest<Status>(`${path}?expectedSubmissionRevision=${submission.revision}&language=${language}`, { roleCode: session.roleCode, signal: controller.signal });
      if (request.current !== controller) return;
      if (response.state === "READY" && (!response.result || !matchesSource(response.result, assignment, submission))) throw new Error("Gợi ý không khớp bài làm hoặc rubric đang xem. Hãy đóng và mở lại bài nộp.");
      setStatus(response);
    } catch (cause) {
      if (request.current === controller) setError(controller.signal.aborted ? "Đã hết thời gian chờ. Máy chủ có thể vẫn đang xử lý; hãy kiểm tra trạng thái, không gửi lại yêu cầu tạo." : cause instanceof Error ? cause.message : "Không đọc được gợi ý chấm. Hãy kiểm tra lại trạng thái.");
    } finally {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }

  /** Chỉ thay dữ liệu trong form sau xác nhận; giảng viên vẫn phải bấm nút lưu điểm riêng. */
  function useSuggestion(): void {
    const result = status?.result;
    if (!reviewed || busy || !result || result.insufficientEvidence || !matchesSource(result, assignment, submission) || result.feedback.trim().length < 3) return;
    onUse(Object.fromEntries(result.criteria.map((item) => [item.criterionId, item.suggestedPoints])), result.feedback);
    setReviewed(false); setUsed(true);
  }

  // Bấm lần đầu hiển thị gợi ý đã lưu; bấm lần nữa khi đang mở sẽ ẩn phần gợi ý đi.
  function toggleSavedSuggestion(): void {
    if (busy) return;
    if (status !== null) {
      setStatus(null);
      setError("");
      setReviewed(false);
      setUsed(false);
      return;
    }
    void load(false);
  }

  const result = status?.state === "READY" ? status.result : null;
  return (
    <section aria-label="Gợi ý chấm AI" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 rounded-xl transition cursor-pointer"
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles size={15} className="text-sky-600 dark:text-sky-400 shrink-0" />
          <span>Gợi ý chấm AI</span>
        </span>
        <ChevronDown
          size={15}
          className={`text-slate-400 transition-transform duration-150 shrink-0 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 px-3.5 py-3">
          {unavailable ? (
            <p className="text-xs leading-5 text-[var(--ink-soft)]">
              AI hỗ trợ tối đa 5 tệp TXT, DOCX, PDF, PNG, JPEG hoặc WebP; tối đa 12 MB mỗi DOCX/PDF/ảnh và 24 MB toàn bộ tệp. Word DOC cũ và bài vượt giới hạn cần chấm thủ công để không bỏ sót nội dung.
            </p>
          ) : (
            <>
              <Field label="Ngôn ngữ gợi ý">
                <select
                  className={inputClass}
                  disabled={busy}
                  value={language}
                  onChange={(event) => {
                    setLanguage(event.target.value as typeof language);
                    setStatus(null);
                    setError("");
                    setReviewed(false);
                    setUsed(false);
                  }}
                >
                  <option value="VI">Tiếng Việt</option>
                  <option value="EN">English</option>
                  <option value="BILINGUAL">Song ngữ Việt–Anh</option>
                </select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  aria-expanded={status !== null}
                  disabled={busy}
                  onClick={toggleSavedSuggestion}
                >
                  {busy ? "Đang xử lý gợi ý…" : "Kiểm tra gợi ý đã lưu"}
                </Button>
                {status?.state === "NOT_REQUESTED" ? (
                  <Button type="button" disabled={busy} onClick={() => void load(true)}>
                    Tạo gợi ý chấm AI
                  </Button>
                ) : null}
              </div>
              {status?.state === "NOT_REQUESTED" ? (
                <p className="text-xs leading-5 text-[var(--ink-soft)]">
                  Chưa có gợi ý đã lưu cho bài làm và ngôn ngữ này.
                </p>
              ) : null}
              {busy ? (
                <p role="status" className="text-xs leading-5 text-[var(--ink-soft)]">
                  Đang kiểm tra hoặc tạo gợi ý. Đóng cửa sổ không hủy tác vụ trên máy chủ.
                </p>
              ) : null}
              {status?.state === "GENERATING" || status?.state === "UNCERTAIN" ? (
                <p role="status" className="text-xs leading-5 text-[var(--ink-soft)]">
                  Yêu cầu đang xử lý hoặc chưa rõ kết quả. Hệ thống không tự gọi lại AI; hãy kiểm tra trạng thái sau hoặc liên hệ quản trị viên.
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-xs leading-5 text-[var(--danger)]">
                  {error}
                </p>
              ) : null}
              {result ? (
                <div className="space-y-3 pt-1" aria-live="polite">
                  {result.sources?.length ? (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold">Nguồn dùng để chấm</h4>
                      <p className="text-xs leading-5 text-[var(--ink-soft)]">
                        {hasOcrSource
                          ? "Bytes và checksum đã được máy chủ đối chiếu với tệp lưu trữ. Văn bản PDF/ảnh vẫn là kết quả OCR chưa được xác minh độc lập; mở từng nguồn để kiểm tra trước khi dùng gợi ý."
                          : hasDocxSource
                            ? "Bytes và checksum đã được máy chủ đối chiếu với tệp lưu trữ. Văn bản DOCX là bản trích xuất cục bộ chưa giữ nguyên mọi định dạng; mở từng nguồn để kiểm tra trước khi dùng gợi ý."
                            : "Bản văn bản đã được máy chủ đối chiếu với tệp lưu trữ. Mở từng nguồn để kiểm tra nội dung trước khi dùng gợi ý."}
                      </p>
                      {result.sources.map((source) => (
                        <details key={source.attachmentId ?? "inline"} className="border-b border-[var(--rule)] py-1.5">
                          <summary className="cursor-pointer break-words py-1.5 text-xs font-semibold">
                            {source.attachmentId ? <span translate="no">{source.name}</span> : <span>Nội dung nhập trực tiếp</span>}
                          </summary>
                          <p translate="no" className="max-h-56 overflow-auto whitespace-pre-wrap break-words py-2 text-xs leading-5" tabIndex={0}>
                            {source.text}
                          </p>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {result.insufficientEvidence ? (
                    <p className="text-xs font-semibold">Chưa đủ bằng chứng để gợi ý điểm</p>
                  ) : (
                    <>
                      <p className="text-xs font-semibold">
                        <span>Tổng điểm đề xuất</span>: {result.suggestedTotal} / {assignment.maxScore}
                      </p>
                      <ol className="divide-y divide-[var(--rule)]">
                        {result.criteria.map((item) => {
                          const matched = assignment.rubric.find((entry) => entry.id === item.criterionId);
                          return (
                            <li key={item.criterionId} className="space-y-1.5 py-3">
                              <p className="flex flex-wrap justify-between gap-2 text-xs font-semibold">
                                <span translate="no">{formatCriterionTitle(matched?.title)}</span>
                                <span>{item.suggestedPoints} / {matched?.maxPoints}</span>
                              </p>
                              <p translate="no" className="whitespace-pre-wrap break-words text-xs leading-5">
                                {item.reasoning}
                              </p>
                              <details>
                                <summary className="cursor-pointer py-1 text-xs font-semibold">Đối chiếu trích dẫn bài làm</summary>
                                {item.evidence.map((quote, index) => (
                                  <div key={index} className="mt-2">
                                    {result.sources ? (
                                      <p className="break-words text-xs font-semibold">
                                        <span>Nguồn trích dẫn</span>:{" "}
                                        {result.sources.find((source) => source.text.includes(quote))?.attachmentId ? (
                                          <span translate="no">{result.sources.find((source) => source.text.includes(quote))?.name}</span>
                                        ) : (
                                          <span>Nội dung nhập trực tiếp</span>
                                        )}
                                      </p>
                                    ) : null}
                                    <blockquote translate="no" className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--ink-soft)]">
                                      {quote}
                                    </blockquote>
                                  </div>
                                ))}
                              </details>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  )}
                  <h4 className="text-xs font-semibold">Phản hồi đề xuất</h4>
                  <p translate="no" className="whitespace-pre-wrap break-words text-xs leading-5">
                    {result.feedback}
                  </p>
                  {!result.insufficientEvidence && result.feedback.trim().length >= 3 ? (
                    <>
                      <label className="flex items-start gap-2.5 text-xs leading-5">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0"
                          checked={reviewed}
                          onChange={(event) => setReviewed(event.target.checked)}
                        />
                        <span>Tôi đã kiểm tra và đồng ý thay điểm, phản hồi đang nhập bằng gợi ý này.</span>
                      </label>
                      <Button type="button" variant="secondary" disabled={!reviewed || busy} onClick={useSuggestion}>
                        Đưa gợi ý vào biểu mẫu
                      </Button>
                    </>
                  ) : null}
                  {used ? (
                    <p role="status" className="text-xs leading-5 text-[var(--ink-soft)]">
                      Đã điền biểu mẫu, chưa lưu điểm. Bạn có thể sửa trước khi bấm Lưu điểm.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
