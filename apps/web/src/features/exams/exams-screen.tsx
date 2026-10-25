"use client";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { RequestError } from "@/components/request-error";
import { QuestionImage } from "@/components/question-image";
import { SectionState } from "@/components/section-state";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  RichText,
  StatusBadge,
  Tabs,
} from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import {
  CheckCircle2,
  Clock3,
  Eye,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { ExamEditorDialog } from "./exam-editor-dialog";
import { ExamPreviewDialog } from "./exam-preview-dialog";
import { useExamsModel } from "./use-exams-model";

/** Lắp ghép màn hình đề thi từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function ExamsScreen() {
  const model = useExamsModel();
  const {
    allowed,
    instructor,
    learner,
    canReview,
    visibleItems,
    pagination,
    classes,
    attemptQuestions,
    attempt,
    answerDrafts,
    setAnswerDrafts,
    results,
    learnerView,
    setLearnerView,
    setSelectedResult,
    regradeOpen,
    setRegradeOpen,
    regradeReason,
    setRegradeReason,
    remainingSeconds,
    autosaveStatus,
    loading,
    saving,
    reviewingId,
    returnTarget,
    setReturnTarget,
    returnNote,
    setReturnNote,
    confirmExam,
    setConfirmExam,
    publishing,
    openCreate,
    openEdit,
    publish,
    preview,
    review,
    start,
    answer,
    saveTextAnswer,
    submit,
    requestRegrade,
  } = model;

  if (!allowed) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Khảo thí & Đánh giá năng lực"
        title="Đề thi & kết quả"
        description={
          learner
            ? "Làm các đề đã được công bố và theo dõi kết quả học tập của bạn."
            : "Thiết kế, công bố và theo dõi kết quả đánh giá của lớp."
        }
        actions={
          instructor ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => openCreate("AI")}>
                <Sparkles size={17} />
                Tạo đề bằng AI
              </Button>
              <Button onClick={() => openCreate("MANUAL")} variant="secondary">
                <Plus size={17} />
                Tạo thủ công
              </Button>
            </div>
          ) : undefined
        }
      />
      <RequestError message={model.loadError} retry={() => void model.reload()} />
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
                  Còn{" "}
                  {Math.floor(remainingSeconds / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(remainingSeconds % 60).toString().padStart(2, "0")} ·
                  Autosave{" "}
                  {autosaveStatus === "SAVING"
                    ? "đang lưu"
                    : autosaveStatus === "SAVED"
                      ? attempt.lastSavedAt || attempt.serverTime
                        ? `đã lưu lúc ${new Date(attempt.lastSavedAt ?? attempt.serverTime!).toLocaleTimeString(activeLocale())}`
                        : "đã lưu"
                      : autosaveStatus === "ERROR"
                        ? "lỗi — câu trả lời vẫn hiển thị để thử lại"
                        : "sẵn sàng"}
                </p>
              ) : null}
              {attempt.submissionReceipt ? (
                <p className="mt-2 text-xs font-bold text-emerald-700">
                  Biên nhận nộp bài: {attempt.submissionReceipt}
                  {attempt.submittedAt || attempt.serverTime
                    ? ` · ${new Date(attempt.submittedAt ?? attempt.serverTime!).toLocaleString(activeLocale())}`
                    : ""}
                </p>
              ) : null}
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
                <fieldset
                  className="rounded-xl bg-[var(--surface)] p-4"
                  key={question.id}
                >
                  <legend className="px-1 text-sm font-extrabold">
                    Câu {index + 1}
                  </legend>
                  <RichText className="mt-2 font-semibold">
                    {question.content}
                  </RichText>
                  <QuestionImage
                    className="mt-4"
                    imageUrl={question.imageUrl}
                  />
                  {question.options.length ? (
                    <div className="mt-4 grid gap-2">
                      {question.options.map((option) => {
                        const checked =
                          attempt.answers[question.id]?.includes(option) ??
                          false;
                        return (
                          <label
                            className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:border-sky-400"
                            key={option}
                          >
                            <input
                              checked={checked}
                              className="mt-1 size-4 shrink-0"
                              name={question.id}
                              onChange={() =>
                                void answer(
                                  question.id,
                                  question.type === "MULTIPLE_CHOICE"
                                    ? checked
                                      ? (
                                          attempt.answers[question.id] ?? []
                                        ).filter(
                                          (answerValue) =>
                                            answerValue !== option,
                                        )
                                      : [
                                          ...(attempt.answers[question.id] ??
                                            []),
                                          option,
                                        ]
                                    : [option],
                                )
                              }
                              type={
                                question.type === "MULTIPLE_CHOICE"
                                  ? "checkbox"
                                  : "radio"
                              }
                            />
                            <RichText className="min-w-0">{option}</RichText>
                          </label>
                        );
                      })}
                    </div>
                  ) : question.type === "SHORT_ANSWER" ? (
                    <input
                      aria-label={`Câu trả lời câu ${index + 1}`}
                      className={`${inputClass} mt-4`}
                      onBlur={() => saveTextAnswer(question.id)}
                      onChange={(event) =>
                        setAnswerDrafts({
                          ...answerDrafts,
                          [question.id]: event.target.value,
                        })
                      }
                      placeholder="Nhập câu trả lời ngắn…"
                      value={answerDrafts[question.id] ?? ""}
                    />
                  ) : (
                    <textarea
                      aria-label={`Bài làm câu ${index + 1}`}
                      className={`${inputClass} mt-4`}
                      onBlur={() => saveTextAnswer(question.id)}
                      onChange={(event) =>
                        setAnswerDrafts({
                          ...answerDrafts,
                          [question.id]: event.target.value,
                        })
                      }
                      placeholder="Nhập bài làm tự luận…"
                      rows={6}
                      value={answerDrafts[question.id] ?? ""}
                    />
                  )}
                </fieldset>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      {learner ? (
        <Tabs
          className="mt-6"
          items={[
            { value: "exams", label: "Đề thi", count: visibleItems.length },
            { value: "results", label: "Kết quả", count: results.length },
          ]}
          label="Chọn đề thi hoặc kết quả"
          onChange={setLearnerView}
          value={learnerView}
        />
      ) : null}
      {!learner || learnerView === "exams" ? (
        <>
          <SectionState
            loading={loading}
            empty={visibleItems.length === 0}
            emptyTitle={
              learner
                ? "Chưa có đề được công bố"
                : "Chưa có đề thi trong phạm vi này"
            }
            emptyDescription={
              learner
                ? "Đề thi sẽ xuất hiện khi giảng viên công bố cho lớp của bạn."
                : instructor
                  ? "Tạo đề thủ công hoặc dùng AI, sau đó kiểm tra nội dung trước khi gửi duyệt."
                  : "Đề thi của các lớp sẽ xuất hiện tại đây để theo dõi và xét duyệt."
            }
          >
            <div className="space-y-4">
              {pagination.pageItems.map((item) => (
                <article
                  className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-[var(--surface)] p-6 shadow-xs hover:shadow-md hover:border-emerald-500/40 transition-all duration-200 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  id={`exam-${item.id}`}
                  key={item.id}
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/80 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                          {classes.find((c) => c.id === item.classId)?.code ??
                            item.classId}
                        </span>
                        <h2 className="mt-2 font-heading text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)]">
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
                    <div className="mt-4 flex flex-wrap items-center gap-6 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 px-4 py-2.5 text-xs">
                      <div>
                        <span className="text-slate-400">Số câu: </span>
                        <strong className="font-extrabold text-[var(--ink)]">
                          {item.questionCount ?? item.questionIds.length}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Thời lượng: </span>
                        <strong className="font-extrabold text-[var(--ink)]">
                          {item.durationMinutes} phút
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">
                          {learner ? "Lượt còn lại: " : "Thang điểm: "}
                        </span>
                        <strong className="font-extrabold text-emerald-600 dark:text-emerald-400">
                          {learner
                            ? (item.remainingAttempts ?? 0)
                            : item.totalScore}
                        </strong>
                      </div>
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <Clock3 size={14} className="text-slate-400" />
                      <span>Thời gian mở: </span>
                      <span className="font-medium">
                        {new Date(item.openAt).toLocaleString(activeLocale())} — {new Date(item.closeAt).toLocaleString(activeLocale())}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {instructor ? (
                      <Button
                        onClick={() => void preview(item)}
                        variant="ghost"
                      >
                        <Eye size={15} />
                        Xem đề
                      </Button>
                    ) : null}
                    {canReview && item.status === "PENDING_REVIEW" ? (
                      <Button
                        onClick={() => void preview(item)}
                        variant="ghost"
                      >
                        <Eye size={15} />
                        Xem đề
                      </Button>
                    ) : null}
                    {instructor && item.status === "DRAFT" ? (
                      <Button onClick={() => openEdit(item)} variant="ghost">
                        <Pencil size={15} />
                        Sửa đề
                      </Button>
                    ) : null}
                    {instructor && item.status === "DRAFT" ? (
                      <Button
                        onClick={() => setConfirmExam(item)}
                        variant="secondary"
                      >
                        <Send size={15} />
                        Gửi phê duyệt
                      </Button>
                    ) : null}
                    {canReview && item.status === "PENDING_REVIEW" ? (
                      <>
                        <Button
                          loading={reviewingId === item.id}
                          onClick={() => void review(item, "APPROVE")}
                        >
                          <CheckCircle2 size={15} />
                          Phê duyệt
                        </Button>
                        <Button
                          disabled={reviewingId === item.id}
                          onClick={() => {
                            setReturnTarget(item);
                            setReturnNote("");
                          }}
                          variant="secondary"
                        >
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
          <Pagination
            itemLabel="đề thi"
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
          />
        </>
      ) : null}
      {learner && learnerView === "results" ? (
        <section className="mt-6">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-heading text-2xl font-extrabold tracking-tight">
                Kết quả đã công bố
              </h2>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                Xem điểm từng câu, phản hồi của giảng viên và gửi yêu cầu phúc
                khảo.
              </p>
            </div>
          </div>
          {results.length ? (
            <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
              {results.map((result) => (
                <article
                  className="grid scroll-mt-24 gap-5 py-5 lg:grid-cols-[1fr_auto] lg:items-center"
                  id={`exam-${result.attempt.id}`}
                  key={result.attempt.id}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-heading text-lg font-extrabold">
                        {result.exam.title}
                      </h3>
                      <StatusBadge
                        status={result.regradeRequest?.status ?? "PUBLISHED"}
                      />
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {result.attempt.feedback ?? "Chưa có nhận xét bổ sung."}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                      {result.answerBreakdown.map((answer, index) => (
                        <span key={answer.questionId}>
                          Câu {index + 1}: {answer.awardedScore}/
                          {answer.maxScore}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 lg:text-right">
                    <div>
                      <p className="text-3xl font-extrabold text-sky-800">
                        {result.attempt.score ?? 0}
                      </p>
                      <p className="text-xs text-slate-500">
                        trên {result.exam.totalScore}
                      </p>
                    </div>
                    {!result.regradeRequest ? (
                      <Button
                        onClick={() => {
                          setSelectedResult(result);
                          setRegradeOpen(true);
                        }}
                        variant="secondary"
                      >
                        <RotateCcw size={15} />
                        Phúc khảo
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="border-y border-[var(--rule-strong)] py-12 text-center">
              <p className="font-bold text-[var(--ink)]">
                Chưa có kết quả được công bố
              </p>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                Bài tự luận sẽ xuất hiện tại đây sau khi giảng viên chấm và công
                bố điểm.
              </p>
              <Button
                className="mt-4"
                onClick={() => setLearnerView("exams")}
                variant="secondary"
              >
                Quay lại đề thi
              </Button>
            </div>
          )}
        </section>
      ) : null}
      <ExamEditorDialog model={model} />
      <Modal
        open={regradeOpen}
        onClose={() => setRegradeOpen(false)}
        title="Yêu cầu phúc khảo"
        description="Yêu cầu hợp lệ trong 7 ngày từ lúc công bố điểm; mỗi bài chỉ có một yêu cầu đang xử lý."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void requestRegrade(event)}
        >
          <Field label="Lý do cần kiểm tra lại">
            <textarea
              className={inputClass}
              minLength={10}
              required
              rows={5}
              value={regradeReason}
              onChange={(event) => setRegradeReason(event.target.value)}
            />
          </Field>
          <Button loading={saving} type="submit">
            Gửi yêu cầu
          </Button>
        </form>
      </Modal>
      <Modal
        open={Boolean(returnTarget)}
        onClose={() => {
          setReturnTarget(null);
          setReturnNote("");
        }}
        title="Trả lại đề thi"
        description={
          returnTarget
            ? `Đề “${returnTarget.title}” sẽ quay về bản nháp để giảng viên chỉnh sửa.`
            : undefined
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (returnTarget) void review(returnTarget, "RETURN", returnNote);
          }}
        >
          <Field label="Lý do trả lại">
            <textarea
              autoFocus
              className={inputClass}
              minLength={5}
              onChange={(event) => setReturnNote(event.target.value)}
              placeholder="Nêu rõ nội dung giảng viên cần điều chỉnh…"
              required
              rows={5}
              value={returnNote}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={Boolean(returnTarget && reviewingId === returnTarget.id)}
              type="submit"
            >
              <RotateCcw size={15} />
              Xác nhận trả lại
            </Button>
            <Button
              onClick={() => {
                setReturnTarget(null);
                setReturnNote("");
              }}
              type="button"
              variant="ghost"
            >
              Hủy
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(confirmExam)}
        onClose={() => {
          if (!publishing) setConfirmExam(null);
        }}
        title="Xác nhận gửi duyệt đề"
        description="Bạn xác nhận là phê duyệt toàn bộ câu hỏi chứ?"
      >
        <p className="text-sm text-[var(--ink-soft)]">
          Xác nhận sẽ phê duyệt các câu hỏi của bạn trong đề và gửi yêu cầu phê
          duyệt đề. Cấu hình tự động duyệt đề của hệ thống vẫn được áp dụng.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button
            disabled={publishing}
            variant="ghost"
            onClick={() => setConfirmExam(null)}
          >
            Hủy
          </Button>
          <Button
            loading={publishing}
            onClick={() => {
              if (confirmExam) void publish(confirmExam);
            }}
          >
            Xác nhận
          </Button>
        </div>
      </Modal>
      <ExamPreviewDialog model={model} />
    </div>
  );
}
