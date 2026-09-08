"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import type { Assignment, AssignmentSubmission } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

type Suggestion = {
  insufficientEvidence: boolean; feedback: string; suggestedTotal: number | null;
  requiresHumanReview: true; model: string; submissionRevision: number; assignmentVersion: number;
  criteria: Array<{ criterionId: string; suggestedPoints: number; reasoning: string; evidence: string[] }>;
};
type Status = { state: "NOT_REQUESTED" | "GENERATING" | "READY" | "UNCERTAIN"; result?: Suggestion | null };
type Props = { assignment: Assignment; submission: AssignmentSubmission; onUse: (scores: Record<string, number>, feedback: string) => void };

/** Tách vòng đời theo bài nộp/phiên bản để không mang gợi ý của bài trước sang bài tiếp theo. */
export function AssignmentAiGrading(props: Props) {
  const { session } = useApp();
  if (session.roleCode !== "INSTRUCTOR" || !session.permissions.includes("exam:manage")) return null;
  return <GradingPanel key={`${session.user.id}:${props.submission.id}:${props.submission.revision}:${props.assignment.version}`} {...props} />;
}

/** Đối chiếu snapshot và bằng chứng trước khi cho chuyển điểm gợi ý vào biểu mẫu thủ công. */
function matchesSource(value: Suggestion, assignment: Assignment, submission: AssignmentSubmission): boolean {
  if (value.submissionRevision !== submission.revision || value.assignmentVersion !== assignment.version || value.requiresHumanReview !== true) return false;
  if (value.insufficientEvidence) return true;
  if (!Array.isArray(value.criteria) || value.criteria.length !== assignment.rubric.length || new Set(value.criteria.map((item) => item.criterionId)).size !== assignment.rubric.length) return false;
  return value.criteria.every((item) => {
    const criterion = assignment.rubric.find((entry) => entry.id === item.criterionId);
    return criterion && Number.isFinite(item.suggestedPoints) && item.suggestedPoints >= 0 && item.suggestedPoints <= criterion.maxPoints && Array.isArray(item.evidence) && item.evidence.length > 0 && item.evidence.every((quote) => typeof quote === "string" && quote.trim() && submission.content.includes(quote));
  });
}

/** Mở kết quả riêng theo yêu cầu; chỉ POST khi chưa có claim và không bao giờ tự ghi điểm. */
function GradingPanel({ assignment, submission, onUse }: Props) {
  const { session } = useApp();
  const [language, setLanguage] = useState<"VI" | "EN" | "BILINGUAL">(activeLocale() === "en-US" ? "EN" : "VI");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [used, setUsed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const unavailable = submission.attachments.length > 0 || !submission.content.trim();
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

  const result = status?.state === "READY" ? status.result : null;
  return <section aria-label="Gợi ý chấm AI" className="space-y-4 border-y border-[var(--rule)] py-5">
    <h3 className="font-bold">Gợi ý chấm AI</h3>
    <p className="text-sm leading-6 text-[var(--ink-soft)]">Gợi ý riêng cho giảng viên, không phải điểm chính thức. AI có thể sai; hãy đối chiếu từng tiêu chí và bài làm.</p>
    {unavailable ? <p className="text-sm text-[var(--ink-soft)]">AI hiện chỉ hỗ trợ bài làm văn bản không có tệp đính kèm. Hãy chấm bài này thủ công để không bỏ sót nội dung.</p> : <>
      <Field label="Ngôn ngữ gợi ý"><select className={inputClass} disabled={busy} value={language} onChange={(event) => { setLanguage(event.target.value as typeof language); setStatus(null); setError(""); setReviewed(false); setUsed(false); }}><option value="VI">Tiếng Việt</option><option value="EN">English</option><option value="BILINGUAL">Song ngữ Việt–Anh</option></select></Field>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void load(false)}>{busy ? "Đang xử lý gợi ý…" : "Kiểm tra gợi ý đã lưu"}</Button>
        {status?.state === "NOT_REQUESTED" ? <Button type="button" disabled={busy} onClick={() => void load(true)}>Tạo gợi ý chấm AI</Button> : null}
      </div>
      {status?.state === "NOT_REQUESTED" ? <p className="text-sm text-[var(--ink-soft)]">Chưa có gợi ý cho bài làm và ngôn ngữ này. Tạo gợi ý sẽ gửi bài làm cùng rubric tới model do admin cấu hình và có thể phát sinh phí.</p> : null}
      {busy ? <p role="status" className="text-sm text-[var(--ink-soft)]">Đang kiểm tra hoặc tạo gợi ý. Đóng cửa sổ không hủy tác vụ trên máy chủ.</p> : null}
      {status?.state === "GENERATING" || status?.state === "UNCERTAIN" ? <p role="status" className="text-sm text-[var(--ink-soft)]">Yêu cầu đang xử lý hoặc chưa rõ kết quả. Hệ thống không tự gọi lại AI; hãy kiểm tra trạng thái sau hoặc liên hệ quản trị viên.</p> : null}
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}
      {result ? <div className="space-y-4" aria-live="polite">
        <p className="break-words text-sm text-[var(--ink-soft)]"><span>Model</span>: <span translate="no">{result.model}</span></p>
        {result.insufficientEvidence ? <p className="font-semibold">Chưa đủ bằng chứng để gợi ý điểm</p> : <>
          <p className="font-semibold"><span>Tổng điểm đề xuất</span>: {result.suggestedTotal} / {assignment.maxScore}</p>
          <ol className="divide-y divide-[var(--rule)]">{result.criteria.map((item) => <li key={item.criterionId} className="space-y-2 py-4">
            <p className="flex flex-wrap justify-between gap-2 font-semibold"><span translate="no">{assignment.rubric.find((entry) => entry.id === item.criterionId)?.title}</span><span>{item.suggestedPoints} / {assignment.rubric.find((entry) => entry.id === item.criterionId)?.maxPoints}</span></p>
            <p translate="no" className="whitespace-pre-wrap break-words text-sm leading-6">{item.reasoning}</p>
            <details><summary className="cursor-pointer py-2 text-sm font-semibold">Đối chiếu trích dẫn bài làm</summary>{item.evidence.map((quote, index) => <blockquote key={index} translate="no" className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink-soft)]">{quote}</blockquote>)}</details>
          </li>)}</ol>
        </>}
        <h4 className="font-semibold">Phản hồi đề xuất</h4>
        <p translate="no" className="whitespace-pre-wrap break-words text-sm leading-6">{result.feedback}</p>
        {!result.insufficientEvidence && result.feedback.trim().length >= 3 ? <>
          <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1 size-5 shrink-0" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />Tôi đã kiểm tra và đồng ý thay điểm, phản hồi đang nhập bằng gợi ý này.</label>
          <Button type="button" variant="secondary" disabled={!reviewed || busy} onClick={useSuggestion}>Đưa gợi ý vào biểu mẫu</Button>
        </> : null}
        {used ? <p role="status" className="text-sm text-[var(--ink-soft)]">Đã điền biểu mẫu, chưa lưu điểm. Bạn có thể sửa trước khi bấm Lưu điểm rubric.</p> : null}
      </div> : null}
    </>}
  </section>;
}
