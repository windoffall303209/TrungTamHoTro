"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { LectureSidebarNavigation } from "@/features/class-detail/lecture-sidebar-navigation";
import { ClassFolderEntry } from "@/features/class-detail/class-folder-entry";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  FileText,
  Video,
  Folder,
  MessageSquare,
  Users,
  Search,
  Play,
  Download,
  Eye,
  MessageCircle,
  X,
  Share2,
  ChevronDown,
  ArrowRight,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Lock,
  AlertCircle,
  Info,
} from "lucide-react";
import type {
  LearningClass,
  Course,
  LearnerExamSummary,
  Assignment,
  Material,
  LearnerResult,
  LiveSession,
} from "@/lib/learning-types";
import { apiRequest, downloadApiFile, previewApiFile } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isMaterialForClass, loadAllMaterials } from "@/lib/materials";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/shared/ui/user-avatar";
import { ExamTakingModal, type ExamTakingData } from "./exam-taking-modal";
import { filterLearnerAssignments, filterLearnerFiles, getLearnerFolderNames } from "./learner-class-workspace.helpers";

interface LearnerClassWorkspaceProps {
  item: LearningClass;
  course: Course | null;
  teacherName?: string;
  instructors?: Array<{
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string | null;
    avatarUrl?: string;
  }>;
  onBack?: () => void;
}

type SubTab = "feed" | "schedule" | "members" | "assignments" | "lectures" | "materials";

export interface AttemptRecord {
  id: string;
  attemptNo: number;
  score?: number;
  maxScore: number;
  submittedAt?: string;
  feedback?: string;
  answers?: Array<{
    questionId: string;
    questionTitle?: string;
    submittedAnswers?: string[];
    awardedScore?: number;
    maxScore?: number;
  }>;
}

interface AssignmentItem {
  id: string;
  title: string;
  type: "EXAM" | "ESSAY";
  durationMinutes?: number;
  dueAt?: string;
  status: "PENDING" | "SUBMITTED" | "GRADED";
  score?: number;
  maxScore?: number;
  totalQuestions?: number;
  remainingAttempts?: number | null;
  attemptLimit?: number;
  completedAttempts?: number;
  folder?: string;
  subtypeText?: string;
  scoringMethod?: string;
  createdAt?: string;
  attempts?: AttemptRecord[];
}

interface LectureItem {
  id: string;
  title: string;
  fileType: "mp4" | "mp3" | "pptx" | "pdf" | "other";
  duration?: string;
  teacher: string;
  uploadedAt: string;
  folder?: string;
  progressPercent?: number;
  viewsCount?: number;
  description?: string;
  youtubeId?: string;
  attachedExamId?: string;
  attachedExamTitle?: string;
}

interface MaterialItem {
  id: string;
  title: string;
  fileType: string;
  size?: string;
  uploadedAt: string;
  folder?: string;
  pageCount?: number;
  downloadsCount?: number;
}

/** Xác định màu sắc thái điểm số theo quy định:
 * - < 5.0đ: Màu đỏ dạng báo động
 * - >= 8.5đ: Màu xanh lục thành tích
 * - 5.0 - 8.4đ: Màu xanh lam nhạt
 * - Chưa có điểm: Trung tính
 */
function getScoreTheme(score?: number | null) {
  if (score === undefined || score === null) {
    return {
      badgeBg: "bg-slate-700 text-slate-200 border border-slate-600",
      barColor: "bg-slate-400",
      textColor: "text-slate-500 dark:text-slate-400",
      label: "Chưa làm bài",
      isGraded: false,
    };
  }
  if (score < 5.0) {
    return {
      badgeBg: "bg-rose-600 text-white shadow-rose-950/30 shadow-md ring-1 ring-rose-500",
      barColor: "bg-rose-600",
      textColor: "text-rose-600 dark:text-rose-400 font-bold",
      label: `${score.toFixed(1)} điểm`,
      isGraded: true,
    };
  }
  if (score >= 8.5) {
    return {
      badgeBg: "bg-emerald-600 text-white shadow-emerald-950/30 shadow-md ring-1 ring-emerald-500",
      barColor: "bg-emerald-500",
      textColor: "text-emerald-600 dark:text-emerald-400 font-bold",
      label: `${score.toFixed(1)} điểm`,
      isGraded: true,
    };
  }
  return {
    badgeBg: "bg-sky-500 text-white shadow-sky-950/30 shadow-md ring-1 ring-sky-400",
    barColor: "bg-sky-500",
    textColor: "text-sky-600 dark:text-sky-400 font-bold",
    label: `${score.toFixed(1)} điểm`,
    isGraded: true,
  };
}

