"use client";
import { MaterialSearchControls } from "@/components/material-search";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  RichText,
  Tabs,
} from "@/components/ui";
import {
  BookOpenCheck,
  Globe2,
  Library,
  Pencil,
  Search,
  Sparkles,
} from "lucide-react";
import { distributeScores, questionTypeOptions } from "./exams.shared";
import type { useExamsModel } from "./use-exams-model";

/** Tạo hoặc sửa đề thi thủ công và đề sinh bằng AI. */
export function ExamEditorDialog({
  model,
}: {
  model: Pick<
    ReturnType<typeof useExamsModel>,
    | "classes"
    | "open"
    | "closeEditor"
    | "discardEditor"
    | "editingExam"
    | "createMode"
    | "setCreateMode"
    | "saving"
    | "form"
    | "setForm"
    | "aiConfig"
    | "setAiConfig"
    | "questionQuery"
    | "setQuestionQuery"
    | "selectableQuestions"
    | "filteredSelectableQuestions"
    | "examAiProviders"
    | "aiQuestionTotal"
    | "allocatedScore"
    | "materialSearch"
    | "eligibleMaterials"
    | "create"
    | "generateAiExam"
  >;
}) {
  const {
    classes,
    open,
    closeEditor,
    discardEditor,
    editingExam,
    createMode,
    setCreateMode,
    saving,
    form,
    setForm,
    aiConfig,
    setAiConfig,
    questionQuery,
    setQuestionQuery,
    selectableQuestions,
    filteredSelectableQuestions,
    examAiProviders,
    aiQuestionTotal,
    allocatedScore,
    materialSearch,
    eligibleMaterials,
    create,
    generateAiExam,
  } = model;
  return (
    <Modal
      open={open}
      onClose={closeEditor}
      size="xl"
      title={
        editingExam
          ? "Chỉnh sửa đề nháp"
          : createMode === "AI"
            ? "Tạo đề bằng AI"
            : "Tạo đề thủ công"
      }
      description={
        editingExam
          ? `Phiên bản ${editingExam.version}; khi lưu sẽ tăng version để bảo vệ thay đổi đồng thời.`
          : createMode === "AI"
            ? "AI tạo câu hỏi đúng ma trận và lưu thành đề nháp. Giảng viên vẫn xem lại toàn bộ trước khi gửi duyệt."
            : "Chọn các câu hỏi đã xuất bản trong ngân hàng câu hỏi."
      }
    >
      <form
        className="space-y-5"
        onSubmit={(event) =>
          createMode === "AI" ? void generateAiExam(event) : void create(event)
        }
      >
        <fieldset disabled={saving} className="space-y-5">
          <p className="text-sm leading-6 text-[var(--ink-soft)]">
            Bản nháp được giữ trong tab này tối đa 24 giờ, kể cả khi chuyển
            trang hoặc tải lại. Đăng xuất sẽ xóa bản nháp trên thiết bị; lưu đề
            để giữ trên hệ thống.
          </p>
          {!editingExam ? (
            <Tabs
              items={[
                { value: "AI", label: "Tạo bằng AI" },
                { value: "MANUAL", label: "Chọn từ ngân hàng" },
              ]}
              label="Chọn cách tạo đề"
              onChange={(value) => setCreateMode(value)}
              value={createMode}
            />
          ) : null}
          <Field label="Lớp học">
            <SearchableSelect
              aria-label="Tìm và chọn lớp ra đề"
              disabled={Boolean(editingExam)}
              onChange={(classId) => {
                setForm((current) =>
                  current.classId === classId
                    ? current
                    : {
                        ...current,
                        classId,
                        questionIds: [],
                        scoreAllocations: {},
                      },
                );
                setAiConfig((current) => ({ ...current, materialIds: [] }));
              }}
              options={classes.map((item) => ({
                value: item.id,
                label: `${item.code} — ${item.name}`,
                description: item.term,
                keywords: item.id,
              }))}
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
          {createMode === "MANUAL" ? (
            <fieldset aria-describedby="exam-question-hint">
              <div className="flex items-baseline justify-between gap-3">
                <legend className="text-sm font-bold text-[var(--ink)]">
                  Câu hỏi
                </legend>
                {form.classId ? (
                  <span className="text-xs font-semibold tabular-nums text-[var(--ink-muted)]">
                    {form.questionIds.length}/{selectableQuestions.length} đã
                    chọn
                  </span>
                ) : null}
              </div>
              <p
                className="mt-1 text-xs leading-5 text-[var(--ink-muted)]"
                id="exam-question-hint"
              >
                Chỉ hiển thị phiên bản đã xuất bản thuộc khóa học của lớp đã
                chọn.
              </p>
              {form.classId && selectableQuestions.length ? (
                <div className="relative mt-3">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"
                    size={17}
                  />
                  <input
                    aria-label="Lọc câu hỏi trong đề"
                    className={`${inputClass} pl-10`}
                    onChange={(event) => setQuestionQuery(event.target.value)}
                    placeholder="Gõ nội dung, dạng hoặc thẻ để lọc…"
                    value={questionQuery}
                  />
                </div>
              ) : null}
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-2.5">
                {!form.classId ? (
                  <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">
                    Chọn lớp học trước để xem câu hỏi phù hợp.
                  </p>
                ) : selectableQuestions.length === 0 ? (
                  <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">
                    Khóa học của lớp này chưa có câu hỏi đã xuất bản. Hãy xuất
                    bản câu hỏi trong Ngân hàng câu hỏi trước.
                  </p>
                ) : filteredSelectableQuestions.length === 0 ? (
                  <p className="px-2 py-5 text-center text-sm text-[var(--ink-muted)]">
                    Không có câu hỏi khớp từ khóa. Các câu đã chọn vẫn được giữ
                    nguyên.
                  </p>
                ) : (
                  filteredSelectableQuestions.map((question) => (
                    <label
                      className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_5rem] items-start gap-3 rounded-lg px-2.5 py-2 text-xs sm:text-sm text-slate-800 dark:text-slate-200 hover:bg-sky-50/60 dark:hover:bg-slate-800 transition-colors"
                      key={question.id}
                    >
                      <input
                        checked={form.questionIds.includes(question.id)}
                        className="mt-0.5 size-4 shrink-0 accent-sky-600"
                        onChange={(event) =>
                          setForm((current) => {
                            const questionIds = event.target.checked
                              ? [...current.questionIds, question.id]
                              : current.questionIds.filter(
                                  (id) => id !== question.id,
                                );
                            return {
                              ...current,
                              questionIds,
                              scoreAllocations: distributeScores(
                                questionIds,
                                current.totalScore,
                              ),
                            };
                          })
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <RichText>{question.content}</RichText>
                        <span className="mt-1 block text-xs font-medium text-[var(--success-deep)]">
                          Đã xuất bản · Phiên bản {question.version}
                        </span>
                      </span>
                      {form.questionIds.includes(question.id) ? (
                        <input
                          aria-label={`Điểm câu ${question.content}`}
                          className={`${inputClass} text-center font-extrabold tabular-nums`}
                          min={0.01}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              scoreAllocations: {
                                ...current.scoreAllocations,
                                [question.id]: Number(event.target.value),
                              },
                            }))
                          }
                          onClick={(event) => event.stopPropagation()}
                          step="0.01"
                          type="number"
                          value={form.scoreAllocations[question.id] ?? 0}
                        />
                      ) : (
                        <span />
                      )}
                    </label>
                  ))
                )}
              </div>
              {form.questionIds.length ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={`text-xs font-bold ${Math.abs(allocatedScore - form.totalScore) <= 0.05 ? "text-[var(--success-deep)]" : "text-[var(--danger)]"}`}
                  >
                    Đã phân bổ {Math.round(allocatedScore * 100) / 100}/
                    {form.totalScore} điểm.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        scoreAllocations: distributeScores(
                          current.questionIds,
                          current.totalScore,
                        ),
                      }))
                    }
                    className="text-xs font-bold text-[var(--accent)] hover:underline"
                  >
                    ⚡ Cân bằng điểm tự động
                  </button>
                </div>
              ) : null}
            </fieldset>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
              <div className="space-y-5">
                <Field label="Nội dung và trọng tâm câu hỏi">
                  <textarea
                    className={inputClass}
                    maxLength={5000}
                    minLength={5}
                    onChange={(event) =>
                      setAiConfig({ ...aiConfig, focus: event.target.value })
                    }
                    placeholder="Ví dụ: REST API, cách chọn HTTP method, status code, xác thực và xử lý lỗi. Ưu tiên câu hỏi tình huống thực tế."
                    required
                    rows={6}
                    value={aiConfig.focus}
                  />
                  <span className="mt-1.5 block text-xs leading-5 text-[var(--ink-muted)]">
                    Nêu chủ đề, chương hoặc yêu cầu cụ thể. AI không tự suy đoán
                    mục tiêu đánh giá ngoài phần này.
                  </span>
                </Field>
                <fieldset>
                  <legend className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Phạm vi ngữ cảnh
                  </legend>
                  <div className="mt-2 space-y-2">
                    {[
                      {
                        value: "AUTO" as const,
                        icon: BookOpenCheck,
                        title: "Tự động theo môn học",
                        text: "Dùng PDF, Word và ảnh đã công khai; nếu không có tệp thì tìm nguồn trên Internet.",
                      },
                      {
                        value: "COURSE_MATERIALS" as const,
                        icon: Library,
                        title: "Chỉ tài liệu môn học",
                        text: "Chỉ dùng các tệp đã chọn trong môn học; báo lỗi nếu không có tệp phù hợp.",
                      },
                      {
                        value: "WEB_SEARCH" as const,
                        icon: Globe2,
                        title: "Tìm kiếm Internet",
                        text: "Dùng Web Search và trả nguồn đã tham khảo.",
                      },
                    ].map((option) => {
                      const Icon = option.icon;
                      const selected = aiConfig.contextMode === option.value;
                      return (
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                            selected
                              ? "border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 ring-1 ring-sky-500"
                              : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 hover:border-slate-300"
                          }`}
                          key={option.value}
                        >
                          <input
                            checked={selected}
                            className="mt-1 size-4 accent-sky-600"
                            name="contextMode"
                            onChange={() =>
                              setAiConfig({
                                ...aiConfig,
                                contextMode: option.value,
                              })
                            }
                            type="radio"
                          />
                          <Icon
                            className={`mt-0.5 shrink-0 ${selected ? "text-sky-600 dark:text-sky-400" : "text-slate-500"}`}
                            size={18}
                          />
                          <span>
                            <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                              {option.title}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {option.text}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {aiConfig.contextMode !== "WEB_SEARCH" ? (
                  <fieldset>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <legend className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          Tài liệu ưu tiên
                        </legend>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          Chọn tối đa 6 tệp đã phát hành. Để trống để hệ thống
                          tự chọn trong môn học.
                        </p>
                      </div>
                      <span className="text-xs font-bold tabular-nums text-slate-500">
                        {aiConfig.materialIds.length}/6
                      </span>
                    </div>
                    <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-2">
                      <MaterialSearchControls search={materialSearch} />
                      {eligibleMaterials.length ? (
                        eligibleMaterials.map((material) => (
                          <label
                            className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-white dark:hover:bg-slate-800 transition-all text-xs"
                            key={material.id}
                          >
                            <input
                              checked={aiConfig.materialIds.includes(
                                material.id,
                              )}
                              className="mt-0.5 size-4 accent-sky-600"
                              disabled={
                                !aiConfig.materialIds.includes(material.id) &&
                                aiConfig.materialIds.length >= 6
                              }
                              onChange={(event) =>
                                setAiConfig((current) => ({
                                  ...current,
                                  materialIds: event.target.checked
                                    ? [...current.materialIds, material.id]
                                    : current.materialIds.filter(
                                        (id) => id !== material.id,
                                      ),
                                }))
                              }
                              type="checkbox"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-extrabold text-[var(--ink)]">
                                {material.name}
                              </span>
                              <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                                {classes.find(
                                  (item) => item.id === material.classId,
                                )?.code ?? material.classId}{" "}
                                · Phiên bản {material.version}
                              </span>
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="px-3 py-5 text-center text-sm text-[var(--ink-muted)]">
                          Môn học chưa có PDF, Word hoặc ảnh đã phát hành. Chế
                          độ tự động sẽ dùng Web Search.
                        </p>
                      )}
                    </div>
                  </fieldset>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Độ khó chung">
                    <select
                      className={inputClass}
                      onChange={(event) =>
                        setAiConfig({
                          ...aiConfig,
                          difficulty: Number(event.target.value) as 1 | 2 | 3,
                        })
                      }
                      value={aiConfig.difficulty}
                    >
                      <option value={1}>Cơ bản</option>
                      <option value={2}>Trung bình</option>
                      <option value={3}>Nâng cao</option>
                    </select>
                  </Field>
                  <Field label="Ngôn ngữ đề thi">
                    <select
                      className={inputClass}
                      value={aiConfig.language}
                      onChange={(event) =>
                        setAiConfig({
                          ...aiConfig,
                          language: event.target.value as
                            "VI" | "EN" | "BILINGUAL",
                        })
                      }
                    >
                      <option value="VI">Tiếng Việt</option>
                      <option value="EN">English</option>
                      <option value="BILINGUAL">Song ngữ Việt–Anh</option>
                    </select>
                  </Field>
                  <p className="text-sm text-[var(--ink-soft)]">
                    AI sinh đề do quản trị viên cấu hình. Bạn chỉ cần chọn nội
                    dung, tài liệu và ma trận câu hỏi.
                  </p>
                </div>
                {!examAiProviders.length ? (
                  <p className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3 text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
                    💡 Chưa có cấu hình AI sinh đề chuyên biệt. Hệ thống sẽ tự động điều phối nhà cung cấp AI mặc định của hệ thống.
                  </p>
                ) : null}
              </div>
              <fieldset>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <legend className="text-sm font-bold text-[var(--ink)]">
                      Ma trận loại câu
                    </legend>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                      Nhập 0 để bỏ một loại. Tổng tối đa 50 câu.
                    </p>
                  </div>
                  <div className="text-right">
                    <strong className="text-3xl font-extrabold tabular-nums text-sky-600 dark:text-sky-400">
                      {aiQuestionTotal}
                    </strong>
                    <span className="ml-1 text-xs font-bold text-slate-500">
                      câu
                    </span>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {questionTypeOptions.map((option) => (
                    <label
                      className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs"
                      key={option.type}
                    >
                      <span>
                        <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {option.description}
                        </span>
                      </span>
                      <input
                        aria-label={`Số câu ${option.label}`}
                        className={`${inputClass} text-center font-bold tabular-nums`}
                        max={50}
                        min={0}
                        onChange={(event) =>
                          setAiConfig({
                            ...aiConfig,
                            distribution: {
                              ...aiConfig.distribution,
                              [option.type]: Math.max(
                                0,
                                Math.min(50, Number(event.target.value) || 0),
                              ),
                            },
                          })
                        }
                        type="number"
                        value={aiConfig.distribution[option.type]}
                      />
                    </label>
                  ))}
                </div>
                {aiQuestionTotal > 50 ? (
                  <p className="mt-2 text-xs font-bold text-[var(--danger)]">
                    Tổng số câu vượt giới hạn 50.
                  </p>
                ) : null}
              </fieldset>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Thời gian làm bài (phút)">
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
                  setForm((current) => ({
                    ...current,
                    totalScore: Number(e.target.value),
                    scoreAllocations:
                      createMode === "MANUAL"
                        ? distributeScores(
                            current.questionIds,
                            Number(e.target.value),
                          )
                        : current.scoreAllocations,
                  }))
                }
              />
            </Field>
            <Field label="Số lượt được làm">
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
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700">
            <input
              checked={form.shuffleQuestions}
              className="size-5 accent-sky-600"
              onChange={(event) =>
                setForm({ ...form, shuffleQuestions: event.target.checked })
              }
              type="checkbox"
            />
            Xáo thứ tự câu hỏi theo mã cố định
          </label>
          {form.shuffleQuestions ? (
            <Field label="Mã xáo trộn câu hỏi">
              <input
                className={inputClass}
                minLength={3}
                required
                value={form.randomSeed}
                onChange={(event) =>
                  setForm({ ...form, randomSeed: event.target.value })
                }
              />
            </Field>
          ) : null}
          <div className="sticky -bottom-5 flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-4 md:-bottom-7">
            <Button
              className="mr-auto"
              disabled={saving}
              onClick={discardEditor}
              type="button"
              variant="ghost"
            >
              Bỏ nội dung
            </Button>
            <Button
              disabled={saving}
              onClick={closeEditor}
              type="button"
              variant="secondary"
            >
              Tạm đóng
            </Button>
            <Button
              disabled={
                !form.classId ||
                (createMode === "MANUAL"
                  ? form.questionIds.length === 0 ||
                    Math.abs(allocatedScore - form.totalScore) > 0.05
                  : !aiConfig.focus.trim() ||
                    aiQuestionTotal < 1 ||
                    aiQuestionTotal > 50)
              }
              loading={saving}
              type="submit"
            >
              {editingExam ? (
                <>
                  <Pencil size={17} />
                  Lưu phiên bản mới
                </>
              ) : createMode === "AI" ? (
                <>
                  <Sparkles size={17} />
                  Tạo đề nháp {aiQuestionTotal} câu
                </>
              ) : (
                "Tạo đề thi"
              )}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
