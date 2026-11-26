"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  LayoutGrid,
  Maximize2,
  Paperclip,
  Send,
  Sparkles,
} from "lucide-react";
import { AssignmentAiGrading } from "@/features/academic/assignment-ai-grading";
import { parseEssayQuestions } from "@/features/academic/assignment-question-parser";
import { DocumentRichViewer } from "@/features/academic/document-rich-viewer";
import { apiRequest } from "@/lib/api-client";
import type {
  Assignment,
  AssignmentSubmission,
  DirectoryUser,
  LearningClass,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { AccessDenied } from "@/shared/auth/access-denied";
import { Button, Field, RichText, StatusBadge, inputClass } from "@/shared/ui/ui";
import { UserAvatar } from "@/shared/ui/user-avatar";

type ReviewLayoutMode = "FULL" | "DOCUMENT_FOCUS" | "READ_ONLY";

/** Trả nhãn định dạng ngắn cho từng tệp bài nộp ở thanh chuyển tab. */
function shortFileTag(mimeType: string, fileName: string): string {
  if (mimeType.startsWith("image/") || /\.(?:png|jpe?g|webp|gif)$/i.test(fileName)) return "IMG";
  if (mimeType === "application/pdf" || /\.pdf$/i.test(fileName)) return "PDF";
  if (/\.docx$/i.test(fileName)) return "DOCX";
  if (/\.doc$/i.test(fileName)) return "DOC";
  if (mimeType === "text/plain" || /\.txt$/i.test(fileName)) return "TXT";
  return "FILE";
}

/** Cột hiển thị bài làm và tệp đính kèm tách memo để việc nhập điểm/nhận xét không re-render trình xem tài liệu hoặc KaTeX. */
const SubmissionContentColumn = memo(function SubmissionContentColumn({
  assignment,
  submission,
  layoutMode,
}: {
  assignment: Assignment;
  submission: AssignmentSubmission;
  layoutMode: ReviewLayoutMode;
}) {
  const { notify } = useApp();
  const { locale } = useI18n();
  const [selectedAttachmentId, setSelectedAttachmentId] = useState(
    () => submission.attachments[0]?.id ?? "",
  );
  const [copiedAnswer, setCopiedAnswer] = useState(false);

  const activeAttachment =
    submission.attachments.find((item) => item.id === selectedAttachmentId) ??
    submission.attachments[0] ??
    null;

  // Sao chép nội dung văn bản bài làm của học sinh vào clipboard.
  const handleCopyContent = async () => {
    if (!submission.content.trim() || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(submission.content);
      setCopiedAnswer(true);
      window.setTimeout(() => setCopiedAnswer(false), 1800);
      notify("Đã sao chép nội dung văn bản bài làm.", "success");
    } catch {
      notify("Không sao chép được văn bản.", "error");
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      {/* Thẻ thông tin học sinh nộp bài */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <UserAvatar name={submission.learnerName} className="size-10 text-sm shrink-0" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100 truncate">
                  {submission.learnerName}
                </h2>
                <StatusBadge status={submission.status} />
                {typeof submission.score === "number" && (
                  <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {submission.score} / {assignment.maxScore} điểm
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                {submission.learnerEmail && <span>{submission.learnerEmail}</span>}
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} />
                  Nộp lúc {new Date(submission.submittedAt).toLocaleString(locale)}
                </span>
                <span>Phiên bản nộp #{submission.revision}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Nội dung văn bản học sinh nhập trực tiếp */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <FileText size={14} className="text-sky-600" />
            <span>Nội dung trả lời trực tiếp của học sinh</span>
          </h3>
          {submission.content.trim() && (
            <button
              type="button"
              onClick={() => void handleCopyContent()}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              {copiedAnswer ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              <span>{copiedAnswer ? "Đã sao chép" : "Sao chép bài viết"}</span>
            </button>
          )}
        </div>
        {submission.content.trim() ? (
          <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4 text-sm leading-7 text-slate-800 dark:text-slate-100">
            <RichText className="prose-sm max-w-none">{submission.content}</RichText>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500">
            Học sinh không nhập văn bản trực tiếp (chỉ nộp tệp đính kèm bên dưới).
          </p>
        )}
      </section>

      {/* Trình xem tệp đính kèm toàn diện */}
      <section className="space-y-3" aria-label="Tệp đính kèm bài làm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
            <Paperclip size={14} className="text-sky-600" />
            <span>Tệp bài làm đính kèm ({submission.attachments.length})</span>
          </h3>
        </div>

        {submission.attachments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-8 text-center text-xs text-slate-500">
            Bài nộp này không có tệp đính kèm.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {submission.attachments.map((file, idx) => {
                const active = activeAttachment?.id === file.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedAttachmentId(file.id)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition cursor-pointer ${
                      active
                        ? "border-sky-500 bg-sky-50 text-sky-800 dark:border-sky-500 dark:bg-sky-950/60 dark:text-sky-200 shadow-2xs"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-300"
                    }`}
                  >
                    <span className="rounded bg-slate-900/10 dark:bg-white/10 px-1.5 py-0.5 text-[10px] font-extrabold">
                      {shortFileTag(file.mimeType, file.originalName)}
                    </span>
                    <span className="max-w-[180px] truncate">{`${idx + 1}. ${file.originalName}`}</span>
                  </button>
                );
              })}
            </div>

            {activeAttachment && (
              <DocumentRichViewer
                key={`${submission.id}:${activeAttachment.id}`}
                kind="SUBMISSION_ATTACHMENT"
                submissionId={submission.id}
                attachment={activeAttachment}
                heightClass={layoutMode === "DOCUMENT_FOCUS" ? "h-[78dvh]" : "h-[68dvh]"}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
});

/** Biểu mẫu chấm điểm rubric & nhận xét được cô lập hoàn toàn state nhập liệu khỏi cột tài liệu và khung ngoài. */
const SubmissionGradingForm = memo(function SubmissionGradingForm({
  assignment,
  submission,
  canGrade,
  hasNextStudent,
  onSaved,
}: {
  assignment: Assignment;
  submission: AssignmentSubmission;
  canGrade: boolean;
  hasNextStudent: boolean;
  onSaved: (updated: AssignmentSubmission, advanceNext: boolean) => void;
}) {
  const { session, notify } = useApp();
  const [rubricScores, setRubricScores] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      assignment.rubric.map((criterion) => [
        criterion.id,
        submission.rubricScores.find((entry) => entry.criterionId === criterion.id)?.score ?? 0,
      ]),
    ),
  );
  const [feedback, setFeedback] = useState(() => submission.feedback ?? "");
  const [saving, setSaving] = useState(false);

  const computedTotal = useMemo(
    () =>
      Math.round(
        assignment.rubric.reduce(
          (sum, criterion) => sum + (Number(rubricScores[criterion.id]) || 0),
          0,
        ) * 100,
      ) / 100,
    [assignment.rubric, rubricScores],
  );

  // Gửi điểm từng tiêu chí rubric và nhận xét giảng viên lên API chấm bài.
  const submitGrade = async (advanceNext: boolean) => {
    if (saving || !canGrade) return;
    const trimmedFeedback = feedback.trim();
    if (trimmedFeedback.length < 3) {
      notify("Vui lòng nhập nhận xét tối thiểu 3 ký tự.", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await apiRequest<AssignmentSubmission>(
        `/instructor/assignment-submissions/${encodeURIComponent(submission.id)}/grade`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            rubricScores: assignment.rubric.map((criterion) => ({
              criterionId: criterion.id,
              score: Number(rubricScores[criterion.id] ?? 0),
            })),
            feedback: trimmedFeedback,
            expectedSubmissionRevision: submission.revision,
          }),
        },
      );
      notify(advanceNext ? "Đã lưu điểm và chuyển sang học sinh tiếp theo." : "Đã lưu điểm rubric và phản hồi.", "success");
      onSaved(updated, advanceNext);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được điểm bài làm.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-xs space-y-4 xl:sticky xl:top-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <BookOpenCheck size={16} className="text-sky-600" />
          <span>Chấm điểm & Nhận xét</span>
        </h3>
        <span className="rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-2.5 py-0.5 text-xs font-black text-sky-700 dark:text-sky-300 tabular-nums">
          {computedTotal} / {assignment.maxScore}
        </span>
      </div>

      {canGrade && (
        <AssignmentAiGrading
          assignment={assignment}
          submission={submission}
          onUse={(scores, nextFeedback) => {
            setRubricScores(scores);
            setFeedback(nextFeedback);
          }}
        />
      )}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitGrade(false);
        }}
      >
        <div className="space-y-3">
          {assignment.rubric.map((criterion) => {
            const value = rubricScores[criterion.id] ?? 0;
            return (
              <div
                key={criterion.id}
                className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-slate-900 dark:text-slate-100">
                      {criterion.title}
                    </p>
                    {criterion.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {criterion.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-slate-500">
                    Tối đa {criterion.maxPoints}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    aria-label={`Điểm ${criterion.title}`}
                    className={`${inputClass} py-1.5 text-xs font-bold tabular-nums w-28`}
                    max={criterion.maxPoints}
                    min={0}
                    required
                    step="0.01"
                    type="number"
                    disabled={!canGrade || saving}
                    value={value}
                    onChange={(event) =>
                      setRubricScores((prev) => ({
                        ...prev,
                        [criterion.id]: Number(event.target.value),
                      }))
                    }
                  />
                  {canGrade && (
                    <div className="flex flex-wrap gap-1">
                      {[0, 0.5, 0.75, 1].map((ratio) => {
                        const preset = Math.round(criterion.maxPoints * ratio * 100) / 100;
                        return (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() =>
                              setRubricScores((prev) => ({
                                ...prev,
                                [criterion.id]: preset,
                              }))
                            }
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:border-sky-400 hover:text-sky-600 cursor-pointer"
                          >
                            {Math.round(ratio * 100)}%
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <Field label="Nhận xét chi tiết cho học sinh">
          <textarea
            aria-label="Nhận xét chi tiết"
            className={inputClass}
            minLength={3}
            placeholder="Ghi nhận ưu điểm, lỗi cần khắc phục hoặc gợi ý sửa bài..."
            required
            rows={4}
            disabled={!canGrade || saving}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </Field>

        {canGrade && (
          <div className="flex flex-col gap-2 pt-1">
            <Button type="submit" disabled={saving}>
              <Send size={14} />
              <span>{saving ? "Đang lưu điểm..." : "Lưu điểm rubric"}</span>
            </Button>
            {hasNextStudent && (
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void submitGrade(true)}
              >
                <CheckCircle2 size={14} />
                <span>Lưu & sang học sinh tiếp theo</span>
              </Button>
            )}
          </div>
        )}

        {!hasNextStudent && canGrade && submissionsDoneBadge(submission)}
      </form>

      {!canGrade && (
        <p className="text-xs text-slate-500">
          Bạn đang ở chế độ chỉ xem; chỉ giảng viên phân công mới có quyền chấm điểm.
        </p>
      )}
    </aside>
  );
});

/** Khung nội dung chi tiết cho một bài nộp tự luận, tách cột tài liệu và biểu mẫu chấm điểm độc lập. */
const SubmissionWorkAndGradingPane = memo(function SubmissionWorkAndGradingPane({
  assignment,
  submission,
  canGrade,
  layoutMode,
  hasNextStudent,
  onSaved,
  onNextStudent,
}: {
  assignment: Assignment;
  submission: AssignmentSubmission;
  canGrade: boolean;
  layoutMode: ReviewLayoutMode;
  hasNextStudent: boolean;
  onSaved: (updated: AssignmentSubmission, advanceNext: boolean) => void;
  onNextStudent: () => void;
}) {
  const showGradingPanel = layoutMode !== "READ_ONLY";

  return (
    <div
      className={
        showGradingPanel
          ? "grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px] items-start"
          : "space-y-5"
      }
    >
      <SubmissionContentColumn
        assignment={assignment}
        submission={submission}
        layoutMode={layoutMode}
      />

      {showGradingPanel && (
        <SubmissionGradingForm
          assignment={assignment}
          submission={submission}
          canGrade={canGrade}
          hasNextStudent={hasNextStudent}
          onSaved={onSaved}
        />
      )}
      {!showGradingPanel && hasNextStudent && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onNextStudent}>
            <span>Sang học sinh tiếp theo</span>
            <ArrowRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
});

/** Hiển thị thông báo phụ gọn khi đã hoàn tất bài cuối cùng trong danh sách. */
function submissionsDoneBadge(submission: AssignmentSubmission) {
  if (submission.status !== "GRADED") return null;
  return (
    <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 text-center">
      Bài làm này đã được chấm điểm và lưu vào bảng điểm lớp.
    </p>
  );
}

/** Trang mới toàn màn hình để giảng viên đối chiếu câu hỏi, xem Ảnh/PDF/DOC/DOCX và chấm bài tự luận học sinh. */
export function AssignmentSubmissionReviewScreen({
  classId,
  assignmentId,
  initialSubmissionId,
  returnTab,
  initialMode,
}: {
  classId: string;
  assignmentId: string;
  initialSubmissionId?: string | null;
  returnTab?: string | null;
  initialMode?: string | null;
}) {
  const router = useRouter();
  const { session, notify } = useApp();
  const { locale } = useI18n();
  const backTab = returnTab === "gradebook" ? "gradebook" : "assignments";
  const canAccess = ["INSTRUCTOR", "CENTER_MANAGER", "SYSTEM_ADMIN"].includes(session.roleCode);
  const canGrade =
    session.roleCode === "INSTRUCTOR" && session.permissions.includes("exam:manage");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [classItem, setClassItem] = useState<LearningClass | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [learners, setLearners] = useState<DirectoryUser[]>([]);
  const [submissions, setSubmissions] = useState<AssignmentSubmission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(
    () => initialSubmissionId ?? "",
  );
  const [layoutMode, setLayoutMode] = useState<ReviewLayoutMode>(
    () => (initialMode === "view" ? "READ_ONLY" : "FULL"),
  );
  const [showSourceMaterialViewer, setShowSourceMaterialViewer] = useState(false);
  const loadSeqRef = useRef(0);

  // Tải thông tin lớp, bài tập tự luận, học viên và danh sách bài nộp ban đầu.
  const loadWorkspace = useCallback(async () => {
    if (!canAccess || !classId || !assignmentId) return;
    const seq = ++loadSeqRef.current;
    try {
      const [classesResult, assignmentsResult, submissionsResult, learnersResult] =
        await Promise.all([
          apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
          apiRequest<Assignment[]>(`/academic/assignments?classId=${encodeURIComponent(classId)}`, {
            roleCode: session.roleCode,
          }),
          apiRequest<AssignmentSubmission[]>(
            `/instructor/assignments/${encodeURIComponent(assignmentId)}/submissions`,
            { roleCode: session.roleCode },
          ),
          session.roleCode === "INSTRUCTOR"
            ? apiRequest<DirectoryUser[]>(`/instructor/classes/${encodeURIComponent(classId)}/learners`, {
                roleCode: session.roleCode,
              }).catch(() => [] as DirectoryUser[])
            : Promise.resolve([] as DirectoryUser[]),
        ]);
      if (seq !== loadSeqRef.current) return;
      const foundClass = classesResult.find((item) => item.id === classId) ?? null;
      const foundAssignment = assignmentsResult.find((item) => item.id === assignmentId) ?? null;
      if (!foundAssignment) {
        setError("Không tìm thấy bài tập tự luận trong lớp học này.");
      } else {
        setError("");
      }
      setClassItem(foundClass);
      setAssignment(foundAssignment);
      setLearners(Array.isArray(learnersResult) ? learnersResult : []);
      const list = Array.isArray(submissionsResult) ? submissionsResult : [];
      setSubmissions(list);
      setSelectedSubmissionId((current) => {
        if (current && list.some((item) => item.id === current)) return current;
        if (initialSubmissionId && list.some((item) => item.id === initialSubmissionId)) {
          return initialSubmissionId;
        }
        return list.find((item) => item.status === "SUBMITTED")?.id ?? list[0]?.id ?? "";
      });
    } catch (cause) {
      if (seq !== loadSeqRef.current) return;
      const message =
        cause instanceof Error ? cause.message : "Không tải được danh sách bài nộp tự luận.";
      setError(message);
      notify(message, "error");
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [assignmentId, canAccess, classId, initialSubmissionId, notify, session.roleCode]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      loadSeqRef.current += 1;
    };
  }, [loadWorkspace]);

  const parsedQuestions = useMemo(
    () =>
      assignment ? parseEssayQuestions(assignment.instructions, assignment.description) : [],
    [assignment],
  );

  const selectedIndex = submissions.findIndex((item) => item.id === selectedSubmissionId);
  const activeSubmission =
    (selectedIndex >= 0 ? submissions[selectedIndex] : submissions[0]) ?? null;
  const gradedCount = submissions.filter((item) => item.status === "GRADED").length;
  const notSubmittedLearners = learners.filter(
    (learner) => !submissions.some((item) => item.learnerId === learner.id),
  );

  // Chọn bài nộp theo chỉ số mảng và đồng bộ submissionId lên query string URL.
  const selectByIndex = (nextIndex: number) => {
    const target = submissions[nextIndex];
    if (!target) return;
    setSelectedSubmissionId(target.id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("submissionId", target.id);
      window.history.replaceState({}, "", url.toString());
    }
  };

  if (!canAccess) return <AccessDenied />;

  return (
    <div className="mx-auto max-w-[1620px] px-4 py-4 sm:px-6 space-y-5">
      {/* Thanh điều hướng trên cùng */}
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push(`/courses/classes/${encodeURIComponent(classId)}?tab=${backTab}`)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <ArrowLeft size={14} />
              <span>Quay lại lớp học</span>
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {classItem && (
                  <span className="rounded-md bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 px-2 py-0.5 text-[11px] font-extrabold text-sky-700 dark:text-sky-300">
                    {classItem.code}
                  </span>
                )}
                <h1 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 truncate">
                  {assignment?.title ?? "Chi tiết chấm bài tự luận"}
                </h1>
              </div>
              {assignment && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Hạn nộp: {new Date(assignment.dueAt).toLocaleString(locale)} · Thang {assignment.maxScore} điểm · Đã chấm {gradedCount}/{submissions.length} bài nộp
                  {learners.length > 0 ? ` (${notSubmittedLearners.length} học viên chưa nộp)` : ""}
                </p>
              )}
            </div>
          </div>

          {/* Bộ chuyển chế độ bố cục */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setLayoutMode("FULL")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 cursor-pointer ${
                layoutMode === "FULL"
                  ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              <LayoutGrid size={13} />
              <span>Đầy đủ 3 vùng</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("DOCUMENT_FOCUS")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 cursor-pointer ${
                layoutMode === "DOCUMENT_FOCUS"
                  ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              <Maximize2 size={13} />
              <span>Tập trung tài liệu</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("READ_ONLY")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 cursor-pointer ${
                layoutMode === "READ_ONLY"
                  ? "bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-2xs"
                  : "text-slate-600 dark:text-slate-300"
              }`}
            >
              <Sparkles size={13} />
              <span>Chỉ xem bài & đề</span>
            </button>
          </div>
        </div>

        {/* Thanh chọn học sinh & điều hướng Trước / Sau */}
        {submissions.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
              <label htmlFor="submission-learner-select" className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
                Chọn học sinh:
              </label>
              <select
                id="submission-learner-select"
                value={activeSubmission?.id ?? ""}
                onChange={(event) => {
                  const idx = submissions.findIndex((item) => item.id === event.target.value);
                  if (idx >= 0) selectByIndex(idx);
                }}
                className="min-w-[240px] max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100"
              >
                {submissions.map((item, idx) => (
                  <option key={item.id} value={item.id}>
                    {`${idx + 1}. ${item.learnerName} — ${
                      item.status === "GRADED"
                        ? `Đã chấm (${item.score ?? 0}/${assignment?.maxScore ?? 10})`
                        : "Chờ chấm"
                    }`}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={selectedIndex <= 0}
                onClick={() => selectByIndex(selectedIndex - 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <ArrowLeft size={13} />
                <span>Học sinh trước</span>
              </button>
              <span className="text-xs font-bold text-slate-500 tabular-nums">
                {selectedIndex >= 0 ? selectedIndex + 1 : 1} / {submissions.length}
              </span>
              <button
                type="button"
                disabled={selectedIndex < 0 || selectedIndex >= submissions.length - 1}
                onClick={() => selectByIndex(selectedIndex + 1)}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <span>Học sinh tiếp theo</span>
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        )}
      </header>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm text-slate-500">
          Đang tải đề bài và bài làm tự luận...
        </div>
      ) : error || !assignment ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/30 p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
            {error || "Không tìm thấy bài tập."}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`/courses/classes/${encodeURIComponent(classId)}?tab=${backTab}`)}
          >
            Quay lại lớp học
          </Button>
        </div>
      ) : (
        <div
          className={
            layoutMode === "DOCUMENT_FOCUS"
              ? "space-y-5"
              : "grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] items-start"
          }
        >
          {/* Cột Trái (hoặc hàng trên khi tập trung tài liệu): Note rõ TOÀN BỘ CÂU HỎI & Tệp đề */}
          <section
            aria-label="Đề bài và toàn bộ câu hỏi"
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 p-4 sm:p-5 shadow-xs space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <ClipboardList size={16} className="text-sky-600" />
                <span>Toàn bộ câu hỏi & Đề bài</span>
              </h2>
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                {parsedQuestions.filter((item) => !item.isGeneral).length || 1} phần
              </span>
            </div>

            {assignment.description.trim() && (
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-3 space-y-1">
                <p className="text-[11px] font-extrabold uppercase text-slate-500">Mô tả chung</p>
                <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                  {assignment.description}
                </p>
              </div>
            )}

            <ol className="space-y-3">
              {parsedQuestions.map((question, idx) => (
                <li
                  key={`${question.label}-${idx}`}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center rounded-lg bg-sky-600 px-2 py-0.5 text-[11px] font-extrabold text-white">
                      {question.label}
                    </span>
                  </div>
                  <RichText className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-100 [&>p]:my-1">
                    {question.prompt}
                  </RichText>
                </li>
              ))}
            </ol>

            {assignment.sourceMaterial && (
              <div className="rounded-xl border border-sky-200 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/25 p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase text-sky-700 dark:text-sky-300">
                      Tệp đề đính kèm
                    </p>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {assignment.sourceMaterial.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSourceMaterialViewer((prev) => !prev)}
                    className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sky-700 shrink-0 cursor-pointer"
                  >
                    {showSourceMaterialViewer ? "Ẩn tệp đề" : "Xem tệp đề"}
                  </button>
                </div>
                {showSourceMaterialViewer && (
                  <DocumentRichViewer
                    key={`source:${assignment.sourceMaterial.id}`}
                    kind="MATERIAL"
                    material={assignment.sourceMaterial}
                    heightClass="h-[46dvh]"
                  />
                )}
              </div>
            )}

            <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
              <p className="text-[11px] font-extrabold uppercase text-slate-500">
                Thang điểm tiêu chí ({assignment.rubric.length})
              </p>
              <ul className="space-y-1.5 text-xs">
                {assignment.rubric.map((criterion) => (
                  <li
                    key={criterion.id}
                    className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 px-2.5 py-1.5"
                  >
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {criterion.title}
                    </span>
                    <span className="font-extrabold text-sky-700 dark:text-sky-300 shrink-0">
                      {criterion.maxPoints}đ
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Khung xem bài nộp & chấm điểm */}
          <div className="min-w-0">
            {!activeSubmission ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center space-y-2">
                <FileText size={32} className="mx-auto text-slate-400" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Chưa có học viên nào nộp bài cho bài tập này.
                </p>
                <p className="text-xs text-slate-500">
                  Các câu hỏi đề bài ở cột bên trái đã sẵn sàng để đối chiếu ngay khi có bài nộp đầu tiên.
                </p>
              </div>
            ) : (
              <SubmissionWorkAndGradingPane
                key={`${activeSubmission.id}:${activeSubmission.revision}:${activeSubmission.status}`}
                assignment={assignment}
                submission={activeSubmission}
                canGrade={canGrade}
                layoutMode={layoutMode}
                hasNextStudent={selectedIndex >= 0 && selectedIndex < submissions.length - 1}
                onNextStudent={() => selectByIndex(selectedIndex + 1)}
                onSaved={(updated, advanceNext) => {
                  setSubmissions((prev) =>
                    prev.map((item) => (item.id === updated.id ? updated : item)),
                  );
                  if (advanceNext && selectedIndex >= 0 && selectedIndex < submissions.length - 1) {
                    selectByIndex(selectedIndex + 1);
                  }
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