/** Component Không gian Chi tiết Lớp học dành cho Học sinh theo phong cách SHub Classroom */
export function LearnerClassWorkspace({
  item,
  course,
  teacherName = "Wind Fall",
  instructors,
  onBack,
}: LearnerClassWorkspaceProps) {
  const router = useRouter();
  const { session, notify } = useApp();

  // Tab điều hướng dọc của học sinh: mặc định là bảng tin ("feed"), lưu bền vững qua URL và sessionStorage
  const [activeTab, setActiveTab] = useState<SubTab>(() => {
    if (typeof window !== "undefined") {
      const tabParam = new URLSearchParams(window.location.search).get("tab") as SubTab | null;
      const validTabs: SubTab[] = [
        "feed",
        "schedule",
        "members",
        "assignments",
        "lectures",
        "materials",
      ];
      if (tabParam && validTabs.includes(tabParam)) return tabParam;

      const stored = sessionStorage.getItem(`class_tab_learner_${item.id}`) as SubTab | null;
      if (stored && validTabs.includes(stored)) return stored;
    }
    return "feed";
  });

  /** Chuyển tab và đồng bộ vào URL query params cùng sessionStorage để khi F5 không bị mất trang */
  const handleSelectTab = useCallback(
    (tab: SubTab) => {
      setActiveTab(tab);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(`class_tab_learner_${item.id}`, tab);
          const url = new URL(window.location.href);
          url.searchParams.set("tab", tab);
          window.history.replaceState({}, "", url.toString());
        } catch (e) {
          console.error("Lỗi cập nhật query param tab:", e);
        }
      }
    },
    [item.id],
  );

  // Dữ liệu thật nạp từ cơ sở dữ liệu backend
  const [classExams, setClassExams] = useState<LearnerExamSummary[]>([]);
  const [classAssignments, setClassAssignments] = useState<Assignment[]>([]);
  const [classMaterials, setClassMaterials] = useState<Material[]>([]);
  const [learnerResults, setLearnerResults] = useState<LearnerResult[]>([]);
  const [classSessions, setClassSessions] = useState<LiveSession[]>([]);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);
  const classDataRequestRef = useRef(0);
  const classDataControllerRef = useRef<AbortController | null>(null);
  const loadedClassIdRef = useRef(item.id);

  /** Tải dữ liệu lớp, bỏ phản hồi cũ và xóa dữ liệu thuộc lớp trước khi đổi lớp. */
  const loadClassData = useCallback(async () => {
    const requestId = ++classDataRequestRef.current;
    classDataControllerRef.current?.abort();
    const controller = new AbortController();
    classDataControllerRef.current = controller;
    if (loadedClassIdRef.current !== item.id) {
      loadedClassIdRef.current = item.id;
      setClassExams([]);
      setClassAssignments([]);
      setClassMaterials([]);
      setLearnerResults([]);
      setClassSessions([]);
      setDataLoadError(null);
    }
    const classId = encodeURIComponent(item.id);
    const responses = await Promise.allSettled([
      apiRequest<LearnerExamSummary[]>(`/learner/classes/${classId}/exams`, { signal: controller.signal }),
      apiRequest<Assignment[]>(`/academic/assignments?classId=${classId}`, { signal: controller.signal }),
      loadAllMaterials<Material>("/materials", { signal: controller.signal }),
      apiRequest<LearnerResult[]>("/learner/results", { signal: controller.signal }),
      apiRequest<LiveSession[]>("/sessions", { signal: controller.signal }),
    ] as const);
    if (requestId !== classDataRequestRef.current || controller.signal.aborted) return;
    const [exams, assignments, materials, results, sessions] = responses;
    if (exams.status === "fulfilled" && Array.isArray(exams.value)) setClassExams(exams.value);
    if (assignments.status === "fulfilled" && Array.isArray(assignments.value)) setClassAssignments(assignments.value);
    if (materials.status === "fulfilled" && Array.isArray(materials.value)) {
      setClassMaterials(materials.value.filter((material) => isMaterialForClass(material, item.id, item.courseId)));
    }
    if (results.status === "fulfilled" && Array.isArray(results.value)) setLearnerResults(results.value);
    if (sessions.status === "fulfilled" && Array.isArray(sessions.value)) {
      setClassSessions(sessions.value.filter((entry) => entry.classId === item.id));
    }
    const failedCount = responses.filter((response) => response.status === "rejected" || !Array.isArray(response.value)).length;
    setDataLoadError(failedCount ? `Không tải được ${failedCount} nguồn dữ liệu lớp học. Vui lòng thử tải lại.` : null);
  }, [item.id, item.courseId]);

  useEffect(() => {
    void loadClassData();
    return () => { classDataRequestRef.current += 1; classDataControllerRef.current?.abort(); };
  }, [loadClassData]);

  // Danh sách giảng viên lớp học (hiển thị 1 hoặc 2 giáo viên kèm avatar thật)
  const displayInstructors = useMemo(() => {
    if (instructors && instructors.length > 0) {
      return instructors.map((inst, index) => ({
        id: inst.instructorId,
        name: inst.displayName || (index === 0 ? teacherName : `Giảng viên ${index + 1}`),
        role: inst.role === "PRIMARY" ? "Giáo viên chính" : "Giảng viên",
        avatarUrl: inst.avatarUrl,
        email: inst.email,
      }));
    }
    return item.instructorIds.map((id, index) => ({
      id,
      name: index === 0 ? teacherName : `Giảng viên ${index + 1}`,
      role: index === 0 ? "Giáo viên chính" : "Giảng viên",
      avatarUrl: undefined,
      email: undefined,
    }));
  }, [instructors, item.instructorIds, teacherName]);

  // State cho Lịch học: Dạng Tuần (Lưới) hoặc Dạng Tháng (Danh sách)
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");

  // State cho Bài tập & Kiểm tra
  const [assignmentSearch, setAssignmentSearch] = useState("");
  const [assignmentSort, setAssignmentSort] = useState<"alpha" | "newest" | "due">("newest");
  const [selectedAssignmentFolder, setSelectedAssignmentFolder] = useState<string>("__ALL__");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [assignmentFolderExpanded, setAssignmentFolderExpanded] = useState<Record<string, boolean>>({});
  const [isAssignmentDetailExpanded, setIsAssignmentDetailExpanded] = useState<boolean>(true);
  const [activeExamForTaking, setActiveExamForTaking] = useState<ExamTakingData | null>(null);
  const [activeEssayAssignment, setActiveEssayAssignment] = useState<Assignment | null>(null);
  const [essayContent, setEssayContent] = useState("");
  const [essayFiles, setEssayFiles] = useState<File[]>([]);
  const [essayError, setEssayError] = useState<string | null>(null);
  const [essaySubmitting, setEssaySubmitting] = useState(false);

  // State quản lý xem lại bài làm & lịch sử nhiều lần nộp bài
  const [selectedAttemptForReview, setSelectedAttemptForReview] = useState<{
    examTitle: string;
    attempt: AttemptRecord;
  } | null>(null);
  const [historyAssignment, setHistoryAssignment] = useState<AssignmentItem | null>(null);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // State trang xem chi tiết bài giảng độc lập (3 cột theo ảnh minh họa)
  const [selectedLectureForPage, setSelectedLectureForPage] = useState<LectureItem | null>(null);
  const [lecturePageFolder, setLecturePageFolder] = useState<string>("__ALL__");

  // State thông báo toast hiện đại (thay thế hoàn toàn alert popup của trình duyệt)
  const [toast, setToast] = useState<{
    id: string;
    message: string;
    type?: "info" | "warning" | "success";
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

  /** Kích hoạt hiển thị thông báo toast mềm mại góc màn hình */
  const showToast = useCallback(
    (
      message: string,
      options?: {
        type?: "info" | "warning" | "success";
        actionLabel?: string;
        onAction?: () => void;
      },
    ) => {
      setToast({
        id: `toast-${Date.now()}`,
        message,
        type: options?.type || "info",
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      });
    },
    [],
  );

  // Mở tab ngay từ thao tác người dùng, sau đó xác nhận quyền tham gia trên máy chủ.
  const joinClassSession = async (liveSession: LiveSession) => {
    const meetingWindow = window.open("", "_blank");
    if (!meetingWindow) {
      showToast("Trình duyệt đã chặn cửa sổ phòng học.", { type: "warning" });
      return;
    }
    meetingWindow.opener = null;
    try {
      const result = await apiRequest<{ attendeeUrl: string }>(`/learner/sessions/${encodeURIComponent(liveSession.id)}/join`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      meetingWindow.location.replace(result.attendeeUrl);
    } catch (error) {
      meetingWindow.close();
      showToast(error instanceof Error ? error.message : "Không thể tham gia phòng học.", { type: "warning" });
    }
  };

  // Lấy URL ký ngắn hạn và tải về tệp mà máy chủ cho phép truy cập.
  const downloadClassMaterial = async (materialId: string) => {
    try {
      const access = await apiRequest<{ url: string }>(`/materials/${encodeURIComponent(materialId)}/access?action=DOWNLOAD`, { roleCode: session.roleCode });
      await downloadApiFile(access.url, session.roleCode);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không thể tải tài liệu.", { type: "warning" });
    }
  };

  // Mở trước cửa sổ xem tài liệu để tránh trình duyệt chặn sau yêu cầu bất đồng bộ.
  const previewClassMaterial = (materialId: string, title: string) => {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      showToast("Trình duyệt đã chặn cửa sổ xem trước.", { type: "warning" });
      return;
    }
    void (async () => {
      try {
        const access = await apiRequest<{ url: string }>(`/materials/${encodeURIComponent(materialId)}/access?action=PREVIEW`, { roleCode: session.roleCode });
        await previewApiFile(access.url, session.roleCode, title, previewWindow);
      } catch (error) {
        previewWindow.close();
        showToast(error instanceof Error ? error.message : "Không thể xem trước tài liệu.", { type: "warning" });
      }
    })();
  };

  /** Mở đúng luồng làm bài thi hoặc nộp bài tự luận theo loại bài tập. */
  const openAssignment = (assignment: AssignmentItem) => {
    if (assignment.type === "ESSAY") {
      const source = classAssignments.find((item) => item.id === assignment.id);
      if (!source) {
        showToast("Không tìm thấy bài tập trong dữ liệu lớp. Hãy tải lại trang.", { type: "warning" });
        return;
      }
      setActiveEssayAssignment(source);
      setEssayContent(source.submission?.content ?? "");
      setEssayFiles([]);
      setEssayError(null);
      return;
    }
    setActiveExamForTaking({
      id: assignment.id,
      title: assignment.title,
      durationMinutes: assignment.durationMinutes ?? 0,
      totalQuestions: assignment.totalQuestions,
      remainingAttempts: assignment.remainingAttempts,
      totalScore: assignment.maxScore,
      closeAt: assignment.dueAt,
    });
  };

  /** Kiểm tra tệp đính kèm trước khi thêm vào bài nộp tự luận. */
  const chooseEssayFiles = (files: FileList | null) => {
    if (!files || !activeEssayAssignment) return;
    const next = [...essayFiles, ...Array.from(files)];
    if (next.length + (activeEssayAssignment.submission?.attachments.length ?? 0) > 5) {
      setEssayError("Mỗi bài nộp được đính kèm tối đa 5 tệp.");
      return;
    }
    const invalid = next.find((file) => file.size <= 0 || file.size > 20 * 1024 * 1024 || !/\.(jpe?g|png|webp|pdf|docx?|txt)$/i.test(file.name));
    if (invalid) {
      setEssayError(`Tệp ${invalid.name} phải đúng định dạng cho phép và không vượt quá 20 MB.`);
      return;
    }
    setEssayFiles(next);
    setEssayError(null);
  };

  /** Nộp nội dung và tệp lên API bài tập cùng revision để tránh ghi đè bài đã sửa. */
  const submitEssayAssignment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeEssayAssignment || essaySubmitting) return;
    if (!essayContent.trim() && essayFiles.length === 0 && !activeEssayAssignment.submission?.attachments.length) {
      setEssayError("Cần nhập nội dung hoặc đính kèm ít nhất một tệp.");
      return;
    }
    const body = new FormData();
    body.set("content", essayContent.trim());
    body.set("expectedRevision", String(activeEssayAssignment.submission?.revision ?? 0));
    essayFiles.forEach((file) => body.append("files", file));
    setEssaySubmitting(true);
    setEssayError(null);
    try {
      await apiRequest(`/learner/assignments/${encodeURIComponent(activeEssayAssignment.id)}/submissions`, {
        method: "POST",
        body,
      });
      setActiveEssayAssignment(null);
      setEssayFiles([]);
      showToast("Đã lưu bài nộp tự luận.", { type: "success" });
      await loadClassData();
    } catch (error) {
      setEssayError(error instanceof Error ? error.message : "Không nộp được bài tập. Hãy thử lại.");
    } finally {
      setEssaySubmitting(false);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      setToast(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Danh sách bài tập & đề thi: 100% LẤY DỮ LIỆU THẬT TỪ DATABASE CỦA LỚP
  const assignmentsList: AssignmentItem[] = useMemo(() => {
    const dbExams: AssignmentItem[] = classExams.map((exam) => {
      const relatedResults = learnerResults.filter(
        (r) => r.attempt && r.attempt.examId === exam.id,
      );
      const attempts: AttemptRecord[] = relatedResults.map((r, aIdx) => ({
        id: r.attempt.id,
        attemptNo: r.attempt.attemptNo || aIdx + 1,
        score: r.attempt.score == null ? undefined : Number(r.attempt.score),
        maxScore: Number(exam.totalScore),
        submittedAt: r.attempt.submittedAt
          ? new Date(r.attempt.submittedAt).toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : undefined,
        feedback: r.attempt.feedback,
        answers: (r.answerBreakdown || []).map((ans) => ({
          questionId: ans.questionId,
          questionTitle: ans.content,
          submittedAnswers: ans.submittedAnswers,
          awardedScore: ans.awardedScore,
          maxScore: ans.maxScore,
        })),
      }));

      const completedCount = relatedResults.filter((r) => r.attempt.status !== "IN_PROGRESS").length;
      const latestScore = attempts.length > 0 && attempts[attempts.length - 1] ? attempts[attempts.length - 1]!.score : undefined;
      const latestStatus = relatedResults.at(-1)?.attempt.status;

      return {
        id: exam.id,
        title: exam.title,
        type: "EXAM",
        durationMinutes: exam.durationMinutes,
        dueAt: exam.closeAt,
        status: latestStatus === "GRADED" ? "GRADED" : latestStatus === "SUBMITTED" ? "SUBMITTED" : "PENDING",
        score: latestScore,
        maxScore: Number(exam.totalScore),
        totalQuestions: exam.questionCount ?? exam.questionIds?.length,
        remainingAttempts: exam.remainingAttempts,
        attemptLimit: exam.attemptLimit,
        completedAttempts: completedCount,
        attempts: attempts,
        subtypeText: "Trắc nghiệm",
        scoringMethod: exam.attemptLimit && exam.attemptLimit > 1 ? "Điểm cao nhất" : "Lần đầu tiên",
      };
    });

    const dbAssigns: AssignmentItem[] = classAssignments.map((assign) => ({
      id: assign.id,
      title: assign.title,
      type: "ESSAY",
      dueAt: assign.dueAt,
      status:
        assign.submission?.status === "GRADED"
          ? "GRADED"
          : assign.submission
            ? "SUBMITTED"
            : "PENDING",
      score: assign.submission?.score !== null && assign.submission?.score !== undefined ? Number(assign.submission.score) : undefined,
      maxScore: Number(assign.maxScore),
      totalQuestions: 1,
      remainingAttempts: null,
      attemptLimit: 1,
      completedAttempts: assign.submission ? 1 : 0,
      attempts: assign.submission ? [
        {
          id: assign.submission.id,
          attemptNo: 1,
          score: assign.submission.score == null ? undefined : Number(assign.submission.score),
          maxScore: Number(assign.maxScore),
          submittedAt: assign.submission.submittedAt ? new Date(assign.submission.submittedAt).toLocaleDateString("vi-VN") : undefined,
          feedback: assign.submission.feedback,
        },
      ] : [],
      subtypeText: "Bài tập tự luận",
      scoringMethod: "Điểm đánh giá",
      createdAt: assign.createdAt ? new Date(assign.createdAt).toLocaleDateString("vi-VN") : undefined,
    }));

    return [...dbExams, ...dbAssigns];
  }, [classExams, classAssignments, learnerResults]);

  // State cho Bài giảng
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureSort, setLectureSort] = useState<"alpha" | "newest" | "type">("newest");
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [lectureFolderExpanded, setLectureFolderExpanded] = useState<Record<string, boolean>>({});

  // Danh sách bài giảng: 100% NẠP TỪ CSDL POSTGRESQL (TABLE MATERIAL CỦA LỚP)
  const lecturesList: LectureItem[] = useMemo(() => {
    const dbLectures: LectureItem[] = classMaterials
      .filter((mat) => {
        const mime = mat.mimeType || "";
        const tags = Array.isArray(mat.tags) ? mat.tags : [];
        return (
          tags.some((t) =>
            t.toLowerCase().includes("lecture") ||
            t.toLowerCase().includes("video") ||
            t.toLowerCase().includes("bài giảng"),
          ) ||
          mime.startsWith("video/") || mime.startsWith("audio/")
        );
      })
      .map((mat) => {
        const tags = Array.isArray(mat.tags) ? mat.tags : [];
        const descTag = tags.find((t) => t.startsWith("Mô tả: "));
        const youtubeTag = tags.find((t) => t.startsWith("youtube:"));
        const examIdTag = tags.find((t) => t.startsWith("attachedExamId:"));
        const examTitleTag = tags.find((t) => t.startsWith("attachedExamTitle:"));

        const mime = mat.mimeType.toLowerCase();
        const fileType: LectureItem["fileType"] = mime.includes("pdf") ? "pdf"
          : mime.includes("presentation") || mime.includes("powerpoint") ? "pptx"
            : mime.startsWith("audio/") ? "mp3" : mime.startsWith("video/") ? "mp4" : "other";

        return {
          id: mat.id,
          title: mat.name,
          fileType,
          teacher: teacherName,
          uploadedAt: mat.createdAt,
          folder: mat.folder || undefined,
          description: descTag?.replace("Mô tả: ", ""),
          youtubeId: youtubeTag ? youtubeTag.replace("youtube:", "") : undefined,
          attachedExamId: examIdTag ? examIdTag.replace("attachedExamId:", "") : undefined,
          attachedExamTitle: examTitleTag ? examTitleTag.replace("attachedExamTitle:", "") : undefined,
        };
      });

    return dbLectures;
  }, [classMaterials, teacherName]);

  // State cho Tài liệu
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialSort, setMaterialSort] = useState<"alpha" | "newest" | "type">("alpha");
  const [selectedMaterialFolder, setSelectedMaterialFolder] = useState<string>("__ALL__");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialFolderExpanded, setMaterialFolderExpanded] = useState<Record<string, boolean>>({});
  const [isMaterialDetailExpanded, setIsMaterialDetailExpanded] = useState<boolean>(true);

  // Danh sách tài liệu: 100% NẠP TỪ CSDL POSTGRESQL (TABLE MATERIAL CỦA LỚP)
  const materialsList: MaterialItem[] = useMemo(() => {
    const dbMats: MaterialItem[] = classMaterials.map((mat) => {
      const isPdf = (mat.mimeType || "").includes("pdf");
      const isDoc =
        (mat.mimeType || "").includes("word") ||
        (mat.mimeType || "").includes("document");
      const isXlsx =
        (mat.mimeType || "").includes("sheet") ||
        (mat.mimeType || "").includes("excel");
      const fileType = isPdf
        ? "pdf"
        : isDoc
          ? "doc"
          : isXlsx
            ? "xlsx"
            : mat.name.split(".").at(-1)?.toLowerCase() || "file";
      const sizeMb = mat.sizeBytes / (1024 * 1024);
      return {
        id: mat.id,
        title: mat.name,
        fileType,
        size: sizeMb >= 1 ? `${sizeMb.toFixed(1)} MB` : `${Math.round(sizeMb * 1024)} KB`,
        uploadedAt: mat.createdAt,
        folder: mat.folder || undefined,
      };
    });

    return dbMats;
  }, [classMaterials]);

  // Danh sách thành viên lớp học
  const membersList = useMemo(
    () => [
      ...displayInstructors.map((instructor) => ({
        id: instructor.id,
        name: instructor.name,
        role: "Giáo viên",
        email: instructor.email,
        isTeacher: true,
      })),
      ...item.learnerIds.map((id) => ({
        id,
        name: id === session.user.id ? session.user.name : `Học viên ${id}`,
        role: "Học sinh",
        email: id === session.user.id ? session.user.email : undefined,
        isTeacher: false,
      })),
    ],
    [displayInstructors, item.learnerIds, session.user.id, session.user.name, session.user.email],
  );

  /** Kích hoạt mở Chat Mini Size trực tiếp với một thành viên */
  const handleOpenChatWithMember = (member: { id: string; name: string; role: string }) => {
    window.dispatchEvent(
      new CustomEvent("open-mini-chat", {
        detail: {
          id: member.id,
          name: member.name,
          role: member.role === "Giáo viên" ? "INSTRUCTOR" : "LEARNER",
        },
      }),
    );
  };

  // Danh sách các thư mục bài tập động
  const assignmentFolders = useMemo(() => {
    return getLearnerFolderNames(assignmentsList);
  }, [assignmentsList]);

  // Lọc và sắp xếp Bài tập theo Thư mục, Tìm kiếm và Sắp xếp
  const filteredAssignments = useMemo(() => {
    return filterLearnerAssignments(assignmentsList, selectedAssignmentFolder, assignmentSearch, assignmentSort);
  }, [assignmentsList, selectedAssignmentFolder, assignmentSearch, assignmentSort]);

  // Bài tập đang được chọn để hiển thị chi tiết ở Cột 3
  const activeAssignment = useMemo(() => {
    if (filteredAssignments.length === 0) return null;
    return filteredAssignments.find((a) => a.id === selectedAssignmentId) || filteredAssignments[0];
  }, [filteredAssignments, selectedAssignmentId]);

  // Danh sách các thư mục bài giảng động
  const lectureFolders = useMemo(() => {
    return getLearnerFolderNames(lecturesList);
  }, [lecturesList]);

  // Lọc và sắp xếp Bài giảng theo Thư mục, Tìm kiếm và Sắp xếp
  const filteredLectures = useMemo(() => {
    return filterLearnerFiles(lecturesList, selectedLectureFolder, lectureSearch, lectureSort);
  }, [lecturesList, selectedLectureFolder, lectureSearch, lectureSort]);

  // Bài giảng đang được chọn ở Cột 3
  const activeLectureItem = useMemo(() => {
    if (filteredLectures.length === 0) return null;
    return filteredLectures.find((l) => l.id === selectedLectureId) || filteredLectures[0];
  }, [filteredLectures, selectedLectureId]);

  // Danh sách các thư mục tài liệu động
  const materialFolders = useMemo(() => {
    return getLearnerFolderNames(materialsList);
  }, [materialsList]);

  // Lọc và sắp xếp Tài liệu theo Thư mục, Tìm kiếm và Sắp xếp
  const filteredMaterials = useMemo(() => {
    return filterLearnerFiles(materialsList, selectedMaterialFolder, materialSearch, materialSort);
  }, [materialsList, selectedMaterialFolder, materialSearch, materialSort]);

  // Tài liệu đang được chọn ở Cột 3
  const activeMaterialItem = useMemo(() => {
    if (filteredMaterials.length === 0) return null;
    return filteredMaterials.find((m) => m.id === selectedMaterialId) || filteredMaterials[0];
  }, [filteredMaterials, selectedMaterialId]);

  // Dùng cùng hộp làm bài cho trang chi tiết bài giảng và trang lớp học.
  const examTakingModal = activeExamForTaking && (
    <ExamTakingModal
      open={Boolean(activeExamForTaking)}
      onClose={() => {
        setActiveExamForTaking(null);
        void loadClassData();
      }}
      exam={activeExamForTaking}
      onSubmitted={() => {
        void loadClassData();
      }}
    />
  );

  // Dùng cùng thông báo nội bộ ở cả hai chế độ xem của lớp học.
  const toastNotification = toast && (
    <aside
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200"
    >
      <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/95 dark:bg-slate-800/95 text-white shadow-2xl border border-slate-700/80 backdrop-blur-md max-w-md">
        <div
          className={`size-8 rounded-xl flex items-center justify-center shrink-0 ${
            toast.type === "warning"
              ? "bg-amber-500/20 text-amber-400"
              : toast.type === "success"
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-blue-500/20 text-blue-400"
          }`}
        >
          {toast.type === "warning" ? <AlertCircle size={18} /> : <Info size={18} />}
        </div>
        <p className="text-xs font-semibold text-slate-100 leading-snug flex-1">
          {toast.message}
        </p>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              setToast(null);
            }}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-xs"
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={() => setToast(null)}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          aria-label="Đóng thông báo"
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );

  // TRANG CHI TIẾT XEM BÀI GIẢNG (THEO MÔ TẢ VÀ ẢNH MINH HỌA CỦA NGƯỜI DÙNG)
  if (selectedLectureForPage) {
    const lecturePlaylist = lecturesList.filter(
      (l) => lecturePageFolder === "__ALL__" || l.folder === lecturePageFolder,
    );
    const lectureAttachedAssignments = assignmentsList.filter((assignment) =>
      (selectedLectureForPage.attachedExamId && assignment.id === selectedLectureForPage.attachedExamId) ||
      (selectedLectureForPage.attachedExamTitle && assignment.title === selectedLectureForPage.attachedExamTitle),
    );

    return (
      <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
        {/* KHUNG BỐ CỤC 3 CỘT: CỘT TRÁI HEADER DỌC, Ở GIỮA BÀI GIẢNG & BÀI TẬP ĐÍNH KÈM, CỘT PHẢI THƯ MỤC & PLAYLIST */}
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* CỘT 1: HEADER DỌC LỚP HỌC (THEO ẢNH MINH HỌA) */}
          <aside className="w-full lg:w-56 shrink-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-4">
              <div>
                <button
                  type="button"
                  onClick={() => setSelectedLectureForPage(null)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors mb-3 cursor-pointer"
                >
                  <ArrowLeft size={14} />
                  <span>Quay lại bài giảng</span>
                </button>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                  {item.name || item.code}
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code}</strong>
                </p>
              </div>

              {/* Chia sẻ lớp học */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Chia sẻ lớp học
                </span>
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate flex-1 font-mono">
                    {typeof window !== "undefined" ? `${window.location.origin}/classes/${item.id}` : `/classes/${item.id}`}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await copyTextToClipboard(window.location.href);
                      } catch {
                        notify("Không thể sao chép liên kết lớp học.", "error");
                      }
                    }}
                    className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                    title="Sao chép link"
                  >
                    <Share2 size={13} />
                  </button>
                </div>
              </div>

              {/* Mô tả cho lớp học */}
              <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                <span>Mô tả cho lớp học</span>
                <span className="text-blue-600 font-bold cursor-pointer hover:underline">+ Thêm</span>
              </div>

              {/* Danh mục các chức năng con */}
              <LectureSidebarNavigation onSelectTab={(tab) => {
                setSelectedLectureForPage(null);
                handleSelectTab(tab);
              }} />
            </div>
          </aside>

          {/* CỘT 2: Ở GIỮA - BÀI GIẢNG, MÔ TẢ, BÀI TẬP & TÀI LIỆU ĐÍNH KÈM */}
          <main className="flex-1 min-w-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              {/* Header: Nút quay lại + Tên bài giảng + Ngày đăng (Không có thống kê đã xem/chưa xem) */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedLectureForPage(null)}
                  className="inline-flex items-center gap-2 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors cursor-pointer min-w-0"
                >
                  <ArrowLeft size={18} className="shrink-0 text-slate-500" />
                  <span className="truncate">{selectedLectureForPage.title}</span>
                </button>
                <div className="text-xs text-slate-400 shrink-0 font-medium">
                  {selectedLectureForPage.uploadedAt}
                </div>
              </div>

              {/* Khung phát bài giảng (Player 16:9 YouTube/Video hoặc Trình xem slide/phiếu bài tập) */}
              {selectedLectureForPage.youtubeId && /^[A-Za-z0-9_-]{11}$/.test(selectedLectureForPage.youtubeId) ? (
                <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-lg border border-slate-200 dark:border-slate-800">
                  <iframe
                    src={`https://www.youtube.com/embed/${selectedLectureForPage.youtubeId}?autoplay=0&rel=0`}
                    className="w-full h-full border-0"
                    title={selectedLectureForPage.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="w-full aspect-video rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <FileText size={38} className="text-blue-500" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{selectedLectureForPage.title}</p>
                  <button type="button" onClick={() => previewClassMaterial(selectedLectureForPage.id, selectedLectureForPage.title)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
                    Xem học liệu
                  </button>
                </div>
              )}

                            {/* Phần Mô tả bài giảng */}
              <div className="space-y-1.5 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Mô tả
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {selectedLectureForPage.description || "Bài giảng không có mô tả nào."}
                </p>
              </div>

              {/* Phần Bài tập & Tài liệu đính kèm (chuẩn Ảnh 2 của người dùng) */}
              <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Bài tập & tài liệu đính kèm
                </span>

                {lectureAttachedAssignments.map((assignment) => (
                  <button key={assignment.id} type="button" onClick={() => openAssignment(assignment)} className="w-full flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 transition-colors text-left">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{assignment.title}</span>
                    <ArrowRight size={16} className="text-blue-600" />
                  </button>
                ))}
                {lectureAttachedAssignments.length === 0 && <p className="text-xs text-slate-500">Chưa có bài tập đính kèm.</p>}
              </div>
            </div>
          </main>

          {/* CỘT 3: CỘT PHẢI - Ở TRÊN LÀ THƯ MỤC, Ở DƯỚI LÀ CÁC BÀI GIẢNG CỦA THƯ MỤC ĐÃ CHỌN */}
          <aside className="w-full lg:w-80 shrink-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
              {/* Bên trên: Thư mục */}
              <div className="space-y-1.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Folder size={15} className="text-blue-600 fill-blue-500/20" />
                  <span>Thư mục bài giảng</span>
                </div>
                <select
                  value={lecturePageFolder}
                  onChange={(e) => setLecturePageFolder(e.target.value)}
                  className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <option value="__ALL__">Tất cả bài giảng</option>
                  {lectureFolders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              {/* Bên dưới: Các bài giảng của thư mục đã chọn (Playlist) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span className="font-bold text-slate-800 dark:text-slate-200 truncate">
                    {lecturePageFolder === "__ALL__" ? "Tất cả bài giảng" : lecturePageFolder}
                  </span>
                  <span>{lecturePlaylist.length} bài giảng</span>
                </div>

                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
                  {lecturePlaylist.map((lec) => {
                    const isPlaying = lec.id === selectedLectureForPage.id;
                    return (
                      <div
                        key={lec.id}
                        onClick={() => setSelectedLectureForPage(lec)}
                        className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                          isPlaying
                            ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-500 dark:border-blue-400 shadow-2xs"
                            : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-slate-700"
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="relative w-20 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0 border border-slate-200 dark:border-slate-800">
                          {lec.youtubeId ? (
                            <img
                              src={`https://img.youtube.com/vi/${lec.youtubeId}/mqdefault.jpg`}
                              alt={lec.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-purple-900/60 text-purple-300">
                              <Video size={16} />
                            </div>
                          )}
                          {isPlaying && (
                            <div className="absolute inset-0 bg-blue-600/40 grid place-items-center">
                              <Play size={14} className="text-white fill-white animate-pulse" />
                            </div>
                          )}
                        </div>

                        {/* Thông tin bài giảng */}
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <strong
                            className={`text-xs font-bold block truncate ${
                              isPlaying
                                ? "text-blue-700 dark:text-blue-400"
                                : "text-slate-900 dark:text-slate-100"
                            }`}
                          >
                            {lec.title}
                          </strong>
                          <p className="text-[10px] text-slate-400 truncate">
                            {lec.fileType === "mp4" ? "Video bài giảng" : "Tài liệu học tập"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* MODAL LÀM BÀI KIỂM TRA TRONG TRANG BÀI GIẢNG */}
        {examTakingModal}

        {/* THÔNG BÁO TOAST NỘI BỘ THAY THẾ TOÀN BỘ POPUP NATIVE */}
        {toastNotification}
      </div>
    );
  }

  return (
    <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
      {/* KHUNG BỐ CỤC LỚP HỌC 2 CỘT PHONG CÁCH SHUB (GIẢM 35% CHIỀU NGANG THANH DỌC) */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* CỘT DỌC BÊN TRÁI: SIDEBAR LỚP HỌC (ĐÃ GIẢM CHIỀU NGANG 35% XUỐNG W-52) */}
        <aside className="w-full lg:w-52 shrink-0 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs">
            {/* Nút quay lại danh sách lớp */}
            <button
              type="button"
              onClick={onBack || (() => router.push("/courses"))}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors mb-3"
            >
              <ArrowLeft size={14} />
              <span>Quay lại danh sách lớp</span>
            </button>

            {/* Thông tin lớp học */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 line-clamp-1" title={item.name || item.code}>
                {item.name || item.code}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code}</strong>
              </p>

              {/* Danh sách giáo viên phụ trách (hỗ trợ hiển thị 2 giáo viên kèm avatar thật) */}
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/60 space-y-2">
                <span className="text-[9px] uppercase font-bold text-slate-400 block leading-tight">
                  {displayInstructors.length > 1 ? "Giảng viên phụ trách (2)" : "Giáo viên phụ trách"}
                </span>
                {displayInstructors.map((teacher) => (
                  <div key={teacher.id} className="flex items-center gap-2">
                    <UserAvatar
                      avatarUrl={teacher.avatarUrl}
                      name={teacher.name}
                      className="size-7 rounded-full text-[10px]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate" title={teacher.name}>
                        {teacher.name}
                      </p>
                      <span className="text-[10px] text-slate-400 font-medium block leading-tight">
                        {teacher.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Danh mục 6 chức năng con */}
            <nav className="space-y-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
                Danh mục
              </p>
              {[
                { id: "feed" as const, label: "Bảng tin", icon: MessageSquare },
                { id: "schedule" as const, label: "Lịch học", icon: CalendarDays },
                { id: "members" as const, label: "Thành viên", icon: Users },
                { id: "assignments" as const, label: "Bài tập", icon: FileText },
                { id: "lectures" as const, label: "Bài giảng", icon: Video },
                { id: "materials" as const, label: "Tài liệu", icon: Folder },
              ].map(({ id, label, icon: Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectTab(id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left ${
                      active
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-blue-600 dark:text-blue-400" : "text-slate-400"} />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* CỘT NỘI DUNG CHÍNH BÊN PHẢI (THEO TỪNG TAB CON) */}
        <main className="flex-1 min-w-0 space-y-5">
          {dataLoadError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <span>{dataLoadError}</span>
              <button type="button" onClick={() => void loadClassData()} className="rounded-lg border border-current px-3 py-1 font-semibold hover:opacity-80">Tải lại</button>
            </div>
          )}
          {/* ================= TAB 1: BẢNG TIN LỚP HỌC (FACEBOOK STYLE VỚI BÌNH LUẬN ĐA TẦNG) ================= */}
          {activeTab === "feed" && (
            <ClassFeedView
              classItem={item}
              courseName={course?.name}
              teacherName={teacherName}
            />
          )}

          {/* ================= TAB 2: LỊCH HỌC LỚP NÀY (DẠNG TUẦN & DẠNG THÁNG) ================= */}
          {activeTab === "schedule" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Lịch học của {item.name || item.code}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Theo dõi các ca học và thời khóa biểu của lớp học.
                  </p>
                </div>

                {/* Nút chuyển đổi: Dạng tuần (Lưới) & Dạng tháng (Danh sách) */}
                <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setScheduleView("week")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      scheduleView === "week"
                        ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    <LayoutGrid size={14} />
                    <span>Dạng tuần (Lưới)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleView("month")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      scheduleView === "month"
                        ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    <List size={14} />
                    <span>Dạng tháng (Danh sách)</span>
                  </button>
                </div>
              </div>

              {classSessions.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Lớp chưa có buổi học trực tuyến nào.</p>
              ) : scheduleView === "week" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2">
                  {Array.from({ length: 7 }, (_, index) => {
                    const day = new Date();
                    day.setHours(0, 0, 0, 0);
                    day.setDate(day.getDate() - ((day.getDay() + 6) % 7) + index);
                    const daySessions = classSessions.filter((entry) => new Date(entry.startsAt).toDateString() === day.toDateString());
                    return (
                      <div key={day.toISOString()} className="p-3 rounded-xl border bg-slate-50/60 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800 min-h-36">
                        <div className="flex justify-between border-b border-slate-200 dark:border-slate-700 pb-2 mb-2">
                          <span className="text-xs font-bold">{day.toLocaleDateString("vi-VN", { weekday: "long" })}</span>
                          <span className="text-[10px] text-slate-500">{day.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</span>
                        </div>
                        {daySessions.length === 0 ? <p className="text-[11px] text-slate-400 italic text-center pt-4">Không có lịch</p> : (
                          <div className="space-y-3">
                            {daySessions.map((entry) => (
                              <div key={entry.id} className="space-y-1">
                                <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{entry.title}</p>
                                <p className="text-[10px] text-slate-500">
                                  {new Date(entry.startsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} – {new Date(entry.endsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                </p>
                                <p className="text-[10px] text-slate-500">{entry.status}</p>
                                {entry.status === "LIVE" && <button type="button" onClick={() => void joinClassSession(entry)} className="w-full rounded-lg bg-blue-600 px-2 py-1 text-[10px] font-bold text-white">Vào phòng</button>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {[...classSessions].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).map((entry) => (
                    <div key={entry.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 gap-3">
                      <div className="space-y-1">
                        <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">{entry.title}</strong>
                        <p className="text-xs text-slate-500">
                          {new Date(entry.startsAt).toLocaleString("vi-VN")} – {new Date(entry.endsAt).toLocaleString("vi-VN")} · {entry.status}
                        </p>
                      </div>
                      {entry.status === "LIVE" && <button type="button" onClick={() => void joinClassSession(entry)} className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Vào phòng học</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ================= TAB 3: THÀNH VIÊN (KÈM NÚT CHAT CẠNH TỪNG NGƯỜI) ================= */}
          {activeTab === "members" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Thành viên lớp ({membersList.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Danh sách giáo viên phụ trách và học sinh trong lớp. Nhấn nút Nhắn tin để trò chuyện trực tiếp.
                </p>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {membersList.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`size-10 rounded-full grid place-items-center text-xs font-bold text-white shrink-0 ${
                        member.isTeacher
                          ? "bg-gradient-to-tr from-purple-600 to-indigo-600"
                          : "bg-gradient-to-tr from-blue-600 to-cyan-500"
                      }`}>
                        {member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {member.name}
                          </strong>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            member.isTeacher
                              ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          }`}>
                            {member.role}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">{member.email}</p>
                      </div>
                    </div>

                    {/* NÚT CHAT CẠNH TỪNG NGƯỜI ĐỂ MỞ MINI CHAT */}
                    <button
                      type="button"
                      onClick={() => handleOpenChatWithMember(member)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                      title={`Nhắn tin với ${member.name}`}
                    >
                      <MessageCircle size={14} />
                      <span className="hidden sm:inline">Nhắn tin</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================= TAB 4: BÀI TẬP & ĐỀ KIỂM TRA (3 CỘT MASTER-DETAIL THEO THƯ MỤC) ================= */}
          {activeTab === "assignments" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              {/* Header tiêu đề danh mục */}
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài tập
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Danh sách bài tập và đề kiểm tra phân bổ theo cấu trúc thư mục môn học.
                  </p>
                </div>
              </div>

              {/* Khung 3 cột Master-Detail */}
              <div className="flex flex-col lg:flex-row min-h-[580px]">
                {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                    <span>Thư mục</span>
                    <SlidersHorizontal size={14} className="text-slate-400" />
                  </div>

                  <div className="space-y-1">
                    {/* Thư mục gốc: Tất cả bài tập */}
                    <button
                      type="button"
                      onClick={() => setSelectedAssignmentFolder("__ALL__")}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                        selectedAssignmentFolder === "__ALL__"
                          ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <Folder
                        size={16}
                        className={
                          selectedAssignmentFolder === "__ALL__"
                            ? "text-blue-600 fill-blue-500/20"
                            : "text-slate-400"
                        }
                      />
                      <span className="truncate">Tất cả bài tập</span>
                    </button>

                    {/* Các thư mục môn học / chương con */}
                    {assignmentFolders.map((folderName) => (
                      <ClassFolderEntry
                        key={folderName}
                        name={folderName}
                        expanded={assignmentFolderExpanded[folderName] ?? true}
                        selected={selectedAssignmentFolder === folderName}
                        onSelect={() => setSelectedAssignmentFolder(folderName)}
                        onToggle={() => setAssignmentFolderExpanded((prev) => ({ ...prev, [folderName]: !(assignmentFolderExpanded[folderName] ?? true) }))}
                      />
                    ))}
                  </div>
                </div>

                {/* CỘT 2: DANH SÁCH BÀI TẬP (FLEX-1) */}
                <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                  {/* Thanh tìm kiếm & Dropdown sắp xếp */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={assignmentSearch}
                        onChange={(e) => setAssignmentSearch(e.target.value)}
                        placeholder="Tìm kiếm bài tập..."
                        className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                      />
                      <Search
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>

                    <div className="relative">
                      <select
                        value={assignmentSort}
                        onChange={(e) => setAssignmentSort(e.target.value as "alpha" | "newest" | "due")}
                        className="appearance-none py-1.5 pl-3 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="newest">Mới nhất</option>
                        <option value="alpha">Tên A-Z</option>
                        <option value="due">Hạn nộp</option>
                      </select>
                      <ChevronDown
                        size={13}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                  </div>

                  {/* Danh sách thẻ bài tập */}
                  <div className="space-y-2">
                    {filteredAssignments.length === 0 ? (
                      <div className="py-12 text-center space-y-2">
                        <Folder size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                        <p className="text-xs text-slate-400">Không có bài tập nào trong thư mục này</p>
                      </div>
                    ) : (
                      filteredAssignments.map((assign) => {
                        const isSelected = (activeAssignment?.id || filteredAssignments[0]?.id) === assign.id;
                        const scorePercent =
                          assign.score !== undefined && assign.maxScore && assign.maxScore > 0
                            ? Math.max(0, Math.min(100, Math.round((assign.score / assign.maxScore) * 100)))
                            : 0;
                        return (
                          <div
                            key={assign.id}
                            onClick={() => setSelectedAssignmentId(assign.id)}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-sky-50/85 dark:bg-blue-950/40 border-blue-400 dark:border-blue-500 shadow-2xs"
                                : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                              {/* Icon W xanh dương bo góc */}
                              <div className="size-8 rounded-lg bg-blue-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                                W
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                  {assign.title}
                                </strong>
                                {/* Thanh tiến độ đổi màu theo điểm */}
                                <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${getScoreTheme(assign.score).barColor}`}
                                    style={{ width: `${scorePercent}%` }}
                                  />
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {assign.subtypeText ||
                                    (assign.type === "EXAM"
                                      ? "Trắc nghiệm tách câu"
                                      : "Bài tập tự luận")}
                                </p>
                              </div>
                            </div>

                            {/* Điểm số hoặc nhãn trạng thái */}
                            <div className="shrink-0 text-right">
                              {assign.score !== undefined ? (
                                <span className={`text-xs ${getScoreTheme(assign.score).textColor}`}>
                                  {assign.score.toFixed(1)}{assign.maxScore !== undefined ? `/${assign.maxScore}` : ""} điểm
                                </span>
                              ) : (
                                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                                  {assign.status === "SUBMITTED" ? "Đã nộp, chờ chấm" : assign.status === "GRADED" ? "Đã chấm" : "Chưa làm"}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* CỘT 3: CHI TIẾT BÀI TẬP (~320px) */}
                <div className="w-full lg:w-80 shrink-0 p-4 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                  {activeAssignment ? (
                    <div className="space-y-4">
                      {/* Khối màu điểm số theo dải điểm (đã bỏ icon emoji theo yêu cầu) */}
                      <div
                        className={`rounded-xl py-2.5 px-4 flex items-center justify-center transition-all ${
                          getScoreTheme(activeAssignment.score).badgeBg
                        }`}
                      >
                        <span className="text-sm font-bold tracking-wide">
                          {activeAssignment.score === undefined && activeAssignment.status === "SUBMITTED"
                            ? "Đã nộp, chờ chấm"
                            : getScoreTheme(activeAssignment.score).label}
                        </span>
                      </div>

                      {/* Tiêu đề bài tập */}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {activeAssignment.title}
                        </h4>
                      </div>

                      {/* Bảng thông số chi tiết */}
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Số lần làm bài</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeAssignment.attemptLimit ?? "Không giới hạn"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Đã làm</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeAssignment.completedAttempts ?? 0}
                            {activeAssignment.attemptLimit !== undefined ? `/${activeAssignment.attemptLimit}` : ""}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Lấy điểm</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeAssignment.scoringMethod || "Chưa có thông tin"}
                          </span>
                        </div>
                        <div className="flex items-start justify-between gap-2 text-slate-600 dark:text-slate-300">
                          <span className="shrink-0">Loại</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 text-right">
                            {activeAssignment.subtypeText || (activeAssignment.type === "EXAM" ? "Trắc nghiệm" : "Tự luận")}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Ngày tạo</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeAssignment.createdAt || "Chưa có thông tin"}
                          </span>
                        </div>
                      </div>

                      {/* Nút thu gọn / mở rộng icon chevron */}
                      <div className="flex justify-center pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setIsAssignmentDetailExpanded(!isAssignmentDetailExpanded)
                          }
                          className="p-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform duration-150 ${
                              isAssignmentDetailExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </div>

                      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between">
                        {/* NÚT CHI TIẾT: Xem lại bài làm nếu 1 lần nộp, hoặc mở lịch sử nếu nhiều lần nộp */}
                        <button
                          type="button"
                          onClick={() => {
                            if (activeAssignment.type === "ESSAY") {
                              openAssignment(activeAssignment);
                              return;
                            }
                            const attempts = activeAssignment.attempts || [];
                            if (attempts.length === 1 && attempts[0]) {
                              setSelectedAttemptForReview({
                                examTitle: activeAssignment.title,
                                attempt: attempts[0],
                              });
                            } else if (attempts.length > 1) {
                              setHistoryAssignment(activeAssignment);
                              setIsHistoryModalOpen(true);
                            } else {
                              showToast("Bạn chưa nộp lượt làm bài nào cho bài tập này.", {
                                type: "info",
                                actionLabel: "Làm bài ngay",
                                onAction: () => openAssignment(activeAssignment),
                              });
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <span>Chi tiết</span>
                          <ArrowRight size={14} />
                        </button>

                        {/* NÚT LÀM BÀI: Để học sinh bắt đầu làm bài kiểm tra */}
                        {activeAssignment.remainingAttempts === 0 || (activeAssignment.type === "ESSAY" && (
                          classAssignments.find((item) => item.id === activeAssignment.id)?.submission?.status === "GRADED" ||
                          (activeAssignment.dueAt ? new Date(activeAssignment.dueAt).getTime() < Date.now() : false)
                        )) ? (
                          <button
                            type="button"
                            disabled
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold cursor-not-allowed opacity-80"
                          >
                            <Lock size={13} />
                            <span>{activeAssignment.type === "ESSAY" ? "Đã đóng nộp bài" : "Hết lượt làm"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openAssignment(activeAssignment)}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            <Play size={13} />
                            <span>{activeAssignment.type === "ESSAY" ? (activeAssignment.completedAttempts ? "Sửa bài nộp" : "Nộp bài") : "Làm bài"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Chọn một bài tập để xem chi tiết
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 5: BÀI GIẢNG (3 CỘT MASTER-DETAIL THEO THƯ MỤC) ================= */}
          {activeTab === "lectures" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              {/* Header tiêu đề danh mục */}
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Bài giảng
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Video bài học chuyên đề, slide trình chiếu và audio ghi âm theo chương mục.
                  </p>
                </div>
              </div>

              {/* Khung 3 cột Master-Detail */}
              <div className="flex flex-col lg:flex-row min-h-[580px]">
                {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                    <span>Thư mục</span>
                    <SlidersHorizontal size={14} className="text-slate-400" />
                  </div>

                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setSelectedLectureFolder("__ALL__")}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                        selectedLectureFolder === "__ALL__"
                          ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <Folder
                        size={16}
                        className={
                          selectedLectureFolder === "__ALL__"
                            ? "text-blue-600 fill-blue-500/20"
                            : "text-slate-400"
                        }
                      />
                      <span className="truncate">Tất cả bài giảng</span>
                    </button>

                    {lectureFolders.map((folderName) => (
                      <ClassFolderEntry
                        key={folderName}
                        name={folderName}
                        expanded={lectureFolderExpanded[folderName] ?? true}
                        selected={selectedLectureFolder === folderName}
                        onSelect={() => setSelectedLectureFolder(folderName)}
                        onToggle={() => setLectureFolderExpanded((prev) => ({ ...prev, [folderName]: !(lectureFolderExpanded[folderName] ?? true) }))}
                      />
                    ))}
                  </div>
                </div>

                {/* CỘT 2: DANH SÁCH BÀI GIẢNG (FLEX-1) */}
                <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={lectureSearch}
                        onChange={(e) => setLectureSearch(e.target.value)}
                        placeholder="Tìm kiếm bài giảng..."
                        className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                      />
                      <Search
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>

                    <div className="relative">
                      <select
                        value={lectureSort}
                        onChange={(e) => setLectureSort(e.target.value as "alpha" | "newest" | "type")}
                        className="appearance-none py-1.5 pl-3 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="newest">Mới nhất</option>
                        <option value="alpha">Tên A-Z</option>
                        <option value="type">Loại tệp</option>
                      </select>
                      <ChevronDown
                        size={13}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {filteredLectures.length === 0 ? (
                      <div className="py-12 text-center space-y-2">
                        <Video size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                        <p className="text-xs text-slate-400">Không có bài giảng nào trong thư mục này</p>
                      </div>
                    ) : (
                      filteredLectures.map((lec) => {
                        const isSelected = (activeLectureItem?.id || filteredLectures[0]?.id) === lec.id;
                        return (
                          <div
                            key={lec.id}
                            onClick={() => setSelectedLectureId(lec.id)}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-purple-50/70 dark:bg-purple-950/30 border-purple-400 dark:border-purple-500 shadow-2xs"
                                : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-purple-300 dark:hover:border-purple-800"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                              <div className={`size-8 rounded-lg text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs ${
                                lec.fileType === "mp4"
                                  ? "bg-purple-600"
                                  : lec.fileType === "mp3"
                                    ? "bg-amber-600"
                                    : "bg-rose-600"
                              }`}>
                                {lec.fileType}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                  {lec.title}
                                </strong>
                                {lec.progressPercent !== undefined && (
                                  <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-purple-500 rounded-full" style={{ width: `${lec.progressPercent}%` }} />
                                  </div>
                                )}
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {lec.duration ? `${lec.duration} · ` : ""}GV: {lec.teacher}
                                </p>
                              </div>
                            </div>

                            {lec.progressPercent !== undefined && (
                              <div className="shrink-0 text-right">
                                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">{lec.progressPercent}% đã xem</span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* CỘT 3: CHI TIẾT BÀI GIẢNG (~320px) - Chỉ hiển thị Tên bài giảng, Mô tả ngắn gọn và Ngày đăng */}
                <div className="w-full lg:w-80 shrink-0 p-5 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                  {activeLectureItem ? (
                    <div className="space-y-4">
                      {/* Tiêu đề bài giảng */}
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 block">
                          Bài giảng
                        </span>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                          {activeLectureItem.title}
                        </h4>
                      </div>

                      {/* Mô tả (hiển thị ngắn gọn) */}
                      <div className="p-3.5 rounded-xl bg-white dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800 space-y-1 shadow-2xs">
                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">
                          Mô tả
                        </span>
                        <p className="text-xs text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
                          {activeLectureItem.description || "Bài giảng không có mô tả nào."}
                        </p>
                      </div>

                      {/* Ngày đăng */}
                      <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 py-1.5 border-t border-b border-slate-200/60 dark:border-slate-800/60">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={13} className="text-slate-400" />
                          <span>Ngày đăng</span>
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {new Date(activeLectureItem.uploadedAt).toLocaleDateString("vi-VN")}
                        </span>
                      </div>

                      {/* Nút Xem bài giảng: Mở trang chi tiết bài giảng */}
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => setSelectedLectureForPage(activeLectureItem)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          <Play size={14} />
                          <span>Xem bài giảng</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Chọn một bài giảng để xem thông tin
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ================= TAB 6: TÀI LIỆU (3 CỘT MASTER-DETAIL THEO THƯ MỤC) ================= */}
          {activeTab === "materials" && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
              {/* Header tiêu đề danh mục */}
              <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Tài liệu
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục chuyên đề.
                  </p>
                </div>
              </div>

              {/* Khung 3 cột Master-Detail */}
              <div className="flex flex-col lg:flex-row min-h-[580px]">
                {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
                <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                    <span>Thư mục</span>
                    <SlidersHorizontal size={14} className="text-slate-400" />
                  </div>

                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setSelectedMaterialFolder("__ALL__")}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left cursor-pointer ${
                        selectedMaterialFolder === "__ALL__"
                          ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                          : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                      }`}
                    >
                      <Folder
                        size={16}
                        className={
                          selectedMaterialFolder === "__ALL__"
                            ? "text-blue-600 fill-blue-500/20"
                            : "text-slate-400"
                        }
                      />
                      <span className="truncate">Tất cả tài liệu</span>
                    </button>

                    {materialFolders.map((folderName) => (
                      <ClassFolderEntry
                        key={folderName}
                        name={folderName}
                        expanded={materialFolderExpanded[folderName] ?? true}
                        selected={selectedMaterialFolder === folderName}
                        onSelect={() => setSelectedMaterialFolder(folderName)}
                        onToggle={() => setMaterialFolderExpanded((prev) => ({ ...prev, [folderName]: !(materialFolderExpanded[folderName] ?? true) }))}
                      />
                    ))}
                  </div>
                </div>

                {/* CỘT 2: DANH SÁCH TÀI LIỆU (FLEX-1) */}
                <div className="flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={materialSearch}
                        onChange={(e) => setMaterialSearch(e.target.value)}
                        placeholder="Tìm kiếm tài liệu..."
                        className="w-full pl-3 pr-8 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:border-blue-500"
                      />
                      <Search
                        size={14}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>

                    <div className="relative">
                      <select
                        value={materialSort}
                        onChange={(e) => setMaterialSort(e.target.value as "alpha" | "newest" | "type")}
                        className="appearance-none py-1.5 pl-3 pr-7 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="alpha">Tên A-Z</option>
                        <option value="type">Theo loại tệp</option>
                        <option value="newest">Mới nhất</option>
                      </select>
                      <ChevronDown
                        size={13}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {filteredMaterials.length === 0 ? (
                      <div className="py-12 text-center space-y-2">
                        <Folder size={32} className="mx-auto text-slate-300 dark:text-slate-600" />
                        <p className="text-xs text-slate-400">Không có tài liệu nào trong thư mục này</p>
                      </div>
                    ) : (
                      filteredMaterials.map((mat) => {
                        const isSelected = (activeMaterialItem?.id || filteredMaterials[0]?.id) === mat.id;
                        return (
                          <div
                            key={mat.id}
                            onClick={() => setSelectedMaterialId(mat.id)}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-500 shadow-2xs"
                                : "bg-white dark:bg-slate-900/60 border-slate-200/80 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-800"
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1 pr-3">
                              <div className={`size-8 rounded-lg text-white font-bold text-xs uppercase flex items-center justify-center shrink-0 shadow-xs ${
                                mat.fileType === "pdf"
                                  ? "bg-rose-600"
                                  : mat.fileType === "xlsx"
                                    ? "bg-emerald-600"
                                    : "bg-blue-600"
                              }`}>
                                {mat.fileType}
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 block truncate">
                                  {mat.title}
                                </strong>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {mat.size ? `${mat.size} · ` : ""}Tải lên {new Date(mat.uploadedAt).toLocaleDateString("vi-VN")}
                                </p>
                              </div>
                            </div>

                            {mat.downloadsCount !== undefined && (
                              <div className="shrink-0 text-right">
                                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                  {mat.downloadsCount} lượt tải
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* CỘT 3: CHI TIẾT TÀI LIỆU (~320px) */}
                <div className="w-full lg:w-80 shrink-0 p-4 space-y-4 bg-slate-50/20 dark:bg-slate-900/20 flex flex-col justify-between">
                  {activeMaterialItem ? (
                    <div className="space-y-4">
                      {/* Banner đen bo góc */}
                      <div className="rounded-xl bg-slate-800 text-white py-2.5 px-4 flex items-center justify-center gap-2 shadow-sm">
                        <FileText size={16} className="text-emerald-400" />
                        <span className="text-sm font-bold">
                          {activeMaterialItem.fileType.toUpperCase()} · {activeMaterialItem.size}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {activeMaterialItem.title}
                        </h4>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Định dạng</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100 uppercase">
                            {activeMaterialItem.fileType}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Dung lượng</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeMaterialItem.size}
                          </span>
                        </div>
                        {activeMaterialItem.pageCount !== undefined && (
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Số trang</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{activeMaterialItem.pageCount} trang</span>
                          </div>
                        )}
                        {activeMaterialItem.downloadsCount !== undefined && (
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Lượt tải</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{activeMaterialItem.downloadsCount} lượt</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                          <span>Ngày tải lên</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {new Date(activeMaterialItem.uploadedAt).toLocaleDateString("vi-VN")}
                          </span>
                        </div>
                      </div>

                      <div className="flex justify-center pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setIsMaterialDetailExpanded(!isMaterialDetailExpanded)
                          }
                          className="p-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform duration-150 ${
                              isMaterialDetailExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </button>
                      </div>

                      <div className="border-t border-slate-200 dark:border-slate-800 pt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => previewClassMaterial(activeMaterialItem.id, activeMaterialItem.title)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer"
                        >
                          <Eye size={13} />
                          <span>Xem trước</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void downloadClassMaterial(activeMaterialItem.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                        >
                          <Download size={13} />
                          <span>Tải xuống</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Chọn một tài liệu để xem chi tiết
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>


      {/* ================= MODAL LÀM BÀI KIỂM TRA (MODULE 5) ================= */}
      {examTakingModal}

      {/* Bài tập tự luận dùng API submissions riêng, không dùng lượt làm bài thi. */}
      {activeEssayAssignment && (() => {
        const editable = activeEssayAssignment.status === "PUBLISHED" &&
          activeEssayAssignment.submission?.status !== "GRADED" &&
          new Date(activeEssayAssignment.dueAt).getTime() >= Date.now();
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
            <section role="dialog" aria-modal="true" aria-labelledby="essay-submission-title" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 id="essay-submission-title" className="text-xl font-bold text-slate-900 dark:text-white break-words">{activeEssayAssignment.title}</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Hạn nộp: {new Date(activeEssayAssignment.dueAt).toLocaleString("vi-VN")}</p>
                </div>
                <button type="button" aria-label="Đóng bài tập" disabled={essaySubmitting} onClick={() => setActiveEssayAssignment(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-50 dark:hover:bg-slate-800"><X size={20} /></button>
              </div>
              {activeEssayAssignment.description && <p className="mb-3 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{activeEssayAssignment.description}</p>}
              {activeEssayAssignment.instructions && <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800"><h3 className="mb-1 font-semibold text-slate-900 dark:text-white">Hướng dẫn</h3><p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{activeEssayAssignment.instructions}</p></div>}
              <form onSubmit={(event) => void submitEssayAssignment(event)} className="space-y-4">
                <div>
                  <label htmlFor="essay-submission-content" className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Nội dung bài làm</label>
                  <textarea id="essay-submission-content" value={essayContent} onChange={(event) => setEssayContent(event.target.value)} disabled={!editable || essaySubmitting} rows={8} className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" placeholder="Nhập nội dung bài làm của bạn…" />
                </div>
                {Boolean(activeEssayAssignment.submission?.attachments.length) && (
                  <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
                    <p className="font-semibold">Tệp đã nộp</p>
                    {activeEssayAssignment.submission?.attachments.map((file) => <p className="break-all" key={file.id}>{file.originalName}</p>)}
                  </div>
                )}
                {editable && (
                  <div>
                    <label htmlFor="essay-submission-files" className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-100">Tệp đính kèm (tối đa 5 tệp, 20 MB/tệp)</label>
                    <input id="essay-submission-files" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.txt" disabled={essaySubmitting} onChange={(event) => { chooseEssayFiles(event.target.files); event.target.value = ""; }} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-100 file:px-3 file:py-2 file:font-semibold file:text-sky-800 dark:text-slate-300" />
                    {essayFiles.map((file, index) => <div key={`${file.name}-${index}`} className="mt-2 flex items-center justify-between gap-2 text-sm text-slate-600 dark:text-slate-300"><span className="min-w-0 truncate">{file.name}</span><button type="button" disabled={essaySubmitting} onClick={() => setEssayFiles((current) => current.filter((_, position) => position !== index))} className="shrink-0 text-rose-600 hover:underline">Bỏ tệp</button></div>)}
                  </div>
                )}
                {!editable && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Bài tập đã đóng hoặc đã chấm điểm. Bạn chỉ có thể xem lại nội dung.</p>}
                {essayError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{essayError}</p>}
                <div className="flex flex-wrap justify-end gap-3 pt-2">
                  <button type="button" disabled={essaySubmitting} onClick={() => setActiveEssayAssignment(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">Đóng</button>
                  {editable && <button type="submit" disabled={essaySubmitting} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">{essaySubmitting ? "Đang lưu bài…" : activeEssayAssignment.submission ? "Lưu bài nộp" : "Nộp bài"}</button>}
                </div>
              </form>
            </section>
          </div>
        );
      })()}

      {/* ================= MODAL XEM LẠI BÀI LÀM (KHI NỘP 1 LẦN HOẶC CHỌN TỪ LỊCH SỬ) ================= */}
      {selectedAttemptForReview && (
        <ReviewAttemptModal
          open={Boolean(selectedAttemptForReview)}
          onClose={() => setSelectedAttemptForReview(null)}
          data={selectedAttemptForReview}
        />
      )}

      {/* ================= MODAL LỊCH SỬ LÀM BÀI (KHI CÓ NHIỀU LẦN NỘP BÀI) ================= */}
      {isHistoryModalOpen && historyAssignment && (
        <AttemptHistoryModal
          open={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          assignment={historyAssignment}
          onSelectAttempt={(att) => {
            setIsHistoryModalOpen(false);
            setSelectedAttemptForReview({
              examTitle: historyAssignment.title,
              attempt: att,
            });
          }}
        />
      )}

      {/* THÔNG BÁO TOAST NỘI BỘ THAY THẾ TOÀN BỘ POPUP NATIVE */}
      {toastNotification}
    </div>
  );
}

interface ReviewAttemptModalProps {
  open: boolean;
  onClose: () => void;
  data: {
    examTitle: string;
    attempt: AttemptRecord;
  } | null;
}

// Hiển thị toàn bộ nội dung và kết quả chấm điểm của một lượt làm bài kiểm tra.
function ReviewAttemptModal({ open, onClose, data }: ReviewAttemptModalProps) {
  if (!open || !data) return null;
  const { examTitle, attempt } = data;
  const theme = getScoreTheme(attempt.score);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chi tiết bài làm (Lần {attempt.attemptNo})
            </h3>
            <p className="text-xs text-slate-500">{examTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 grid place-items-center cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Khối huy hiệu điểm số lớn với dải màu tương ứng */}
        <div className={`p-4 rounded-xl flex items-center justify-between ${theme.badgeBg}`}>
          <div>
            <span className="text-xs uppercase font-bold tracking-wider opacity-90 block">
              Kết quả chấm điểm
            </span>
            <span className="text-2xl font-black">
              {attempt.score !== undefined ? `${attempt.score.toFixed(1)} / ${attempt.maxScore} điểm` : "Đang chờ chấm điểm"}
            </span>
          </div>
          <div className="text-right text-xs opacity-90">
            <span>Thời gian nộp</span>
            <span className="block font-semibold">{attempt.submittedAt || "Chưa ghi nhận"}</span>
          </div>
        </div>

        {/* Khối nhận xét của giáo viên */}
        <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-1">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide block">
            Nhận xét của giáo viên
          </span>
          <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
            {attempt.feedback || "Chưa có nhận xét."}
          </p>
        </div>

        {/* Danh sách câu hỏi và đáp án nộp */}
        {attempt.answers && attempt.answers.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
              Chi tiết các câu hỏi ({attempt.answers.length})
            </span>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {attempt.answers.map((ans, i) => (
                <div
                  key={ans.questionId || i}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between font-semibold text-slate-900 dark:text-slate-100">
                    <span>Câu {i + 1}: {ans.questionTitle || "Chưa có nội dung câu hỏi"}</span>
                    {ans.awardedScore !== undefined && ans.maxScore !== undefined && (
                      <span className="text-[11px] text-blue-600 font-bold">
                        {ans.awardedScore}/{ans.maxScore}đ
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                    Đáp án đã nộp:{" "}
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {(ans.submittedAnswers || []).join(", ") || "Chưa có dữ liệu"}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

interface AttemptHistoryModalProps {
  open: boolean;
  onClose: () => void;
  assignment: AssignmentItem | null;
  onSelectAttempt: (attempt: AttemptRecord) => void;
}

// Hiển thị danh sách lịch sử các lần nộp bài của học sinh để lựa chọn xem lại.
function AttemptHistoryModal({
  open,
  onClose,
  assignment,
  onSelectAttempt,
}: AttemptHistoryModalProps) {
  if (!open || !assignment) return null;
  const attempts = assignment.attempts || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Lịch sử làm bài ({attempts.length} lần)
            </h3>
            <p className="text-xs text-slate-500">{assignment.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 grid place-items-center cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {attempts.map((att) => {
            const theme = getScoreTheme(att.score);
            return (
              <div
                key={att.id}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Lần làm bài {att.attemptNo}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${theme.badgeBg}`}>
                      {theme.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Nộp bài lúc: {att.submittedAt}
                  </p>
                  {att.feedback && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 italic truncate max-w-xs">
                      &quot;{att.feedback}&quot;
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onSelectAttempt(att)}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer shrink-0"
                >
                  Xem lại bài làm
                </button>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
