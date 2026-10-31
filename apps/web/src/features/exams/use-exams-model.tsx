"use client";
import { useMaterialSearch } from "@/features/materials/material-search";
import { hasPermission } from "@/lib/access-control";
import { persistentAiRequestId } from "@/lib/ai-request-key";
import { apiRequest } from "@/lib/api-client";
import { eligibleExamQuestions } from "@/lib/exam-question-selection";
import type {
  AiGeneratedExamResult,
  AiProviderSummary,
  Exam,
  ExamAttempt,
  LearnerResult,
  LearningClass,
  Question,
} from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import {
  readSessionDraft,
  DRAFT_MAX_AGE,
  removeSessionDraft,
  writeSessionDraft,
} from "@/lib/session-drafts";
import { isExamEditorDraft } from "./exam-draft";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blank,
  blankAiConfig,
  distributeScores,
  LearnerExam,
  questionTypeOptions,
  toLocalDateTimeInput,
} from "./exams.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình đề thi; giữ nguyên thứ tự hook. */
export function useExamsModel() {
  const { session, notify } = useApp();
  const { t } = useI18n();

  const searchParams = useSearchParams();

  const allowed = [
    "SYSTEM_ADMIN",
    "CENTER_MANAGER",
    "INSTRUCTOR",
    "LEARNER",
  ].includes(session.roleCode);

  const instructor = session.roleCode === "INSTRUCTOR";

  const learner = session.roleCode === "LEARNER";

  const canReview =
    ["SYSTEM_ADMIN", "CENTER_MANAGER"].includes(session.roleCode) &&
    hasPermission(session, "class:manage");

  const [items, setItems] = useState<LearnerExam[]>([]);

  const requestedClassId = searchParams.get("classId");
  const requestedExamId = searchParams.get("examId");
  const listKey = `${session.user.id}:${session.roleCode}:${requestedClassId ?? ""}:${requestedExamId ?? ""}`;
  const [pageRequest, setPageRequest] = useState({ key: "", page: 1, pageSize: 10 });
  const [pageResult, setPageResult] = useState({ page: 1, total: 0 });
  const page = pageRequest.key === listKey ? pageRequest.page : 1;
  const pageSize = pageRequest.pageSize;
  const pageQuery = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (requestedClassId) pageQuery.set("classId", requestedClassId);
  if (requestedExamId && pageRequest.key !== listKey) pageQuery.set("focusId", requestedExamId);
  const examPagePath = `/exams/page?${pageQuery.toString()}`;
  const visibleItems = items;
  const pagination = {
    pageItems: items, page: pageResult.page, pageSize, totalItems: pageResult.total,
    setPage: (nextPage: number) => setPageRequest({ key: listKey, page: nextPage, pageSize }),
    setPageSize: (nextSize: number) => setPageRequest({ key: listKey, page: 1, pageSize: nextSize }),
  };
  const listSequence = useRef(0);
  const pageController = useRef<AbortController | null>(null);
  const auxiliaryCache = useRef(new Map<string, { at: number; promise: Promise<unknown> }>());

  const [classes, setClasses] = useState<LearningClass[]>([]);

  const [questions, setQuestions] = useState<Question[]>([]);

  const [attemptQuestions, setAttemptQuestions] = useState<Question[]>([]);

  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const answerQueue = useRef<Promise<void>>(Promise.resolve());
  const answerVersions = useRef(new Map<string, number>());
  const confirmedAnswers = useRef(new Map<string, string[]>());
  const pendingAnswers = useRef(0);
  const answerSaveFailed = useRef(false);
  const submittingAttempt = useRef(false);
  const currentAttemptId = useRef<string | null>(null);

  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  const [results, setResults] = useState<LearnerResult[]>([]);

  const [learnerView, setLearnerView] = useState<"exams" | "results">("exams");

  const [selectedResult, setSelectedResult] = useState<LearnerResult | null>(
    null,
  );

  const [regradeOpen, setRegradeOpen] = useState(false);

  const [regradeReason, setRegradeReason] = useState("");

  const [activeExam, setActiveExam] = useState<LearnerExam | null>(null);

  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const [autosaveStatus, setAutosaveStatus] = useState<
    "IDLE" | "SAVING" | "SAVED" | "ERROR"
  >("IDLE");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [open, setOpen] = useState(false);

  const [editingExam, setEditingExam] = useState<LearnerExam | null>(null);

  const [createMode, setCreateMode] = useState<"MANUAL" | "AI">("MANUAL");

  const [saving, setSaving] = useState(false);

  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const [returnTarget, setReturnTarget] = useState<LearnerExam | null>(null);

  const [returnNote, setReturnNote] = useState("");

  const [previewExam, setPreviewExam] = useState<LearnerExam | null>(null);

  const [previewQuestions, setPreviewQuestions] = useState<Question[]>([]);

  const [confirmExam, setConfirmExam] = useState<Exam | null>(null);

  const [publishing, setPublishing] = useState(false);

  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const [savingQuestion, setSavingQuestion] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const previewSequence = useRef(0);

  const [form, setForm] = useState(blank);

  const [aiConfig, setAiConfig] = useState(blankAiConfig);

  const editorDrafts = useRef(
    new Map<string, { form: typeof blank; aiConfig: typeof blankAiConfig; savedAt: number }>(),
  );
  const editorKey = `${session.user.id}:${session.roleCode}:${editingExam ? `${editingExam.id}:${editingExam.version}` : createMode}`;
  const storageWarning = useRef(false);

  // Ghi sau mỗi thay đổi để chuyển trang, tải lại hoặc hết phiên không làm mất nội dung trong tab.
  useEffect(() => {
    if (!open || !session.user.id) return;
    const draft = { form, aiConfig };
    editorDrafts.current.set(editorKey, { ...draft, savedAt: Date.now() });
    if (!writeSessionDraft(editorKey, draft) && !storageWarning.current) {
      storageWarning.current = true;
      notify(
        "Trình duyệt không lưu được bản nháp. Hãy lưu đề trước khi rời trang.",
        "error",
      );
    }
  }, [open, editorKey, form, aiConfig, notify, session.user.id]);

  /** Giữ nội dung riêng cho từng đề/chế độ khi tạm đóng trong tab hiện tại. */
  const closeEditor = () => {
    if (saving) return;
    editorDrafts.current.set(editorKey, { form, aiConfig, savedAt: Date.now() });
    setOpen(false);
  };

  /** Chỉ bỏ nội dung đang soạn sau khi người dùng xác nhận rõ ràng. */
  const discardEditor = () => {
    if (
      saving ||
      !window.confirm(
        t("Bỏ nội dung đang soạn? Thao tác này không thể hoàn tác."),
      )
    )
      return;
    editorDrafts.current.delete(editorKey);
    removeSessionDraft(editorKey);
    setForm(blank);
    setAiConfig({
      ...blankAiConfig,
      providerId: aiConfig.providerId,
      model: aiConfig.model,
    });
    setEditingExam(null);
    setOpen(false);
  };

  // Cảnh báo khi tải lại hoặc đóng tab có nội dung đang soạn chưa được lưu lên máy chủ.
  useEffect(() => {
    const hasDraft =
      editorDrafts.current.size > 0 ||
      (open && (form !== blank || aiConfig.focus.trim() !== ""));
    if (!hasDraft || !storageWarning.current) return;
    /** Cho trình duyệt yêu cầu xác nhận trước khi rời trang có bản nháp chưa lưu. */
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [open, form, aiConfig]);

  const aiSubmitting = useRef(false);
  const manualSubmitting = useRef(false);

  const [aiProviders, setAiProviders] = useState<AiProviderSummary[]>([]);

  const [questionQuery, setQuestionQuery] = useState("");

  const selectableQuestions = useMemo(
    () => eligibleExamQuestions(questions, classes, form.classId),
    [classes, form.classId, questions],
  );

  /** Lọc câu hỏi theo từ khóa nhưng giữ nguyên các mục đã chọn để người dùng không mất lựa chọn. */
  const filteredSelectableQuestions = useMemo(() => {
    const needle = questionQuery
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("vi-VN");
    if (!needle) return selectableQuestions;
    return selectableQuestions.filter((question) =>
      `${question.content} ${question.tags.join(" ")} ${question.type}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("vi-VN")
        .includes(needle),
    );
  }, [questionQuery, selectableQuestions]);

  const examAiProviders = useMemo(
    () =>
      aiProviders.filter((provider) =>
        ["GEMINI", "OPENAI", "CUSTOM"].includes(provider.provider),
      ),
    [aiProviders],
  );

  const aiQuestionTotal = useMemo(
    () =>
      Object.values(aiConfig.distribution).reduce(
        (sum, count) => sum + count,
        0,
      ),
    [aiConfig.distribution],
  );

  const allocatedScore = useMemo(
    () =>
      Object.values(form.scoreAllocations).reduce(
        (sum, score) => sum + score,
        0,
      ),
    [form.scoreAllocations],
  );

  const materialCourseId =
    classes.find((item) => item.id === form.classId)?.courseId ?? "";

  const materialSearch = useMaterialSearch(
    session.roleCode,
    { courseId: materialCourseId, visibility: "PUBLISHED", aiOnly: "true" },
    instructor && Boolean(materialCourseId),
    session.user.id,
  );

  const eligibleMaterials = materialSearch.items;

  /** Nạp lớp, đề thi và dữ liệu kết quả phù hợp với vai trò cùng bộ lọc hiện tại. */
  const load = useCallback(async (refreshAuxiliary = true) => {
    if (!allowed) return;
    const sequence = ++listSequence.current;
    pageController.current?.abort();
    const controller = new AbortController();
    pageController.current = controller;
    /** Tái sử dụng request hỗ trợ trong 30 giây, tách theo tài khoản/vai trò và làm mới sau thao tác ghi. */
    const auxiliary = <T,>(path: string): Promise<T> => {
      const key = `${session.user.id}:${session.roleCode}:${path}`;
      const existing = auxiliaryCache.current.get(key);
      if (!refreshAuxiliary && existing && Date.now() - existing.at < 30_000) return existing.promise as Promise<T>;
      const promise = apiRequest<T>(path, { roleCode: session.roleCode }).catch((error: unknown) => {
        if (auxiliaryCache.current.get(key)?.promise === promise) auxiliaryCache.current.delete(key);
        throw error;
      });
      auxiliaryCache.current.set(key, { at: Date.now(), promise });
      return promise;
    };
    setLoading(true);
    setLoadError("");
    try {
      const [exams, classData, questionData, resultData, providerData] =
        await Promise.all([
          apiRequest<{ items: LearnerExam[]; total: number; page: number }>(examPagePath, {
            roleCode: session.roleCode,
            signal: controller.signal,
          }),
          auxiliary<LearningClass[]>("/classes"),
          instructor
            ? auxiliary<Question[]>(
                "/instructor/question-bank/questions?status=PUBLISHED",
              )
            : Promise.resolve([]),
          learner
            ? auxiliary<LearnerResult[]>("/learner/results")
            : Promise.resolve([]),
          instructor
            ? auxiliary<AiProviderSummary[]>(
                "/instructor/question-bank/ai-providers?task=GENERATE_EXAM",
              )
            : Promise.resolve([]),
        ]);
      if (sequence !== listSequence.current) return;
      setItems(exams.items);
      setPageResult({ page: exams.page, total: exams.total });
      setClasses(classData);
      setQuestions(questionData);
      setResults(resultData);
      setAiProviders(providerData);
      setAiConfig((current) => ({
        ...current,
        providerId:
          current.providerId ||
          providerData.find(
            (item) =>
              ["GEMINI", "OPENAI", "CUSTOM"].includes(item.provider) &&
              item.isDefault,
          )?.id ||
          providerData.find((item) =>
            ["GEMINI", "OPENAI", "CUSTOM"].includes(item.provider),
          )?.id ||
          "",
      }));
    } catch (error) {
      if (sequence !== listSequence.current) return;
      notify(
        error instanceof Error ? error.message : "Không tải được đề thi.",
        "error",
      );
      setLoadError(
        error instanceof Error ? error.message : "Không tải được đề thi.",
      );
    } finally {
      if (sequence === listSequence.current) setLoading(false);
    }
  }, [allowed, instructor, learner, notify, session.roleCode, session.user.id, examPagePath, setPageResult]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    return () => { window.clearTimeout(timer); listSequence.current += 1; pageController.current?.abort(); };
  }, [load]);

  /** Mở đúng tab và đưa đề hoặc kết quả từ lịch/thông báo vào vùng nhìn. */
  useEffect(() => {
    if (loading) return;
    const attemptId = searchParams.get("attemptId");
    const examId = searchParams.get("examId");
    const linkedResult = results.find(
      (result) => result.attempt.id === attemptId || result.exam.id === examId,
    );
    const targetId = linkedResult?.attempt.id ?? examId;
    if (!targetId) return;
    const timer = window.setTimeout(() => {
      if (linkedResult) setLearnerView("results");
      window.requestAnimationFrame(() => {
        const node = document.getElementById(`exam-${targetId}`);
        if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
        else
          notify(
            "Đề hoặc kết quả không còn khả dụng với tài khoản này.",
            "error",
          );
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [items, loading, notify, results, searchParams]);

  useEffect(() => {
    if (
      searchParams.get("create") !== "scan" ||
      !questions.length ||
      !classes.length
    )
      return;
    try {
      const raw = sessionStorage.getItem("wind-scan-question-ids");
      if (!raw) return;
      const ids: unknown = JSON.parse(raw);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        throw new Error("Danh sách câu hỏi quét không hợp lệ.");
      }
      const selectedQuestions = questions.filter((question) =>
        ids.includes(question.id),
      );
      const classItem = classes.find(
        (item) => item.courseId === selectedQuestions[0]?.courseId,
      );
      if (classItem && selectedQuestions.length) {
        setForm({
          ...blank,
          classId: classItem.id,
          questionIds: selectedQuestions.map((item) => item.id),
        });
        setOpen(true);
        notify(
          `Đã đưa ${selectedQuestions.length} câu vừa quét vào đề mới.`,
          "info",
        );
      }
    } catch (error) {
      console.warn("Không thể khôi phục câu hỏi vừa quét:", error);
      notify("Không thể khôi phục danh sách câu hỏi vừa quét.", "error");
    } finally {
      try {
        sessionStorage.removeItem("wind-scan-question-ids");
      } catch (error) {
        console.warn("Không thể xóa danh sách câu hỏi quét đã lưu:", error);
      }
    }
  }, [classes, notify, questions, searchParams]);

  /** Tạo đề từ các câu hỏi đã chọn, giữ thứ tự gốc và cấu hình xáo trộn riêng. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (manualSubmitting.current) return;
    manualSubmitting.current = true;
    setSaving(true);
    try {
      await apiRequest(
        editingExam
          ? `/instructor/exams/${editingExam.id}`
          : "/instructor/exams",
        {
          method: editingExam ? "PATCH" : "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            ...form,
            scoreAllocations: form.questionIds.map((questionId) => ({
              questionId,
              score: form.scoreAllocations[questionId] ?? 0,
            })),
            expectedVersion: editingExam?.version,
            openAt: new Date(form.openAt).toISOString(),
            closeAt: new Date(form.closeAt).toISOString(),
          }),
        },
      );
      notify(editingExam ? "Đã cập nhật đề nháp." : "Đã tạo đề thi bản nháp.");
      editorDrafts.current.delete(editorKey);
      removeSessionDraft(editorKey);
      setOpen(false);
      setEditingExam(null);
      setForm(blank);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được đề thi.",
        "error",
      );
    } finally {
      manualSubmitting.current = false;
      setSaving(false);
    }
  };

  /** Gửi ma trận và phạm vi ngữ cảnh để AI tạo câu hỏi rồi lưu một đề nháp có thể xem lại. */
  const generateAiExam = async (event: React.FormEvent) => {
    event.preventDefault();
    if (aiQuestionTotal < 1 || aiQuestionTotal > 50) {
      notify("Tổng số câu AI phải từ 1 đến 50.", "error");
      return;
    }
    const effectiveProviderId =
      aiConfig.providerId ||
      examAiProviders.find((p) => p.isDefault)?.id ||
      examAiProviders[0]?.id ||
      "";
    if (!effectiveProviderId && examAiProviders.length === 0) {
      notify(
        "Chưa có AI Provider nào hoạt động. Quản trị viên cần kích hoạt AI Provider trong Cài đặt hệ thống.",
        "error",
      );
      return;
    }
    if (aiSubmitting.current) return;
    aiSubmitting.current = true;
    setSaving(true);
    try {
      const payload = JSON.parse(
        JSON.stringify({
          ...form,
          questionIds: undefined,
          scoreAllocations: undefined,
          focus: aiConfig.focus.trim(),
          difficulty: aiConfig.difficulty,
          language: aiConfig.language,
          contextMode: aiConfig.contextMode,
          materialIds:
            aiConfig.contextMode === "WEB_SEARCH" ? [] : aiConfig.materialIds,
          distribution: questionTypeOptions.flatMap((item) =>
            aiConfig.distribution[item.type] > 0
              ? [{ type: item.type, count: aiConfig.distribution[item.type] }]
              : [],
          ),
          openAt: new Date(form.openAt).toISOString(),
          closeAt: new Date(form.closeAt).toISOString(),
        }),
      );
      const requestId = await persistentAiRequestId(session.user.id, payload);
      const result = await apiRequest<AiGeneratedExamResult>(
        "/instructor/exams/ai-generate",
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ ...payload, clientRequestId: requestId }),
        },
      );
      const sourceLabel =
        result.context.mode === "COURSE_MATERIALS"
          ? `${result.context.materialNames.length} tệp trong môn học`
          : `${result.context.sources.length || "các"} nguồn web`;
      notify(
        `Đã tạo đề nháp ${result.generatedQuestionCount} câu từ ${sourceLabel}. Hãy duyệt các câu AI rồi mới gửi duyệt đề.`,
      );
      setOpen(false);
      setForm(blank);
      editorDrafts.current.delete(editorKey);
      removeSessionDraft(editorKey);
      setAiConfig((current) => ({
        ...blankAiConfig,
        providerId: current.providerId,
        model: current.model,
      }));
      await load();
      await preview(result.exam);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được đề bằng AI.",
        "error",
      );
    } finally {
      aiSubmitting.current = false;
      setSaving(false);
    }
  };

  /** Loại cache hết hạn trước khi phục hồi để thống nhất thời hạn với storage của tab. */
  const restoreEditorDraft = useCallback((key: string) => {
    const cached = editorDrafts.current.get(key);
    if (cached && Date.now() >= cached.savedAt && Date.now() - cached.savedAt < DRAFT_MAX_AGE) return cached;
    editorDrafts.current.delete(key);
    return readSessionDraft(key, isExamEditorDraft);
  }, []);

  /** Mở hộp tạo đề ở chế độ thường hoặc AI và giữ provider đã chọn. */
  const openCreate = useCallback((mode: "MANUAL" | "AI") => {
    const key = `${session.user.id}:${session.roleCode}:${mode}`;
    const draft =
      restoreEditorDraft(key);
    setEditingExam(null);
    setForm(draft?.form ?? blank);
    setAiConfig(
      draft?.aiConfig ?? {
        ...blankAiConfig,
        providerId: aiConfig.providerId,
        model: aiConfig.model,
      },
    );
    setCreateMode(mode);
    setQuestionQuery("");
    setOpen(true);
  }, [aiConfig.model, aiConfig.providerId, restoreEditorDraft, session.roleCode, session.user.id]);

  const openedFromLink = useRef(false);
  /** Mở trình soạn đề hiện có khi chuyển đến từ Ngân hàng câu hỏi. */
  useEffect(() => {
    if (searchParams.get("create") !== "manual" || !instructor || openedFromLink.current) return;
    openedFromLink.current = true;
    openCreate("MANUAL");
  }, [instructor, openCreate, searchParams]);

  /** Nạp toàn bộ cấu hình đề nháp vào biểu mẫu chỉnh sửa. */
  const openEdit = (item: LearnerExam) => {
    const key = `${session.user.id}:${session.roleCode}:${item.id}:${item.version}`;
    const draft =
      restoreEditorDraft(key);
    setEditingExam(item);
    setCreateMode("MANUAL");
    setQuestionQuery("");
    setForm(
      draft?.form ?? {
        classId: item.classId,
        title: item.title,
        questionIds: [...item.questionIds],
        durationMinutes: item.durationMinutes,
        totalScore: item.totalScore,
        openAt: toLocalDateTimeInput(item.openAt),
        closeAt: toLocalDateTimeInput(item.closeAt),
        attemptLimit: item.attemptLimit,
        shuffleQuestions: item.shuffleQuestions ?? false,
        randomSeed: item.randomSeed ?? "wind-exam-2026",
        scoreAllocations:
          item.questionScores ??
          distributeScores(item.questionIds, item.totalScore),
      },
    );
    setOpen(true);
  };

  /** Đưa một câu AI nháp vào vòng phê duyệt và cập nhật trạng thái ngay trong bản xem đề. */
  const submitGeneratedQuestion = async (questionId: string) => {
    try {
      const updated = await apiRequest<Question>(
        `/instructor/question-bank/questions/${questionId}/publish`,
        { method: "POST", roleCode: session.roleCode },
      );
      setPreviewQuestions((current) =>
        current.map((question) =>
          question.id === questionId ? updated : question,
        ),
      );
      notify(
        updated.status === "PUBLISHED"
          ? "Câu hỏi đã được duyệt tự động."
          : "Câu hỏi đã được gửi vào hàng chờ duyệt.",
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không gửi duyệt được câu hỏi.",
        "error",
      );
    }
  };

  /** Gửi đề vào quy trình duyệt hoặc tự xuất bản tùy cấu hình phê duyệt của hệ thống. */
  const publish = async (item: Exam) => {
    setPublishing(true);
    try {
      await apiRequest<Exam>(
        `/instructor/exams/${item.id}/publish`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            confirmQuestions: true,
            expectedVersion: item.version,
          }),
        },
      );
      notify("Đề thi đã được phát hành thành công và sẵn sàng cho học viên.");
      setConfirmExam(null);
      closePreview();
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không phát hành được đề thi.",
        "error",
      );
    } finally {
      setPublishing(false);
    }
  };

  /** Lưu câu hỏi riêng của đề và nạp lại phiên bản đề mới. */
  const savePreviewQuestion = async () => {
    if (!previewExam || !editingQuestion) return;
    setSavingQuestion(true);
    try {
      const question = await apiRequest<Question>(
        `/instructor/exams/${previewExam.id}/questions/${editingQuestion.id}`,
        {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            content: editingQuestion.content,
            options: editingQuestion.options,
            correctAnswers: editingQuestion.correctAnswers,
            expectedVersion: previewExam.version,
          }),
        },
      );
      const updated = {
        ...previewExam,
        version: previewExam.version + 1,
        questionScores: {
          ...previewExam.questionScores,
          [question.id]:
            previewExam.questionScores?.[editingQuestion.id] ??
            previewExam.totalScore / previewQuestions.length,
        },
      };
      setEditingQuestion(null);
      await preview(updated);
      await load();
      notify("Đã lưu câu hỏi trong đề nháp.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được câu hỏi.",
        "error",
      );
    } finally {
      setSavingQuestion(false);
    }
  };

  /** Nạp bản xem đề theo thứ tự tác giả để giảng viên không bị ảnh hưởng bởi xáo trộn. */
  const preview = async (item: LearnerExam) => {
    const sequence = ++previewSequence.current;
    setPreviewExam(item);
    setPreviewQuestions([]);
    setPreviewLoading(true);
    try {
      const questions = await apiRequest<Question[]>(
        `${instructor ? "/instructor" : "/manager"}/exams/${item.id}/preview`,
        { roleCode: session.roleCode },
      );
      if (sequence === previewSequence.current) setPreviewQuestions(questions);
    } catch (error) {
      if (sequence !== previewSequence.current) return;
      setPreviewExam(null);
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được bản xem đề thi.",
        "error",
      );
    } finally {
      if (sequence === previewSequence.current) setPreviewLoading(false);
    }
  };

  /** Đóng bản xem trước và vô hiệu hóa phản hồi từ các lượt tải cũ. */
  const closePreview = () => {
    previewSequence.current += 1;
    setPreviewExam(null);
    setPreviewQuestions([]);
    setPreviewLoading(false);
  };

  /** Gửi quyết định duyệt hoặc trả lại đề cùng ghi chú của người kiểm duyệt. */
  const review = async (
    item: LearnerExam,
    decision: "APPROVE" | "RETURN",
    reviewNote?: string,
  ) => {
    setReviewingId(item.id);
    try {
      await apiRequest(`/manager/exams/${item.id}/approve`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ decision, reviewNote }),
      });
      notify(
        decision === "APPROVE"
          ? "Đã phê duyệt và phát hành đề."
          : "Đã trả đề về bản nháp cho giảng viên.",
      );
      setReturnTarget(null);
      setReturnNote("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không cập nhật được trạng thái phê duyệt.",
        "error",
      );
    } finally {
      setReviewingId(null);
    }
  };

  /** Bắt đầu lượt thi, nhận snapshot câu hỏi đã xáo trộn và khởi tạo đồng hồ đếm ngược. */
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
      currentAttemptId.current = data.id;
      answerVersions.current.clear();
      confirmedAnswers.current = new Map(Object.entries(data.answers));
      answerSaveFailed.current = false;
      setAutosaveStatus("IDLE");
      setAttempt(data);
      setActiveExam(item);
      setRemainingSeconds(
        Math.max(0, Math.floor((deadline - Date.now()) / 1000)),
      );
      setAttemptQuestions(questionData);
      setAnswerDrafts(
        Object.fromEntries(
          questionData.map((question) => [
            question.id,
            data.answers[question.id]?.[0] ?? "",
          ]),
        ),
      );
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

  /** Lưu tức thời đáp án khách quan của một câu vào lượt thi đang hoạt động. */
  const answer = async (questionId: string, answers: string[]) => {
    if (!attempt || submittingAttempt.current) return;
    const attemptId = attempt.id;
    const version = (answerVersions.current.get(questionId) ?? 0) + 1;
    answerVersions.current.set(questionId, version);
    setAttempt((current) => current?.id === attemptId ? {
      ...current,
      answers: { ...current.answers, [questionId]: answers },
    } : current);
    /** Gói thao tác lưu để cơ chế retry có thể gọi lại cùng payload một cách nhất quán. */
    const request = () =>
      apiRequest<ExamAttempt>(`/learner/exam-attempts/${attemptId}/answers`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ questionId, answers }),
      });
    if (pendingAnswers.current === 0) answerSaveFailed.current = false;
    pendingAnswers.current += 1;
    setAutosaveStatus("SAVING");
    /** Tuần tự hóa các lần lưu để phản hồi cũ không ghi đè đáp án mới. */
    const save = async () => {
      try {
        let data: ExamAttempt;
        try {
          data = await request();
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 500));
          data = await request();
        }
        if (currentAttemptId.current === attemptId) {
          const savedAnswer = data.answers[questionId];
          if (savedAnswer === undefined) confirmedAnswers.current.delete(questionId);
          else confirmedAnswers.current.set(questionId, savedAnswer);
        }
        setAttempt((current) => {
          if (current?.id !== attemptId || current.status !== "IN_PROGRESS") return current;
          const mergedAnswers = { ...data.answers, ...current.answers };
          if (answerVersions.current.get(questionId) === version) {
            const savedAnswer = data.answers[questionId];
            if (savedAnswer !== undefined) mergedAnswers[questionId] = savedAnswer;
            else delete mergedAnswers[questionId];
          }
          return { ...data, answers: mergedAnswers };
        });
      } catch (error) {
        answerSaveFailed.current = true;
        setAttempt((current) => {
          if (current?.id !== attemptId || answerVersions.current.get(questionId) !== version) return current;
          const restoredAnswers = { ...current.answers };
          const savedAnswer = confirmedAnswers.current.get(questionId);
          if (savedAnswer === undefined) delete restoredAnswers[questionId];
          else restoredAnswers[questionId] = savedAnswer;
          return { ...current, answers: restoredAnswers };
        });
        notify(
          error instanceof Error
            ? error.message
            : "Không lưu được câu trả lời sau hai lần thử.",
          "error",
        );
      } finally {
        pendingAnswers.current -= 1;
        if (currentAttemptId.current === attemptId) {
          setAutosaveStatus(pendingAnswers.current > 0 ? "SAVING" : answerSaveFailed.current ? "ERROR" : "SAVED");
        }
      }
    };
    const task = answerQueue.current.then(save);
    answerQueue.current = task;
    await task;
  };

  /** Chuyển nội dung tự luận đang gõ thành mảng đáp án và dùng chung cơ chế lưu câu trả lời. */
  const saveTextAnswer = (questionId: string) => {
    const value = answerDrafts[questionId]?.trim();
    void answer(questionId, value ? [value] : []);
  };

  /** Nộp lượt thi thủ công hoặc tự động khi hết giờ, có khóa chống gửi lặp. */
  const submit = useCallback(
    async (automatic = false) => {
      if (!attempt || attempt.status !== "IN_PROGRESS" || submittingAttempt.current) return;
      submittingAttempt.current = true;
      try {
        // Đợi các lần autosave trước khi khóa bài và tính điểm ở server.
        await answerQueue.current;
        const data = await apiRequest<ExamAttempt>(
          `/learner/exam-attempts/${attempt.id}/submit`,
          { method: "POST", roleCode: session.roleCode },
        );
        setAttempt((current) => current?.id === attempt.id ? data : current);
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
      } finally {
        submittingAttempt.current = false;
      }
    },
    [attempt, load, notify, session.roleCode],
  );

  /** Tạo yêu cầu phúc khảo cho kết quả thi và lý do người học cung cấp. */
  const requestRegrade = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedResult) return;
    setSaving(true);
    try {
      await apiRequest(
        `/learner/attempts/${selectedResult.attempt.id}/regrade-requests`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ reason: regradeReason }),
        },
      );
      notify(
        "Đã gửi yêu cầu phúc khảo; trạng thái được lưu trong lịch sử kết quả.",
      );
      setRegradeOpen(false);
      setRegradeReason("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không gửi được yêu cầu phúc khảo.",
        "error",
      );
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
  return {
    allowed,
    instructor,
    learner,
    canReview,
    items,
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
    loadError,
    reload: load,
    open,
    closeEditor,
    discardEditor,
    editingExam,
    createMode,
    setCreateMode,
    saving,
    reviewingId,
    returnTarget,
    setReturnTarget,
    returnNote,
    setReturnNote,
    previewExam,
    setPreviewExam,
    closePreview,
    previewQuestions,
    setPreviewQuestions,
    confirmExam,
    setConfirmExam,
    publishing,
    editingQuestion,
    setEditingQuestion,
    savingQuestion,
    previewLoading,
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
    openCreate,
    openEdit,
    submitGeneratedQuestion,
    publish,
    savePreviewQuestion,
    preview,
    review,
    start,
    answer,
    saveTextAnswer,
    submit,
    requestRegrade,
  };
}
