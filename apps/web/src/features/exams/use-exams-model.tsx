"use client";
import { useMaterialSearch } from "@/components/material-search";
import { usePagination } from "@/components/ui";
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

  const visibleItems = useMemo(
    () =>
      requestedClassId
        ? items.filter((item) => item.classId === requestedClassId)
        : items,
    [items, requestedClassId],
  );

  const pagination = usePagination(visibleItems);

  const [classes, setClasses] = useState<LearningClass[]>([]);

  const [questions, setQuestions] = useState<Question[]>([]);

  const [attemptQuestions, setAttemptQuestions] = useState<Question[]>([]);

  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);

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

  const [form, setForm] = useState(blank);

  const [aiConfig, setAiConfig] = useState(blankAiConfig);

  const aiSubmitting = useRef(false);

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
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [exams, classData, questionData, resultData, providerData] =
        await Promise.all([
          apiRequest<LearnerExam[]>(learner ? "/learner/exams" : "/exams", {
            roleCode: session.roleCode,
          }),
          apiRequest<LearningClass[]>("/classes", {
            roleCode: session.roleCode,
          }),
          instructor
            ? apiRequest<Question[]>(
                "/instructor/question-bank/questions?status=PUBLISHED",
                {
                  roleCode: session.roleCode,
                },
              )
            : Promise.resolve([]),
          learner
            ? apiRequest<LearnerResult[]>("/learner/results", {
                roleCode: session.roleCode,
              })
            : Promise.resolve([]),
          instructor
            ? apiRequest<AiProviderSummary[]>(
                "/instructor/question-bank/ai-providers?task=GENERATE_EXAM",
                { roleCode: session.roleCode },
              )
            : Promise.resolve([]),
        ]);
      setItems(exams);
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
    const raw = sessionStorage.getItem("wind-scan-question-ids");
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as string[];
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
    } finally {
      sessionStorage.removeItem("wind-scan-question-ids");
    }
  }, [classes, notify, questions, searchParams]);

  /** Tạo đề từ các câu hỏi đã chọn, giữ thứ tự gốc và cấu hình xáo trộn riêng. */
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
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
    if (!aiConfig.providerId) {
      notify(
        "Quản trị viên cần cấu hình AI sinh đề trong Cấu hình hệ thống.",
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

  /** Mở hộp tạo đề ở chế độ thường hoặc AI và giữ provider đã chọn. */
  const openCreate = (mode: "MANUAL" | "AI") => {
    setEditingExam(null);
    setForm(blank);
    setCreateMode(mode);
    setQuestionQuery("");
    setOpen(true);
  };

  /** Nạp toàn bộ cấu hình đề nháp vào biểu mẫu chỉnh sửa. */
  const openEdit = (item: LearnerExam) => {
    setEditingExam(item);
    setCreateMode("MANUAL");
    setQuestionQuery("");
    setForm({
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
    });
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
      const updated = await apiRequest<Exam>(
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
      notify(
        updated.status === "PUBLISHED"
          ? "Đề đã được tự động phê duyệt và phát hành."
          : "Đã gửi đề sang hàng chờ phê duyệt.",
      );
      setConfirmExam(null);
      setPreviewExam(null);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi duyệt được.",
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
    setPreviewExam(item);
    setPreviewQuestions([]);
    setPreviewLoading(true);
    try {
      setPreviewQuestions(
        await apiRequest<Question[]>(
          `${instructor ? "/instructor" : "/manager"}/exams/${item.id}/preview`,
          { roleCode: session.roleCode },
        ),
      );
    } catch (error) {
      setPreviewExam(null);
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được bản xem đề thi.",
        "error",
      );
    } finally {
      setPreviewLoading(false);
    }
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
    if (!attempt) return;
    const previousAttempt = attempt;
    setAttempt({
      ...attempt,
      answers: { ...attempt.answers, [questionId]: answers },
    });
    /** Gói thao tác lưu để cơ chế retry có thể gọi lại cùng payload một cách nhất quán. */
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

  /** Chuyển nội dung tự luận đang gõ thành mảng đáp án và dùng chung cơ chế lưu câu trả lời. */
  const saveTextAnswer = (questionId: string) => {
    const value = answerDrafts[questionId]?.trim();
    void answer(questionId, value ? [value] : []);
  };

  /** Nộp lượt thi thủ công hoặc tự động khi hết giờ, có khóa chống gửi lặp. */
  const submit = useCallback(
    async (automatic = false) => {
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
    open,
    setOpen,
    editingExam,
    setEditingExam,
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
