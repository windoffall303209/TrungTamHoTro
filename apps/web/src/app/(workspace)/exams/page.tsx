"use client";

import { CheckCircle2, Clock3, Eye, ListOrdered, Play, Plus, RotateCcw, Search, Send } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { QuestionImage } from "@/components/question-image";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, Pagination, RichText, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import { eligibleExamQuestions } from "@/lib/exam-question-selection";
import type {
  Exam,
  ExamAttempt,
  LearnerResult,
  LearningClass,
  Question,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

const blank = {
  classId: "",
  title: "",
  questionIds: [] as string[],
  durationMinutes: 45,
  totalScore: 10,
  openAt: "",
  closeAt: "",
  attemptLimit: 1,
  shuffleQuestions: false,
  randomSeed: "wind-exam-2026",
};
interface LearnerExam extends Exam {
  questionCount?: number;
  availabilityStatus?:
    | "UPCOMING"
    | "AVAILABLE"
    | "IN_PROGRESS"
    | "ATTEMPT_LIMIT_REACHED"
    | "CLOSED";
  remainingAttempts?: number;
  serverTime?: string;
}
export default function ExamsPage() {
  const { session, notify } = useApp();
  const searchParams = useSearchParams();
  const allowed = ["SYSTEM_ADMIN", "CENTER_MANAGER", "INSTRUCTOR", "LEARNER"].includes(session.roleCode);
  const instructor = session.roleCode === "INSTRUCTOR";
  const learner = session.roleCode === "LEARNER";
  const canReview = ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) && hasPermission(session, "class:manage");
  const [items, setItems] = useState<LearnerExam[]>([]);
  const pagination = usePagination(items);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attemptQuestions, setAttemptQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [results, setResults] = useState<LearnerResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<LearnerResult | null>(null);
  const [regradeOpen, setRegradeOpen] = useState(false);
  const [regradeReason, setRegradeReason] = useState("");
  const [activeExam, setActiveExam] = useState<LearnerExam | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [autosaveStatus, setAutosaveStatus] = useState<
    "IDLE" | "SAVING" | "SAVED" | "ERROR"
  >("IDLE");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [returnTarget, setReturnTarget] = useState<LearnerExam | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [previewExam, setPreviewExam] = useState<LearnerExam | null>(null);
  const [previewQuestions, setPreviewQuestions] = useState<Question[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form, setForm] = useState(blank);
  const [questionQuery, setQuestionQuery] = useState("");
  const selectableQuestions = useMemo(
    () => eligibleExamQuestions(questions, classes, form.classId),
    [classes, form.classId, questions],
  );
  const filteredSelectableQuestions = useMemo(() => {
    const needle = questionQuery.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");
    if (!needle) return selectableQuestions;
    return selectableQuestions.filter((question) => `${question.content} ${question.tags.join(" ")} ${question.type}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN").includes(needle));
  }, [questionQuery, selectableQuestions]);
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [exams, classData, questionData, resultData] = await Promise.all([
        apiRequest<LearnerExam[]>(learner ? "/learner/exams" : "/exams", {
          roleCode: session.roleCode,
        }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
        instructor
          ? apiRequest<Question[]>("/instructor/question-bank/questions?status=PUBLISHED", {
              roleCode: session.roleCode,
            })
          : Promise.resolve([]),
        learner
          ? apiRequest<LearnerResult[]>("/learner/results", { roleCode: session.roleCode })
          : Promise.resolve([]),
      ]);
      setItems(exams);
      setClasses(classData);
      setQuestions(questionData);
      setResults(resultData);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được đề thi.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed, instructor, learner, notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (searchParams.get("create") !== "scan" || !questions.length || !classes.length) return;
    const raw = sessionStorage.getItem("wind-scan-question-ids");
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
      const selectedQuestions = questions.filter((question) => ids.includes(question.id));
      const classItem = classes.find((item) => item.courseId === selectedQuestions[0]?.courseId);
      if (classItem && selectedQuestions.length) { setForm({ ...blank, classId: classItem.id, questionIds: selectedQuestions.map((item) => item.id) }); setOpen(true); notify(`Đã đưa ${selectedQuestions.length} câu vừa quét vào đề mới.`, "info"); }
    } finally { sessionStorage.removeItem("wind-scan-question-ids"); }
  }, [classes, notify, questions, searchParams]);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/instructor/exams", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          ...form,
          openAt: new Date(form.openAt).toISOString(),
          closeAt: new Date(form.closeAt).toISOString(),
        }),
      });
      notify("Đã tạo đề thi bản nháp.");
      setOpen(false);
      setForm(blank);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được đề thi.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };
  const publish = async (item: Exam) => {
    try {
      const updated = await apiRequest<Exam>(`/instructor/exams/${item.id}/publish`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify(updated.status === "PUBLISHED" ? "Đề đã được tự động phê duyệt và phát hành." : "Đã gửi đề sang hàng chờ phê duyệt.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi duyệt được.",
        "error",
      );
    }
  };
  const preview = async (item: LearnerExam) => {
    setPreviewExam(item); setPreviewQuestions([]); setPreviewLoading(true);
    try { setPreviewQuestions(await apiRequest<Question[]>(`/instructor/exams/${item.id}/preview`, { roleCode: session.roleCode })); }
    catch (error) { setPreviewExam(null); notify(error instanceof Error ? error.message : "Không tải được bản xem đề thi.", "error"); }
    finally { setPreviewLoading(false); }
  };
  const review = async (item: LearnerExam, decision: "APPROVE" | "RETURN", reviewNote?: string) => {
    setReviewingId(item.id);
    try {
      await apiRequest(`/manager/exams/${item.id}/approve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ decision, reviewNote }),
      });
      notify(decision === "APPROVE" ? "Đã phê duyệt và phát hành đề." : "Đã trả đề về bản nháp cho giảng viên.");
      setReturnTarget(null);
      setReturnNote("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được trạng thái phê duyệt.", "error");
    } finally {
      setReviewingId(null);
    }
  };
  const start = async (item: LearnerExam) => {
    try {
      const data = await apiRequest<ExamAttempt>(
        `/learner/exams/${item.id}/attempts`,
        { method: "POST", roleCode: session.roleCode },
      );
      const questionData = await apiRequest<Question[]>(
        `/learner/exams/${item.id}/questions`,
        { roleCode: session.roleCode },
      );
      const deadline = Math.min(
        new Date(data.startedAt).getTime() + item.durationMinutes * 60_000,
        new Date(item.closeAt).getTime(),
      );
      setAttempt(data);
      setActiveExam(item);
      setRemainingSeconds(
        Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
      );
      setAttemptQuestions(questionData);
      setAnswerDrafts(Object.fromEntries(questionData.map((question) => [question.id, data.answers[question.id]?.[0] ?? ""])));
      notify(
        "Đã bắt đầu lượt làm bài; câu hỏi chỉ được mở sau khi server tạo lượt hợp lệ.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không bắt đầu được.",
        "error",
      );
    }
  };
  const answer = async (questionId: string, answers: string[]) => {
    if (!attempt) return;
    const previousAttempt = attempt;
    setAttempt({ ...attempt, answers: { ...attempt.answers, [questionId]: answers } });
    const request = () =>
      apiRequest<ExamAttempt>(`/learner/exam-attempts/${attempt.id}/answers`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ questionId, answers }),
      });
    setAutosaveStatus("SAVING");
    try {
      let data: ExamAttempt;
      try {
        data = await request();
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        data = await request();
      }
      setAttempt(data);
      setAutosaveStatus("SAVED");
    } catch (error) {
      setAttempt(previousAttempt);
      setAutosaveStatus("ERROR");
      notify(
        error instanceof Error
          ? error.message
          : "Không lưu được câu trả lời sau hai lần thử.",
        "error",
      );
    }
  };
  const saveTextAnswer = (questionId: string) => {
    const value = answerDrafts[questionId]?.trim();
    void answer(questionId, value ? [value] : []);
  };
  const submit = useCallback(async (automatic = false) => {
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    try {
      const data = await apiRequest<ExamAttempt>(
        `/learner/exam-attempts/${attempt.id}/submit`,
        { method: "POST", roleCode: session.roleCode },
      );
      setAttempt(data);
      setRemainingSeconds(0);
      notify(
        `${automatic ? "Hết giờ, hệ thống đã tự nộp bài" : "Đã nộp bài"}. Điểm hiện tại: ${data.score ?? 0}.`,
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không nộp được bài.",
        "error",
      );
    }
  }, [attempt, load, notify, session.roleCode]);
  const requestRegrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedResult) return;
    setSaving(true);
    try {
      await apiRequest(`/learner/attempts/${selectedResult.attempt.id}/regrade-requests`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: regradeReason }),
      });
      notify("Đã gửi yêu cầu phúc khảo; trạng thái được lưu trong lịch sử kết quả.");
      setRegradeOpen(false);
      setRegradeReason("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không gửi được yêu cầu phúc khảo.", "error");
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS" || !activeExam) return;
    const timer = window.setInterval(() => {
      const deadline = Math.min(
        new Date(attempt.startedAt).getTime() +
          activeExam.durationMinutes * 60_000,
        new Date(activeExam.closeAt).getTime(),
      );
      const next = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next === 0) {
        window.clearInterval(timer);
        void submit(true);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeExam, attempt, submit]);
  if (!allowed) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Assessment Workflow"
        title="Đề thi & kết quả"
        description="Thiết kế, công bố, làm bài và chấm điểm theo cùng một vòng đời dữ liệu."
        actions={
          instructor ? (
            <Button onClick={() => { setQuestionQuery(""); setOpen(true); }}>
              <Plus size={17} />
              Tạo đề thi
            </Button>
          ) : undefined
        }
      />
      {attempt ? (
        <section className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider text-sky-700">
                Lượt làm bài đang mở
              </p>
              <p className="mt-1 font-bold">Mã lượt: {attempt.id}</p>
              <p className="mt-1 text-sm text-slate-600">
                Trạng thái: {attempt.status}
                {attempt.score !== undefined ? ` · Điểm ${attempt.score}` : ""}
              </p>
              {attempt.status === "IN_PROGRESS" ? (
                <p className="mt-2 text-sm font-extrabold text-rose-700">
                  <Clock3 className="mr-1 inline" size={15} />
                  Còn {Math.floor(remainingSeconds / 60).toString().padStart(2, "0")}:
                  {(remainingSeconds % 60).toString().padStart(2, "0")} · Autosave {autosaveStatus === "SAVING" ? "đang lưu" : autosaveStatus === "SAVED" ? attempt.lastSavedAt || attempt.serverTime ? `đã lưu lúc ${new Date(attempt.lastSavedAt ?? attempt.serverTime!).toLocaleTimeString("vi-VN")}` : "đã lưu" : autosaveStatus === "ERROR" ? "lỗi — câu trả lời vẫn hiển thị để thử lại" : "sẵn sàng"}
                </p>
              ) : null}
              {attempt.submissionReceipt ? <p className="mt-2 text-xs font-bold text-emerald-700">Biên nhận nộp bài: {attempt.submissionReceipt}{attempt.submittedAt || attempt.serverTime ? ` · ${new Date(attempt.submittedAt ?? attempt.serverTime!).toLocaleString("vi-VN")}` : ""}</p> : null}
            </div>
            {attempt.status === "IN_PROGRESS" ? (
              <Button onClick={() => void submit()}>
                <Send size={16} />
                Nộp bài
              </Button>
            ) : (
              <CheckCircle2 className="text-emerald-600" size={28} />
            )}
          </div>
          {attempt.status === "IN_PROGRESS" ? (
            <div className="mt-5 space-y-4 border-t border-sky-200 pt-5">
              {attemptQuestions.map((question, index) => (
                <fieldset className="rounded-xl bg-[var(--surface)] p-4" key={question.id}>
                  <legend className="px-1 text-sm font-extrabold">Câu {index + 1}</legend>
                  <RichText className="mt-2 font-semibold">{question.content}</RichText>
                  <QuestionImage className="mt-4" imageUrl={question.imageUrl} />
                  {question.options.length ? <div className="mt-4 grid gap-2">
                    {question.options.map((option) => {
                      const checked = attempt.answers[question.id]?.includes(option) ?? false;
                      return (
                      <label
                        className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:border-sky-400"
                        key={option}
                      >
                        <input
                          checked={checked}
                          className="mt-1 size-4 shrink-0"
                          name={question.id}
                          onChange={() => void answer(question.id, question.type === "MULTIPLE_CHOICE" ? checked ? (attempt.answers[question.id] ?? []).filter((answerValue) => answerValue !== option) : [...(attempt.answers[question.id] ?? []), option] : [option])}
                          type={question.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                        />
                        <RichText className="min-w-0">{option}</RichText>
                      </label>
                    );})}
                  </div> : question.type === "SHORT_ANSWER" ? <input aria-label={`Câu trả lời câu ${index + 1}`} className={`${inputClass} mt-4`} onBlur={() => saveTextAnswer(question.id)} onChange={(event) => setAnswerDrafts({ ...answerDrafts, [question.id]: event.target.value })} placeholder="Nhập câu trả lời ngắn…" value={answerDrafts[question.id] ?? ""} /> : <textarea aria-label={`Bài làm câu ${index + 1}`} className={`${inputClass} mt-4`} onBlur={() => saveTextAnswer(question.id)} onChange={(event) => setAnswerDrafts({ ...answerDrafts, [question.id]: event.target.value })} placeholder="Nhập bài làm tự luận…" rows={6} value={answerDrafts[question.id] ?? ""} />}
                </fieldset>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <SectionState loading={loading} empty={items.length === 0}>
        <div className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">
          {pagination.pageItems.map((item) => (
            <article
              className="grid gap-4 border-b border-[var(--rule)] px-5 py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              key={item.id}
            >
              <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-extrabold text-sky-700">
                    {classes.find((c) => c.id === item.classId)?.code ??
                      item.classId}
                  </p>
                  <h2 className="mt-1 font-heading text-xl font-extrabold">
                    {item.title}
                  </h2>
                </div>
                <StatusBadge
                  status={
                    learner
                      ? (item.availabilityStatus ?? item.status)
                      : item.status
                  }
                />
              </div>
              <div className="mt-5 grid grid-cols-3 divide-x divide-slate-100 border-y border-slate-100 py-4 text-center">
                <div>
                  <p className="font-extrabold">
                    {item.questionCount ?? item.questionIds.length}
                  </p>
                  <p className="text-[11px] text-slate-500">Câu hỏi</p>
                </div>
                <div>
                  <p className="font-extrabold">{item.durationMinutes}&apos;</p>
                  <p className="text-[11px] text-slate-500">Thời gian</p>
                </div>
                <div>
                  <p className="font-extrabold">
                    {learner ? (item.remainingAttempts ?? 0) : item.totalScore}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {learner ? "Lượt còn lại" : "Tổng điểm"}
                  </p>
                </div>
              </div>
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                <Clock3 size={14} />
                {new Date(item.openAt).toLocaleString("vi-VN")} —{" "}
                {new Date(item.closeAt).toLocaleString("vi-VN")}
              </p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
              {instructor ? (
                <Button onClick={() => void preview(item)} variant="ghost"><Eye size={15} />Xem đề</Button>
              ) : null}
              {instructor && item.status === "DRAFT" ? (
                <Button
                  onClick={() => void publish(item)}
                  variant="secondary"
                >
                  <Send size={15} />
                  Gửi phê duyệt
                </Button>
              ) : null}
              {canReview && item.status === "PENDING_REVIEW" ? (
                <>
                  <Button loading={reviewingId === item.id} onClick={() => void review(item, "APPROVE")}>
                    <CheckCircle2 size={15} />
                    Phê duyệt
                  </Button>
                  <Button disabled={reviewingId === item.id} onClick={() => { setReturnTarget(item); setReturnNote(""); }} variant="secondary">
                    <RotateCcw size={15} />
                    Trả lại
                  </Button>
                </>
              ) : null}
              {learner &&
              ["AVAILABLE", "IN_PROGRESS"].includes(
                item.availabilityStatus ?? "",
              ) ? (
                <Button onClick={() => void start(item)}>
                  <Play size={15} />
                  {item.availabilityStatus === "IN_PROGRESS"
                    ? "Tiếp tục làm bài"
                    : "Bắt đầu làm bài"}
                </Button>
              ) : null}
              </div>
            </article>
          ))}
        </div>
      </SectionState>
      <Pagination itemLabel="đề thi" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
      {learner && results.length ? (
        <section className="mt-10 border-t border-slate-200 pt-7">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><h2 className="font-heading text-2xl font-extrabold tracking-tight">Kết quả, phản hồi và phúc khảo</h2><p className="mt-1 text-sm text-slate-500">Các bài đã chấm và công bố cho tài khoản hiện tại.</p></div>
          </div>
          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {results.map((result) => (
              <article className="grid gap-5 py-5 lg:grid-cols-[1fr_auto] lg:items-center" key={result.attempt.id}>
                <div>
                  <div className="flex flex-wrap items-center gap-3"><h3 className="font-heading text-lg font-extrabold">{result.exam.title}</h3><StatusBadge status={result.regradeRequest?.status ?? "PUBLISHED"} /></div>
                  <p className="mt-2 text-sm text-slate-600">{result.attempt.feedback ?? "Chưa có nhận xét bổ sung."}</p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">{result.answerBreakdown.map((answer, index) => <span key={answer.questionId}>Câu {index + 1}: {answer.awardedScore}/{answer.maxScore}</span>)}</div>
                </div>
                <div className="flex items-center gap-4 lg:text-right"><div><p className="text-3xl font-extrabold text-sky-800">{result.attempt.score ?? 0}</p><p className="text-xs text-slate-500">trên {result.exam.totalScore}</p></div>{!result.regradeRequest ? <Button onClick={() => { setSelectedResult(result); setRegradeOpen(true); }} variant="secondary"><RotateCcw size={15} />Phúc khảo</Button> : null}</div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Tạo đề thi">
        <form className="space-y-4" onSubmit={(e) => void create(e)}>
          <Field label="Lớp học">
            <SearchableSelect
              aria-label="Tìm và chọn lớp ra đề"
              onChange={(classId) => setForm((current) => current.classId === classId ? current : { ...current, classId, questionIds: [] })}
              options={classes.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}`, description: item.term, keywords: item.id }))}
              placeholder="Gõ mã hoặc tên lớp để lọc…"
              value={form.classId}
            />
          </Field>
          <Field label="Tên đề">
            <input
              className={inputClass}
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <fieldset aria-describedby="exam-question-hint">
            <div className="flex items-baseline justify-between gap-3">
              <legend className="text-sm font-bold text-[var(--ink)]">Câu hỏi</legend>
              {form.classId ? <span className="text-xs font-semibold tabular-nums text-[var(--ink-muted)]">{form.questionIds.length}/{selectableQuestions.length} đã chọn</span> : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]" id="exam-question-hint">
              Chỉ hiển thị phiên bản đã xuất bản thuộc khóa học của lớp đã chọn.
            </p>
            {form.classId && selectableQuestions.length ? <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} /><input aria-label="Lọc câu hỏi trong đề" className={`${inputClass} pl-10`} onChange={(event) => setQuestionQuery(event.target.value)} placeholder="Gõ nội dung, dạng hoặc thẻ để lọc…" value={questionQuery} /></div> : null}
            <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] p-2">
              {!form.classId ? (
                <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">Chọn lớp học trước để xem câu hỏi phù hợp.</p>
              ) : selectableQuestions.length === 0 ? (
                <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">Khóa học của lớp này chưa có câu hỏi đã xuất bản. Hãy xuất bản câu hỏi trong Ngân hàng câu hỏi trước.</p>
              ) : filteredSelectableQuestions.length === 0 ? (
                <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">Không có câu hỏi khớp từ khóa. Các câu đã chọn vẫn được giữ nguyên.</p>
              ) : filteredSelectableQuestions.map((question) => (
                <label className="flex min-h-12 items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]" key={question.id}>
                  <input
                    checked={form.questionIds.includes(question.id)}
                    className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      questionIds: event.target.checked
                        ? [...current.questionIds, question.id]
                        : current.questionIds.filter((id) => id !== question.id),
                    }))}
                    type="checkbox"
                  />
                  <span className="min-w-0">
                    <RichText>{question.content}</RichText>
                    <span className="mt-1 block text-xs font-medium text-[var(--success-deep)]">Đã xuất bản · Phiên bản {question.version}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Phút">
              <input
                className={inputClass}
                min={1}
                type="number"
                value={form.durationMinutes}
                onChange={(e) =>
                  setForm({ ...form, durationMinutes: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Tổng điểm">
              <input
                className={inputClass}
                min={1}
                type="number"
                value={form.totalScore}
                onChange={(e) =>
                  setForm({ ...form, totalScore: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Số lượt">
              <input
                className={inputClass}
                min={1}
                max={10}
                type="number"
                value={form.attemptLimit}
                onChange={(e) =>
                  setForm({ ...form, attemptLimit: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mở đề">
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={form.openAt}
                onChange={(e) => setForm({ ...form, openAt: e.target.value })}
              />
            </Field>
            <Field label="Đóng đề">
              <input
                className={inputClass}
                required
                type="datetime-local"
                value={form.closeAt}
                onChange={(e) => setForm({ ...form, closeAt: e.target.value })}
              />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700"><input checked={form.shuffleQuestions} className="size-5 accent-sky-600" onChange={(event) => setForm({ ...form, shuffleQuestions: event.target.checked })} type="checkbox" />Xáo thứ tự câu hỏi theo seed có thể tái lập</label>
          {form.shuffleQuestions ? <Field label="Random seed"><input className={inputClass} minLength={3} required value={form.randomSeed} onChange={(event) => setForm({ ...form, randomSeed: event.target.value })} /></Field> : null}
          <Button
            disabled={!form.classId || form.questionIds.length === 0}
            loading={saving}
            type="submit"
          >
            Tạo đề thi
          </Button>
        </form>
      </Modal>
      <Modal open={regradeOpen} onClose={() => setRegradeOpen(false)} title="Yêu cầu phúc khảo" description="Yêu cầu hợp lệ trong 7 ngày từ lúc công bố điểm; mỗi bài chỉ có một yêu cầu đang xử lý.">
        <form className="space-y-4" onSubmit={(event) => void requestRegrade(event)}>
          <Field label="Lý do cần kiểm tra lại"><textarea className={inputClass} minLength={10} required rows={5} value={regradeReason} onChange={(event) => setRegradeReason(event.target.value)} /></Field>
          <Button loading={saving} type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
      <Modal open={Boolean(returnTarget)} onClose={() => { setReturnTarget(null); setReturnNote(""); }} title="Trả lại đề thi" description={returnTarget ? `Đề “${returnTarget.title}” sẽ quay về bản nháp để giảng viên chỉnh sửa.` : undefined}>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (returnTarget) void review(returnTarget, "RETURN", returnNote); }}>
          <Field label="Lý do trả lại"><textarea autoFocus className={inputClass} minLength={5} onChange={(event) => setReturnNote(event.target.value)} placeholder="Nêu rõ nội dung giảng viên cần điều chỉnh…" required rows={5} value={returnNote} /></Field>
          <div className="flex flex-wrap gap-2"><Button loading={Boolean(returnTarget && reviewingId === returnTarget.id)} type="submit"><RotateCcw size={15} />Xác nhận trả lại</Button><Button onClick={() => { setReturnTarget(null); setReturnNote(""); }} type="button" variant="ghost">Hủy</Button></div>
        </form>
      </Modal>
      <Modal open={Boolean(previewExam)} onClose={() => { if (!previewLoading) { setPreviewExam(null); setPreviewQuestions([]); } }} size="xl" title={previewExam?.title ?? "Xem đề thi"} description="Bản dành cho giảng viên — luôn hiển thị theo thứ tự gốc khi tạo đề, không áp dụng xáo trộn câu hỏi.">
        {previewExam ? <div>
          <div className="grid gap-3 border-y border-[var(--rule)] py-4 sm:grid-cols-4">
            <div><p className="text-xs font-bold text-[var(--ink-muted)]">Lớp học</p><p className="mt-1 text-sm font-extrabold">{classes.find((item) => item.id === previewExam.classId)?.code ?? previewExam.classId}</p></div>
            <div><p className="text-xs font-bold text-[var(--ink-muted)]">Thời gian</p><p className="mt-1 text-sm font-extrabold">{previewExam.durationMinutes} phút</p></div>
            <div><p className="text-xs font-bold text-[var(--ink-muted)]">Tổng điểm</p><p className="mt-1 text-sm font-extrabold">{previewExam.totalScore}</p></div>
            <div><p className="text-xs font-bold text-[var(--ink-muted)]">Thứ tự học viên</p><p className="mt-1 text-sm font-extrabold">{previewExam.shuffleQuestions ? "Có xáo trộn" : "Theo thứ tự gốc"}</p></div>
          </div>
          {previewLoading ? <p className="py-16 text-center text-sm font-semibold text-[var(--ink-muted)]">Đang tải nội dung đề…</p> : <ol className="mt-5 space-y-5">
            {previewQuestions.map((question, index) => (
              <li className="rounded-xl border border-[var(--rule-strong)] bg-[var(--canvas)] p-4 md:p-5" key={question.id}>
                <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-sm font-extrabold"><ListOrdered size={16} />Câu {index + 1}</p><span className="text-xs font-bold text-[var(--ink-muted)]">{question.type} · Mức {question.difficulty}</span></div>
                <RichText className="mt-3 font-semibold">{question.content}</RichText>
                <QuestionImage className="mt-4" imageUrl={question.imageUrl} />
                {question.options.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{question.options.map((option, optionIndex) => { const correct = question.correctAnswers.includes(option); return <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${correct ? "border-[var(--success)] bg-[var(--success-soft)]" : "border-[var(--rule)] bg-[var(--surface)]"}`} key={`${optionIndex}-${option}`}><span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current text-xs font-extrabold">{String.fromCharCode(65 + optionIndex)}</span><RichText className="min-w-0">{option}</RichText>{correct ? <CheckCircle2 aria-label="Đáp án đúng" className="ml-auto shrink-0 text-[var(--success-deep)]" size={17} /> : null}</div>; })}</div> : null}
                {question.correctAnswers.length && !question.options.length ? <div className="mt-4 rounded-lg bg-[var(--success-soft)] p-3"><p className="text-xs font-bold text-[var(--success-deep)]">Đáp án / ý tham khảo</p>{question.correctAnswers.map((answer) => <RichText className="mt-1 text-sm" key={answer}>{answer}</RichText>)}</div> : null}
              </li>
            ))}
          </ol>}
        </div> : null}
      </Modal>
    </div>
  );
}
