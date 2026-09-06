"use client";

import { activeLocale } from "@/i18n/runtime";
import {
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  Eye,
  Globe2,
  Library,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { QuestionImage } from "@/components/question-image";
import { SectionState } from "@/components/section-state";
import { SearchableSelect } from "@/components/searchable-select";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  RichText,
  StatusBadge,
  Tabs,
  usePagination,
} from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import { eligibleExamQuestions } from "@/lib/exam-question-selection";
import type {
  AiGeneratedExamResult,
  AiProviderSummary,
  Exam,
  ExamAttempt,
  LearnerResult,
  LearningClass,
  Material,
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
  scoreAllocations: {} as Record<string, number>,
};
const questionTypeOptions: Array<{
  type: Question["type"];
  label: string;
  description: string;
}> = [
  {
    type: "SINGLE_CHOICE",
    label: "Chọn một đáp án",
    description: "Một đáp án đúng trong 4 lựa chọn",
  },
  {
    type: "MULTIPLE_CHOICE",
    label: "Chọn nhiều đáp án",
    description: "Từ hai đáp án đúng trở lên",
  },
  {
    type: "TRUE_FALSE",
    label: "Đúng / Sai",
    description: "Nhận định hai lựa chọn",
  },
  {
    type: "SHORT_ANSWER",
    label: "Điền từ / trả lời ngắn",
    description: "Đáp án ngắn có thể chấm tự động",
  },
  { type: "ESSAY", label: "Tự luận", description: "Kèm dàn ý chấm tham khảo" },
];
const blankAiConfig = {
  focus: "",
  difficulty: 2 as 1 | 2 | 3,
  contextMode: "AUTO" as "AUTO" | "COURSE_MATERIALS" | "WEB_SEARCH",
  providerId: "",
  materialIds: [] as string[],
  distribution: {
    SINGLE_CHOICE: 2,
    MULTIPLE_CHOICE: 1,
    TRUE_FALSE: 0,
    SHORT_ANSWER: 2,
    ESSAY: 0,
  } as Record<Question["type"], number>,
};

/** Chia tổng điểm theo hai chữ số thập phân và dồn phần dư vào câu cuối. */
function distributeScores(
  questionIds: string[],
  totalScore: number,
): Record<string, number> {
  if (!questionIds.length) return {};
  const base = Math.floor((totalScore / questionIds.length) * 100) / 100;
  const result = Object.fromEntries(
    questionIds.map((questionId) => [questionId, base]),
  );
  result[questionIds[questionIds.length - 1]!] =
    Math.round((totalScore - base * (questionIds.length - 1)) * 100) / 100;
  return result;
}

