"use client";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { RequestError } from "@/shared/ui/request-error";
import { QuestionImage } from "@/features/questions/question-image";
import { SectionState } from "@/shared/ui/section-state";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  RichText,
  StatusBadge,
  Tabs,
} from "@/shared/ui/ui";
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
    <div className="w-full space-y-4">
      <PageHeader
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
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs"
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
          className="mt-3.5 mb-3"
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
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5">Đề thi</th>
                      <th className="px-3.5 py-2.5">Lớp học</th>
                      <th className="px-3 py-2.5 text-center">Số câu</th>
                      <th className="px-3 py-2.5 text-center">Thời lượng</th>
                      <th className="px-3 py-2.5 text-center">{learner ? "Lượt còn lại" : "Thang điểm"}</th>
                      <th className="px-3.5 py-2.5">Thời gian mở</th>
                      <th className="px-3.5 py-2.5 text-center">Trạng thái</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {pagination.pageItems.map((item) => {
                      const classItem = classes.find((c) => c.id === item.classId);
                      return (
                        <tr
                          key={item.id}
                          id={`exam-${item.id}`}
                          className="hover:bg-sky-50/40 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <strong className="font-semibold text-slate-900 dark:text-slate-100 truncate block max-w-xs" title={item.title}>
                              {item.title}
                            </strong>
                          </td>
                          <td className="px-3.5 py-2.5 whitespace-nowrap">
                            <span className="inline-flex items-center rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
                              {classItem?.code ?? item.classId}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs whitespace-nowrap tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                            {item.questionCount ?? item.questionIds.length}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs whitespace-nowrap tabular-nums text-slate-700 dark:text-slate-300">
                            {item.durationMinutes} phút
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs whitespace-nowrap tabular-nums font-bold text-sky-600 dark:text-sky-400">
                            {learner ? (item.remainingAttempts ?? 0) : item.totalScore}
                          </td>
                          <td className="px-3.5 py-2.5 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            <p>{new Date(item.openAt).toLocaleDateString(activeLocale())} {new Date(item.openAt).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}</p>
                            <p className="text-[10px] text-slate-400">đến {new Date(item.closeAt).toLocaleDateString(activeLocale())} {new Date(item.closeAt).toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit" })}</p>
                          </td>
                          <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                            <StatusBadge status={learner ? (item.availabilityStatus ?? item.status) : item.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {instructor ? (
                                <Button onClick={() => void preview(item)} variant="ghost" className="h-8 px-2 text-xs">
                                  <Eye size={14} />
                                  <span className="hidden sm:inline">Xem đề</span>
                                </Button>
                              ) : null}
                              {canReview && item.status === "PENDING_REVIEW" ? (
                                <Button onClick={() => void preview(item)} variant="ghost" className="h-8 px-2 text-xs">
                                  <Eye size={14} />
                                  <span className="hidden sm:inline">Xem đề</span>
                                </Button>
                              ) : null}
                              {instructor && item.status === "DRAFT" ? (
                                <Button onClick={() => openEdit(item)} variant="ghost" className="h-8 px-2 text-xs">
                                  <Pencil size={14} />
                                  <span className="hidden sm:inline">Sửa đề</span>
                                </Button>
                              ) : null}
                              {instructor && item.status === "DRAFT" ? (
                                <Button onClick={() => setConfirmExam(item)} variant="secondary" className="h-8 px-2.5 text-xs font-semibold">
                                  <Send size={13} />
                                  Phát hành đề
                                </Button>
                              ) : null}
                              {(instructor || canReview) && item.status === "PENDING_REVIEW" ? (
                                <Button loading={reviewingId === item.id} onClick={() => void review(item, "APPROVE")} className="h-8 px-2.5 text-xs font-semibold">
                                  <CheckCircle2 size={13} />
                                  Phát hành ngay
                                </Button>
                              ) : null}
                              {learner && ["AVAILABLE", "IN_PROGRESS"].includes(item.availabilityStatus ?? "") ? (
                                <Button onClick={() => void start(item)} className="h-8 px-2.5 text-xs font-semibold">
                                  <Play size={13} />
                                  {item.availabilityStatus === "IN_PROGRESS" ? "Tiếp tục làm bài" : "Bắt đầu làm bài"}
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
        <section className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Kết quả đã công bố ({results.length})
            </h2>
          </div>
          {results.length ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5">Đề thi</th>
                      <th className="px-3.5 py-2.5 text-center">Điểm số</th>
                      <th className="px-4 py-2.5">Điểm từng câu</th>
                      <th className="px-3.5 py-2.5 text-center">Trạng thái</th>
                      <th className="px-4 py-2.5 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {results.map((result) => (
                      <tr
                        key={result.attempt.id}
                        id={`exam-${result.attempt.id}`}
                        className="hover:bg-sky-50/40 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <strong className="font-semibold text-slate-900 dark:text-slate-100 block truncate max-w-xs" title={result.exam.title}>
                            {result.exam.title}
                          </strong>
                          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 line-clamp-1">
                            {result.attempt.feedback ?? "Chưa có nhận xét bổ sung."}
                          </p>
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          <span className="text-sm font-extrabold text-sky-600 dark:text-sky-400 tabular-nums">
                            {result.attempt.score ?? 0}
                          </span>
                          <span className="text-xs text-slate-400">/{result.exam.totalScore}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1 text-[11px]">
                            {result.answerBreakdown.map((answer, index) => (
                              <span
                                key={answer.questionId}
                                className="inline-flex items-center rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-medium text-slate-600 dark:text-slate-300"
                              >
                                C{index + 1}: <strong className="ml-0.5 text-sky-600 dark:text-sky-400">{answer.awardedScore}</strong>/{answer.maxScore}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          <StatusBadge status={result.regradeRequest?.status ?? "PUBLISHED"} />
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {!result.regradeRequest ? (
                            <Button
                              onClick={() => {
                                setSelectedResult(result);
                                setRegradeOpen(true);
                              }}
                              variant="secondary"
                              className="h-8 px-2.5 text-xs font-semibold"
                            >
                              <RotateCcw size={13} />
                              Phúc khảo
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400">Đã gửi phúc khảo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 py-14 text-center">
              <p className="font-bold text-slate-800 dark:text-slate-200">
                Chưa có kết quả được công bố
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Bài tự luận sẽ xuất hiện tại đây sau khi giảng viên chấm và công bố điểm.
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
        title="Xác nhận phát hành đề thi"
        description="Đề thi sẽ được công bố và học viên có thể làm bài theo lịch mở đề."
      >
        <p className="text-sm text-[var(--ink-soft)]">
          Đề thi sẽ được phát hành ngay lập tức và các câu hỏi trong đề sẽ được kích hoạt cho học viên.
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
            Phát hành ngay
          </Button>
        </div>
      </Modal>
      <ExamPreviewDialog model={model} />
    </div>
  );
}