/** Chuyển ISO từ máy chủ sang giá trị datetime-local theo múi giờ trình duyệt. */
function toLocalDateTimeInput(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
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
/** Điều phối toàn bộ vòng đời đề thi cho quản lý, giảng viên và học viên theo quyền. */
export default function ExamsPage() {
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
  const visibleItems = useMemo(() => requestedClassId ? items.filter((item) => item.classId === requestedClassId) : items, [items, requestedClassId]);
  const pagination = usePagination(visibleItems);
  const [classes, setClasses] = useState<LearningClass[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form, setForm] = useState(blank);
  const [aiConfig, setAiConfig] = useState(blankAiConfig);
  const [aiRequestId, setAiRequestId] = useState("");
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
  const openAiProviders = useMemo(
    () => aiProviders.filter((provider) => provider.provider === "OPENAI"),
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
  const eligibleMaterials = useMemo(() => {
    const selectedClass = classes.find((item) => item.id === form.classId);
    if (!selectedClass) return [];
    const relatedClassIds = new Set(
      classes
        .filter((item) => item.courseId === selectedClass.courseId)
        .map((item) => item.id),
    );
    return materials.filter(
      (item) =>
        relatedClassIds.has(item.classId) &&
        item.visibility === "PUBLISHED" &&
        [
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "image/png",
          "image/jpeg",
        ].includes(item.mimeType),
    );
  }, [classes, form.classId, materials]);
  /** Nạp lớp, đề thi và dữ liệu kết quả phù hợp với vai trò cùng bộ lọc hiện tại. */
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [
        exams,
        classData,
        questionData,
        resultData,
        providerData,
        materialData,
      ] = await Promise.all([
        apiRequest<LearnerExam[]>(learner ? "/learner/exams" : "/exams", {
          roleCode: session.roleCode,
        }),
        apiRequest<LearningClass[]>("/classes", { roleCode: session.roleCode }),
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
              "/instructor/question-bank/ai-providers",
              { roleCode: session.roleCode },
            )
          : Promise.resolve([]),
        instructor
          ? apiRequest<Material[]>("/materials", { roleCode: session.roleCode })
          : Promise.resolve([]),
      ]);
      setItems(exams);
      setClasses(classData);
      setQuestions(questionData);
      setResults(resultData);
      setAiProviders(providerData);
      setMaterials(materialData);
      setAiConfig((current) => ({
        ...current,
        providerId:
          current.providerId ||
          providerData.find(
            (item) => item.provider === "OPENAI" && item.isDefault,
          )?.id ||
          providerData.find((item) => item.provider === "OPENAI")?.id ||
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
            clientRequestId: aiRequestId || crypto.randomUUID(),
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
        "Cần cấu hình và bật một provider OpenAI trong Quản trị hệ thống.",
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      const result = await apiRequest<AiGeneratedExamResult>(
        "/instructor/exams/ai-generate",
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            ...form,
            questionIds: undefined,
            scoreAllocations: undefined,
            focus: aiConfig.focus.trim(),
            difficulty: aiConfig.difficulty,
            contextMode: aiConfig.contextMode,
            providerId: aiConfig.providerId,
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
      }));
      await load();
      await preview(result.exam);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được đề bằng AI.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Mở hộp tạo đề ở chế độ thường hoặc AI và giữ provider đã chọn. */
  const openCreate = (mode: "MANUAL" | "AI") => {
    setEditingExam(null);
    setForm(blank);
    setCreateMode(mode);
    setAiRequestId(mode === "AI" ? crypto.randomUUID() : "");
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
    try {
      const updated = await apiRequest<Exam>(
        `/instructor/exams/${item.id}/publish`,
        {
          method: "POST",
          roleCode: session.roleCode,
        },
      );
      notify(
        updated.status === "PUBLISHED"
          ? "Đề đã được tự động phê duyệt và phát hành."
          : "Đã gửi đề sang hàng chờ phê duyệt.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi duyệt được.",
        "error",
      );
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
  if (!allowed) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Assessment Workflow"
        title="Đề thi & kết quả"
        description="Thiết kế, công bố, làm bài và chấm điểm theo cùng một vòng đời dữ liệu."
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
          <SectionState loading={loading} empty={visibleItems.length === 0}>
            <div className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">
              {pagination.pageItems.map((item) => (
                <article
                  className="grid gap-4 border-b border-[var(--rule)] px-5 py-5 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                  id={`exam-${item.id}`}
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
                        <p className="font-extrabold">
                          {item.durationMinutes}&apos;
                        </p>
                        <p className="text-[11px] text-slate-500">Thời gian</p>
                      </div>
                      <div>
                        <p className="font-extrabold">
                          {learner
                            ? (item.remainingAttempts ?? 0)
                            : item.totalScore}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {learner ? "Lượt còn lại" : "Tổng điểm"}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                      <Clock3 size={14} />
                      {new Date(item.openAt).toLocaleString(activeLocale())} —{" "}
                      {new Date(item.closeAt).toLocaleString(activeLocale())}
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
                        onClick={() => void publish(item)}
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
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditingExam(null);
        }}
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
            createMode === "AI"
              ? void generateAiExam(event)
              : void create(event)
          }
        >
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
              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] p-2">
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
                      className="grid min-h-12 grid-cols-[auto_minmax(0,1fr)_5rem] items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]"
                      key={question.id}
                    >
                      <input
                        checked={form.questionIds.includes(question.id)}
                        className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
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
                <p
                  className={`mt-2 text-xs font-bold ${Math.abs(allocatedScore - form.totalScore) < 0.001 ? "text-[var(--success-deep)]" : "text-[var(--danger)]"}`}
                >
                  Đã phân bổ {Math.round(allocatedScore * 100) / 100}/
                  {form.totalScore} điểm.
                </p>
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
                  <legend className="text-sm font-bold text-[var(--ink)]">
                    Phạm vi ngữ cảnh
                  </legend>
                  <div className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
                    {[
                      {
                        value: "AUTO" as const,
                        icon: BookOpenCheck,
                        title: "Tự động theo môn học",
                        text: "Gửi tạm PDF, Word và ảnh đã công khai đến OpenAI; không có tệp mới tìm web.",
                      },
                      {
                        value: "COURSE_MATERIALS" as const,
                        icon: Library,
                        title: "Chỉ tài liệu môn học",
                        text: "Gửi tạm tệp đến OpenAI và xóa sau khi tạo; báo lỗi nếu không có tệp.",
                      },
                      {
                        value: "WEB_SEARCH" as const,
                        icon: Globe2,
                        title: "Tìm kiếm Internet",
                        text: "Dùng Web Search và trả nguồn đã tham khảo.",
                      },
                    ].map((option) => {
                      const Icon = option.icon;
                      return (
                        <label
                          className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-[var(--surface-muted)]"
                          key={option.value}
                        >
                          <input
                            checked={aiConfig.contextMode === option.value}
                            className="mt-1 size-4 accent-[var(--accent)]"
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
                            className="mt-0.5 shrink-0 text-[var(--accent-ink)]"
                            size={18}
                          />
                          <span>
                            <span className="block text-sm font-extrabold text-[var(--ink)]">
                              {option.title}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-[var(--ink-muted)]">
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
                        <legend className="text-sm font-bold text-[var(--ink)]">
                          Tài liệu ưu tiên
                        </legend>
                        <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                          Chọn tối đa 6 tệp đã phát hành. Để trống để hệ thống
                          tự chọn trong môn học.
                        </p>
                      </div>
                      <span className="text-xs font-bold tabular-nums text-[var(--ink-muted)]">
                        {aiConfig.materialIds.length}/6
                      </span>
                    </div>
                    <div className="mt-2 max-h-44 divide-y divide-[var(--rule)] overflow-y-auto border-y border-[var(--rule-strong)]">
                      {eligibleMaterials.length ? (
                        eligibleMaterials.map((material) => (
                          <label
                            className="flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-[var(--surface-muted)]"
                            key={material.id}
                          >
                            <input
                              checked={aiConfig.materialIds.includes(
                                material.id,
                              )}
                              className="mt-1 size-4 accent-[var(--accent)]"
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
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <Field label="Mô hình AI">
                    <select
                      className={inputClass}
                      onChange={(event) =>
                        setAiConfig({
                          ...aiConfig,
                          providerId: event.target.value,
                        })
                      }
                      required
                      value={aiConfig.providerId}
                    >
                      <option value="">Chọn OpenAI provider</option>
                      {openAiProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name} — {provider.model}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {!openAiProviders.length ? (
                  <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs font-bold leading-5 text-[var(--warning-deep)]">
                    Chưa có OpenAI provider đang bật và có API key. Cấu hình
                    provider trong Quản trị hệ thống trước khi tạo đề.
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
                    <strong className="text-3xl font-extrabold tabular-nums text-[var(--accent-ink)]">
                      {aiQuestionTotal}
                    </strong>
                    <span className="ml-1 text-xs font-bold text-[var(--ink-muted)]">
                      câu
                    </span>
                  </div>
                </div>
                <div className="mt-3 divide-y divide-[var(--rule)] border-y border-[var(--rule-strong)]">
                  {questionTypeOptions.map((option) => (
                    <label
                      className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-4 py-3"
                      key={option.type}
                    >
                      <span>
                        <span className="block text-sm font-extrabold text-[var(--ink)]">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--ink-muted)]">
                          {option.description}
                        </span>
                      </span>
                      <input
                        aria-label={`Số câu ${option.label}`}
                        className={`${inputClass} text-center font-extrabold tabular-nums`}
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
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-slate-700">
            <input
              checked={form.shuffleQuestions}
              className="size-5 accent-sky-600"
              onChange={(event) =>
                setForm({ ...form, shuffleQuestions: event.target.checked })
              }
              type="checkbox"
            />
            Xáo thứ tự câu hỏi theo seed có thể tái lập
          </label>
          {form.shuffleQuestions ? (
            <Field label="Random seed">
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
          <Button
            disabled={
              !form.classId ||
              (createMode === "MANUAL"
                ? form.questionIds.length === 0 ||
                  Math.abs(allocatedScore - form.totalScore) >= 0.001
                : !aiConfig.focus.trim() ||
                  !aiConfig.providerId ||
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
        </form>
      </Modal>
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
        open={Boolean(previewExam)}
        onClose={() => {
          if (!previewLoading) {
            setPreviewExam(null);
            setPreviewQuestions([]);
          }
        }}
        size="xl"
        title={previewExam?.title ?? "Xem đề thi"}
        description="Bản dành cho giảng viên — luôn hiển thị theo thứ tự gốc khi tạo đề, không áp dụng xáo trộn câu hỏi."
      >
        {previewExam ? (
          <div>
            <div className="grid gap-3 border-y border-[var(--rule)] py-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-bold text-[var(--ink-muted)]">
                  Lớp học
                </p>
                <p className="mt-1 text-sm font-extrabold">
                  {classes.find((item) => item.id === previewExam.classId)
                    ?.code ?? previewExam.classId}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--ink-muted)]">
                  Thời gian
                </p>
                <p className="mt-1 text-sm font-extrabold">
                  {previewExam.durationMinutes} phút
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--ink-muted)]">
                  Tổng điểm
                </p>
                <p className="mt-1 text-sm font-extrabold">
                  {previewExam.totalScore}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-[var(--ink-muted)]">
                  Thứ tự học viên
                </p>
                <p className="mt-1 text-sm font-extrabold">
                  {previewExam.shuffleQuestions
                    ? "Có xáo trộn"
                    : "Theo thứ tự gốc"}
                </p>
              </div>
            </div>
            {previewLoading ? (
              <p className="py-16 text-center text-sm font-semibold text-[var(--ink-muted)]">
                Đang tải nội dung đề…
              </p>
            ) : (
              <ol className="mt-5 space-y-5">
                {previewQuestions.map((question, index) => (
                  <li
                    className="rounded-xl border border-[var(--rule-strong)] bg-[var(--canvas)] p-4 md:p-5"
                    key={question.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-sm font-extrabold">
                        <ListOrdered size={16} />
                        Câu {index + 1} ·{" "}
                        {previewExam.questionScores?.[question.id] ??
                          Math.round(
                            (previewExam.totalScore /
                              Math.max(1, previewQuestions.length)) *
                              100,
                          ) / 100}{" "}
                        điểm
                      </p>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={question.status} />
                        {instructor && question.status === "DRAFT" ? (
                          <Button
                            onClick={() =>
                              void submitGeneratedQuestion(question.id)
                            }
                            variant="ghost"
                          >
                            <Send size={14} />
                            Gửi duyệt câu
                          </Button>
                        ) : null}
                        <span className="text-xs font-bold text-[var(--ink-muted)]">
                          {question.type} · Mức {question.difficulty}
                        </span>
                      </div>
                    </div>
                    <RichText className="mt-3 font-semibold">
                      {question.content}
                    </RichText>
                    <QuestionImage
                      className="mt-4"
                      imageUrl={question.imageUrl}
                    />
                    {question.options.length ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {question.options.map((option, optionIndex) => {
                          const correct =
                            question.correctAnswers.includes(option);
                          return (
                            <div
                              className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${correct ? "border-[var(--success)] bg-[var(--success-soft)]" : "border-[var(--rule)] bg-[var(--surface)]"}`}
                              key={`${optionIndex}-${option}`}
                            >
                              <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-current text-xs font-extrabold">
                                {String.fromCharCode(65 + optionIndex)}
                              </span>
                              <RichText className="min-w-0">{option}</RichText>
                              {correct ? (
                                <CheckCircle2
                                  aria-label="Đáp án đúng"
                                  className="ml-auto shrink-0 text-[var(--success-deep)]"
                                  size={17}
                                />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {question.correctAnswers.length &&
                    !question.options.length ? (
                      <div className="mt-4 rounded-lg bg-[var(--success-soft)] p-3">
                        <p className="text-xs font-bold text-[var(--success-deep)]">
                          Đáp án / ý tham khảo
                        </p>
                        {question.correctAnswers.map((answer) => (
                          <RichText className="mt-1 text-sm" key={answer}>
                            {answer}
                          </RichText>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {previewExam.aiContext ? (
              <div className="mt-5 border-y border-[var(--rule-strong)] py-4">
                <p className="text-sm font-extrabold">Nguồn tạo đề AI</p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {previewExam.aiContext.mode === "COURSE_MATERIALS"
                    ? `${previewExam.aiContext.materialIds.length} tài liệu trong môn học`
                    : `${previewExam.aiContext.sources.length} nguồn Internet`}
                </p>
                {previewExam.aiContext.sources.length ? (
                  <ul className="mt-2 space-y-1">
                    {previewExam.aiContext.sources.map((source) => (
                      <li className="truncate text-xs" key={source.url}>
                        <a
                          className="text-[var(--accent-ink)] underline"
                          href={source.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
