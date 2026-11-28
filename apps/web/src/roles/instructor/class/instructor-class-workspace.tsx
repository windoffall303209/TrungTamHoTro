"use client";

import { InlineFilePreview } from "@/features/academic/inline-file-preview";
import { SubmissionFile } from "@/features/academic/submission-file";
import { parseLocalDateTimeInput } from "@/lib/date-time";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { useI18n } from "@/providers/i18n-provider";
import { ClassSchedulePanel } from "@/features/class-detail/class-schedule-panel";
import { LectureSidebarNavigation } from "@/features/class-detail/lecture-sidebar-navigation";
import { ExamTakingModal, type ExamTakingData } from "@/roles/learner/class/exam-taking-modal";
import {
  ArrowLeft,
  Award,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Edit2,
  Edit3,
  Eye,
  EyeOff,
  FileCheck2,
  FileQuestion,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListChecks,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Share2,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCheck,
  Users,
  Video,
  Wand2,
  Scan,
  X,
} from "lucide-react";
import type {
  Assignment,
  AssignmentSubmission,
  Course,
  DirectoryUser,
  Exam,
  GradebookAssessmentColumn,
  GradebookResponse,
  GradebookRow,
  LearningClass,
  Material,
  Question,
} from "@/lib/learning-types";
import { AiExamBuilderModal, type AiAssignmentMode } from "./ai-exam-builder-modal";
import { SmartExamScanModal, type SmartScanTargetMode } from "./smart-exam-scan-modal";
import { useClassExamPage } from "@/lib/class-exams";
import { apiRequest, downloadApiFile } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isExamQuestionPreviewCurrent, toggleVisibleExamQuestions } from "@/lib/exam-question-selection";
import { isMaterialForClass, loadClassMaterials } from "@/lib/materials";
import { useApp } from "@/providers/app-provider";
import { QuestionRenderPreview } from "@/features/questions/question-render-preview";
import { ScoreStepperInput } from "@/shared/ui/score-stepper-input";
import { Pagination, RichText } from "@/shared/ui/ui";
import { useServerPagination, type PaginatedResponse } from "@/shared/hooks/use-server-pagination";
import {
  AssignmentBuilderModal,
  distributeEqualQuestionScores,
  type AssignmentBuilderModalProps,
} from "@/features/exams/assignment-builder-modal";
import {
  BANK_DIFFICULTY_LEVELS,
  detectLectureLinkPlatform,
  filterClassQuestions,
  getClassQuestionStats,
  getScoreColorClass,
  getLectureEmbedUrl,
  getLectureYoutubeId,
  isLectureMaterial,
  toClassQuestion,
  toLectureItem,
  toMaterialDisplayItem,
  type ClassQuestion,
  type LectureItem,
  type MaterialDisplayItem,
} from "./instructor-class-workspace.helpers";
import { InstructorGradebookTab } from "./tabs/instructor-gradebook-tab";
import { normalizeGradebookResponse } from "@/features/academic/class-gradebook-table";
import { InstructorLecturesTab } from "./tabs/instructor-lectures-tab";
import { InstructorMaterialsTab } from "./tabs/instructor-materials-tab";
import { InstructorMembersTab } from "./tabs/instructor-members-tab";
import { InstructorQuestionsTab } from "./tabs/instructor-questions-tab";
import { InstructorRolesTab } from "./tabs/instructor-roles-tab";
import { InstructorSettingsTab } from "./tabs/instructor-settings-tab";
import { ClassWorkDetailView } from "./class-work-detail-view";
import {
  ClassAssignmentEditModal,
  ClassAssignmentPreviewModal,
  ClassAssignmentTrialModal,
  ClassExamEditModal,
  ClassExamPreviewModal,
} from "./class-work-modals";
import { detachOpener } from "@/lib/safe-content";
import { ClassAvatar } from "@/shared/ui/class-avatar";

export interface InstructorClassWorkspaceProps {
  item: LearningClass;
  course: Course | null;
  instructors?: Array<{
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string | null;
    avatarUrl?: string;
  }>;
  onBack?: () => void;
  onClassUpdated?: (updated: LearningClass) => void;
}

export type InstructorSubTab =
  | "feed"
  | "schedule"
  | "members"
  | "roles"
  | "assignments"
  | "gradebook"
  | "lectures"
  | "materials"
  | "questions"
  | "settings";

const invalidLectureLinkMessage = "Chỉ chấp nhận liên kết từ YouTube, Facebook hoặc Google Drive!";

type AssignmentPreview = Assignment & {
  folder?: string;
  durationMinutes?: number;
  totalQuestions?: number;
  questions?: ClassQuestion[];
  questionIds?: string[];
};

/** Đảm nhiệm InstructorClassWorkspace trong phạm vi module hiện tại. */
export function InstructorClassWorkspace({
  item,
  course,
  instructors = [],
  onBack,
  onClassUpdated,
}: InstructorClassWorkspaceProps) {
  const router = useRouter();
  const { session, notify } = useApp();
  const { t, locale } = useI18n();
  const canManageClassContent =
    session.roleCode === "INSTRUCTOR" &&
    item.status !== "CLOSED" &&
    item.instructorIds.includes(session.user.id);

  // Tab điều hướng dọc của giáo viên: mặc định là bảng tin ("feed"), lưu bền vững qua URL và sessionStorage
  const [activeTab, setActiveTab] = useState<InstructorSubTab>(() => {
    if (typeof window !== "undefined") {
      const tabParam = new URLSearchParams(window.location.search).get("tab") as InstructorSubTab | null;
      const validTabs: InstructorSubTab[] = [
        "feed",
        "schedule",
        "members",
        "assignments",
        "gradebook",
        "lectures",
        "materials",
        "questions",
        "settings",
      ];
      if (tabParam && validTabs.includes(tabParam)) return tabParam;

      const stored = sessionStorage.getItem(`class_tab_instructor_${item.id}`) as InstructorSubTab | null;
      if (stored && validTabs.includes(stored)) return stored;
    }
    return "feed";
  });

  /** Chuyển tab và đồng bộ vào URL query params cùng sessionStorage để khi F5 không bị mất trang */
  const handleSelectTab = useCallback(
    (tab: InstructorSubTab) => {
      setActiveTab(tab);
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(`class_tab_instructor_${item.id}`, tab);
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

  // Dữ liệu lớp học
  const [learners, setLearners] = useState<DirectoryUser[]>([]);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [assignments, setAssignments] = useState<AssignmentPreview[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRow[]>([]);
  const [gradebookAssessments, setGradebookAssessments] = useState<GradebookAssessmentColumn[]>([]);
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<Record<string, AssignmentSubmission[]>>({});

  // Bộ lọc và tìm kiếm chung
  const [searchQuery, setSearchQuery] = useState("");

  // Quản lý thư mục cho Bài tập, Bài giảng, Tài liệu
  const [selectedFolder, setSelectedFolder] = useState<string>("__ALL__");
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [customLectureFolders, setCustomLectureFolders] = useState<string[]>([]);
  const [customMaterialFolders, setCustomMaterialFolders] = useState<string[]>([]);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);

  // Chế độ xem bài tập: "list" (danh sách 3 cột) hoặc "detail" (chi tiết & bảng điểm; state tìm kiếm/lọc cô lập trong ClassWorkDetailView)
  const [assignmentViewMode, setAssignmentViewMode] = useState<"list" | "detail">("list");
  const [assignmentListDisplayMode, setAssignmentListDisplayMode] = useState<"list" | "grid">("list");
  const [assignmentSort, setAssignmentSort] = useState<"newest" | "oldest">("newest");

  const examPage = useClassExamPage(item.id, session.roleCode, activeTab === "assignments", searchQuery, assignmentSort,
    () => notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error"));
  const visibleExams = examPage.rows.filter(exam => exam.classId === item.id);
  const setClassExams = examPage.setRows;

  // Bài tập được chọn ở Cột 3
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentPreview | null>(null);
  const selectedClassExam = visibleExams.find(exam => exam.id === selectedExamId)
    ?? (!selectedAssignment ? visibleExams[0] : undefined);
  const selectedWork = selectedClassExam ?? selectedAssignment;
  const deadline = selectedClassExam ? selectedClassExam.closeAt : selectedAssignment?.dueAt;
  const [changingWork, setChangingWork] = useState(false);
  const essayQuestionCount = selectedAssignment?.totalQuestions
    ?? (selectedAssignment?.instructions
      ? selectedAssignment.instructions.match(/^Câu\s+\d+\s*:/gmu)?.length || undefined
      : undefined);
  const workDetails = [
    ["Loại", selectedClassExam ? "Trắc nghiệm" : "Tự luận"],
    ["Trạng thái", selectedWork?.hidden ? "Đã ẩn với học sinh" : "Đang hiển thị"],
    ["Hạn nộp", deadline ? new Date(deadline).toLocaleString(locale) : "—"],
    ["Điểm tối đa", selectedClassExam ? selectedClassExam.totalScore : selectedAssignment?.maxScore],
    ["Số câu hỏi", selectedClassExam ? selectedClassExam.questionIds.length : essayQuestionCount ?? "—"],
    ["Thời lượng", selectedClassExam ? selectedClassExam.durationMinutes + " phút" : "Theo hạn nộp"],
    ["Số lần làm bài", selectedClassExam ? selectedClassExam.attemptLimit : "Một bài nộp, có thể cập nhật"],
  ];

  const [previewExam, setPreviewExam] = useState<ExamTakingData | null>(null);
  const [previewExamContent, setPreviewExamContent] = useState<Exam | null>(null);
  const [previewAssignment, setPreviewAssignment] = useState<Assignment | null>(null);
  const [trialAssignment, setTrialAssignment] = useState<Assignment | null>(null);
  const [editingClassExam, setEditingClassExam] = useState<Exam | null>(null);
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [selectedStudentAttempt, setSelectedStudentAttempt] = useState<AssignmentSubmission | null>(null);



  // Bài giảng được nạp từ danh sách học liệu của API, cùng nguồn với học viên.
  const [lectures, setLectures] = useState<LectureItem[]>([]);

  const [selectedLectureForPage, setSelectedLectureForPage] = useState<LectureItem | null>(null);
  const [selectedLectureId, setSelectedLectureId] = useState<string>("");
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");

  // Modal tạo & chỉnh sửa Bài giảng 2 vùng (Two-Pane Creator)
  const [addLectureModalOpen, setAddLectureModalOpen] = useState(false);
  const [editLectureModalOpen, setEditLectureModalOpen] = useState(false);
  const [editingLecture, setEditingLecture] = useState<LectureItem | null>(null);
  const [lectureMethod, setLectureMethod] = useState<"LINK" | "FILE">("FILE");
  const [lectureInputUrl, setLectureInputUrl] = useState("");
  const [lectureUrlError, setLectureUrlError] = useState("");
  const [lectureDetectedPlatform, setLectureDetectedPlatform] = useState<
    "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID"
  >("INVALID");
  const [lectureFileObj, setLectureFileObj] = useState<File | null>(null);
  const [lectureSaving, setLectureSaving] = useState(false);
  const [lectureFormTitle, setLectureFormTitle] = useState("");
  const [lectureFormVisibility, setLectureFormVisibility] = useState<"PUBLISHED" | "HIDDEN">(
    "PUBLISHED",
  );
  const [lectureFormFolder, setLectureFormFolder] = useState("");
  const [lectureAttachedAssignments, setLectureAttachedAssignments] = useState<string[]>([]);

  // State chỉnh sửa bài giảng 2 vùng (y hệt tạo mới)
  const [editLectureMethod, setEditLectureMethod] = useState<"LINK" | "FILE">("LINK");
  const [editLectureInputUrl, setEditLectureInputUrl] = useState("");
  const [editLectureUrlError, setEditLectureUrlError] = useState("");
  const [editLectureDetectedPlatform, setEditLectureDetectedPlatform] = useState<
    "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID"
  >("INVALID");
  const [editLectureFileObj, setEditLectureFileObj] = useState<File | null>(null);
  const [editLectureFormTitle, setEditLectureFormTitle] = useState("");
  const [editLectureFormVisibility, setEditLectureFormVisibility] = useState<
    "PUBLISHED" | "HIDDEN"
  >("PUBLISHED");
  const [editLectureFormFolder, setEditLectureFormFolder] = useState("Bài giảng chung");

  // Modal tạo Bài tập mới
  const [addAssignmentModalOpen, setAddAssignmentModalOpen] = useState(false);
  const [builderInitialMethod, setBuilderInitialMethod] = useState<"MANUAL" | "AI" | undefined>(undefined);

  // Modal Chỉnh sửa Bài tập tự luận
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);

  // Modal Hub điều phối 5 cách tạo Bài tập & Soạn câu hỏi
  const [creationHubOpen, setCreationHubOpen] = useState(false);
  const [creationTarget, setCreationTarget] = useState<"ASSIGNMENT" | "QUESTION">("ASSIGNMENT");
  const [assignmentHubType, setAssignmentHubType] = useState<"MULTIPLE_CHOICE" | "ESSAY" | null>(null);
  const [openedFromCreationHub, setOpenedFromCreationHub] = useState(false);

  // Cách 1: Soạn câu hỏi thủ công
  const [authoringModalOpen, setAuthoringModalOpen] = useState(false);
  const [authoringContent, setAuthoringContent] = useState("");
  const [authoringType, setAuthoringType] = useState<"SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "ESSAY">("SINGLE_CHOICE");
  const [authoringDifficulty, setAuthoringDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [authoringOptions, setAuthoringOptions] = useState<string[]>([
    "Phương án A",
    "Phương án B",
    "Phương án C",
    "Phương án D",
  ]);
  const [authoringCorrect, setAuthoringCorrect] = useState<number[]>([0]);
  const [authoringSaving, setAuthoringSaving] = useState(false);
  const [authoringPreview, setAuthoringPreview] = useState(false);

  // Cách 2: Quét đề bằng AI OCR
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanTargetMode, setScanTargetMode] = useState<SmartScanTargetMode>("BANK_ONLY");

  // Cách 3: Tạo đề thi / tự luận bằng AI (có duyệt & sửa câu hỏi)
  const [aiExamModalOpen, setAiExamModalOpen] = useState(false);
  const [aiBuilderMode, setAiBuilderMode] = useState<AiAssignmentMode>("MULTIPLE_CHOICE");

  // Cách 4: Tạo đề thi / bài tập từ ngân hàng câu hỏi (3 kiểu: 1. Thủ công, 2. Chọn mốc, 3. Ngẫu nhiên)
  const [manualExamModalOpen, setManualExamModalOpen] = useState(false);
  const [bankBuilderAssignmentType, setBankBuilderAssignmentType] = useState<"MULTIPLE_CHOICE" | "ESSAY">("MULTIPLE_CHOICE");
  const [examCreationMode, setExamCreationMode] = useState<"MANUAL" | "AI_CRITERIA" | "RANDOM">("MANUAL");
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDuration, setManualExamDuration] = useState(45);
  const [manualExamDueAt, setManualExamDueAt] = useState("");
  const [manualExamTargetScore, setManualExamTargetScore] = useState(10);
  const [manualExamQuestionScores, setManualExamQuestionScores] = useState<Record<string, number>>({});
  const [manualExamCustomScored, setManualExamCustomScored] = useState(false);
  const [manualExamTutorEnabled, setManualExamTutorEnabled] = useState(false);
  const [examSaving, setExamSaving] = useState(false);
  const [manualExamSelectedQuestions, setManualExamSelectedQuestions] = useState<string[]>([]);
  const [manualExamSearch, setManualExamSearch] = useState("");
  const [manualExamDifficulties, setManualExamDifficulties] = useState<string[]>([]);
  const [manualDifficultyDropdownOpen, setManualDifficultyDropdownOpen] = useState(false);
  const manualDifficultyFilterRef = useRef<HTMLDivElement | null>(null);

  // Kiểu 2: Chọn mốc để AI chọn câu hỏi
  const [aiCriteriaQuestionCount, setAiCriteriaQuestionCount] = useState(10);
  const [aiCriteriaPreset, setAiCriteriaPreset] = useState<"STANDARD" | "BASIC" | "ADVANCED" | "CUSTOM">("STANDARD");
  const [aiRatioBasic, setAiRatioBasic] = useState(40);
  const [aiRatioMedium, setAiRatioMedium] = useState(30);
  const [aiRatioHard, setAiRatioHard] = useState(20);
  const [aiRatioVeryHard, setAiRatioVeryHard] = useState(10);
  const [aiCriteriaPreviewList, setAiCriteriaPreviewList] = useState<ClassQuestion[]>([]);

  // Kiểu 3: Ngẫu nhiên
  const [randomQuestionCount, setRandomQuestionCount] = useState(10);
  const [randomShuffle, setRandomShuffle] = useState(true);

  // Bộ lọc cho Tab 9: Ngân hàng câu hỏi
  const [questionBankTab, setQuestionBankTab] = useState<"ALL" | "MULTIPLE_CHOICE" | "ESSAY">("ALL");
  const [questionBankSearch, setQuestionBankSearch] = useState("");
  const [questionBankDifficulty, setQuestionBankDifficulty] = useState("ALL");

  // Chỉnh sửa câu hỏi trong ngân hàng
  const [editingQuestionModalOpen, setEditingQuestionModalOpen] = useState(false);
  const [editingQuestionSaving, setEditingQuestionSaving] = useState(false);
  const [editingQuestionPreview, setEditingQuestionPreview] = useState(false);
  const [editingQuestionData, setEditingQuestionData] = useState<{
    id: string;
    content: string;
    type: string;
    difficulty: string;
    source: string;
    options: string[];
    correctAnswers: number[];
    solution: string;
  } | null>(null);

  // Ngân hàng chỉ lấy từ API để không giữ các bản ghi giả hoặc dữ liệu đã lỗi thời.
  const [classQuestions, setClassQuestions] = useState<ClassQuestion[]>([]);
  const [pagedClassQuestions, setPagedClassQuestions] = useState<ClassQuestion[]>([]);
  const [questionSummary, setQuestionSummary] = useState<{ total: number; multipleChoice: number; essay: number }>({
    total: 0,
    multipleChoice: 0,
    essay: 0,
  });
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [questionBankError, setQuestionBankError] = useState("");
  const questionPagination = useServerPagination(10);
  const {
    page: questionPage,
    displayPage: questionDisplayPage,
    pageSize: questionPageSize,
    totalItems: questionTotalItems,
    setPage: setQuestionPage,
    setPageSize: setQuestionPageSize,
    resetPage: resetQuestionPage,
    syncResponse: syncQuestionPage,
  } = questionPagination;
  const questionBankRequestRef = useRef(0);
  const questionBankControllerRef = useRef<AbortController | null>(null);
  const publishedPoolLoadedRef = useRef<string | null>(null);
  const publishedPoolRequestRef = useRef(0);

  // Chỉ dùng câu hỏi đã xuất bản khi lập đề; câu nháp vẫn hiển thị trong ngân hàng.
  const publishedClassQuestions = useMemo(
    () => classQuestions.filter((question) => question.status === "PUBLISHED"),
    [classQuestions],
  );
  const aiCriteriaPreviewIsCurrent = useMemo(
    () => isExamQuestionPreviewCurrent(aiCriteriaPreviewList, classQuestions),
    [aiCriteriaPreviewList, classQuestions],
  );
  const scopedPublishedBankQuestions = useMemo(
    () => filterClassQuestions(publishedClassQuestions, bankBuilderAssignmentType),
    [publishedClassQuestions, bankBuilderAssignmentType],
  );
  const manualExamVisibleQuestions = useMemo(
    () =>
      filterClassQuestions(
        publishedClassQuestions,
        bankBuilderAssignmentType,
        manualExamDifficulties,
        manualExamSearch,
      ),
    [publishedClassQuestions, bankBuilderAssignmentType, manualExamDifficulties, manualExamSearch],
  );
  const manualExamDifficultyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const level of BANK_DIFFICULTY_LEVELS) counts[level] = 0;
    for (const q of scopedPublishedBankQuestions) {
      counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
    }
    return counts;
  }, [scopedPublishedBankQuestions]);

  // Tự động đóng dropdown lọc độ khó khi giảng viên bấm ra ngoài hoặc nhấn phím Escape.
  useEffect(() => {
    if (!manualDifficultyDropdownOpen) return;
    // Đóng menu lọc độ khó khi click chuột bên ngoài vùng tham chiếu.
    const handlePointerDown = (event: MouseEvent) => {
      if (
        manualDifficultyFilterRef.current &&
        !manualDifficultyFilterRef.current.contains(event.target as Node)
      ) {
        setManualDifficultyDropdownOpen(false);
      }
    };
    // Đóng menu lọc độ khó khi nhấn phím Escape.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManualDifficultyDropdownOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [manualDifficultyDropdownOpen]);
  const manualExamAllVisibleSelected = manualExamVisibleQuestions.length > 0 &&
    manualExamVisibleQuestions.every((question) => manualExamSelectedQuestions.includes(question.id));
  const publishedQuestionStats = useMemo(() => getClassQuestionStats(publishedClassQuestions), [publishedClassQuestions]);

  // API là nguồn dữ liệu duy nhất để tránh hiện tài liệu đã xóa/di chuyển hoặc bản ghi giả.
  const [materialsList, setMaterialsList] = useState<MaterialDisplayItem[]>([]);
  const rawMaterialsMapRef = useRef<Map<string, Material>>(new Map());

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  // Thư mục tài liệu & biểu mẫu tải/chỉnh sửa tài liệu
  const [selectedMaterialFolder, setSelectedMaterialFolder] = useState<string>("__ALL__");
  const [addMaterialModalOpen, setAddMaterialModalOpen] = useState(false);
  const [editMaterialModalOpen, setEditMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialDisplayItem | null>(null);
  const [materialFormTitle, setMaterialFormTitle] = useState("");
  const [materialFormFolder, setMaterialFormFolder] = useState("");
  const [materialUploadFile, setMaterialUploadFile] = useState<File | null>(null);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialFormVisibility, setMaterialFormVisibility] = useState<"PUBLISHED" | "HIDDEN">(
    "PUBLISHED",
  );
  const [editMaterialFileObj, setEditMaterialFileObj] = useState<File | null>(null);
  const [editMaterialFormTitle, setEditMaterialFormTitle] = useState("");
  const [editMaterialFormFolder, setEditMaterialFormFolder] = useState("");
  const [editMaterialFormVisibility, setEditMaterialFormVisibility] = useState<
    "PUBLISHED" | "HIDDEN"
  >("PUBLISHED");

  const foldersLoadedClassRef = useRef<string | null>(null);
  const allInstructorClassesLoadedRoleRef = useRef<string | null>(null);
  const needsFoldersTab = activeTab === "assignments" || activeTab === "lectures" || activeTab === "materials";

  // Đặt lại bộ nhớ đệm thư mục khi chuyển sang lớp khác để tránh giữ nhãn thư mục của lớp cũ.
  useEffect(() => {
    foldersLoadedClassRef.current = null;
    setCustomFolders([]);
    setCustomLectureFolders([]);
    setCustomMaterialFolders([]);
    setSelectedLectureFolder("__ALL__");
    setSelectedMaterialFolder("__ALL__");
    setSelectedFolder("__ALL__");
  }, [item.id]);

  // Chỉ tải thư mục lớp từ API khi người dùng thực sự mở tab Bài tập, Bài giảng hoặc Tài liệu.
  useEffect(() => {
    if (!needsFoldersTab) return;
    if (foldersLoadedClassRef.current === item.id) return;
    const controller = new AbortController();
    const path = `/instructor/classes/${encodeURIComponent(item.id)}/folders`;
    const options = { roleCode: session.roleCode, signal: controller.signal };
    type Folders = { materials: string[]; lectures: string[]; assignments: string[] };
    // Tải danh sách thư mục của lớp từ API và đồng bộ thư mục cũ từ localStorage nếu có.
    async function loadFolders() {
      let folders = await apiRequest<Folders>(path, options);
      const key = `wind_class_folders_${item.id}`;
      let legacy: unknown;
      try { legacy = JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { legacy = null; }
      if (legacy && typeof legacy === "object" && item.status !== "CLOSED") {
        const saved = legacy as Record<string, unknown>;
        // Lấy mảng tên thư mục theo từng loại nội dung từ dữ liệu lưu cục bộ.
        const entries = (kind: string): unknown[] => Array.isArray(saved[kind]) ? saved[kind] : [];
        for (const kind of ["assignments", "lectures", "materials"] as const) {
          for (const name of entries(kind)) {
            if (typeof name === "string" && name.trim() && !folders[kind].includes(name))
              folders = await apiRequest<Folders>(path, { ...options, method: "POST", body: JSON.stringify({ name, kind }) });
          }
        }
        try { window.localStorage.removeItem(key); } catch { /* Import is idempotent. */ }
      }
      if (!controller.signal.aborted) {
        foldersLoadedClassRef.current = item.id;
        setCustomFolders(folders.assignments);
        setCustomLectureFolders(folders.lectures);
        setCustomMaterialFolders(folders.materials);
        setLectureFormFolder((prev) =>
          folders.lectures.includes(prev) ? prev : (folders.lectures[0] ?? ""),
        );
        setMaterialFormFolder((prev) =>
          folders.materials.includes(prev) ? prev : (folders.materials[0] ?? ""),
        );
      }
    }
    void loadFolders().catch(() => {
      if (!controller.signal.aborted) notify("Không tải được thư mục của lớp.", "error");
    });
    return () => controller.abort();
  }, [needsFoldersTab, item.id, item.status, session.roleCode, notify]);

  // Modal di chuyển bài giảng / tài liệu sang lớp được phân công và thư mục hợp lệ
  const [moveItemModalOpen, setMoveItemModalOpen] = useState(false);
  const [itemForMove, setItemForMove] = useState<{ id: string; title: string; kind: "LECTURE" | "MATERIAL" } | null>(null);
  const [targetDestinationClassId, setTargetDestinationClassId] = useState<string>("");
  const [targetDestinationFolders, setTargetDestinationFolders] = useState<string[]>([]);
  const [targetDestinationFolder, setTargetDestinationFolder] = useState<string>("");
  const [loadingDestinationFolders, setLoadingDestinationFolders] = useState(false);
  const [allInstructorClasses, setAllInstructorClasses] = useState<LearningClass[]>([]);

  // Chỉ tải danh sách lớp giảng dạy khi người dùng mở hộp thoại di chuyển học liệu.
  useEffect(() => {
    if (!moveItemModalOpen) return;
    if (allInstructorClassesLoadedRoleRef.current === session.roleCode) return;
    const controller = new AbortController();
    apiRequest<LearningClass[]>("/instructor/classes", {
      roleCode: session.roleCode,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) {
          allInstructorClassesLoadedRoleRef.current = session.roleCode;
          setAllInstructorClasses(data);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn("Lỗi nạp danh sách lớp:", err);
      });
    return () => controller.abort();
  }, [moveItemModalOpen, session.roleCode]);

  const movableDestinationClasses = useMemo(
    () =>
      allInstructorClasses.filter(
        (cls) => cls.status !== "CLOSED" && cls.instructorIds.includes(session.user.id),
      ),
    [allInstructorClasses, session.user.id],
  );

  // Tự chọn lớp đích hợp lệ ngay khi danh sách lớp giảng dạy vừa tải xong lúc mở modal di chuyển.
  useEffect(() => {
    if (!moveItemModalOpen || targetDestinationClassId || movableDestinationClasses.length === 0) return;
    const preferred =
      movableDestinationClasses.find((cls) => cls.id !== item.id) ?? movableDestinationClasses[0];
    if (preferred) setTargetDestinationClassId(preferred.id);
  }, [moveItemModalOpen, targetDestinationClassId, movableDestinationClasses, item.id]);

  // Nạp danh sách thư mục hợp lệ từ class_folders của lớp đích khi mở hoặc đổi lớp
  useEffect(() => {
    if (!moveItemModalOpen || !itemForMove || !targetDestinationClassId) {
      setTargetDestinationFolders([]);
      setTargetDestinationFolder("");
      return;
    }
    const controller = new AbortController();
    setLoadingDestinationFolders(true);
    apiRequest<{ materials: string[]; lectures: string[]; assignments: string[] }>(
      `/classes/${encodeURIComponent(targetDestinationClassId)}/folders`,
      { roleCode: session.roleCode, signal: controller.signal },
    )
      .then((folders) => {
        if (controller.signal.aborted) return;
        const candidates = itemForMove.kind === "LECTURE" ? folders.lectures : folders.materials;
        setTargetDestinationFolders(candidates);
        setTargetDestinationFolder((prev) =>
          candidates.includes(prev) ? prev : (candidates[0] ?? ""),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTargetDestinationFolders([]);
          setTargetDestinationFolder("");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDestinationFolders(false);
      });
    return () => controller.abort();
  }, [moveItemModalOpen, itemForMove, targetDestinationClassId, session.roleCode]);

  /** Mở hộp thoại di chuyển đến lớp được phân công giảng dạy và thư mục hợp lệ. */
  const handleOpenMoveItem = (id: string, title: string, kind: "LECTURE" | "MATERIAL") => {
    const preferredClass =
      movableDestinationClasses.find((cls) => cls.id !== item.id) ?? movableDestinationClasses[0];
    setItemForMove({ id, title, kind });
    setTargetDestinationClassId(preferredClass?.id ?? "");
    setTargetDestinationFolder("");
    setMoveItemModalOpen(true);
  };

  /** Di chuyển học liệu sang lớp và thư mục thuộc class_folders. */
  const handleConfirmMoveItem = async () => {
    if (!itemForMove) return;
    if (!targetDestinationClassId || !targetDestinationFolder) {
      notify("Vui lòng chọn lớp và thư mục đích hợp lệ.", "error");
      return;
    }
    try {
      await apiRequest(`/instructor/materials/${itemForMove.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: targetDestinationClassId,
          scope: "CLASS",
          folder: targetDestinationFolder,
        }),
      });

      if (targetDestinationClassId !== item.id) {
        if (itemForMove.kind === "LECTURE") {
          setLectures((prev) => prev.filter((l) => l.id !== itemForMove.id));
        } else {
          setMaterialsList((prev) => prev.filter((m) => m.id !== itemForMove.id));
        }
      } else {
        await loadClassData();
      }

      const targetCls = movableDestinationClasses.find((c) => c.id === targetDestinationClassId);
      const destName = targetCls?.name || "lớp mới";
      notify(`Đã di chuyển '${itemForMove.title}' sang ${destName} (${targetDestinationFolder}) thành công!`, "success");
    } catch (err) {
      console.warn("Lỗi di chuyển học liệu trong CSDL:", err);
      notify(err instanceof Error ? err.message : "Có lỗi khi di chuyển học liệu. Vui lòng thử lại!", "error");
    } finally {
      setMoveItemModalOpen(false);
      setItemForMove(null);
    }
  };

  const learnersLoadedClassRef = useRef<string | null>(null);
  const learnersRequestRef = useRef(0);
  const learnersControllerRef = useRef<AbortController | null>(null);
  const assignmentsLoadedClassRef = useRef<string | null>(null);
  const assignmentsRequestRef = useRef(0);
  const assignmentsControllerRef = useRef<AbortController | null>(null);
  const materialsLoadedClassRef = useRef<string | null>(null);
  const materialsRequestRef = useRef(0);
  const materialsControllerRef = useRef<AbortController | null>(null);
  const loadedSubmissionKeysRef = useRef<Set<string>>(new Set());
  const [submissionsRefreshToken, setSubmissionsRefreshToken] = useState(0);
  const gradebookLoadedClassRef = useRef<string | null>(null);
  const gradebookRequestRef = useRef(0);
  const gradebookControllerRef = useRef<AbortController | null>(null);

  /** Tải bảng điểm của lớp chỉ khi giảng viên mở tab Bảng điểm. */
  const loadClassGradebookTab = useCallback(async (force = false) => {
    if (!force && gradebookLoadedClassRef.current === item.id) return;
    const requestId = ++gradebookRequestRef.current;
    gradebookControllerRef.current?.abort();
    const controller = new AbortController();
    gradebookControllerRef.current = controller;
    try {
      const payload = await apiRequest<GradebookResponse | GradebookRow[]>(`/academic/classes/${item.id}/gradebook`, {
        roleCode: session.roleCode,
        signal: controller.signal,
      });
      if (requestId !== gradebookRequestRef.current || controller.signal.aborted) return;
      const normalized = normalizeGradebookResponse(payload);
      gradebookLoadedClassRef.current = item.id;
      setGradebookAssessments(normalized.assessments);
      setGradebook(normalized.rows);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Không tải được bảng điểm của lớp:", error);
      if (requestId === gradebookRequestRef.current && !controller.signal.aborted) {
        notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error");
      }
    }
  }, [item.id, session.roleCode, notify]);

  /** Tải danh sách học viên chỉ khi cần cho tab Thành viên, Bài tập hoặc Bảng điểm. */
  const loadLearnersSlice = useCallback(async (force = false) => {
    if (!force && learnersLoadedClassRef.current === item.id) return;
    const requestId = ++learnersRequestRef.current;
    learnersControllerRef.current?.abort();
    const controller = new AbortController();
    learnersControllerRef.current = controller;
    try {
      const rows = await apiRequest<DirectoryUser[]>(`/instructor/classes/${item.id}/learners`, {
        roleCode: session.roleCode,
        signal: controller.signal,
      });
      if (requestId !== learnersRequestRef.current || controller.signal.aborted) return;
      learnersLoadedClassRef.current = item.id;
      setLearners(rows);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Không tải được học viên của lớp:", error);
      if (requestId === learnersRequestRef.current && !controller.signal.aborted) {
        notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error");
      }
    }
  }, [item.id, session.roleCode, notify]);

  /** Tải danh sách bài tập tự luận kèm số bài đã nộp chỉ khi giảng viên mở tab Bài tập. */
  const loadAssignmentsSlice = useCallback(async (force = false) => {
    if (!force && assignmentsLoadedClassRef.current === item.id) return;
    const requestId = ++assignmentsRequestRef.current;
    assignmentsControllerRef.current?.abort();
    const controller = new AbortController();
    assignmentsControllerRef.current = controller;
    if (force) {
      loadedSubmissionKeysRef.current.clear();
      setSubmissionsRefreshToken((value) => value + 1);
    }
    try {
      const rows = await apiRequest<Assignment[]>(`/academic/assignments?classId=${item.id}`, {
        roleCode: session.roleCode,
        signal: controller.signal,
      });
      if (requestId !== assignmentsRequestRef.current || controller.signal.aborted) return;
      assignmentsLoadedClassRef.current = item.id;
      setAssignments(rows);
      setSelectedAssignment((current) => rows.find((assignment) => assignment.id === current?.id) ?? rows[0] ?? null);
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Không tải được bài tập của lớp:", error);
      if (requestId === assignmentsRequestRef.current && !controller.signal.aborted) {
        notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error");
      }
    }
  }, [item.id, session.roleCode, notify]);

  /** Tải danh sách bài giảng và tài liệu chỉ khi mở tab Bài giảng hoặc Tài liệu. */
  const loadMaterialsSlice = useCallback(async (force = false) => {
    if (!force && materialsLoadedClassRef.current === item.id) return;
    const requestId = ++materialsRequestRef.current;
    materialsControllerRef.current?.abort();
    const controller = new AbortController();
    materialsControllerRef.current = controller;
    try {
      const rows = await loadClassMaterials<Material>(item.id, {
        roleCode: session.roleCode,
        signal: controller.signal,
      });
      if (requestId !== materialsRequestRef.current || controller.signal.aborted) return;
      materialsLoadedClassRef.current = item.id;
      const classMaterials = rows.filter((m) => isMaterialForClass(m, item.id));
      rawMaterialsMapRef.current = new Map(classMaterials.map((m) => [m.id, m]));
      const mappedLectures = classMaterials.filter(isLectureMaterial)
        .map((material) => toLectureItem(material, session.user.name || "Giảng viên"));
      setLectures(mappedLectures);
      setSelectedLectureId((current) => mappedLectures.some((lecture) => lecture.id === current) ? current : (mappedLectures[0]?.id ?? ""));
      setSelectedLectureForPage((current) => mappedLectures.find((lecture) => lecture.id === current?.id) ?? null);
      const mappedMats = classMaterials
        .filter((material) => !isLectureMaterial(material))
        .map(toMaterialDisplayItem);
      setMaterialsList(mappedMats);
      setSelectedMaterialId((current) => mappedMats.some((m) => m.id === current) ? current : (mappedMats[0]?.id ?? ""));
    } catch (error) {
      if (!controller.signal.aborted) console.warn("Không tải được tài liệu của lớp:", error);
      if (requestId === materialsRequestRef.current && !controller.signal.aborted) {
        notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error");
      }
    }
  }, [item.id, session.roleCode, session.user.name, notify, setSelectedLectureId, setSelectedLectureForPage, setSelectedMaterialId]);

  /** Làm mới các nhóm dữ liệu liên quan đến tab hiện tại sau khi giảng viên thêm/sửa/xóa nội dung. */
  const loadClassData = useCallback(async () => {
    gradebookLoadedClassRef.current = null;
    const tasks: Array<Promise<void>> = [];
    if (activeTab === "members" || activeTab === "gradebook" || learnersLoadedClassRef.current === item.id) {
      tasks.push(loadLearnersSlice(true));
    }
    if (activeTab === "assignments" || assignmentsLoadedClassRef.current === item.id) {
      tasks.push(loadAssignmentsSlice(true));
    }
    if (activeTab === "lectures" || activeTab === "materials" || materialsLoadedClassRef.current === item.id) {
      tasks.push(loadMaterialsSlice(true));
    }
    await Promise.all(tasks);
  }, [activeTab, item.id, loadLearnersSlice, loadAssignmentsSlice, loadMaterialsSlice]);

  // Xóa dữ liệu cũ khi chuyển sang lớp khác để tránh hiển thị nhầm giữa các lớp.
  useEffect(() => {
    learnersLoadedClassRef.current = null;
    assignmentsLoadedClassRef.current = null;
    materialsLoadedClassRef.current = null;
    gradebookLoadedClassRef.current = null;
    loadedSubmissionKeysRef.current.clear();
    setLearners([]);
    setAssignments([]);
    setSelectedAssignment(null);
    setSubmissionsByAssignment({});
    setLectures([]);
    setMaterialsList([]);
    setGradebook([]);
    setGradebookAssessments([]);
  }, [item.id]);

  // Chỉ tải danh sách học viên cho các tab thực sự hiển thị sĩ số hoặc bảng điểm.
  useEffect(() => {
    if (activeTab !== "members" && activeTab !== "assignments" && activeTab !== "gradebook") return;
    void loadLearnersSlice();
    return () => {
      learnersRequestRef.current += 1;
      learnersControllerRef.current?.abort();
    };
  }, [activeTab, loadLearnersSlice]);

  // Chỉ tải danh sách bài tập khi giảng viên mở tab Bài tập.
  useEffect(() => {
    if (activeTab !== "assignments") return;
    void loadAssignmentsSlice();
    return () => {
      assignmentsRequestRef.current += 1;
      assignmentsControllerRef.current?.abort();
    };
  }, [activeTab, loadAssignmentsSlice]);

  // Chỉ tải danh sách học liệu/bài giảng khi mở tab Bài giảng hoặc Tài liệu.
  useEffect(() => {
    if (activeTab !== "lectures" && activeTab !== "materials") return;
    void loadMaterialsSlice();
    return () => {
      materialsRequestRef.current += 1;
      materialsControllerRef.current?.abort();
    };
  }, [activeTab, loadMaterialsSlice]);

  useEffect(() => {
    if (activeTab !== "gradebook") return;
    void loadClassGradebookTab();
    return () => {
      gradebookRequestRef.current += 1;
      gradebookControllerRef.current?.abort();
    };
  }, [activeTab, loadClassGradebookTab]);

  /** Tải thống kê và một trang câu hỏi của ngân hàng lớp từ API phân trang trên DB. */
  const loadClassQuestionBank = useCallback(async () => {
    const requestId = ++questionBankRequestRef.current;
    questionBankControllerRef.current?.abort();
    const controller = new AbortController();
    questionBankControllerRef.current = controller;
    setQuestionBankLoading(true);
    setQuestionBankError("");
    try {
      const summaryUrl = item.courseId
        ? `/instructor/question-bank/questions/summary?courseId=${encodeURIComponent(item.courseId)}`
        : "/instructor/question-bank/questions/summary";
      const params = new URLSearchParams({
        page: String(questionPage),
        pageSize: String(questionPageSize),
      });
      if (item.courseId) params.set("courseId", item.courseId);
      if (questionBankTab === "MULTIPLE_CHOICE") params.set("typeGroup", "OBJECTIVE");
      else if (questionBankTab === "ESSAY") params.set("typeGroup", "ESSAY");
      if (questionBankDifficulty === "Cơ bản") params.set("difficulty", "1");
      else if (questionBankDifficulty === "Thông hiểu") params.set("difficulty", "2");
      else if (questionBankDifficulty === "Vận dụng" || questionBankDifficulty === "Vận dụng cao") {
        params.set("difficulty", "3");
      }
      const trimmedQuery = questionBankSearch.trim();
      if (trimmedQuery) params.set("query", trimmedQuery);

      const [summary, pageResult] = await Promise.all([
        apiRequest<{ total: number; multipleChoice: number; essay: number }>(summaryUrl, {
          roleCode: session.roleCode,
          signal: controller.signal,
        }),
        apiRequest<PaginatedResponse<Question & { solution?: string; createdAt?: string }>>(
          `/instructor/question-bank/questions/page?${params.toString()}`,
          {
            roleCode: session.roleCode,
            signal: controller.signal,
          },
        ),
      ]);
      if (requestId !== questionBankRequestRef.current || controller.signal.aborted) return;
      setQuestionSummary(summary);
      setPagedClassQuestions(pageResult.items.map(toClassQuestion));
      syncQuestionPage(pageResult);
    } catch (error) {
      if (!controller.signal.aborted && requestId === questionBankRequestRef.current) {
        const message = error instanceof Error ? error.message : "Không tải được ngân hàng câu hỏi.";
        setQuestionBankError(message);
        notify(message, "error");
      }
    } finally {
      if (!controller.signal.aborted && requestId === questionBankRequestRef.current) {
        setQuestionBankLoading(false);
      }
    }
  }, [
    item.courseId,
    questionPage,
    questionPageSize,
    questionBankTab,
    questionBankDifficulty,
    questionBankSearch,
    session.roleCode,
    syncQuestionPage,
    notify,
  ]);

  /** Chỉ tải tập câu hỏi đã xuất bản khi người dùng mở modal tạo hoặc chỉnh sửa đề thi. */
  const loadPublishedExamPool = useCallback(async (force = false) => {
    const cacheKey = item.courseId || "__ALL__";
    if (!force && publishedPoolLoadedRef.current === cacheKey) return;
    const requestId = ++publishedPoolRequestRef.current;
    try {
      const queryUrl = item.courseId
        ? `/instructor/question-bank/questions?courseId=${encodeURIComponent(item.courseId)}&status=PUBLISHED`
        : "/instructor/question-bank/questions?status=PUBLISHED";
      const summaryUrl = item.courseId
        ? `/instructor/question-bank/questions/summary?courseId=${encodeURIComponent(item.courseId)}`
        : "/instructor/question-bank/questions/summary";
      const [publishedRows, summary] = await Promise.all([
        apiRequest<Array<Question & { solution?: string; createdAt?: string }>>(queryUrl, {
          roleCode: session.roleCode,
        }),
        apiRequest<{ total: number; multipleChoice: number; essay: number }>(summaryUrl, {
          roleCode: session.roleCode,
        }),
      ]);
      if (requestId !== publishedPoolRequestRef.current) return;
      publishedPoolLoadedRef.current = cacheKey;
      setClassQuestions(publishedRows.map(toClassQuestion));
      setQuestionSummary(summary);
    } catch (error) {
      console.warn("Không tải được câu hỏi đã xuất bản cho biểu mẫu đề thi:", error);
    }
  }, [item.courseId, session.roleCode]);

  useEffect(() => {
    if (activeTab !== "questions") return;
    void loadClassQuestionBank();
    return () => {
      questionBankRequestRef.current += 1;
      questionBankControllerRef.current?.abort();
    };
  }, [activeTab, loadClassQuestionBank]);

  useEffect(() => {
    if (!manualExamModalOpen && !editingClassExam) return;
    void loadPublishedExamPool();
  }, [manualExamModalOpen, editingClassExam, loadPublishedExamPool]);

  /** Cập nhật từ khóa tìm kiếm ngân hàng câu hỏi sau debounce ở tab con và đưa về trang 1. */
  const handleQuestionSearchCommit = useCallback(
    (nextQuery: string) => {
      setQuestionBankSearch(nextQuery);
      resetQuestionPage();
    },
    [resetQuestionPage],
  );

  /** Làm mới trang câu hỏi và hủy bộ nhớ đệm câu hỏi xuất bản sau khi thay đổi dữ liệu. */
  const refreshQuestionData = async () => {
    publishedPoolLoadedRef.current = null;
    const tasks: Array<Promise<void>> = [];
    if (activeTab === "questions") tasks.push(loadClassQuestionBank());
    if (manualExamModalOpen || editingClassExam) tasks.push(loadPublishedExamPool(true));
    await Promise.all(tasks);
  };

  const selectedAssignmentId = selectedAssignment?.id ?? "";

  // Chỉ tải bài nộp cho đúng bài tập đang được chọn trong tab Bài tập (xóa N+1 tải toàn bộ bài tập).
  useEffect(() => {
    if (activeTab !== "assignments" || !selectedAssignmentId) return;
    const cacheKey = `${item.id}:${selectedAssignmentId}`;
    if (loadedSubmissionKeysRef.current.has(cacheKey)) return;
    let active = true;
    const controller = new AbortController();
    void apiRequest<AssignmentSubmission[]>(
      `/instructor/assignments/${encodeURIComponent(selectedAssignmentId)}/submissions`,
      { roleCode: session.roleCode, signal: controller.signal },
    )
      .then((rows) => {
        if (!active || controller.signal.aborted) return;
        loadedSubmissionKeysRef.current.add(cacheKey);
        setSubmissionsByAssignment((prev) => ({ ...prev, [selectedAssignmentId]: rows }));
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.warn(`Không tải được bài nộp của ${selectedAssignmentId}:`, error);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeTab, item.id, selectedAssignmentId, session.roleCode, submissionsRefreshToken]);

  const selectedSubmissions = selectedAssignment
    ? submissionsByAssignment[selectedAssignment.id] ?? []
    : [];

  // Phân tích đường link bài giảng (YouTube, Facebook, Google Drive)
  const handleLinkChange = (value: string) => {
    setLectureInputUrl(value);
    const platform = detectLectureLinkPlatform(value);
    setLectureDetectedPlatform(platform);
    setLectureUrlError(value.trim() && platform === "INVALID" ? invalidLectureLinkMessage : "");
  };

  // Kiểm tra lựa chọn tệp; quá trình tải lên chỉ diễn ra khi lưu.
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validExtensions = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".jpg", ".png"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!validExtensions.includes(ext)) {
      notify("Định dạng tệp không được hỗ trợ. Hãy chọn PDF, Word, PowerPoint hoặc Ảnh.", "error");
      return;
    }

    setLectureFileObj(file);
  };

  // Lưu liên kết qua metadata hoặc tải tệp lên, rồi đồng bộ danh sách với máy chủ.
  const handleSaveLecture = async () => {
    if (lectureSaving) return;
    if (!lectureFormTitle.trim()) {
      notify("Vui lòng nhập tên bài giảng!", "error");
      return;
    }
    const lectureUrl = lectureInputUrl.trim();
    if (lectureMethod === "LINK" && detectLectureLinkPlatform(lectureUrl) === "INVALID") {
      notify(invalidLectureLinkMessage, "error");
      return;
    }
    if (lectureMethod === "FILE" && (!lectureFileObj || lectureFileObj.size === 0)) {
      notify("Vui lòng chọn tệp bài giảng hợp lệ.", "error");
      return;
    }
    const targetFolder = lectureFormFolder.trim();
    if (!targetFolder || !customLectureFolders.includes(targetFolder)) {
      notify("Vui lòng chọn hoặc tạo thư mục bài giảng hợp lệ trong lớp trước.", "error");
      return;
    }
    setLectureSaving(true);
    let uploadedId: string | null = null;
    try {
      const tags = [
        "LECTURE",
        ...lectureAttachedAssignments.map((id) => `assignmentId:${id}`),
      ];
      let created: Material;
      if (lectureMethod === "LINK") {
        created = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/materials`, {
          method: "POST", roleCode: session.roleCode,
          body: JSON.stringify({
            name: lectureFormTitle.trim(), mimeType: "text/uri-list",
            sizeBytes: new TextEncoder().encode(lectureUrl).length,
            folder: targetFolder,
            tags: [...tags, `lecture-url:${lectureUrl}`],
            scope: "CLASS",
            visibility: lectureFormVisibility,
          }),
        });
      } else {
        const form = new FormData();
        form.append("file", lectureFileObj!);
        form.append("folder", targetFolder);
        form.append("tags", tags.join(","));
        form.append("scope", "CLASS");
        form.append("visibility", lectureFormVisibility);
        created = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/material-uploads`, {
          method: "POST", roleCode: session.roleCode, body: form,
        });
      }
      if (!created?.id) throw new Error("Máy chủ không trả về ID bài giảng vừa lưu.");
      uploadedId = created.id;
      if (lectureFormTitle.trim() !== created.name || created.visibility !== lectureFormVisibility) {
        await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(created.id)}`, {
          method: "PATCH", roleCode: session.roleCode,
          body: JSON.stringify({
            name: lectureFormTitle.trim(),
            visibility: lectureFormVisibility,
          }),
        });
      }
      await loadClassData();
      setSelectedLectureId(created.id);
      setSelectedLectureFolder(targetFolder);
      setAddLectureModalOpen(false);
      notify("Đã lưu bài giảng.", "success");

      // Reset form
      setLectureFormTitle("");
      setLectureFormVisibility("PUBLISHED");
      setLectureInputUrl("");
      setLectureFileObj(null);
    } catch (err) {
      console.error("Lỗi khi lưu bài giảng:", err);
      if (uploadedId) await loadClassData();
      const detail = err instanceof Error ? err.message : "Không thể lưu bài giảng vào cơ sở dữ liệu";
      notify(uploadedId ? `Đã tạo bài giảng nhưng chưa hoàn tất cập nhật: ${detail}` : detail, "error");
    } finally {
      setLectureSaving(false);
    }
  };

  // Kiểm tra dữ liệu từ biểu mẫu và lưu bài thi hoặc bài tự luận qua API.
  // Select the confirmed exam immediately, including when a subsequent refresh fails.
  const selectCreatedExam = (exam: Exam) => {
    setClassExams(previous => [exam, ...previous.filter(row => row.id !== exam.id)]);
    setSelectedExamId(exam.id);
    examPage.refresh(exam.id);
    setSearchQuery("");
    setSelectedFolder("__ALL__");
    setAssignmentViewMode("list");
  };

  // Kiểm tra ràng buộc thời gian lớp và lưu bài tập hoặc đề thi mới tạo từ trình dựng đề.
  const handleSaveFromBuilder = async (data: Parameters<AssignmentBuilderModalProps["onSaveAssignment"]>[0]) => {
    const title = data.title.trim();
    if (title.length < 3) throw new Error("Tên bài cần ít nhất 3 ký tự.");
    if (item.status === "CLOSED") throw new Error("Lớp đã đóng, không thể tạo bài mới.");

    const now = Date.now();
    const classEnd = new Date(item.endAt).getTime();
    const openAt = data.settings.hasStartAt ? (parseLocalDateTimeInput(data.settings.startAt)?.getTime() ?? NaN) : now;
    const dueAt = data.settings.hasDueAt
      ? (parseLocalDateTimeInput(data.settings.dueAt)?.getTime() ?? NaN)
      : Math.min(now + 7 * 86400000, classEnd);
    if (![classEnd, openAt, dueAt].every(Number.isFinite) || classEnd <= now ||
      dueAt <= now || dueAt <= openAt || dueAt > classEnd) {
      throw new Error("Ngày bắt đầu và hạn nộp phải hợp lệ, nằm trong thời gian lớp và hạn nộp phải ở tương lai.");
    }

    if (data.type === "MULTIPLE_CHOICE") {
      if (!item.courseId) throw new Error("Lớp chưa liên kết khóa học để tạo đề trắc nghiệm.");
      if (data.questions.length === 0) throw new Error("Đề cần có ít nhất một câu hỏi.");
      const durationMinutes = data.settings.hasDuration ? data.settings.durationMinutes : 45;
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
        throw new Error("Thời lượng đề thi phải là số phút nguyên dương.");
      }
      if (!Number.isInteger(data.settings.maxAttempts) || data.settings.maxAttempts < 1 || data.settings.maxAttempts > 10) {
        throw new Error("Số lượt làm bài phải nằm trong khoảng từ 1 đến 10.");
      }

      const questions = data.questions.map((question, index) => {
        const resolvedType = question.questionType ?? "SINGLE_CHOICE";
        const validOptions = question.options
          .filter((option) => option.text.trim())
          .map((option) => {
            const key = option.key.trim().toUpperCase();
            const text = option.text.trim();
            return {
              key,
              text,
              value: resolvedType === "TRUE_FALSE" ? text : `${key}. ${text}`,
            };
          });
        const requestedKeys = (
          question.correctAnswers && question.correctAnswers.length > 0
            ? question.correctAnswers
            : [question.correctAnswer]
        )
          .map((entry) => entry.trim().toUpperCase())
          .filter(Boolean);
        const matchedAnswers = validOptions.filter((option) => requestedKeys.includes(option.key));
        if (question.type !== "Trắc nghiệm một đáp án" ||
          question.content.trim().length < 5 ||
          validOptions.length < 2 ||
          new Set(validOptions.map((option) => option.key)).size !== validOptions.length ||
          new Set(validOptions.map((option) => option.text.toLocaleLowerCase())).size !== validOptions.length ||
          matchedAnswers.length === 0) {
          throw new Error("Câu " + (index + 1) + ": cần nội dung hợp lệ, phương án khác nhau và đáp án đúng.");
        }
        if (!Number.isFinite(question.score) || question.score < 0.01 ||
          Math.abs(Math.round(question.score * 100) - question.score * 100) > 0.000001) {
          throw new Error("Câu " + (index + 1) + ": điểm phải từ 0,01 và có tối đa hai chữ số thập phân.");
        }
        return {
          courseId: item.courseId,
          content: question.content.trim(),
          type: resolvedType,
          options: validOptions.map((option) => option.value),
          correctAnswers: matchedAnswers.map((option) => option.value),
          difficulty: 2,
          tags: ["Trắc nghiệm", "Tạo đề trong lớp"],
        };
      });
      const totalScore = Math.round(data.questions.reduce((sum, question) => sum + question.score, 0) * 100) / 100;
      if (!Number.isFinite(totalScore) || totalScore < 0.25) {
        throw new Error("Tổng điểm đề thi phải ít nhất 0,25 điểm.");
      }

      const imported = await apiRequest<Array<{
        row: number;
        status: "IMPORTED" | "FAILED";
        questionId?: string;
        message: string;
      }>>("/instructor/question-bank/questions/import", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ questions }),
      });
      const successful = imported.filter((result) => result.status === "IMPORTED" && result.questionId);
      if (successful.length !== questions.length || imported.length !== questions.length) {
        const failed = imported.filter((result) => result.status !== "IMPORTED" || !result.questionId)
          .map((result) => "Câu " + result.row + ": " + result.message).join("; ");
        throw new Error("Chỉ nhập được " + successful.length + "/" + questions.length + " câu. ID đã lưu: " + (successful.map((result) => result.questionId).join(", ") || "không có") + ". " + failed + " Kiểm tra ngân hàng trước khi thử lại để tránh nhập trùng.");
      }
      const questionIds = successful.map((result) => result.questionId!);

      const createdExam = await apiRequest<Exam>("/instructor/exams", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: item.id,
          title,
          questionIds,
          durationMinutes,
          totalScore,
          openAt: new Date(openAt).toISOString(),
          closeAt: new Date(dueAt).toISOString(),
          attemptLimit: data.settings.maxAttempts,
          shuffleQuestions: data.settings.shuffleQuestions,
          aiTutorEnabled: Boolean(data.settings.aiTutorEnabled),
          scoreAllocations: questionIds.map((questionId, index) => ({
            questionId,
            score: data.questions[index]!.score,
          })),
        }),
      });
      const publishedExam = createdExam;
      selectCreatedExam(publishedExam);
      notify("Đã tạo và phát hành bài tập trắc nghiệm cho học viên.", "success");
    } else {
      const essayQuestions = data.essayQuestions.map((question) => question.trim()).filter(Boolean);
      if (!essayQuestions.length && !data.attachedFile) {
        throw new Error("Cần nhập ít nhất một câu hỏi tự luận hoặc đính kèm tệp đề.");
      }
      const description = data.description.trim() || "Bài tập tự luận: " + title;
      const instructions = [
        ...essayQuestions.map((question, index) => {
          const qScore = data.essayQuestionScores?.[index];
          const scoreLabel =
            typeof qScore === "number" && Number.isFinite(qScore) && essayQuestions.length > 1
              ? ` (${qScore} điểm)`
              : "";
          return `Câu ${index + 1}${scoreLabel}: ${question}`;
        }),
        ...(data.attachedFile ? ["Xem hoặc tải tệp đề đính kèm để làm bài."] : []),
        "Nhập nội dung bài làm hoặc tải lên tệp câu trả lời.",
      ].join("\n\n");
      if (instructions.length > 10000) {
        throw new Error("Nội dung câu hỏi vượt giới hạn 10.000 ký tự. Hãy rút gọn hoặc sử dụng tệp đề.");
      }

      let sourceMaterialId: string | undefined;
      if (data.attachedFile) {
        const form = new FormData();
        form.append("file", data.attachedFile);
        form.append("folder", "Bài tập tự luận");
        form.append("tags", "ESSAY,ASSIGNMENT");
        form.append("visibility", data.hidden ? "HIDDEN" : "PUBLISHED");
        form.append("scope", "CLASS");
        const uploaded = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/material-uploads`, {
          method: "POST",
          roleCode: session.roleCode,
          body: form,
        });
        if (!uploaded?.id) throw new Error("Máy chủ không trả về ID tệp đề đã tải lên.");
        sourceMaterialId = uploaded.id;
      }
      const mcPointsRaw = data.scoreBreakdown?.multipleChoicePoints ?? 0;
      const essayPointsRaw = data.scoreBreakdown?.essayPoints ?? 10;
      const mcPoints = Number.isFinite(mcPointsRaw) && mcPointsRaw > 0 ? Math.round(mcPointsRaw * 100) / 100 : 0;
      const essayPoints = Number.isFinite(essayPointsRaw) && essayPointsRaw > 0 ? Math.round(essayPointsRaw * 100) / 100 : 0;
      const rubricCriteria: Array<{ title: string; description: string; maxPoints: number }> = [];
      if (mcPoints > 0) {
        rubricCriteria.push({
          title: "Phần trắc nghiệm",
          description: "Điểm phần trắc nghiệm.",
          maxPoints: mcPoints,
        });
      }
      if (essayPoints > 0) {
        rubricCriteria.push({
          title: "Phần tự luận",
          description: "Điểm phần tự luận.",
          maxPoints: essayPoints,
        });
      }
      if (!rubricCriteria.length) {
        rubricCriteria.push({
          title: "Phần tự luận",
          description: "Điểm phần tự luận.",
          maxPoints: 10,
        });
      }
      const computedMaxScore =
        Math.round(rubricCriteria.reduce((sum, entry) => sum + entry.maxPoints, 0) * 100) / 100;

      let created: Assignment;
      try {
        created = await apiRequest<Assignment>(`/instructor/classes/${encodeURIComponent(item.id)}/assignments`, {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            title,
            description: description.length >= 10 ? description : "Bài tập tự luận: " + title,
            instructions,
            hidden: data.hidden,
            ...(sourceMaterialId ? { sourceMaterialId } : {}),
            dueAt: new Date(dueAt).toISOString(),
            maxScore: computedMaxScore,
            rubric: rubricCriteria,
          }),
        });
      } catch (error) {
        if (sourceMaterialId) {
          throw new Error(`Tệp đề đã tải lên thành công (ID: ${sourceMaterialId}) nhưng tạo bài tập thất bại: ${error instanceof Error ? error.message : String(error)}. Hãy kiểm tra kho tài liệu trước khi thử lại.`);
        }
        throw error;
      }
      if (created.status !== "PUBLISHED") {
        created = await apiRequest<Assignment>(`/instructor/assignments/${encodeURIComponent(created.id)}/publish`, {
          method: "POST",
          roleCode: session.roleCode,
        });
      }
      setSelectedExamId("");
      setSearchQuery("");
      setSelectedAssignment(created);
      notify(data.hidden ? "Đã tạo bài tập tự luận ở trạng thái ẩn." : "Đã tạo bài tập tự luận cho học viên.", "success");
    }

    await loadClassData();
    setAddAssignmentModalOpen(false);
  };
  // Thư mục bài giảng của lớp học (kết hợp từ dữ liệu thực tế và thư mục giảng viên vừa tạo)
  const lectureFolders = useMemo(
    () => [...customLectureFolders].sort((a, b) => a.localeCompare(b, "vi")),
    [customLectureFolders],
  );

  // Thư mục tài liệu của lớp học (kết hợp từ dữ liệu thực tế và thư mục giảng viên vừa tạo)
  const materialFolders = useMemo(
    () => [...customMaterialFolders].sort((a, b) => a.localeCompare(b, "vi")),
    [customMaterialFolders],
  );

  // Tạo thư mục mới đúng theo tab đang mở (Bài tập, Bài giảng hoặc Tài liệu)
  const handleCreateFolder = async () => {
    const folderName = newFolderInput.trim();
    const kind = activeTab === "lectures" || activeTab === "materials" ? activeTab : "assignments";
    if (!folderName) return;
    try {
      const folders = await apiRequest<{ assignments: string[]; lectures: string[]; materials: string[] }>(
        `/instructor/classes/${encodeURIComponent(item.id)}/folders`,
        { method: "POST", roleCode: session.roleCode, body: JSON.stringify({ kind, name: folderName }) }
      );
      setCustomFolders(folders.assignments);
      setCustomLectureFolders(folders.lectures);
      setCustomMaterialFolders(folders.materials);
    } catch {
      notify("Không tạo được thư mục trong lớp.", "error");
      return;
    }
    if (kind === "lectures") {
      setSelectedLectureFolder(folderName);
      setLectureFormFolder(folderName);
    } else if (kind === "materials") {
      setSelectedMaterialFolder(folderName);
      setMaterialFormFolder(folderName);
    } else {
      setSelectedFolder(folderName);
    }
    setNewFolderInput("");
    setShowNewFolderModal(false);
    notify("Đã tạo thư mục mới!", "success");
  };

  // Xóa học liệu bài giảng tại máy chủ rồi đồng bộ lại danh sách.
  const handleDeleteLecture = async (lectureId: string, lectureTitle: string) => {
    if (lectureSaving || !window.confirm(t(`Bạn có chắc muốn xóa bài giảng "${lectureTitle}" không?`))) return;
    setLectureSaving(true);
    try {
      await apiRequest(`/instructor/materials/${encodeURIComponent(lectureId)}`, {
        method: "DELETE", roleCode: session.roleCode,
      });
      await loadClassData();
      if (selectedLectureForPage?.id === lectureId) {
        setSelectedLectureForPage(null);
      }
      notify("Đã xóa bài giảng thành công!", "success");
    } catch (error) {
      console.error("Lỗi xóa bài giảng:", error);
      notify(error instanceof Error ? error.message : "Không thể xóa bài giảng.", "error");
    } finally {
      setLectureSaving(false);
    }
  };

  // Xử lý thay đổi liên kết bài giảng khi chỉnh sửa
  const handleEditLectureLinkChange = (value: string) => {
    setEditLectureInputUrl(value);
    const platform = detectLectureLinkPlatform(value);
    setEditLectureDetectedPlatform(platform);
    setEditLectureUrlError(value.trim() && platform === "INVALID" ? invalidLectureLinkMessage : "");
  };

  // Ghi nhận tệp thay thế; chỉ gửi lên máy chủ khi người dùng lưu.
  const handleEditLectureFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validExtensions = [".pdf", ".docx", ".doc", ".pptx", ".ppt", ".mp4", ".mov", ".jpg", ".png"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!validExtensions.includes(ext)) {
      notify("Định dạng tệp không được hỗ trợ. Hãy chọn PowerPoint, Video, PDF hoặc Word.", "error");
      return;
    }
    setEditLectureFileObj(file);
  };

  // Chuyển đổi trạng thái hiển thị hoặc ẩn của bài giảng/tài liệu đối với học viên.
  const handleToggleResourceVisibility = async (
    resourceId: string,
    currentVisibility: "PUBLISHED" | "HIDDEN",
    resourceLabel: string,
  ) => {
    const nextVisibility: "PUBLISHED" | "HIDDEN" =
      currentVisibility === "HIDDEN" ? "PUBLISHED" : "HIDDEN";
    try {
      await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(resourceId)}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      await loadClassData();
      notify(
        nextVisibility === "HIDDEN"
          ? `Đã ẩn "${resourceLabel}" đối với học sinh.`
          : `Đã hiển thị "${resourceLabel}" cho học sinh.`,
        "success",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không thể cập nhật trạng thái hiển thị.",
        "error",
      );
    }
  };

  // Mở modal sửa bài giảng với đầy đủ dữ liệu nguồn (Link hoặc File)
  const handleOpenEditLecture = (lec: LectureItem) => {
    setEditingLecture({ ...lec });
    setEditLectureFormTitle(lec.title);
    setEditLectureFormVisibility(lec.visibility || "PUBLISHED");
    setEditLectureFormFolder(lec.folder);
    setEditLectureFileObj(null);

    if (lec.sourceType === "LINK") {
      setEditLectureMethod("LINK");
      const url = lec.sourceUrl || (lec.youtubeId ? `https://www.youtube.com/watch?v=${lec.youtubeId}` : "");
      setEditLectureInputUrl(url);
      setEditLectureDetectedPlatform(detectLectureLinkPlatform(url));
    } else {
      setEditLectureMethod("FILE");
      setEditLectureInputUrl("");
      setEditLectureDetectedPlatform("INVALID");
    }
    setEditLectureModalOpen(true);
  };

  // Ghi phiên bản tệp mới và metadata vào API, giữ trạng thái khi lưu thất bại.
  const handleSaveEditLecture = async () => {
    if (lectureSaving) return;
    if (!editingLecture || !editLectureFormTitle.trim()) {
      notify("Vui lòng nhập tên bài giảng!", "error");
      return;
    }
    const nextUrl = editLectureInputUrl.trim();
    if (editLectureMethod === "LINK" && detectLectureLinkPlatform(nextUrl) === "INVALID") {
      notify(invalidLectureLinkMessage, "error");
      return;
    }
    if (editLectureMethod === "FILE" && editingLecture.sourceType === "LINK" && !editLectureFileObj) {
      notify("Cần chọn tệp để thay thế nguồn liên kết hiện tại.", "error");
      return;
    }
    if (editLectureMethod === "LINK" && editingLecture.sourceType === "FILE") {
      notify("Để chuyển bài giảng từ tệp sang liên kết, hãy tạo bài giảng liên kết mới.", "error");
      return;
    }
    const targetFolder = editLectureFormFolder.trim() || "Bài giảng chung";
    const tags = (editingLecture.tags ?? []).filter((tag) =>
      !tag.startsWith("Mô tả: ") && !tag.startsWith("youtube:") && !tag.startsWith("lecture-url:"));
    if (!tags.some((tag) => /^(lecture|bài giảng)$/i.test(tag))) tags.push("LECTURE");
    if (editLectureMethod === "LINK") tags.push(`lecture-url:${nextUrl}`);
    setLectureSaving(true);
    let versionUploaded = false;
    try {
      const path = `/instructor/materials/${encodeURIComponent(editingLecture.id)}`;
      if (editLectureMethod === "FILE" && editLectureFileObj) {
        if (editLectureFileObj.size === 0) throw new Error("Tệp thay thế không có dữ liệu.");
        const form = new FormData();
        form.append("file", editLectureFileObj);
        form.append("folder", targetFolder);
        form.append("tags", tags.join(","));
        form.append("visibility", editLectureFormVisibility);
        await apiRequest<Material>(`${path}/file`, {
          method: "PUT", roleCode: session.roleCode, body: form,
        });
        versionUploaded = true;
      }
      await apiRequest<Material>(path, {
        method: "PATCH", roleCode: session.roleCode,
        body: JSON.stringify({
          name: editLectureFormTitle.trim(),
          folder: targetFolder,
          tags,
          visibility: editLectureFormVisibility,
        }),
      });
      await loadClassData();
      setEditLectureModalOpen(false);
      setEditingLecture(null);
      setEditLectureFileObj(null);
      notify("Đã cập nhật bài giảng thành công!", "success");
    } catch (error) {
      console.error("Lỗi cập nhật bài giảng:", error);
      if (versionUploaded) await loadClassData();
      const detail = error instanceof Error ? error.message : "Lỗi API";
      notify(versionUploaded ? `Đã tải phiên bản mới nhưng metadata chưa lưu xong: ${detail}` : detail, "error");
    } finally {
      setLectureSaving(false);
    }
  };

  // Xóa tài liệu thực tế trên máy chủ rồi đồng bộ lại danh sách.
  const handleDeleteMaterial = async (materialId: string, materialTitle: string) => {
    if (materialSaving || !window.confirm(t(`Bạn có chắc muốn xóa tài liệu "${materialTitle}" không?`))) return;
    setMaterialSaving(true);
    try {
      await apiRequest(`/instructor/materials/${encodeURIComponent(materialId)}`, {
        method: "DELETE", roleCode: session.roleCode,
      });
      setMaterialsList((prev) => prev.filter((m) => m.id !== materialId));
      setSelectedMaterialId((current) => current === materialId ? "" : current);
      notify("Đã xóa tài liệu thành công!", "success");
    } catch (error) {
      console.error("Lỗi xóa tài liệu:", error);
      notify(error instanceof Error ? error.message : "Không thể xóa tài liệu.", "error");
    } finally {
      setMaterialSaving(false);
    }
  };

  // Lấy URL truy cập hợp lệ rồi tải tệp thật từ máy chủ.
  const handleDownloadMaterial = async (materialId: string) => {
    try {
      const access = await apiRequest<{ url: string }>(
        `/materials/${encodeURIComponent(materialId)}/access?action=DOWNLOAD`,
        { roleCode: session.roleCode },
      );
      await downloadApiFile(access.url, session.roleCode);
    } catch (error) {
      console.error("Không tải được tài liệu:", error);
      notify(error instanceof Error ? error.message : "Không tải được tài liệu.", "error");
    }
  };

  // Mở tệp đề tự luận trong tab mới qua URL truy cập có phân quyền.
  const handlePreviewMaterial = async (materialId: string) => {
    const previewWindow = detachOpener(window.open("", "_blank"));
    if (!previewWindow) {
      notify("Trình duyệt đã chặn cửa sổ xem đề.", "error");
      return;
    }
    try {
      const access = await apiRequest<{ url: string }>(
        `/materials/${encodeURIComponent(materialId)}/access?action=PREVIEW`,
        { roleCode: session.roleCode },
      );
      previewWindow.location.href = access.url;
    } catch (error) {
      previewWindow.close();
      notify(error instanceof Error ? error.message : "Không thể xem tệp đề.", "error");
    }
  };

  // Xử lý chọn tệp mới từ máy tính khi chỉnh sửa tài liệu
  const handleEditMaterialFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEditMaterialFileObj(file);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    notify(`Đã nhận diện tệp mới: ${file.name} (${sizeMb} MB)`, "info");
  };

  // Mở modal sửa tài liệu và nạp toàn bộ thông tin
  const handleOpenEditMaterial = (mat: MaterialDisplayItem) => {
    setEditingMaterial({ ...mat });
    setEditMaterialFormTitle(mat.title);
    setEditMaterialFormFolder(mat.folder);
    setEditMaterialFormVisibility(mat.visibility || "PUBLISHED");
    setEditMaterialFileObj(null);
    setEditMaterialModalOpen(true);
  };

  // Lưu chỉnh sửa tài liệu bao gồm tệp thay thế từ máy tính
  const handleSaveEditMaterial = async () => {
    if (materialSaving) return;
    if (!editingMaterial || !editMaterialFormTitle.trim()) {
      notify("Vui lòng nhập tên tài liệu!", "error");
      return;
    }
    const targetFolder = editMaterialFormFolder.trim();
    if (!targetFolder || !materialFolders.includes(targetFolder)) {
      notify("Vui lòng chọn thư mục tài liệu hợp lệ trong lớp.", "error");
      return;
    }
    setMaterialSaving(true);
    let versionUploaded = false;
    try {
      const path = `/instructor/materials/${encodeURIComponent(editingMaterial.id)}`;
      const existingTags = rawMaterialsMapRef.current.get(editingMaterial.id)?.tags ?? [];
      const tags = existingTags.filter((tag) => !tag.startsWith("Mô tả: "));
      if (editMaterialFileObj) {
        const form = new FormData();
        form.append("file", editMaterialFileObj);
        form.append("folder", targetFolder);
        form.append("tags", tags.join(","));
        form.append("visibility", editMaterialFormVisibility);
        await apiRequest<Material>(`${path}/file`, { method: "PUT", roleCode: session.roleCode, body: form });
        versionUploaded = true;
      }
      await apiRequest<Material>(path, {
        method: "PATCH", roleCode: session.roleCode,
        body: JSON.stringify({
          name: editMaterialFormTitle.trim(),
          folder: targetFolder,
          tags,
          visibility: editMaterialFormVisibility,
        }),
      });
      await loadClassData();
      setEditMaterialModalOpen(false);
      setEditingMaterial(null);
      setEditMaterialFileObj(null);
      notify("Đã cập nhật tài liệu thành công!", "success");
    } catch (error) {
      console.error("Lỗi cập nhật tài liệu:", error);
      if (versionUploaded) await loadClassData();
      const detail = error instanceof Error ? error.message : "Lỗi API";
      notify(versionUploaded ? `Tệp đã được thay thế nhưng chưa lưu được thông tin: ${detail}` : detail, "error");
    } finally {
      setMaterialSaving(false);
    }
  };

  // Mở hộp thoại xem đề ngay trong lớp học (không điều hướng sang trang Đề thi).
  const openWorkPreview = () => {
    if (selectedClassExam) {
      setPreviewExamContent(selectedClassExam);
      return;
    }
    if (selectedAssignment) {
      setPreviewAssignment(selectedAssignment);
    }
  };

  // Mở chế độ làm thử đề giống học sinh nhưng không lưu dữ liệu lịch sử làm bài.
  const openWorkTrial = () => {
    if (selectedClassExam) {
      setPreviewExam({
        id: selectedClassExam.id,
        title: selectedClassExam.title,
        durationMinutes: selectedClassExam.durationMinutes,
        totalQuestions: selectedClassExam.questionIds.length,
        totalScore: selectedClassExam.totalScore,
        closeAt: selectedClassExam.closeAt,
        questionScores: selectedClassExam.questionScores,
        aiTutorEnabled: selectedClassExam.aiTutorEnabled,
      });
      return;
    }
    if (selectedAssignment) {
      setTrialAssignment(selectedAssignment);
    }
  };

  // Mở hộp thoại chỉnh sửa trực tiếp cho đề trắc nghiệm hoặc bài tự luận trong lớp.
  const openWorkEdit = () => {
    if (selectedClassExam) {
      setEditingClassExam(selectedClassExam);
      return;
    }
    if (selectedAssignment) {
      setEditingAssignment(selectedAssignment);
    }
  };

  // Cập nhật ẩn/hiện hoặc xóa bài tập đang được chọn theo phiên bản hiển thị.
  const changeSelectedWork = async (action: "visibility" | "delete") => {
    const work = selectedWork;
    if (!work || changingWork) return;
    const isExam = Boolean(selectedClassExam);
    const path = "/instructor/" + (isExam ? "exams/" : "assignments/") + encodeURIComponent(work.id);
    if (action === "delete" && !window.confirm('Xóa “' + work.title + '” cùng các bài làm và điểm liên quan?')) return;
    setChangingWork(true);
    try {
      if (action === "delete") {
        await apiRequest(path, { method: "DELETE", roleCode: session.roleCode, body: JSON.stringify({ expectedVersion: work.version }) });
        if (isExam) {
          setClassExams(rows => rows.filter(row => row.id !== work.id));
          examPage.refresh();
          setSelectedExamId(current => current === work.id ? "" : current);
        } else {
          setAssignments(rows => rows.filter(row => row.id !== work.id));
          setSelectedAssignment(row => row?.id === work.id ? null : row);
        }
        setAssignmentViewMode("list");
        notify("Đã xóa bài tập.", "success");
      } else {
        const result = await apiRequest<{ hidden: boolean; version: number }>(path + "/visibility", {
          method: "PATCH", roleCode: session.roleCode, body: JSON.stringify({ hidden: !work.hidden, expectedVersion: work.version }),
        });
        if (isExam) setClassExams(rows => rows.map(row => row.id === work.id ? { ...row, ...result } : row));
        else {
          setAssignments(rows => rows.map(row => row.id === work.id ? { ...row, ...result } : row));
          setSelectedAssignment(row => row?.id === work.id ? { ...row, ...result } : row);
        }
        notify(result.hidden ? "Đã ẩn bài tập." : "Đã hiện bài tập.", "success");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không cập nhật được bài tập.", "error");
    } finally {
      setChangingWork(false);
    }
  };

  // Mở Hub điều phối chọn phương thức tạo Bài tập hoặc bổ sung Ngân hàng câu hỏi.
  const handleOpenCreationHub = (target: "ASSIGNMENT" | "QUESTION") => {
    setCreationTarget(target);
    setAssignmentHubType(null);
    setOpenedFromCreationHub(false);
    setCreationHubOpen(true);
  };

  // Đóng modal phương thức hiện tại và quay lại màn hình chọn cách tạo khác trong Hub.
  const handleReturnToCreationHub = () => {
    setAddAssignmentModalOpen(false);
    setBuilderInitialMethod(undefined);
    setScanModalOpen(false);
    setAiExamModalOpen(false);
    setManualExamModalOpen(false);
    setAuthoringModalOpen(false);
    setAuthoringPreview(false);
    setCreationHubOpen(true);
  };

  /** Lưu câu hỏi vào ngân hàng thật và chuẩn bị để công bố trong luồng tạo đề. */
  const handleSaveManualQuestion = async () => {
    if (authoringSaving) return;
    if (!item.courseId) {
      notify("Lớp chưa gắn với khóa học nên không thể lưu câu hỏi.", "error");
      return;
    }
    if (authoringContent.trim().length < 5) {
      notify("Nội dung câu hỏi cần ít nhất 5 ký tự.", "error");
      return;
    }
    const options = authoringType === "ESSAY" ? [] : authoringOptions.map((option) => option.trim());
    const correctAnswers = authoringType === "ESSAY" ? [] : [
      ...new Set(authoringCorrect.map((index) => options[index]).filter((answer): answer is string => Boolean(answer))),
    ];
    if (authoringType !== "ESSAY" && (options.some((option) => !option) || options.length < 2 || correctAnswers.length === 0)) {
      notify("Câu trắc nghiệm phải có ít nhất 2 phương án và 1 đáp án đúng hợp lệ.", "error");
      return;
    }
    setAuthoringSaving(true);
    try {
      await apiRequest<Question>("/instructor/question-bank/questions", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          courseId: item.courseId,
          type: authoringType,
          content: authoringContent.trim(),
          options,
          correctAnswers,
          difficulty: authoringDifficulty === "EASY" ? 1 : authoringDifficulty === "MEDIUM" ? 2 : 3,
          tags: ["Soạn thủ công"],
        }),
      });
      await refreshQuestionData();
      setAuthoringModalOpen(false);
      setAuthoringPreview(false);
      setAuthoringContent("");
      notify("Đã lưu câu hỏi nháp vào ngân hàng. Cần duyệt và xuất bản trước khi tạo đề thi.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được câu hỏi.", "error");
    } finally {
      setAuthoringSaving(false);
    }
  };

  // Mở modal chỉnh sửa câu hỏi trong ngân hàng lớp
  const handleOpenEditQuestion = (q: ClassQuestion) => {
    setEditingQuestionPreview(false);
    setEditingQuestionData({
      id: q.id,
      content: q.content,
      type: q.type || "Trắc nghiệm một đáp án",
      difficulty: q.difficulty || "Thông hiểu",
      source: q.source || "Ngân hàng câu hỏi",
      options: q.options ? [...q.options] : ["Phương án A", "Phương án B", "Phương án C", "Phương án D"],
      correctAnswers: q.correctAnswers ? [...q.correctAnswers] : [0],
      solution: q.solution || "",
    });
    setEditingQuestionModalOpen(true);
  };

  // Lưu câu hỏi tại chỗ hoặc chờ API tạo version mới rồi mới xác nhận thành công.
  const handleSaveEditedQuestion = async () => {
    if (!editingQuestionData || editingQuestionSaving) return;
    if (!editingQuestionData.content.trim()) {
      notify("Vui lòng nhập nội dung câu hỏi!", "error");
      return;
    }

    try {
        setEditingQuestionSaving(true);
        const options = editingQuestionData.options.map((option) => option.trim()).filter(Boolean);
        const correctAnswers = editingQuestionData.type === "Tự luận" ? [] : [
          ...new Set(editingQuestionData.correctAnswers.map((idx) => editingQuestionData.options[idx]?.trim()).filter((answer): answer is string => Boolean(answer))),
        ];
        const questionType = editingQuestionData.type === "Tự luận" ? "ESSAY"
          : ["Nhiều đáp án", "Trắc nghiệm nhiều đáp án"].includes(editingQuestionData.type) ? "MULTIPLE_CHOICE"
          : editingQuestionData.type === "Đúng / Sai" ? "TRUE_FALSE"
          : editingQuestionData.type === "Điền khuyết" ? "SHORT_ANSWER" : "SINGLE_CHOICE";
        await apiRequest<{ id: string }>(`/instructor/question-bank/questions/${editingQuestionData.id}`, {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            courseId: item.courseId,
            content: editingQuestionData.content.trim(),
            type: questionType,
            options,
            correctAnswers,
            difficulty: editingQuestionData.difficulty === "Cơ bản" ? 1 : editingQuestionData.difficulty === "Thông hiểu" ? 2 : 3,
            tags: editingQuestionData.source.split(",").map((tag) => tag.trim()).filter(Boolean),
          }),
        });
        await refreshQuestionData();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật câu hỏi.", "error");
      return;
    } finally {
      setEditingQuestionSaving(false);
    }

    setEditingQuestionModalOpen(false);
    setEditingQuestionPreview(false);
    setEditingQuestionData(null);
    notify("Đã cập nhật câu hỏi thành công!", "success");
  };

  /** Trộn danh sách độc lập bằng Fisher–Yates để mọi hoán vị có cơ hội như nhau. */
  const shuffleQuestionPool = (questions: ClassQuestion[]): ClassQuestion[] => {
    const result = [...questions];
    for (let index = result.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      const current = result[index]!;
      result[index] = result[swapIndex]!;
      result[swapIndex] = current;
    }
    return result;
  };

  /** Chia đều thang điểm mục tiêu cho danh sách mã câu hỏi ngân hàng đang chọn. */
  const buildEqualBankScoreMap = (questionIds: string[], targetTotal: number): Record<string, number> => {
    const equal = distributeEqualQuestionScores(
      questionIds.length,
      targetTotal >= 0.25 ? targetTotal : 10,
    );
    return Object.fromEntries(questionIds.map((qid, idx) => [qid, equal[idx] ?? 1]));
  };

  /** Tạo đề trắc nghiệm hoặc bài tập tự luận đã phát hành từ câu hỏi ngân hàng đúng theo loại bài và mức điểm đã chọn. */
  const persistAndCacheExam = async (
    title: string,
    selectedQuestions: ClassQuestion[],
    shuffleQuestions = false,
    customScoresMap?: Record<string, number>,
  ): Promise<boolean> => {
    if (examSaving) return false;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      notify("Tiêu đề bài tập cần ít nhất 3 ký tự.", "error");
      return false;
    }
    if (!selectedQuestions.length || selectedQuestions.some((question) => question.status !== "PUBLISHED")) {
      notify("Chỉ được đóng gói từ câu hỏi đã xuất bản trong ngân hàng.", "error");
      return false;
    }
    const openAt = new Date();
    const closeAt = manualExamDueAt ? parseLocalDateTimeInput(manualExamDueAt) : new Date(openAt.getTime() + 7 * 86400000);
    if (!closeAt || closeAt <= openAt) {
      notify("Hạn nộp phải hợp lệ và muộn hơn thời điểm hiện tại.", "error");
      return false;
    }

    const fallbackEqual = distributeEqualQuestionScores(
      selectedQuestions.length,
      manualExamTargetScore >= 0.25 ? manualExamTargetScore : 10,
    );
    const resolvedScores = selectedQuestions.map((question, idx) => {
      const candidate = customScoresMap?.[question.id];
      return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0.01
        ? Math.round(candidate * 100) / 100
        : (fallbackEqual[idx] ?? 1);
    });
    const resolvedTotalScore =
      Math.round(resolvedScores.reduce((acc, sc) => acc + sc, 0) * 100) / 100;
    if (!Number.isFinite(resolvedTotalScore) || resolvedTotalScore < 0.25 || resolvedTotalScore > 1000) {
      notify("Tổng điểm bài tập cần nằm trong khoảng từ 0,25 đến 1000 điểm.", "error");
      return false;
    }

    if (bankBuilderAssignmentType === "ESSAY") {
      if (selectedQuestions.some((question) => question.type !== "Tự luận")) {
        notify("Bài tập tự luận chỉ nhận câu hỏi dạng Tự luận. Hãy bỏ chọn các câu trắc nghiệm.", "error");
        return false;
      }
      setExamSaving(true);
      try {
        const instructions = [
          ...selectedQuestions.map((question, idx) => {
            const scoreLabel =
              selectedQuestions.length > 1 ? ` (${resolvedScores[idx]} điểm)` : "";
            return `Câu ${idx + 1}${scoreLabel}: ${question.content.trim()}`;
          }),
          "Nhập nội dung bài làm hoặc tải lên tệp câu trả lời.",
        ].join("\n\n");
        let created = await apiRequest<Assignment>(
          `/instructor/classes/${encodeURIComponent(item.id)}/assignments`,
          {
            method: "POST",
            roleCode: session.roleCode,
            body: JSON.stringify({
              title: trimmedTitle,
              description: `Bài tập tự luận từ ngân hàng câu hỏi: ${trimmedTitle}`,
              instructions,
              hidden: false,
              dueAt: closeAt.toISOString(),
              maxScore: resolvedTotalScore,
              rubric: [
                {
                  title: "Phần tự luận",
                  description: "Điểm phần tự luận.",
                  maxPoints: resolvedTotalScore,
                },
              ],
            }),
          },
        );
        if (created.status !== "PUBLISHED") {
          created = await apiRequest<Assignment>(
            `/instructor/assignments/${encodeURIComponent(created.id)}/publish`,
            {
              method: "POST",
              roleCode: session.roleCode,
            },
          );
        }
        setSelectedExamId("");
        setSearchQuery("");
        setSelectedAssignment(created);
        await loadClassData();
        notify(
          `Đã tạo và phát hành bài tập tự luận '${created.title}' gồm ${selectedQuestions.length} câu (tổng ${resolvedTotalScore} điểm).`,
          "success",
        );
        return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : "Không thể tạo bài tập tự luận.", "error");
        return false;
      } finally {
        setExamSaving(false);
      }
    }

    if (!Number.isInteger(manualExamDuration) || manualExamDuration < 1) {
      notify("Thời lượng đề thi phải là số phút nguyên dương.", "error");
      return false;
    }
    if (selectedQuestions.some((question) => question.type === "Tự luận")) {
      notify("Đề trắc nghiệm chỉ sử dụng câu hỏi trắc nghiệm. Hãy bỏ chọn câu tự luận.", "error");
      return false;
    }

    setExamSaving(true);
    try {
      const created = await apiRequest<Exam>("/instructor/exams", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: item.id,
          title: trimmedTitle,
          questionIds: selectedQuestions.map((question) => question.id),
          durationMinutes: manualExamDuration,
          totalScore: resolvedTotalScore,
          openAt: openAt.toISOString(),
          closeAt: closeAt.toISOString(),
          attemptLimit: 1,
          shuffleQuestions,
          aiTutorEnabled: manualExamTutorEnabled,
          scoreAllocations: selectedQuestions.map((question, idx) => ({
            questionId: question.id,
            score: resolvedScores[idx]!,
          })),
        }),
      });
      if (!created?.id) throw new Error("Máy chủ không trả về đề thi vừa tạo.");
      const published = created;
      selectCreatedExam(published);
      await loadClassData();
      notify("Đã tạo và phát hành đề thi '" + published.title + "' gồm " + selectedQuestions.length + " câu (tổng " + resolvedTotalScore + " điểm).", "success");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tạo đề thi.", "error");
      return false;
    } finally {
      setExamSaving(false);
    }
  };

  /** Tạo đề từ tập câu hỏi được giáo viên chọn thủ công. */
  const handleCreateExamManual = async () => {
    if (manualExamSelectedQuestions.length === 0) {
      notify("Vui lòng chọn ít nhất một câu hỏi đã xuất bản.", "error");
      return;
    }
    const selected = publishedClassQuestions.filter((question) => manualExamSelectedQuestions.includes(question.id));
    if (selected.length !== manualExamSelectedQuestions.length) {
      notify("Một số câu hỏi không còn trong ngân hàng. Hãy chọn lại.", "error");
      return;
    }
    if (await persistAndCacheExam(manualExamTitle, selected, false, manualExamQuestionScores)) {
      setManualExamModalOpen(false);
      setManualExamTitle("");
      setManualExamSelectedQuestions([]);
      setManualExamQuestionScores({});
      setManualExamCustomScored(false);
    }
  };

  /** Chọn đúng số câu theo ma trận từ nhóm PUBLISHED cùng loại bài và kiểm tra đủ nguồn theo từng mức. */
  const handleTriggerAiCriteriaSelection = () => {
    const pool = scopedPublishedBankQuestions;
    const ratios = [aiRatioBasic, aiRatioMedium, aiRatioHard, aiRatioVeryHard];
    if (!Number.isInteger(aiCriteriaQuestionCount) || aiCriteriaQuestionCount < 1 ||
      ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0) ||
      ratios.reduce((sum, ratio) => sum + ratio, 0) !== 100) {
      notify("Số câu phải hợp lệ và tổng tỷ lệ độ khó phải bằng 100%.", "error");
      setAiCriteriaPreviewList([]);
      return;
    }
    if (pool.length < aiCriteriaQuestionCount) {
      notify("Không đủ câu hỏi đã xuất bản cho số lượng yêu cầu.", "error");
      setAiCriteriaPreviewList([]);
      return;
    }
    // API hiện hỗ trợ ba độ khó; mốc vận dụng cao được gộp vào vận dụng.
    const basic = Math.round(aiCriteriaQuestionCount * aiRatioBasic / 100);
    const medium = Math.round(aiCriteriaQuestionCount * (aiRatioBasic + aiRatioMedium) / 100) - basic;
    const hard = aiCriteriaQuestionCount - basic - medium;
    const groups = [
      { level: "Cơ bản", count: basic },
      { level: "Thông hiểu", count: medium },
      { level: "Vận dụng", count: hard },
    ];
    const picked: ClassQuestion[] = [];
    for (const group of groups) {
      const available = shuffleQuestionPool(pool.filter((q) =>
        group.level === "Vận dụng" ? ["Vận dụng", "Vận dụng cao"].includes(q.difficulty) : q.difficulty === group.level
      ));
      if (available.length < group.count) {
        notify("Thiếu câu hỏi mức " + group.level + ": cần " + group.count + ", hiện có " + available.length + ".", "error");
        setAiCriteriaPreviewList([]);
        return;
      }
      picked.push(...available.slice(0, group.count));
    }
    const shuffledPicked = shuffleQuestionPool(picked);
    setAiCriteriaPreviewList(shuffledPicked);
    setManualExamCustomScored(false);
    setManualExamQuestionScores(
      buildEqualBankScoreMap(
        shuffledPicked.map((q) => q.id),
        manualExamTargetScore,
      ),
    );
    notify("Đã chọn đủ " + picked.length + " câu theo ma trận độ khó. Hãy xem trước trước khi tạo đề.", "success");
  };

  /** Lưu đề thi từ bản xem trước đã được lựa chọn theo ma trận. */
  const handleCreateExamAiCriteria = async () => {
    if (!aiCriteriaPreviewList.length || aiCriteriaPreviewList.length !== aiCriteriaQuestionCount) {
      notify("Hãy chọn và kiểm tra bản xem trước theo ma trận trước khi tạo đề.", "error");
      return;
    }
    if (!aiCriteriaPreviewIsCurrent) {
      notify("Ngân hàng câu hỏi đã thay đổi so với bản xem trước. Hãy chọn lại.", "error");
      setAiCriteriaPreviewList([]);
      return;
    }
    if (await persistAndCacheExam(manualExamTitle, aiCriteriaPreviewList, false, manualExamQuestionScores)) {
      setManualExamModalOpen(false);
      setManualExamTitle("");
      setAiCriteriaPreviewList([]);
      setManualExamQuestionScores({});
      setManualExamCustomScored(false);
    }
  };

  /** Bốc đủ số câu từ câu hỏi đã xuất bản đúng loại đề đã chọn và tạo đề thi / bài tự luận thật. */
  const handleCreateExamRandom = async () => {
    const pool = scopedPublishedBankQuestions;
    if (!Number.isInteger(randomQuestionCount) || randomQuestionCount < 1 || pool.length < randomQuestionCount) {
      notify("Ngân hàng chưa có đủ câu hỏi đã xuất bản theo phạm vi yêu cầu.", "error");
      return;
    }
    const picked = shuffleQuestionPool(pool).slice(0, randomQuestionCount);
    if (await persistAndCacheExam(manualExamTitle, picked, randomShuffle)) {
      setManualExamModalOpen(false);
      setManualExamTitle("");
    }
  };


  // Lưu thêm tài liệu mới trực tiếp vào cơ sở dữ liệu PostgreSQL
  const handleSaveNewMaterial = async () => {
    if (materialSaving) return;
    if (!materialFormTitle.trim()) {
      notify("Vui lòng nhập tên tài liệu!", "error");
      return;
    }
    if (!materialUploadFile || materialUploadFile.size === 0) {
      notify("Vui lòng chọn tệp tài liệu hợp lệ!", "error");
      return;
    }
    const targetFolder = materialFormFolder.trim();
    if (!targetFolder || !materialFolders.includes(targetFolder)) {
      notify("Vui lòng chọn hoặc tạo thư mục tài liệu hợp lệ trong lớp trước.", "error");
      return;
    }
    setMaterialSaving(true);
    let uploadedId: string | null = null;
    try {
      const form = new FormData();
      form.append("file", materialUploadFile);
      form.append("folder", targetFolder);
      form.append("tags", "");
      form.append("scope", "CLASS");
      form.append("visibility", materialFormVisibility);
      const created = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/material-uploads`, {
        method: "POST", roleCode: session.roleCode, body: form,
      });
      if (!created?.id) throw new Error("Máy chủ không trả về ID tài liệu vừa tải lên.");
      uploadedId = created.id;
      if (materialFormTitle.trim() !== created.name || created.visibility !== materialFormVisibility) {
        await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(created.id)}`, {
          method: "PATCH", roleCode: session.roleCode,
          body: JSON.stringify({
            name: materialFormTitle.trim(),
            visibility: materialFormVisibility,
          }),
        });
      }
      await loadClassData();
      setSelectedMaterialId(created.id);
      setSelectedMaterialFolder(targetFolder);
      setAddMaterialModalOpen(false);
      setMaterialFormTitle("");
      setMaterialFormVisibility("PUBLISHED");
      setMaterialUploadFile(null);
      notify("Đã tải lên và lưu tài liệu thành công!", "success");
    } catch (err) {
      console.error("Lỗi khi lưu tài liệu:", err);
      if (uploadedId) await loadClassData();
      const detail = err instanceof Error ? err.message : "Lỗi API";
      notify(uploadedId ? `Tệp đã tải lên nhưng bước cập nhật hoặc làm mới thất bại: ${detail}` : detail, "error");
    } finally {
      setMaterialSaving(false);
    }
  };

  // =========================================================================
  // TRANG CHI TIẾT XEM BÀI GIẢNG (THEO ẢNH 2 CHUẨN CỦA HỌC SINH VÀ GIẢNG VIÊN)
  // =========================================================================
  if (selectedLectureForPage) {
    const lecturePlaylist = lectures.filter(
      (l) => selectedLectureFolder === "__ALL__" || l.folder === selectedLectureFolder
    );

    return (
      <div className="w-full px-5 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col lg:flex-row gap-5 items-start">
          {/* CỘT 1: HEADER DỌC LỚP HỌC (CHUẨN ẢNH 2) */}
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
                  {item.name || "Lớp học"}
                </h2>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code || "OPS-K01"}</strong>
                </p>
              </div>

              {/* Chia sẻ lớp học */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Chia sẻ lớp học
                </span>
                <div className="flex items-center gap-1.5 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 truncate flex-1 font-mono">
                    {typeof window !== "undefined" ? window.location.href : `https://windedu.vn/c/${item.code}`}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await copyTextToClipboard(window.location.href);
                        notify("Đã sao chép link lớp học!", "success");
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

          {/* CỘT 2: Ở GIỮA - NỘI DUNG BÀI GIẢNG / PHIẾU BÀI TẬP & BÀI TẬP ĐÍNH KÈM */}
          <main className="flex-1 min-w-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
              {/* Header: Nút quay lại + Tên bài giảng + Nút chức năng Giảng viên (Chỉnh sửa, Xóa) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedLectureForPage(null)}
                  className="inline-flex items-center gap-2 text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors cursor-pointer min-w-0"
                >
                  <ArrowLeft size={18} className="shrink-0 text-slate-500" />
                  <span className="truncate">{selectedLectureForPage.title}</span>
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400 font-medium mr-2">
                    {selectedLectureForPage.uploadedAt}
                  </span>
                  {canManageClassContent && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenEditLecture(selectedLectureForPage)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/80 cursor-pointer transition-colors"
                      >
                        <Edit3 size={13} />
                        <span>Chỉnh sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLecture(selectedLectureForPage.id, selectedLectureForPage.title)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-100 dark:hover:bg-rose-900/80 cursor-pointer transition-colors"
                      >
                        <Trash2 size={13} />
                        <span>Xóa</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Khung phát bài giảng (Player 16:9 YouTube/Video hoặc Phiếu bài tập trắc nghiệm toán học chuẩn Ảnh 2) */}
              {selectedLectureForPage.sourceUrl && getLectureEmbedUrl(selectedLectureForPage.sourceUrl) ? (
                <div>
                  <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-lg border border-slate-200 dark:border-slate-800">
                    <iframe
                      src={getLectureEmbedUrl(selectedLectureForPage.sourceUrl) ?? undefined}
                      className="h-full w-full border-0"
                      title={selectedLectureForPage.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Nếu không xem được trong trang, <a href={selectedLectureForPage.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-600 underline underline-offset-2 hover:text-sky-700">bấm vào đây để mở trang bài giảng</a>.</p>
                </div>
              ) : selectedLectureForPage.sourceType === "LINK" && selectedLectureForPage.sourceUrl ? (
                <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-950">
                  <LinkIcon size={36} className="text-sky-600" />
                  <p className="text-sm text-slate-700 dark:text-slate-200">Nếu không xem được trong trang, hãy mở bài giảng từ liên kết bên dưới.</p>
                  <a href={selectedLectureForPage.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700">Mở bài giảng</a>
                </div>
              ) : (
                <div className="space-y-2">
                  <InlineFilePreview key={selectedLectureForPage.id} materialId={selectedLectureForPage.id} title={selectedLectureForPage.title} />
                  <button type="button" className="text-sm font-semibold underline" onClick={() => void handleDownloadMaterial(selectedLectureForPage.id)}>Tải xuống</button>
                </div>
              )}

              {/* Trạng thái hiển thị bài giảng */}
              <div className="flex items-center justify-between pt-2 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Trạng thái hiển thị
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                    selectedLectureForPage.visibility === "HIDDEN"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  }`}
                >
                  {selectedLectureForPage.visibility === "HIDDEN" ? (
                    <>
                      <EyeOff size={13} />
                      <span>Đã ẩn với học sinh</span>
                    </>
                  ) : (
                    <>
                      <Eye size={13} />
                      <span>Đang hiển thị</span>
                    </>
                  )}
                </span>
              </div>

              {/* Lối tắt tới bài tập của lớp: chỉ hiện khi lớp thực sự có bài tập. */}
              {assignments.length > 0 && <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Bài tập của lớp
                </span>

                <div
                  onClick={() => {
                    setSelectedLectureForPage(null);
                    handleSelectTab("assignments");
                    if (assignments.length > 0) {
                      setSelectedAssignment(assignments[0]!);
                      setAssignmentViewMode("detail");
                    }
                  }}
                  className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-xs transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-9 rounded-lg bg-blue-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
                      W
                    </div>
                    <div className="min-w-0">
                      <strong className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 transition-colors block truncate">
                        {assignments[0]!.title}
                      </strong>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Mở danh sách bài tập của lớp
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              </div>}
            </div>
          </main>

          {/* CỘT 3: CỘT PHẢI - THƯ MỤC & PLAYLIST BÀI GIẢNG (CHUẨN ẢNH 2) */}
          <aside className="w-full lg:w-80 shrink-0 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
              {/* Bên trên: Thư mục */}
              <div className="space-y-1.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Folder size={15} className="text-blue-600 fill-blue-500/20" />
                  <span>Thư mục bài giảng</span>
                </div>
                <select
                  value={selectedLectureFolder}
                  onChange={(e) => setSelectedLectureFolder(e.target.value)}
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
                    {selectedLectureFolder === "__ALL__" ? "Tất cả bài giảng" : selectedLectureFolder}
                  </span>
                  <span>{lecturePlaylist.length} bài giảng</span>
                </div>

                <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
                  {lecturePlaylist.map((lec) => {
                    const isPlaying = lec.id === selectedLectureForPage.id;
                    const ytId = lec.youtubeId || getLectureYoutubeId(lec.sourceUrl);
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
                          {ytId ? (
                            <img
                              src={`https://img.youtube.com/vi/${ytId}/mqdefault.jpg`}
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
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-5">
      {/* =========================================================================
          KHUNG BỐ CỤC 2 CỘT ĐỒNG BỘ HOÀN TOÀN VỚI HỌC SINH
          ========================================================================= */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* =========================================================================
            CỘT 1: THANH HEADER DỌC CỦA LỚP HỌC (SIDEBAR CỦA GIÁO VIÊN - CHUẨN DESIGN HỌC SINH)
            ========================================================================= */}
        <aside className="w-full lg:w-56 shrink-0 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3.5 shadow-xs">
            {/* Nút quay lại danh sách lớp */}
            <button
              type="button"
              onClick={onBack || (() => router.push("/courses"))}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors mb-3 cursor-pointer"
            >
              <ArrowLeft size={14} />
              <span>Quay lại danh sách lớp</span>
            </button>

            {/* Thông tin lớp học */}
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
              <div className="flex items-center gap-2.5">
                <ClassAvatar
                  avatarUrl={item.avatarUrl}
                  name={item.name || item.code}
                  sizeClass="size-10"
                  iconSize={18}
                />
                <div className="min-w-0 flex-1">
                  <h1 className="text-sm font-bold text-slate-900 dark:text-slate-100 line-clamp-1" title={item.name || item.code}>
                    {item.name || item.code}
                  </h1>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code}</strong>
                  </p>
                </div>
              </div>

              {/* Chia sẻ lớp học */}
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[9px] uppercase font-bold text-slate-400 block leading-tight mb-1">
                  Chia sẻ lớp học
                </span>
                <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                  <span className="text-[10px] text-slate-600 dark:text-slate-300 truncate flex-1 font-mono">
                    {typeof window !== "undefined" ? window.location.href : `https://windedu.vn/c/${item.code}`}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await copyTextToClipboard(window.location.href);
                        notify("Đã sao chép liên kết lớp học!");
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
            </div>

            {/* Danh sách 9 chức năng chính của lớp học */}
            <nav className="space-y-1">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
                Danh mục
              </p>
              {[
                { id: "feed" as const, label: "Bảng tin", icon: MessageSquare },
                { id: "schedule" as const, label: "Lịch học", icon: CalendarDays },
                { id: "members" as const, label: "Thành viên", icon: Users },
                { id: "roles" as const, label: "Vai trò", icon: UserCheck },
                { id: "assignments" as const, label: "Bài tập", icon: ListChecks },
                { id: "gradebook" as const, label: "Bảng điểm", icon: Award },
                { id: "lectures" as const, label: "Bài giảng", icon: Video },
                { id: "materials" as const, label: "Tài liệu", icon: FolderOpen },
                { id: "questions" as const, label: "Ngân hàng câu hỏi", icon: FileQuestion },
              ].map(({ id, label, icon: Icon }) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectTab(id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
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

            {/* MỤC CÀI ĐẶT LỚP HỌC (NẰM DƯỚI ĐÁY SIDEBAR, TÁCH BIỆT HẲN RA) */}
            <div className="pt-2 mt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => handleSelectTab("settings")}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                  activeTab === "settings"
                    ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                }`}
              >
                <Settings size={15} className={activeTab === "settings" ? "text-blue-600 dark:text-blue-400" : "text-slate-400"} />
                <span className="truncate">Cài đặt lớp học</span>
              </button>
            </div>
          </div>
        </aside>

        {/* =========================================================================
            NỘI DUNG CHÍNH (THAY ĐỔI THEO TAB ĐANG CHỌN)
            ========================================================================= */}
        <main className="flex-1 min-w-0 space-y-4">
        {/* TAB 1: BẢNG TIN LỚP HỌC (ĐỒNG BỘ GIAO DIỆN & TÍNH NĂNG VỚI HỌC SINH) */}
        {activeTab === "feed" && (
          <ClassFeedView
            classItem={item}
            courseName={course?.name}
            teacherName={session.user.name || "Wind Fall"}
          />
        )}

        {/* TAB 2: LỊCH HỌC */}
        {activeTab === "schedule" && (
          <ClassSchedulePanel
            classItem={item}
            roleCode={session.roleCode}
            canManage={canManageClassContent}
            canTransitionStatus={canManageClassContent}
            locale={locale}
            notify={notify}
            t={t}
          />
        )}

        {/* TAB 3: THÀNH VIÊN */}
        {activeTab === "members" && (
          <InstructorMembersTab
            instructorName={session.user.name}
            instructorEmail={session.user.email}
            learners={learners}
          />
        )}

        {/* TAB 4: VAI TRÒ (THÊM ĐỒNG GIÁO VIÊN ĐỂ CHẤM ĐIỂM) */}
        {activeTab === "roles" && (
          <InstructorRolesTab
            currentUserId={session.user.id}
            currentUserName={session.user.name}
            currentUserEmail={session.user.email}
            instructors={instructors}
          />
        )}

        {/* TAB 5: BÀI TẬP (HỖ TRỢ DANH SÁCH 3 CỘT VÀ XEM CHI TIẾT BẢNG ĐIỂM CHO CẢ TRẮC NGHIỆM & TỰ LUẬN) */}
        {activeTab === "assignments" && (
          <>
            {assignmentViewMode === "detail" && selectedWork ? (
              <ClassWorkDetailView
                key={selectedWork.id}
                work={
                  selectedClassExam
                    ? { kind: "EXAM", exam: selectedClassExam }
                    : { kind: "ASSIGNMENT", assignment: selectedAssignment! }
                }
                roleCode={session.roleCode}
                locale={locale}
                learners={learners}
                submissions={selectedSubmissions}
                changingWork={changingWork}
                onBack={() => setAssignmentViewMode("list")}
                onOpenPreviewModal={openWorkPreview}
                onTryWork={openWorkTrial}
                onEditWork={openWorkEdit}
                onToggleVisibility={() => void changeSelectedWork("visibility")}
                onDeleteWork={() => void changeSelectedWork("delete")}
                onPreviewMaterial={(materialId) => void handlePreviewMaterial(materialId)}
                onDownloadMaterial={(materialId) => void handleDownloadMaterial(materialId)}
              />
            ) : (
              /* =========================================================================
                 DANH SÁCH BÀI TẬP BỐ CỤC 3 CỘT (CHUẨN ẢNH 2 CỦA NGƯỜI DÙNG)
                 ========================================================================= */
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
                <div className="flex flex-col lg:flex-row min-h-[620px]">
                  {/* CỘT 1: CÂY THƯ MỤC BÀI TẬP (THEO ẢNH 2) */}
                  <div className="w-full lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/40 dark:bg-slate-900/40 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                          <Filter size={14} className="text-slate-500" />
                          <span>Thư mục</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowNewFolderModal(true)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 transition cursor-pointer"
                          title="Tạo thư mục mới"
                        >
                          <FolderPlus size={15} />
                        </button>
                      </div>

                      <div className="space-y-1">
                        {/* Mục Tất cả bài tập */}
                        <button
                          type="button"
                          onClick={() => setSelectedFolder("__ALL__")}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition text-left cursor-pointer ${
                            selectedFolder === "__ALL__" || selectedFolder === "Tất cả bài tập"
                              ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                              : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                          }`}
                        >
                          <Folder
                            size={16}
                            className={
                              selectedFolder === "__ALL__" || selectedFolder === "Tất cả bài tập"
                                ? "text-blue-600 fill-blue-500/20"
                                : "text-blue-500"
                            }
                          />
                          <span className="truncate">Tất cả bài tập</span>
                        </button>

                        {/* Các thư mục tùy chỉnh */}
                        {customFolders.map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setSelectedFolder(f)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition text-left cursor-pointer ${
                              selectedFolder === f
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            }`}
                          >
                            <Folder
                              size={15}
                              className={selectedFolder === f ? "text-blue-600 fill-blue-500/20" : "text-slate-400"}
                            />
                            <span className="truncate">{f}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* CỘT 2: DANH SÁCH BÀI TẬP VÀ TOOLBAR TÌM KIẾM (THEO ẢNH 2) */}
                  <div className="flex-1 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-4 flex flex-col space-y-3">
                    {/* Toolbar trên: Toggle List/Grid + Ô tìm kiếm + Dropdown sắp xếp + Nút + Tạo bài tập */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        {/* Toggle List / Grid */}
                        <div className="flex items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-0.5">
                          <button
                            type="button"
                            onClick={() => setAssignmentListDisplayMode("list")}
                            className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                              assignmentListDisplayMode === "list"
                                ? "bg-blue-600 text-white shadow-2xs"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                            }`}
                            title="Hiển thị dạng danh sách"
                          >
                            <List size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignmentListDisplayMode("grid")}
                            className={`p-1.5 rounded-lg text-xs transition cursor-pointer ${
                              assignmentListDisplayMode === "grid"
                                ? "bg-blue-600 text-white shadow-2xs"
                                : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                            }`}
                            title="Hiển thị dạng lưới"
                          >
                            <LayoutGrid size={14} />
                          </button>
                        </div>

                        {/* Ô tìm kiếm */}
                        <div className="relative w-44 sm:w-56">
                          <input
                            type="text"
                            placeholder="Tìm kiếm..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-3 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                          />
                          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <select
                            aria-label="Sắp xếp bài tập"
                            value={assignmentSort}
                            onChange={(event) => setAssignmentSort(event.target.value as "newest" | "oldest")}
                            className="py-1.5 pl-3 pr-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <option value="newest">Mới nhất</option>
                            <option value="oldest">Cũ nhất</option>
                          </select>
                          <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>

                        <button
                          type="button"
                          onClick={() => handleOpenCreationHub("ASSIGNMENT")}
                          className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Plus size={14} />
                          <span>Tạo bài tập</span>
                        </button>
                      </div>
                    </div>

                    {/* Danh sách thẻ bài tập */}
                    <div className={`flex-1 overflow-y-auto max-h-[540px] pr-1 ${assignmentListDisplayMode === "grid" ? "grid content-start gap-3 sm:grid-cols-2" : "space-y-2"}`}>
                      {assignments.length === 0 && visibleExams.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-400">
                          Chưa có bài tập nào. Bấm &quot;+ Tạo bài tập&quot; để thêm mới.
                        </div>
                      ) : (
                        [...visibleExams, ...assignments]
                          .filter(work => work.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
                          .sort((left, right) => {
                            const leftTime = Date.parse("openAt" in left ? left.openAt : left.createdAt) || 0;
                            const rightTime = Date.parse("openAt" in right ? right.openAt : right.createdAt) || 0;
                            return assignmentSort === "newest" ? rightTime - leftTime : leftTime - rightTime;
                          })
                          .map(work => {
                            const exam = "attemptLimit" in work;
                            const isSelected = selectedWork?.id === work.id;
                            const loadedSubmissions = submissionsByAssignment[work.id];
                            const submittedCount = loadedSubmissions
                              ? new Set(loadedSubmissions.map((submission) => submission.learnerId)).size
                              : (!exam && typeof work.submissionCount === "number" ? work.submissionCount : 0);
                            return (
                              <button type="button"
                                key={work.id}
                                aria-pressed={isSelected}
                                onClick={() => { if (exam) setSelectedExamId(work.id); else { setSelectedExamId(""); setSelectedAssignment(work); } }}
                                className={`w-full rounded-xl border text-left cursor-pointer transition ${assignmentListDisplayMode === "grid" ? "flex min-h-36 flex-col items-start justify-between gap-4 p-4" : "flex items-center justify-between gap-3 p-3.5"} ${
                                  isSelected
                                    ? "border-blue-400 dark:border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 shadow-2xs"
                                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 bg-white dark:bg-slate-900"
                                }`}
                              >
                                <div className={`flex min-w-0 gap-3 ${assignmentListDisplayMode === "grid" ? "w-full flex-col items-start" : "items-center"}`}>
                                  {/* Icon đề bài */}
                                  <div className="size-8 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-xs">
                                    W
                                  </div>
                                  <div className="min-w-0">
                                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                      {work.title}{work.hidden && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">Đã ẩn</span>}
                                    </strong>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                      {exam ? "Trắc nghiệm" : "Tự luận"}
                                    </p>
                                  </div>
                                </div>

                                <div className={`${assignmentListDisplayMode === "grid" ? "w-full text-left" : "text-right"} shrink-0`}>
                                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    {exam ? work.questionIds.length + " câu" : submittedCount + "/" + learners.length + " đã nộp"}
                                  </span>
                                </div>
                              </button>
                            );
                          })
                      )}
                    </div>
                    {examPage.total > examPage.pageSize && (
                      <Pagination compact totalItems={examPage.total} page={examPage.page} pageSize={examPage.pageSize}
                        onPageChange={examPage.setPage} onPageSizeChange={examPage.setPageSize} itemLabel="đề thi" />
                    )}
                  </div>

                  {/* CỘT 3: PANEL XEM NHANH THÔNG TIN BÀI TẬP & CỤM NÚT CHỨC NĂNG */}
                  <div className="w-full lg:w-80 shrink-0 p-5 space-y-5 bg-slate-50/30 dark:bg-slate-950/20 flex flex-col justify-between">
                    {selectedWork ? (
                      <div className="space-y-4">
                        <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100">{selectedWork.title}</h3>
                        <dl className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
                          {workDetails.map(([label, value]) => (
                            <div key={label} className="flex items-center justify-between gap-3 pt-2">
                              <dt className="text-slate-500">{label}</dt>
                              <dd className="text-right font-bold text-slate-900 dark:text-slate-100">{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {/* DANH SÁCH NÚT CHỨC NĂNG DỌC (TÊN TRÁI - ICON PHẢI) */}
                        <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={openWorkPreview}
                            aria-label="Xem bài tập"
                            title="Xem đề bài tập"
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <span>Xem bài tập</span>
                            <Eye size={16} className="shrink-0" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setAssignmentViewMode("detail")}
                            aria-label="Xem chi tiết"
                            title="Xem bảng điểm cả bài tập"
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <span>Xem chi tiết</span>
                            <BarChart3 size={16} className="shrink-0" />
                          </button>

                          <button
                            type="button"
                            onClick={openWorkTrial}
                            aria-label="Làm thử"
                            title="Làm thử bài tập"
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <span>Làm thử</span>
                            <Play size={16} className="shrink-0" />
                          </button>

                          <button
                            type="button"
                            aria-label="Chỉnh sửa bài tập"
                            title="Chỉnh sửa bài tập"
                            onClick={openWorkEdit}
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                          >
                            <span>Chỉnh sửa</span>
                            <Edit2 size={16} className="shrink-0" />
                          </button>

                          <button
                            type="button"
                            disabled={changingWork}
                            onClick={() => void changeSelectedWork("visibility")}
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                          >
                            <span>{selectedWork.hidden ? "Hiện bài tập" : "Ẩn bài tập"}</span>
                            {selectedWork.hidden ? (
                              <Eye size={16} className="shrink-0 text-emerald-600" />
                            ) : (
                              <EyeOff size={16} className="shrink-0 text-slate-500" />
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={changingWork}
                            onClick={() => void changeSelectedWork("delete")}
                            className="w-full flex items-center justify-between gap-2 text-left px-3.5 py-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                          >
                            <span>Xóa bài tập</span>
                            <Trash2 size={16} className="shrink-0" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Chọn một bài tập từ cột bên trái để xem thông tin.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Bảng điểm theo dữ liệu thật từ API lớp học. */}
        {activeTab === "gradebook" && (
          <InstructorGradebookTab
            classId={item.id}
            roleCode={session.roleCode}
            className={item.name}
            gradebook={gradebook}
            assessments={gradebookAssessments}
            onRefreshGradebook={() => void loadClassGradebookTab(true)}
          />
        )}
        {/* TAB 7: BÀI GIẢNG */}
        {activeTab === "lectures" && (
          <InstructorLecturesTab
            lectures={lectures}
            lectureFolders={lectureFolders}
            selectedLectureFolder={selectedLectureFolder}
            selectedLectureId={selectedLectureId}
            canManageClassContent={canManageClassContent}
            onSelectFolder={setSelectedLectureFolder}
            onSelectLectureId={setSelectedLectureId}
            onOpenLecturePage={setSelectedLectureForPage}
            onOpenAddLecture={() => {
              const defaultFolder = customLectureFolders.includes(selectedLectureFolder)
                ? selectedLectureFolder
                : (customLectureFolders[0] ?? "");
              setLectureFormFolder(defaultFolder);
              setLectureFormVisibility("PUBLISHED");
              setAddLectureModalOpen(true);
            }}
            onOpenNewFolder={() => setShowNewFolderModal(true)}
            onToggleVisibility={(id, visibility, title) => void handleToggleResourceVisibility(id, visibility, title)}
            onEditLecture={handleOpenEditLecture}
            onMoveLecture={(id, title) => handleOpenMoveItem(id, title, "LECTURE")}
            onDeleteLecture={(id, title) => void handleDeleteLecture(id, title)}
          />
        )}

        {/* TAB 8: TÀI LIỆU */}
        {activeTab === "materials" && (
          <InstructorMaterialsTab
            materials={materialsList}
            materialFolders={materialFolders}
            selectedMaterialFolder={selectedMaterialFolder}
            selectedMaterialId={selectedMaterialId}
            canManageClassContent={canManageClassContent}
            onSelectFolder={setSelectedMaterialFolder}
            onSelectMaterialId={setSelectedMaterialId}
            onOpenAddMaterial={() => {
              const defaultFolder = customMaterialFolders.includes(selectedMaterialFolder)
                ? selectedMaterialFolder
                : (customMaterialFolders[0] ?? "");
              setMaterialFormFolder(defaultFolder);
              setMaterialFormVisibility("PUBLISHED");
              setAddMaterialModalOpen(true);
            }}
            onOpenNewFolder={() => setShowNewFolderModal(true)}
            onDownloadMaterial={(id) => void handleDownloadMaterial(id)}
            onToggleVisibility={(id, visibility, title) => void handleToggleResourceVisibility(id, visibility, title)}
            onEditMaterial={handleOpenEditMaterial}
            onMoveMaterial={(id, title) => handleOpenMoveItem(id, title, "MATERIAL")}
            onDeleteMaterial={(id, title) => void handleDeleteMaterial(id, title)}
          />
        )}

        {/* TAB 9: NGÂN HÀNG CÂU HỎI LỚP HỌC */}
        {activeTab === "questions" && (
          <InstructorQuestionsTab
            className={item.name}
            questionBankTab={questionBankTab}
            questionBankSearch={questionBankSearch}
            questionBankDifficulty={questionBankDifficulty}
            questionSummary={questionSummary}
            questionBankLoading={questionBankLoading}
            questionBankError={questionBankError}
            pagedClassQuestions={pagedClassQuestions}
            questionDisplayPage={questionDisplayPage}
            questionPageSize={questionPageSize}
            questionTotalItems={questionTotalItems}
            onChangeTab={(nextTab) => {
              setQuestionBankTab(nextTab);
              resetQuestionPage();
            }}
            onSearchCommit={handleQuestionSearchCommit}
            onChangeDifficulty={(nextDifficulty) => {
              setQuestionBankDifficulty(nextDifficulty);
              resetQuestionPage();
            }}
            onPageChange={setQuestionPage}
            onPageSizeChange={setQuestionPageSize}
            onRetry={() => void loadClassQuestionBank()}
            onOpenCreateExam={() => {
              const targetType = questionBankTab === "ESSAY" ? "ESSAY" : "MULTIPLE_CHOICE";
              setOpenedFromCreationHub(false);
              setBankBuilderAssignmentType(targetType);
              setManualExamTargetScore(10);
              setManualExamQuestionScores({});
              setManualExamCustomScored(false);
              setManualExamSelectedQuestions([]);
              setManualExamSearch("");
              setManualExamDifficulties([]);
              setManualDifficultyDropdownOpen(false);
              setAiCriteriaPreviewList([]);
              setExamCreationMode("MANUAL");
              setManualExamTitle(
                t(
                  targetType === "ESSAY"
                    ? `Bài tập tự luận lớp ${item.name} - ${new Date().toLocaleDateString(locale)}`
                    : `Đề kiểm tra lớp ${item.name} - ${new Date().toLocaleDateString(locale)}`,
                ),
              );
              setManualExamModalOpen(true);
            }}
            onOpenCreateQuestion={() => handleOpenCreationHub("QUESTION")}
            onEditQuestion={handleOpenEditQuestion}
          />
        )}

        {/* TAB 10: CÀI ĐẶT LỚP HỌC (TÁCH BIỆT) */}
        {activeTab === "settings" && (
          <InstructorSettingsTab
            item={item}
            course={course}
            roleCode={session.roleCode}
            onClassUpdated={onClassUpdated}
          />
        )}
      </main>
      </div>

      {/* =========================================================================
          MODAL THÊM BÀI GIẢNG HAI VÙNG (TWO-PANE LECTURE CREATOR)
          ========================================================================= */}
      {addLectureModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Thêm bài giảng mới vào lớp {item.name}
              </h3>
              <button
                type="button"
                onClick={() => setAddLectureModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Hai vùng (Vùng 1: Trái, Vùng 2: Phải) */}
            <div className="flex-1 overflow-y-auto p-6 grid md:grid-cols-2 gap-6">
              {/* BƯỚC 1: VÙNG TRÁI - Chọn nguồn bài giảng */}
              <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-0 md:pr-6">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-600 block">
                  Bước 1: Chọn cách thêm bài giảng
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLectureMethod("LINK");
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      lectureMethod === "LINK"
                        ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700"
                        : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <LinkIcon size={14} />
                    <span>Dán liên kết</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLectureMethod("FILE");
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      lectureMethod === "FILE"
                        ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700"
                        : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <UploadCloud size={14} />
                    <span>Tải tệp từ máy</span>
                  </button>
                </div>

                {/* Nếu chọn dán liên kết */}
                {lectureMethod === "LINK" && (
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Dán liên kết (YouTube, Facebook, Google Drive):
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={lectureInputUrl}
                        onChange={(e) => handleLinkChange(e.target.value)}
                        className={`w-full px-3 py-2 pr-9 rounded-xl border text-xs ${
                          lectureUrlError
                            ? "border-rose-500 bg-rose-50/20 text-rose-700"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        }`}
                      />
                      {lectureDetectedPlatform !== "INVALID" && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 font-extrabold text-[10px]">
                          ✓ {lectureDetectedPlatform}
                        </span>
                      )}
                    </div>
                    {lectureUrlError && <p className="text-[11px] text-rose-500 font-bold">{lectureUrlError}</p>}
                  </div>
                )}

                {/* Nếu chọn tải tệp từ máy */}
                {lectureMethod === "FILE" && (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Tải tệp bài giảng (PDF, Word, PPTX, Ảnh):
                    </label>
                    <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-5 block text-center cursor-pointer hover:border-sky-500 transition">
                      <input type="file" onChange={handleFileSelect} className="hidden" />
                      <UploadCloud size={28} className="mx-auto text-sky-500 mb-1" />
                      <span className="block text-xs font-bold">Bấm để chọn tệp từ máy</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">Hỗ trợ PDF, DOCX, PPTX, Ảnh</span>
                    </label>

                    {lectureFileObj && (
                      <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                        <div className="font-bold text-[11px] break-all">
                          <span>{lectureFileObj.name}</span>
                        </div>
                        <p className="text-[10px] text-slate-500">Đã chọn tệp. Tệp sẽ được tải lên khi lưu bài giảng.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* BƯỚC 2: VÙNG PHẢI - Điền thông tin & Liên kết bài tập/tài liệu (Trượt vào trong 280ms) */}
              <div
                className={`space-y-4 transition-all duration-280 ${
                  lectureMethod === "LINK" || lectureFileObj !== null
                    ? "opacity-100 translate-x-0"
                    : "opacity-40 pointer-events-none translate-x-4"
                }`}
              >
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 block">
                  Bước 2: Thông tin bài giảng & Đính kèm
                </span>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tên bài giảng <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Bài giảng số 1..."
                    value={lectureFormTitle}
                    onChange={(e) => setLectureFormTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Trạng thái hiển thị:
                  </label>
                  <select
                    value={lectureFormVisibility}
                    onChange={(e) =>
                      setLectureFormVisibility(e.target.value as "PUBLISHED" | "HIDDEN")
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                  >
                    <option value="PUBLISHED">Hiển thị với học sinh</option>
                    <option value="HIDDEN">Ẩn với học sinh</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Thư mục lưu trữ bài giảng:
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={lectureFormFolder}
                      onChange={(e) => setLectureFormFolder(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                    >
                      {customLectureFolders.length === 0 && (
                        <option value="">Chưa có thư mục bài giảng</option>
                      )}
                      {Array.from(new Set(customLectureFolders.filter(Boolean))).map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Đang lưu vào thư mục: <strong className="text-purple-600 dark:text-purple-400">{lectureFormFolder}</strong>
                  </span>
                </div>

                {/* Chọn bài tập đi kèm (chỉ những bài ĐÃ CÓ trong lớp) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Bài tập đi kèm:
                  </label>
                  {assignments.length > 0 ? (
                    <div className="max-h-24 overflow-y-auto space-y-1 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                      {assignments.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={lectureAttachedAssignments.includes(a.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setLectureAttachedAssignments([...lectureAttachedAssignments, a.id]);
                              } else {
                                setLectureAttachedAssignments(lectureAttachedAssignments.filter((id) => id !== a.id));
                              }
                            }}
                          />
                          <span className="truncate">{a.title}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs text-slate-400">
                      Lớp chưa có bài tập nào.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setOpenedFromCreationHub(false);
                          setAssignmentHubType(null);
                          setBuilderInitialMethod(undefined);
                          setAddLectureModalOpen(false);
                          setAddAssignmentModalOpen(true);
                        }}
                        className="text-sky-600 font-bold hover:underline"
                      >
                        + Tạo bài tập ngay
                      </button>
                    </div>
                  )}
                </div>

                {/* Nút lưu */}
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveLecture}
                    className="px-5 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition"
                  >
                    Lưu bài giảng
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL THÊM BÀI TẬP MỚI TOÀN DIỆN (HỖ TRỢ 2 NGUỒN, AI TÁCH CÂU, TÙY CHỌN NỘP BÀI)
          ========================================================================= */}
      {addAssignmentModalOpen && (
        <AssignmentBuilderModal
          open
          onClose={() => {
            setAddAssignmentModalOpen(false);
            setBuilderInitialMethod(undefined);
            setOpenedFromCreationHub(false);
          }}
          onBackToHub={openedFromCreationHub ? handleReturnToCreationHub : undefined}
          targetClassName={item.name || item.code}
          targetClassEndAt={item.endAt}
          initialType={assignmentHubType ?? undefined}
          initialMethod={builderInitialMethod}
          onSaveAssignment={handleSaveFromBuilder}
        />
      )}

      {/* =========================================================================
          MODAL THỐNG KÊ LƯỢT LÀM BÀI & XEM CHI TIẾT BÀI LÀM
          ========================================================================= */}
      {statsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-extrabold">
                  Thống kê bài nộp: {selectedAssignment?.title}
                </h3>
                <p className="text-xs text-slate-500">
                  Danh sách toàn bộ học sinh, số lần làm, điểm số và chi tiết bài làm
                </p>
              </div>
              <button type="button" onClick={() => setStatsModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedStudentAttempt ? (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setSelectedStudentAttempt(null)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:underline"
                  >
                    ← Quay lại bảng thống kê
                  </button>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-2">
                    <strong className="text-sm font-bold block">{selectedStudentAttempt.learnerName}</strong>
                    <div className="text-xs text-slate-500">{selectedStudentAttempt.learnerEmail}</div>
                    <div className="text-xs">
                      Trạng thái: {selectedStudentAttempt.status === "GRADED" ? "Đã chấm" : "Chờ chấm"} ·
                      Lần nộp {selectedStudentAttempt.revision} ·
                      Nộp lúc {new Date(selectedStudentAttempt.submittedAt).toLocaleString(locale)}
                    </div>
                    {typeof selectedStudentAttempt.score === "number" && (
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs font-extrabold border ${getScoreColorClass(selectedStudentAttempt.score, selectedAssignment?.maxScore ?? 10)}`}>
                        Điểm: {selectedStudentAttempt.score} / {selectedAssignment?.maxScore ?? "—"}
                      </span>
                    )}
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                    <h4 className="text-xs font-extrabold uppercase text-slate-500">Nội dung bài nộp</h4>
                    <p className="text-sm whitespace-pre-wrap wrap-break-word">{selectedStudentAttempt.content || "Không có nội dung văn bản."}</p>
                  </div>
                  {selectedStudentAttempt.attachments.length > 0 && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <h4 className="text-xs font-extrabold uppercase text-slate-500">Tệp đính kèm</h4>
                      {selectedStudentAttempt.attachments.map((file) => (
                  <SubmissionFile key={file.id} submissionId={selectedStudentAttempt.id} file={file} showImage />
                ))}
                    </div>
                  )}
                  {selectedStudentAttempt.rubricScores.length > 0 && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <h4 className="text-xs font-extrabold uppercase text-slate-500">Điểm tiêu chí</h4>
                      {selectedStudentAttempt.rubricScores.map((criterion) => (
                        <div key={criterion.criterionId} className="text-xs">
                          {selectedAssignment?.rubric.find((entry) => entry.id === criterion.criterionId)?.title ?? criterion.criterionId}: {criterion.score}
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedStudentAttempt.feedback && (
                    <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
                      <h4 className="text-xs font-extrabold uppercase text-slate-500">Nhận xét</h4>
                      <p className="text-sm whitespace-pre-wrap">{selectedStudentAttempt.feedback}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-extrabold text-[10px]">
                      <tr>
                        <th className="px-4 py-3">Học sinh</th>
                        <th className="px-4 py-3 text-center">Lần nộp</th>
                        <th className="px-4 py-3 text-center">Trạng thái / Điểm</th>
                        <th className="px-4 py-3">Thời gian nộp</th>
                        <th className="px-4 py-3 text-right">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {selectedSubmissions.map((submission) => (
                        <tr key={submission.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 font-bold">{submission.learnerName}</td>
                          <td className="px-4 py-3 text-center">{submission.revision}</td>
                          <td className="px-4 py-3 text-center">
                            {typeof submission.score === "number"
                              ? `${submission.score} / ${selectedAssignment?.maxScore ?? "—"}`
                              : "Chờ chấm"}
                          </td>
                          <td className="px-4 py-3">{new Date(submission.submittedAt).toLocaleString(locale)}</td>
                          <td className="px-4 py-3 text-right">
                            <button type="button" onClick={() => setSelectedStudentAttempt(submission)} className="font-bold text-sky-600 hover:underline">
                              Xem bài làm
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedSubmissions.length === 0 && (
                    <p className="text-center text-xs text-slate-500 py-6">Chưa có bài nộp.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL CHIA SẺ BÀI TẬP
          ========================================================================= */}
      {/* =========================================================================
          MODAL TẠO THƯ MỤC MỚI
          ========================================================================= */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
            <h3 className="text-sm font-extrabold">Tạo thư mục mới</h3>
            <input
              type="text"
              placeholder="Tên thư mục (Ví dụ: Tuần 3 - Nâng cao)..."
              value={newFolderInput}
              onChange={(e) => setNewFolderInput(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateFolder}
                className="px-4 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Tạo thư mục
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL THÊM ĐỒNG GIÁO VIÊN
          ========================================================================= */}
      {/* Modal làm thử đề trắc nghiệm dành cho giáo viên (không lưu lịch sử) */}
      <ExamTakingModal
        open={Boolean(previewExam)}
        onClose={() => setPreviewExam(null)}
        exam={previewExam}
        isInstructorPreview={true}
      />

      <ClassExamPreviewModal
        exam={previewExamContent}
        classNameLabel={item.name || item.code}
        roleCode={session.roleCode}
        onClose={() => setPreviewExamContent(null)}
        onTryExam={(target) => {
          setPreviewExam({
            id: target.id,
            title: target.title,
            durationMinutes: target.durationMinutes,
            totalQuestions: target.questionIds.length,
            totalScore: target.totalScore,
            closeAt: target.closeAt,
            questionScores: target.questionScores,
            aiTutorEnabled: target.aiTutorEnabled,
          });
        }}
        onEditExam={(target) => setEditingClassExam(target)}
      />

      <ClassAssignmentPreviewModal
        assignment={previewAssignment}
        locale={locale}
        onClose={() => setPreviewAssignment(null)}
        onPreviewMaterial={(materialId) => void handlePreviewMaterial(materialId)}
        onDownloadMaterial={(materialId) => void handleDownloadMaterial(materialId)}
        onTryAssignment={(target) => setTrialAssignment(target)}
        onEditAssignment={(target) => setEditingAssignment(target)}
      />

      <ClassAssignmentTrialModal
        assignment={trialAssignment}
        locale={locale}
        onClose={() => setTrialAssignment(null)}
        onPreviewMaterial={(materialId) => void handlePreviewMaterial(materialId)}
        onDownloadMaterial={(materialId) => void handleDownloadMaterial(materialId)}
      />

      <ClassExamEditModal
        exam={editingClassExam}
        roleCode={session.roleCode}
        classCourseId={item.courseId}
        classEndAt={item.endAt}
        classQuestions={classQuestions}
        onClose={() => setEditingClassExam(null)}
        onSaved={async () => {
          examPage.refresh();
          await loadClassData();
        }}
      />

      <ClassAssignmentEditModal
        assignment={editingAssignment}
        classId={item.id}
        classEndAt={item.endAt}
        roleCode={session.roleCode}
        onClose={() => setEditingAssignment(null)}
        onSaved={loadClassData}
      />

      {/* =========================================================================
          MODAL CHỈNH SỬA BÀI GIẢNG DÀNH CHO GIẢNG VIÊN
          ========================================================================= */}
      {editLectureModalOpen && editingLecture && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Chỉnh sửa bài giảng: {editingLecture.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditLectureModalOpen(false);
                  setEditingLecture(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body: Two-Pane */}
            <div className="flex-1 overflow-y-auto p-6 grid md:grid-cols-2 gap-6">
              {/* BƯỚC 1: VÙNG TRÁI - Nguồn bài giảng (Đổi Link hoặc Chọn File mới từ máy) */}
              <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-0 md:pr-6">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-600 block">
                  Bước 1: Nguồn bài giảng (Link hoặc Tệp tải lên)
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditLectureMethod("LINK");
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      editLectureMethod === "LINK"
                        ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700"
                        : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <LinkIcon size={14} />
                    <span>Dán liên kết</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditLectureMethod("FILE");
                    }}
                    className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                      editLectureMethod === "FILE"
                        ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-700"
                        : "border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <UploadCloud size={14} />
                    <span>Tải tệp từ máy</span>
                  </button>
                </div>

                {/* Nếu chọn dán liên kết */}
                {editLectureMethod === "LINK" && (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Liên kết video bài giảng (YouTube, Facebook, Google Drive):
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        placeholder="https://www.youtube.com/watch?v=..."
                        value={editLectureInputUrl}
                        onChange={(e) => handleEditLectureLinkChange(e.target.value)}
                        className={`w-full px-3 py-2 pr-9 rounded-xl border text-xs ${
                          editLectureUrlError
                            ? "border-rose-500 bg-rose-50/20 text-rose-700"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                        }`}
                      />
                      {editLectureDetectedPlatform !== "INVALID" && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 font-extrabold text-[10px]">
                          ✓ {editLectureDetectedPlatform}
                        </span>
                      )}
                    </div>
                    {editLectureUrlError && (
                      <p className="text-[11px] text-rose-500 font-bold">{editLectureUrlError}</p>
                    )}

                    {/* Preview video nếu là YouTube */}
                    {getLectureYoutubeId(editLectureInputUrl) && (
                      <div className="mt-2 rounded-xl overflow-hidden aspect-video bg-black border border-slate-200 dark:border-slate-700 shadow-sm">
                        <iframe
                          src={`https://www.youtube.com/embed/${getLectureYoutubeId(editLectureInputUrl)}`}
                          className="w-full h-full border-0"
                          title="Xem trước video bài giảng"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Nếu chọn tải tệp từ máy */}
                {editLectureMethod === "FILE" && (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Chọn tệp bài giảng mới từ máy tính (PPTX, Video, PDF):
                    </label>
                    <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-5 block text-center cursor-pointer hover:border-sky-500 transition">
                      <input type="file" onChange={handleEditLectureFileSelect} className="hidden" />
                      <UploadCloud size={28} className="mx-auto text-sky-500 mb-1" />
                      <span className="block text-xs font-bold">Bấm để chọn tệp thay thế</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">
                        Hỗ trợ PowerPoint (.pptx), Video (.mp4), PDF, Word
                      </span>
                    </label>

                    {/* Hiển thị tệp hiện tại hoặc tệp mới */}
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1.5">
                      <div className="flex justify-between font-bold text-[11px]">
                        <span className="truncate max-w-[200px]">
                          {editLectureFileObj
                            ? `Tệp mới: ${editLectureFileObj.name}`
                            : `Tệp hiện tại: ${editingLecture.sourceUrl || editingLecture.title}`}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        {editLectureFileObj ? "Đã chọn tệp thay thế. Tệp sẽ được tải lên khi lưu thay đổi." : "Chưa chọn tệp thay thế."}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* BƯỚC 2: VÙNG PHẢI - Sửa thông tin tiêu đề, thư mục, mô tả */}
              <div className="space-y-4">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 block">
                  Bước 2: Cập nhật thông tin bài giảng
                </span>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tên bài giảng <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    value={editLectureFormTitle}
                    onChange={(e) => setEditLectureFormTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Thư mục lưu trữ:
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={editLectureFormFolder}
                      onChange={(e) => setEditLectureFormFolder(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                    >
                      {Array.from(
                        new Set(
                          [...lectureFolders, editLectureFormFolder, "Bài giảng chung"].filter(
                            Boolean,
                          ),
                        ),
                      ).map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Trạng thái hiển thị:
                  </label>
                  <select
                    value={editLectureFormVisibility}
                    onChange={(e) =>
                      setEditLectureFormVisibility(e.target.value as "PUBLISHED" | "HIDDEN")
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                  >
                    <option value="PUBLISHED">Hiển thị với học sinh</option>
                    <option value="HIDDEN">Ẩn với học sinh</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => {
                  setEditLectureModalOpen(false);
                  setEditingLecture(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditLecture}
                className="px-5 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 shadow-xs cursor-pointer"
              >
                Lưu toàn bộ thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL THÊM TÀI LIỆU MỚI DÀNH CHO GIẢNG VIÊN
          ========================================================================= */}
      {addMaterialModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Tải lên tài liệu mới
              </h3>
              <button
                type="button"
                onClick={() => setAddMaterialModalOpen(false)}
                disabled={materialSaving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên tài liệu:
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đề cương ôn tập Toán học 12.pdf"
                  value={materialFormTitle}
                  onChange={(e) => setMaterialFormTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Thư mục lưu trữ tài liệu:
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={materialFormFolder}
                      onChange={(e) => setMaterialFormFolder(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    >
                      {customMaterialFolders.length === 0 && (
                        <option value="">Chưa có thư mục tài liệu</option>
                      )}
                      {Array.from(new Set(customMaterialFolders.filter(Boolean))).map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Đang lưu vào thư mục: <strong className="text-blue-600 dark:text-blue-400">{materialFormFolder}</strong>
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Tệp tài liệu <span className="text-rose-500">*</span>:</label>
                <input
                  type="file"
                  disabled={materialSaving}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setMaterialUploadFile(file);
                    if (file && !materialFormTitle.trim()) setMaterialFormTitle(file.name);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
                {materialUploadFile && <p className="mt-1 text-slate-500">{materialUploadFile.name} · {(materialUploadFile.size / 1024 / 1024).toFixed(2)} MB</p>}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trạng thái hiển thị:
                </label>
                <select
                  value={materialFormVisibility}
                  onChange={(e) =>
                    setMaterialFormVisibility(e.target.value as "PUBLISHED" | "HIDDEN")
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="PUBLISHED">Hiển thị với học sinh</option>
                  <option value="HIDDEN">Ẩn với học sinh</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAddMaterialModalOpen(false)}
                disabled={materialSaving}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveNewMaterial}
                disabled={materialSaving}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs"
              >
                {materialSaving ? "Đang tải lên..." : "Tải lên & Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL CHỈNH SỬA TÀI LIỆU DÀNH CHO GIẢNG VIÊN (HỖ TRỢ THAY TỆP MỚI TỪ MÁY)
          ========================================================================= */}
      {editMaterialModalOpen && editingMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Chỉnh sửa tài liệu: {editingMaterial.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditMaterialModalOpen(false);
                  setEditingMaterial(null);
                }}
                disabled={materialSaving}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Vùng tải tệp thay thế từ máy tính */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Thay đổi tệp đính kèm từ máy tính (tùy chọn):
                </label>
                <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-3.5 block text-center cursor-pointer hover:border-blue-500 transition bg-slate-50/50 dark:bg-slate-800/40">
                  <input type="file" onChange={handleEditMaterialFileSelect} disabled={materialSaving} className="hidden" />
                  <UploadCloud size={22} className="mx-auto text-blue-500 mb-1" />
                  <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                    {editMaterialFileObj ? `Đã chọn: ${editMaterialFileObj.name}` : "Bấm để chọn tệp mới thay thế"}
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    Hỗ trợ PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx)
                  </span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tên tài liệu <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={editMaterialFormTitle}
                  onChange={(e) => setEditMaterialFormTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Thư mục:
                  </label>
                  <select
                    value={editMaterialFormFolder}
                    onChange={(e) => setEditMaterialFormFolder(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    {Array.from(
                      new Set(materialFolders.filter(Boolean)),
                    ).map((f) => (
                      <option key={f} value={f}>
                        📁 {f}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Định dạng & Dung lượng:
                  </label>
                  <p className="px-2 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase">
                    {editMaterialFileObj ? editMaterialFileObj.name.split(".").pop() || "file" : editingMaterial.fileType} · {editMaterialFileObj ? `${(editMaterialFileObj.size / 1024 / 1024).toFixed(2)} MB` : editingMaterial.size}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Trạng thái hiển thị:
                </label>
                <select
                  value={editMaterialFormVisibility}
                  onChange={(e) =>
                    setEditMaterialFormVisibility(e.target.value as "PUBLISHED" | "HIDDEN")
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="PUBLISHED">Hiển thị với học sinh</option>
                  <option value="HIDDEN">Ẩn với học sinh</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setEditMaterialModalOpen(false);
                  setEditingMaterial(null);
                }}
                disabled={materialSaving}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditMaterial}
                disabled={materialSaving}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer"
              >
                {materialSaving ? "Đang lưu..." : "Lưu toàn bộ thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL HUB ĐIỀU PHỐI TÁCH BẠCH LUỒNG TẠO BÀI TẬP & BỔ SUNG NGÂN HÀNG CÂU HỎI
          ========================================================================= */}
      {creationHubOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles size={18} className="text-blue-600" />
                  <span>
                    {creationTarget === "ASSIGNMENT"
                      ? `Tạo bài tập mới cho lớp ${item.name}`
                      : `Thêm câu hỏi mới vào Ngân hàng câu hỏi`}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {creationTarget === "QUESTION"
                    ? "Chọn phương thức bổ sung câu hỏi mới vào Ngân hàng câu hỏi của lớp:"
                    : !assignmentHubType
                      ? "Chọn loại bài trước, sau đó chọn một trong 5 phương thức tạo bài tương ứng."
                      : assignmentHubType === "ESSAY"
                        ? "Chọn 1 trong 5 phương thức tạo bài tập tự luận dưới đây:"
                        : "Chọn 1 trong 5 phương thức tạo đề trắc nghiệm dưới đây:"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreationHubOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            {creationTarget === "QUESTION" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpenedFromCreationHub(true);
                    setCreationHubOpen(false);
                    setAuthoringModalOpen(true);
                  }}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-white dark:bg-slate-800/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                >
                  <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                    <Edit3 size={18} />
                  </div>
                  <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                    1. Soạn câu hỏi thủ công
                  </strong>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Nhập nội dung, phương án, đáp án và mức độ khó cho từng câu hỏi mới lưu vào ngân hàng lớp.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOpenedFromCreationHub(true);
                    setCreationHubOpen(false);
                    setScanTargetMode("BANK_ONLY");
                    setScanModalOpen(true);
                  }}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 bg-white dark:bg-slate-800/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                >
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                    <Scan size={18} />
                  </div>
                  <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                    2. Quét câu hỏi từ ảnh (AI OCR)
                  </strong>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Chọn tối đa 5 ảnh đề chụp thực tế, quét cộng dồn câu hỏi và chỉnh sửa trước khi nhập vào ngân hàng.
                  </p>
                </button>
              </div>
            ) : !assignmentHubType ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setAssignmentHubType("MULTIPLE_CHOICE")}
                  className="rounded-2xl border-2 border-slate-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-50/50 dark:border-slate-800 dark:hover:bg-blue-950/30 cursor-pointer"
                >
                  <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    Đề Trắc nghiệm
                  </strong>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    Có phương án lựa chọn, chấm điểm tự động trên thang 10 điểm và hỗ trợ hỏi đáp AI dẫn dắt.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAssignmentHubType("ESSAY")}
                  className="rounded-2xl border-2 border-slate-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-50/50 dark:border-slate-800 dark:hover:bg-blue-950/30 cursor-pointer"
                >
                  <strong className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    Đề Tự luận
                  </strong>
                  <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                    Học viên trình bày lời giải hoặc nộp tệp bài làm trên thang 10 điểm để giảng viên chấm.
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50/70 px-3.5 py-2 text-xs dark:border-blue-900/60 dark:bg-blue-950/30">
                  <span className="font-bold text-blue-800 dark:text-blue-200">
                    Loại bài đang chọn:{" "}
                    {assignmentHubType === "ESSAY" ? "Đề Tự luận" : "Đề Trắc nghiệm"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAssignmentHubType(null)}
                    className="inline-flex items-center gap-1 font-bold text-blue-600 hover:underline dark:text-blue-400 cursor-pointer"
                  >
                    <ArrowLeft size={13} />
                    <span>Đổi loại đề</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Cách 1: Soạn thủ công đúng theo loại đề */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFromCreationHub(true);
                      setCreationHubOpen(false);
                      setBuilderInitialMethod("MANUAL");
                      setAddAssignmentModalOpen(true);
                    }}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-white dark:bg-slate-800/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                  >
                    <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Edit3 size={18} />
                    </div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      {assignmentHubType === "ESSAY"
                        ? "1. Soạn đề tự luận thủ công"
                        : "1. Soạn đề trắc nghiệm thủ công"}
                    </strong>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {assignmentHubType === "ESSAY"
                        ? "Tự nhập từng câu hỏi tự luận, đính kèm tệp đề (nếu có) và thiết lập hạn nộp."
                        : "Tự nhập từng câu trắc nghiệm, phương án A–D, đáp án đúng và tự động chia đều 10 điểm."}
                    </p>
                  </button>

                  {/* Cách 2: Quét ảnh bằng AI OCR tạo đề trực tiếp */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFromCreationHub(true);
                      setCreationHubOpen(false);
                      setScanTargetMode(assignmentHubType);
                      setScanModalOpen(true);
                    }}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 bg-white dark:bg-slate-800/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                  >
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Scan size={18} />
                    </div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      {assignmentHubType === "ESSAY"
                        ? "2. Quét ảnh đề tự luận (AI OCR)"
                        : "2. Quét ảnh đề trắc nghiệm (AI OCR)"}
                    </strong>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {assignmentHubType === "ESSAY"
                        ? "Quét cộng dồn tối đa 5 ảnh đề tự luận, sửa từng câu hỏi và lưu tạo trực tiếp thành bài tập."
                        : "Quét cộng dồn tối đa 5 ảnh đề thi, sửa câu hỏi/đáp án, chia đều 10 điểm và lưu tạo thành bài tập."}
                    </p>
                  </button>

                  {/* Cách 3: Tạo đề bằng AI có duyệt sửa */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFromCreationHub(true);
                      setCreationHubOpen(false);
                      setAiBuilderMode(assignmentHubType);
                      setAiExamModalOpen(true);
                    }}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 bg-white dark:bg-slate-800/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                  >
                    <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Wand2 size={18} />
                    </div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      {assignmentHubType === "ESSAY"
                        ? "3. Tạo đề tự luận bằng AI"
                        : "3. Tạo đề trắc nghiệm bằng AI"}
                    </strong>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {assignmentHubType === "ESSAY"
                        ? "Nhập môn học & chuyên đề để AI sinh câu tự luận nháp, xem & sửa từng câu trước khi phát hành."
                        : "Nhập môn học & chuyên đề để AI sinh câu trắc nghiệm nháp, xem & sửa câu hỏi/đáp án trước khi phát hành."}
                    </p>
                  </button>

                  {/* Cách 4: Đóng gói từ Ngân hàng câu hỏi đúng theo loại đề */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFromCreationHub(true);
                      setBankBuilderAssignmentType(assignmentHubType);
                      setManualExamTargetScore(10);
                      setManualExamQuestionScores({});
                      setManualExamCustomScored(false);
                      setManualExamSelectedQuestions([]);
                      setManualExamSearch("");
                      setManualExamDifficulties([]);
                      setManualDifficultyDropdownOpen(false);
                      setAiCriteriaPreviewList([]);
                      setExamCreationMode("MANUAL");
                      setCreationHubOpen(false);
                      setManualExamModalOpen(true);
                    }}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-amber-400 dark:hover:border-amber-600 bg-white dark:bg-slate-800/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
                  >
                    <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Layers size={18} />
                    </div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      {assignmentHubType === "ESSAY"
                        ? "4. Chọn câu tự luận từ Ngân hàng"
                        : "4. Chọn câu trắc nghiệm từ Ngân hàng"}
                    </strong>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {assignmentHubType === "ESSAY"
                        ? "Chỉ hiển thị và bốc các câu tự luận đã xuất bản trong ngân hàng để giao bài tập."
                        : "Chỉ hiển thị và bốc các câu trắc nghiệm đã xuất bản trong ngân hàng thành đề 10 điểm."}
                    </p>
                  </button>

                  {/* Cách 5: Tách đề từ tệp Word / PDF / TXT */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenedFromCreationHub(true);
                      setCreationHubOpen(false);
                      setBuilderInitialMethod("AI");
                      setAddAssignmentModalOpen(true);
                    }}
                    className="p-4 rounded-2xl border border-blue-300 dark:border-blue-700 hover:border-blue-500 bg-linear-to-r from-blue-50/80 to-indigo-50/80 dark:from-blue-950/40 dark:to-indigo-950/40 text-left transition space-y-2 cursor-pointer group shadow-sm sm:col-span-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                        <FileCheck2 size={18} />
                      </div>
                      <div>
                        <strong className="block text-xs font-bold text-blue-900 dark:text-blue-100">
                          {assignmentHubType === "ESSAY"
                            ? "5. Tách đề tự luận từ tệp Word / PDF / TXT"
                            : "5. Tách đề trắc nghiệm từ tệp Word / PDF / TXT"}
                        </strong>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                          {assignmentHubType === "ESSAY"
                            ? "Tự động tách từng câu hỏi tự luận để giảng viên rà soát và đính kèm tệp đề"
                            : "Hỗ trợ nhận diện bảng phương án, bảng đáp án cuối đề và tự động chia đều 10 điểm"}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {assignmentHubType === "ESSAY"
                        ? "Tải tệp Word, PDF hoặc TXT có sẵn để bóc tách câu hỏi tự luận, chỉnh sửa nội dung và đính kèm tệp đề gốc."
                        : "Tải tệp Word, PDF hoặc TXT có sẵn để tự tách câu hỏi, phương án, ghép đáp án và kiểm duyệt trước khi lưu."}
                    </p>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          CÁCH 1: MODAL SOẠN CÂU HỎI THỦ CÔNG
          ========================================================================= */}
      {authoringModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Soạn câu hỏi thủ công"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                <span>Soạn câu hỏi thủ công</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={authoringPreview}
                  onClick={() => setAuthoringPreview((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition inline-flex items-center gap-1.5 cursor-pointer ${
                    authoringPreview
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-950/60 dark:text-blue-300"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {authoringPreview ? <Edit3 size={13} /> : <Eye size={14} />}
                  <span>{authoringPreview ? "Quay lại chỉnh sửa" : "Xem giao diện"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthoringModalOpen(false);
                    setAuthoringPreview(false);
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {authoringPreview ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                    Bản xem trước giao diện sau khi render LaTeX
                  </p>
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60">
                        {authoringType === "SINGLE_CHOICE"
                          ? "Trắc nghiệm một đáp án"
                          : authoringType === "MULTIPLE_CHOICE"
                            ? "Trắc nghiệm nhiều đáp án"
                            : "Tự luận"}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                        {authoringDifficulty === "EASY"
                          ? "Cơ bản"
                          : authoringDifficulty === "MEDIUM"
                            ? "Thông hiểu"
                            : "Vận dụng cao"}
                      </span>
                    </div>
                    <QuestionRenderPreview
                      content={authoringContent}
                      options={authoringType !== "ESSAY" ? authoringOptions : []}
                      correctOptionIndexes={authoringCorrect}
                    />
                  </div>
                </div>
              ) : (
                <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Loại câu hỏi:
                  </label>
                  <select
                    value={authoringType}
                    onChange={(e) => setAuthoringType(e.target.value as typeof authoringType)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="SINGLE_CHOICE">Trắc nghiệm một đáp án</option>
                    <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
                    <option value="ESSAY">Tự luận</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mức độ khó:
                  </label>
                  <select
                    value={authoringDifficulty}
                    onChange={(e) => setAuthoringDifficulty(e.target.value as typeof authoringDifficulty)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="EASY">Cơ bản (Nhận biết)</option>
                    <option value="MEDIUM">Thông hiểu</option>
                    <option value="HARD">Vận dụng cao</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nội dung câu hỏi <span className="text-rose-500">*</span>:
                </label>
                <textarea
                  rows={3}
                  placeholder="Nhập nội dung đề bài câu hỏi..."
                  value={authoringContent}
                  onChange={(e) => setAuthoringContent(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none font-medium"
                />
              </div>

              {/* Các phương án A, B, C, D nếu là trắc nghiệm */}
              {authoringType !== "ESSAY" && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Các phương án trả lời (chọn phương án đúng):
                  </label>
                  {authoringOptions.map((opt, idx) => {
                    const isChecked = authoringCorrect.includes(idx);
                    const prefix = String.fromCharCode(65 + idx);
                    return (
                      <div key={idx} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (authoringType === "SINGLE_CHOICE") {
                              setAuthoringCorrect([idx]);
                            } else {
                              if (authoringCorrect.includes(idx)) {
                                setAuthoringCorrect(authoringCorrect.filter((c) => c !== idx));
                              } else {
                                setAuthoringCorrect([...authoringCorrect, idx]);
                              }
                            }
                          }}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer transition ${
                            isChecked
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300"
                          }`}
                        >
                          {prefix}
                        </button>
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => {
                            const next = [...authoringOptions];
                            next[idx] = e.target.value;
                            setAuthoringOptions(next);
                          }}
                          className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                        />
                        {isChecked && (
                          <span className="text-[11px] font-bold text-emerald-600 shrink-0">
                            ✓ Đáp án đúng
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="text-xs text-blue-700 dark:text-blue-300">
                Câu hỏi mới được lưu trong ngân hàng và có thể dùng để tạo đề thi ngay.
              </p>
                </>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <div>
                {openedFromCreationHub && (
                  <button
                    type="button"
                    disabled={authoringSaving}
                    onClick={handleReturnToCreationHub}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <ArrowLeft size={14} />
                    <span>Chọn cách thêm khác</span>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthoringModalOpen(false);
                    setAuthoringPreview(false);
                    setOpenedFromCreationHub(false);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleSaveManualQuestion}
                  disabled={authoringSaving}
                  className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {authoringSaving ? "Đang lưu..." : "Lưu câu hỏi"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CÁCH 2: MODAL QUÉT ĐỀ THÔNG MINH BẰNG AI (OCR ĐA ẢNH & CHỈNH SỬA TRỰC QUAN)
          ========================================================================= */}
      <SmartExamScanModal
        open={scanModalOpen}
        courseId={item.courseId}
        roleCode={session.roleCode}
        targetMode={scanTargetMode}
        targetClassEndAt={item.endAt}
        onClose={() => {
          setScanModalOpen(false);
          setOpenedFromCreationHub(false);
        }}
        onBackToHub={openedFromCreationHub ? handleReturnToCreationHub : undefined}
        onImported={refreshQuestionData}
        onSaveAssignment={handleSaveFromBuilder}
      />

      {/* =========================================================================
          CÁCH 3: MODAL TẠO ĐỀ BẰNG AI CÓ DUYỆT & CHỈNH SỬA CÂU HỎI
          ========================================================================= */}
      <AiExamBuilderModal
        open={aiExamModalOpen}
        initialMode={aiBuilderMode}
        classId={item.id}
        defaultSubject={item.subject || course?.subject || course?.name || undefined}
        targetClassEndAt={item.endAt}
        roleCode={session.roleCode}
        onClose={() => {
          setAiExamModalOpen(false);
          setOpenedFromCreationHub(false);
        }}
        onBackToHub={openedFromCreationHub ? handleReturnToCreationHub : undefined}
        onSaveAssignment={handleSaveFromBuilder}
      />

      {/* =========================================================================
          MODAL: CHỈNH SỬA CÂU HỎI TRONG NGÂN HÀNG CÂU HỎI LỚP
          ========================================================================= */}
      {editingQuestionModalOpen && editingQuestionData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chỉnh sửa câu hỏi ngân hàng lớp"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Chỉnh sửa câu hỏi ngân hàng lớp
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-pressed={editingQuestionPreview}
                  onClick={() => setEditingQuestionPreview((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition inline-flex items-center gap-1.5 cursor-pointer ${
                    editingQuestionPreview
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500/70 dark:bg-blue-950/60 dark:text-blue-300"
                      : "border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {editingQuestionPreview ? <Edit3 size={13} /> : <Eye size={14} />}
                  <span>{editingQuestionPreview ? "Quay lại chỉnh sửa" : "Xem giao diện"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingQuestionModalOpen(false);
                    setEditingQuestionPreview(false);
                    setEditingQuestionData(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              {editingQuestionPreview ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                    Bản xem trước giao diện sau khi render LaTeX
                  </p>
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60">
                        {editingQuestionData.type}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                        {editingQuestionData.difficulty}
                      </span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        Nguồn:{" "}
                        <strong className="text-slate-600 dark:text-slate-300">
                          {editingQuestionData.source.trim() || "Ngân hàng câu hỏi"}
                        </strong>
                      </span>
                    </div>
                    <QuestionRenderPreview
                      content={editingQuestionData.content}
                      options={editingQuestionData.type !== "Tự luận" ? editingQuestionData.options : []}
                      correctOptionIndexes={editingQuestionData.correctAnswers}
                      solution={editingQuestionData.solution}
                    />
                  </div>
                </div>
              ) : (
                <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Loại câu hỏi:
                  </label>
                  <select
                    value={editingQuestionData.type}
                    onChange={(e) =>
                      setEditingQuestionData({ ...editingQuestionData, type: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                  >
                    <option value="Trắc nghiệm một đáp án">Trắc nghiệm một đáp án</option>
                    <option value="Nhiều đáp án">Nhiều đáp án</option>
                    <option value="Đúng / Sai">Đúng / Sai</option>
                    <option value="Điền khuyết">Điền khuyết</option>
                    <option value="Tự luận">Tự luận</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mức độ độ khó:
                  </label>
                  <select
                    value={editingQuestionData.difficulty}
                    onChange={(e) =>
                      setEditingQuestionData({ ...editingQuestionData, difficulty: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                  >
                    <option value="Cơ bản">Cơ bản (Nhận biết)</option>
                    <option value="Thông hiểu">Thông hiểu</option>
                    <option value="Vận dụng">Vận dụng</option>
                    <option value="Vận dụng cao">Vận dụng cao</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nội dung câu hỏi <span className="text-rose-500">*</span>:
                </label>
                <textarea
                  aria-label="Nội dung câu hỏi"
                  rows={3}
                  value={editingQuestionData.content}
                  onChange={(e) =>
                    setEditingQuestionData({ ...editingQuestionData, content: e.target.value })
                  }
                  placeholder="Nhập nội dung câu hỏi..."
                  className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                />
              </div>

              {/* Các phương án nếu không phải Tự luận */}
              {editingQuestionData.type !== "Tự luận" && (
                <div className="space-y-3 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Các phương án trả lời & Chọn đáp án đúng:
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const nextLetter = String.fromCharCode(65 + editingQuestionData.options.length);
                        setEditingQuestionData({
                          ...editingQuestionData,
                          options: [...editingQuestionData.options, `Phương án ${nextLetter}`],
                        });
                      }}
                      className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      + Thêm phương án
                    </button>
                  </div>

                  <div className="space-y-2">
                    {editingQuestionData.options.map((opt, idx) => {
                      const prefix = String.fromCharCode(65 + idx);
                      const isCorrect = editingQuestionData.correctAnswers.includes(idx);
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (["Nhiều đáp án", "Trắc nghiệm nhiều đáp án"].includes(editingQuestionData.type)) {
                                const exists = editingQuestionData.correctAnswers.includes(idx);
                                setEditingQuestionData({
                                  ...editingQuestionData,
                                  correctAnswers: exists
                                    ? editingQuestionData.correctAnswers.filter((a) => a !== idx)
                                    : [...editingQuestionData.correctAnswers, idx],
                                });
                              } else {
                                setEditingQuestionData({
                                  ...editingQuestionData,
                                  correctAnswers: [idx],
                                });
                              }
                            }}
                            className={`size-7 rounded-lg font-bold text-xs shrink-0 flex items-center justify-center transition cursor-pointer ${
                              isCorrect
                                ? "bg-emerald-600 text-white shadow-2xs"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                            }`}
                            title={isCorrect ? "Đáp án đúng (Bấm để đổi)" : "Bấm để chọn làm đáp án đúng"}
                          >
                            {prefix}
                          </button>
                          <input
                            aria-label={`Phương án ${prefix}`}
                            type="text"
                            value={opt}
                            onChange={(e) => {
                              const newOpts = [...editingQuestionData.options];
                              newOpts[idx] = e.target.value;
                              setEditingQuestionData({ ...editingQuestionData, options: newOpts });
                            }}
                            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                          />
                          {editingQuestionData.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => {
                                const newOpts = editingQuestionData.options.filter((_, oIdx) => oIdx !== idx);
                                const newCorrect = editingQuestionData.correctAnswers
                                  .filter((a) => a !== idx)
                                  .map((a) => (a > idx ? a - 1 : a));
                                setEditingQuestionData({
                                  ...editingQuestionData,
                                  options: newOpts,
                                  correctAnswers: newCorrect.length > 0 ? newCorrect : [0],
                                });
                              }}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 cursor-pointer"
                              title="Xóa phương án này"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Máy chủ chưa lưu lời giải của câu hỏi: không hiển thị ô nhập để tránh mất dữ liệu âm thầm. */}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nguồn câu hỏi / Xuất xứ đề:
                </label>
                <input
                  aria-label="Nguồn câu hỏi / Xuất xứ đề"
                  type="text"
                  value={editingQuestionData.source}
                  onChange={(e) =>
                    setEditingQuestionData({ ...editingQuestionData, source: e.target.value })
                  }
                  placeholder="Ví dụ: Đề kiểm tra giữa kỳ 1, Tách từ Word..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
                </>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionModalOpen(false);
                  setEditingQuestionPreview(false);
                  setEditingQuestionData(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditedQuestion}
                disabled={editingQuestionSaving}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer disabled:opacity-50"
              >
                Lưu cập nhật
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CÁCH 4: MODAL TẠO ĐỀ THI TỪ NGÂN HÀNG CÂU HỎI (3 KIỂU CHỨC NĂNG THẬT)
          ========================================================================= */}
      {manualExamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200 my-auto">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/20">
              <div className="flex items-center gap-2">
                <FileCheck2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    {bankBuilderAssignmentType === "ESSAY"
                      ? "Tạo bài tập tự luận từ Ngân hàng câu hỏi"
                      : "Tạo đề trắc nghiệm từ Ngân hàng câu hỏi"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {bankBuilderAssignmentType === "ESSAY"
                      ? `Ngân hàng lớp hiện có ${publishedQuestionStats.essay} câu tự luận đã xuất bản · Tổng ${manualExamTargetScore} điểm`
                      : `Ngân hàng lớp hiện có ${publishedQuestionStats.multipleChoice} câu trắc nghiệm đã xuất bản · Tổng ${manualExamTargetScore} điểm`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {openedFromCreationHub && (
                  <button
                    type="button"
                    disabled={examSaving}
                    onClick={handleReturnToCreationHub}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <ArrowLeft size={14} />
                    <span>Chọn cách tạo khác</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setManualExamModalOpen(false);
                    setOpenedFromCreationHub(false);
                  }}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Thông tin chung */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={bankBuilderAssignmentType === "ESSAY" ? "sm:col-span-3" : "sm:col-span-2"}>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tiêu đề bài kiểm tra / bài tập <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    placeholder={
                      bankBuilderAssignmentType === "ESSAY"
                        ? "Ví dụ: Bài tập tự luận chương 1..."
                        : "Ví dụ: Kiểm tra 15 phút Toán học số 1..."
                    }
                    value={manualExamTitle}
                    onChange={(e) => setManualExamTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                  />
                </div>

                {bankBuilderAssignmentType === "MULTIPLE_CHOICE" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Thời lượng (phút):
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={manualExamDuration}
                      onChange={(e) => setManualExamDuration(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-bold"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="manual-exam-due-at" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Hạn nộp (để trống: sau 7 ngày):
                  </label>
                  <input
                    id="manual-exam-due-at"
                    type="datetime-local"
                    value={manualExamDueAt}
                    onChange={(event) => setManualExamDueAt(event.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 px-3 py-2">
                  <label htmlFor="manual-exam-target-score" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Tổng điểm thang đề:
                  </label>
                  <ScoreStepperInput
                    id="manual-exam-target-score"
                    stepTargetLabel="tổng điểm ngân hàng"
                    min={0.25}
                    max={1000}
                    value={manualExamTargetScore}
                    onChange={(val) => {
                      const safe = val >= 0.25 ? val : 0.25;
                      setManualExamTargetScore(safe);
                      setManualExamCustomScored(false);
                      const activeIds =
                        examCreationMode === "AI_CRITERIA"
                          ? aiCriteriaPreviewList.map((q) => q.id)
                          : manualExamSelectedQuestions;
                      setManualExamQuestionScores(buildEqualBankScoreMap(activeIds, safe));
                    }}
                  />
                </div>
              </div>

              {bankBuilderAssignmentType === "MULTIPLE_CHOICE" && (
                <label className="flex items-start gap-2.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={manualExamTutorEnabled}
                    onChange={(event) => setManualExamTutorEnabled(event.target.checked)}
                    className="mt-0.5 size-4 accent-indigo-600"
                  />
                  <span>
                    <span className="block font-bold text-slate-900 dark:text-slate-100">
                      Cho phép học sinh hỏi đáp AI dẫn dắt khi làm bài
                    </span>
                    <span className="block text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      Mỗi câu hỏi có khung chat gợi ý riêng theo hạn mức hệ thống, không tiết lộ đáp án.
                    </span>
                  </span>
                </label>
              )}

              {/* BỘ CHỌN 3 KIỂU TẠO ĐỀ */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Chọn phương thức tạo đề thi:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setExamCreationMode("MANUAL")}
                    className={`p-3 rounded-xl border-2 text-left transition cursor-pointer space-y-1 ${
                      examCreationMode === "MANUAL"
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-xs"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-slate-100">
                      <ListChecks size={15} className="text-indigo-600" />
                      <span>1. Chọn thủ công</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-tight">
                      Tự tay tick chọn từng câu hỏi trong ngân hàng đưa vào đề.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExamCreationMode("AI_CRITERIA")}
                    className={`p-3 rounded-xl border-2 text-left transition cursor-pointer space-y-1 ${
                      examCreationMode === "AI_CRITERIA"
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-xs"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-slate-100">
                      <Wand2 size={15} className="text-emerald-600" />
                      <span>2. Chọn theo ma trận</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-tight">
                      Chọn tỷ lệ độ khó, hệ thống lọc câu hỏi đã xuất bản.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExamCreationMode("RANDOM")}
                    className={`p-3 rounded-xl border-2 text-left transition cursor-pointer space-y-1 ${
                      examCreationMode === "RANDOM"
                        ? "border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 shadow-xs"
                        : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900 dark:text-slate-100">
                      <RefreshCw size={15} className="text-amber-600" />
                      <span>3. Ngẫu nhiên</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-tight">
                      Bốc ngẫu nhiên số lượng câu hỏi và tự động xáo trộn.
                    </p>
                  </button>
                </div>
              </div>

              {/* =================================================================
                  NỘI DUNG KIỂU 1: GIÁO VIÊN CHỌN THỦ CÔNG (CHỈ HIỂN THỊ ĐÚNG LOẠI ĐỀ)
                  ================================================================= */}
              {examCreationMode === "MANUAL" && (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {bankBuilderAssignmentType === "ESSAY"
                        ? `Chọn câu tự luận (${manualExamSelectedQuestions.length}/${scopedPublishedBankQuestions.length} câu đã xuất bản):`
                        : `Chọn câu trắc nghiệm (${manualExamSelectedQuestions.length}/${scopedPublishedBankQuestions.length} câu đã xuất bản):`}
                    </span>

                    <div className="flex flex-1 flex-wrap items-center justify-end gap-2 min-w-[260px]">
                      <div className="relative flex-1 min-w-[150px] max-w-[220px]">
                        <Search
                          size={13}
                          aria-hidden="true"
                          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="text"
                          value={manualExamSearch}
                          onChange={(e) => setManualExamSearch(e.target.value)}
                          placeholder="Tìm câu hỏi, nguồn..."
                          aria-label="Tìm kiếm câu hỏi ngân hàng"
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-7 pr-6 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                        {manualExamSearch.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setManualExamSearch("")}
                            aria-label="Xóa từ khóa tìm kiếm"
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        )}
                      </div>

                      <div ref={manualDifficultyFilterRef} className="relative shrink-0">
                        <button
                          type="button"
                          aria-expanded={manualDifficultyDropdownOpen}
                          aria-haspopup="true"
                          onClick={() => setManualDifficultyDropdownOpen((prev) => !prev)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                            manualExamDifficulties.length > 0
                              ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          }`}
                        >
                          <Filter size={13} aria-hidden="true" />
                          <span>
                            {manualExamDifficulties.length > 0
                              ? `Lọc (${manualExamDifficulties.length})`
                              : "Lọc"}
                          </span>
                          <ChevronDown
                            size={13}
                            aria-hidden="true"
                            className={`transition-transform ${manualDifficultyDropdownOpen ? "rotate-180" : ""}`}
                          />
                        </button>

                        {manualDifficultyDropdownOpen && (
                          <div
                            role="group"
                            aria-label="Lọc mức độ khó câu hỏi"
                            className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 shadow-xl space-y-1.5"
                          >
                            <div className="flex items-center justify-between px-1 pb-1 border-b border-slate-100 dark:border-slate-800">
                              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                Mức độ khó
                              </span>
                              {manualExamDifficulties.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setManualExamDifficulties([])}
                                  className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                                >
                                  Bỏ lọc
                                </button>
                              )}
                            </div>
                            <div className="space-y-1">
                              {BANK_DIFFICULTY_LEVELS.map((level) => {
                                const checked = manualExamDifficulties.includes(level);
                                return (
                                  <label
                                    key={level}
                                    className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition ${
                                      checked
                                        ? "bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 font-semibold"
                                        : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/70"
                                    }`}
                                  >
                                    <span className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        aria-label={`Độ khó ${level}`}
                                        checked={checked}
                                        onChange={(e) => {
                                          setManualExamDifficulties((prev) =>
                                            e.target.checked
                                              ? prev.includes(level)
                                                ? prev
                                                : [...prev, level]
                                              : prev.filter((item) => item !== level),
                                          );
                                        }}
                                        className="rounded text-indigo-600 accent-indigo-600"
                                      />
                                      <span>{level}</span>
                                    </span>
                                    <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                      {manualExamDifficultyCounts[level] ?? 0}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {manualExamSelectedQuestions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setManualExamCustomScored(false);
                            setManualExamQuestionScores(
                              buildEqualBankScoreMap(manualExamSelectedQuestions, manualExamTargetScore),
                            );
                          }}
                          className="text-emerald-600 font-bold hover:underline cursor-pointer whitespace-nowrap"
                        >
                          Chia đều điểm
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const visibleIds = manualExamVisibleQuestions.map((question) => question.id);
                          const nextSelected = toggleVisibleExamQuestions(manualExamSelectedQuestions, visibleIds);
                          setManualExamSelectedQuestions(nextSelected);
                          setManualExamCustomScored(false);
                          setManualExamQuestionScores(
                            buildEqualBankScoreMap(nextSelected, manualExamTargetScore),
                          );
                        }}
                        disabled={manualExamVisibleQuestions.length === 0}
                        className="text-indigo-600 font-bold hover:underline cursor-pointer disabled:opacity-40 whitespace-nowrap"
                      >
                        {manualExamAllVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                      </button>
                    </div>
                  </div>

                  {manualExamVisibleQuestions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-xs text-slate-500 space-y-2">
                      <p>
                        {scopedPublishedBankQuestions.length === 0
                          ? bankBuilderAssignmentType === "ESSAY"
                            ? "Ngân hàng lớp hiện chưa có câu hỏi tự luận nào đã xuất bản."
                            : "Ngân hàng lớp hiện chưa có câu hỏi trắc nghiệm nào đã xuất bản."
                          : "Không tìm thấy câu hỏi phù hợp với từ khóa hoặc bộ lọc độ khó đang chọn."}
                      </p>
                      {scopedPublishedBankQuestions.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setManualExamSearch("");
                            setManualExamDifficulties([]);
                          }}
                          className="font-bold text-indigo-600 hover:underline cursor-pointer"
                        >
                          Xóa tìm kiếm & bộ lọc
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {manualExamVisibleQuestions.map((q, qIdx) => {
                        const isSelected = manualExamSelectedQuestions.includes(q.id);
                        return (
                          <div
                            key={q.id}
                            className={`p-3 rounded-xl border flex items-start justify-between gap-3 transition ${
                              isSelected
                                ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30"
                                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850"
                            }`}
                          >
                            <label className="flex flex-1 items-start gap-3 cursor-pointer min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const nextSelected = e.target.checked
                                    ? manualExamSelectedQuestions.includes(q.id)
                                      ? manualExamSelectedQuestions
                                      : [...manualExamSelectedQuestions, q.id]
                                    : manualExamSelectedQuestions.filter((id) => id !== q.id);
                                  setManualExamSelectedQuestions(nextSelected);
                                  if (!manualExamCustomScored) {
                                    setManualExamQuestionScores(
                                      buildEqualBankScoreMap(nextSelected, manualExamTargetScore),
                                    );
                                  } else {
                                    setManualExamQuestionScores((prev) => {
                                      const next = { ...prev };
                                      if (e.target.checked && next[q.id] === undefined) {
                                        next[q.id] = 1;
                                      }
                                      const sum =
                                        Math.round(
                                          nextSelected.reduce((acc, id) => acc + (Number(next[id]) || 0), 0) * 100,
                                        ) / 100;
                                      if (sum >= 0.25) setManualExamTargetScore(sum);
                                      return next;
                                    });
                                  }
                                }}
                                className="mt-0.5 rounded text-indigo-600 accent-indigo-600"
                              />
                              <div className="flex-1 space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    {q.type}
                                  </span>
                                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                                    {q.difficulty}
                                  </span>
                                  <span className="text-[10px] text-slate-400">Nguồn: {q.source}</span>
                                </div>
                                <RichText className="font-semibold text-slate-800 dark:text-slate-200 [&>p]:my-0">
                                  {q.content}
                                </RichText>
                              </div>
                            </label>
                            {isSelected && (
                              <div className="shrink-0 flex items-center gap-1.5">
                                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Điểm:</span>
                                <ScoreStepperInput
                                  ariaLabel={`Điểm câu ngân hàng ${qIdx + 1}`}
                                  stepTargetLabel={`câu ngân hàng ${qIdx + 1}`}
                                  min={0.25}
                                  max={1000}
                                  value={manualExamQuestionScores[q.id] ?? 1}
                                  onChange={(val) => {
                                    setManualExamCustomScored(true);
                                    setManualExamQuestionScores((prev) => {
                                      const next = { ...prev, [q.id]: val };
                                      const sum =
                                        Math.round(
                                          manualExamSelectedQuestions.reduce(
                                            (acc, id) => acc + (Number(next[id]) || 0),
                                            0,
                                          ) * 100,
                                        ) / 100;
                                      if (sum >= 0.25) setManualExamTargetScore(sum);
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* =================================================================
                  NỘI DUNG KIỂU 2: CHỌN MỐC MA TRẬN ĐỘ KHÓ (CHỈ LỌC TRONG LOẠI ĐỀ ĐÃ CHỌN)
                  ================================================================= */}
              {examCreationMode === "AI_CRITERIA" && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {bankBuilderAssignmentType === "ESSAY"
                        ? `Tổng số lượng câu tự luận trong bài (khả dụng ${scopedPublishedBankQuestions.length} câu đã xuất bản):`
                        : `Tổng số lượng câu trắc nghiệm trong đề (khả dụng ${scopedPublishedBankQuestions.length} câu đã xuất bản):`}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, scopedPublishedBankQuestions.length)}
                      value={aiCriteriaQuestionCount}
                      onChange={(e) => {
                        setAiCriteriaQuestionCount(Number(e.target.value));
                        setAiCriteriaPreviewList([]);
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Mốc ma trận phân bố độ khó:
                    </label>
                    <select
                      value={aiCriteriaPreset}
                      onChange={(e) => {
                        const val = e.target.value as typeof aiCriteriaPreset;
                        setAiCriteriaPreset(val);
                        setAiCriteriaPreviewList([]);
                        if (val === "STANDARD") {
                          setAiRatioBasic(40);
                          setAiRatioMedium(30);
                          setAiRatioHard(20);
                          setAiRatioVeryHard(10);
                        } else if (val === "BASIC") {
                          setAiRatioBasic(50);
                          setAiRatioMedium(35);
                          setAiRatioHard(15);
                          setAiRatioVeryHard(0);
                        } else if (val === "ADVANCED") {
                          setAiRatioBasic(20);
                          setAiRatioMedium(30);
                          setAiRatioHard(30);
                          setAiRatioVeryHard(20);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                    >
                      <option value="STANDARD">
                        Ma trận chuẩn Bộ GD&ĐT (40% Cơ bản, 30% Thông hiểu, 20% Vận dụng, 10% Vận dụng cao)
                      </option>
                      <option value="BASIC">
                        Đề 15 phút - Ôn tập cơ bản (50% Cơ bản, 35% Thông hiểu, 15% Vận dụng)
                      </option>
                      <option value="ADVANCED">
                        Đề nâng cao - Phân hóa học sinh (20% Cơ bản, 30% Thông hiểu, 30% Vận dụng, 20% Vận dụng cao)
                      </option>
                      <option value="CUSTOM">Tùy chỉnh tỷ lệ ma trận</option>
                    </select>
                  </div>

                  {/* Lưới 4 mốc tỷ lệ */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    <div>
                      <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Cơ bản (Nhận biết)
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={aiRatioBasic}
                          onChange={(e) => { setAiRatioBasic(Number(e.target.value)); setAiCriteriaPreviewList([]); }}
                          disabled={aiCriteriaPreset !== "CUSTOM"}
                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-xs"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    </div>

                    <div>
                      <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Thông hiểu
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={aiRatioMedium}
                          onChange={(e) => { setAiRatioMedium(Number(e.target.value)); setAiCriteriaPreviewList([]); }}
                          disabled={aiCriteriaPreset !== "CUSTOM"}
                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-xs"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    </div>

                    <div>
                      <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Vận dụng
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={aiRatioHard}
                          onChange={(e) => { setAiRatioHard(Number(e.target.value)); setAiCriteriaPreviewList([]); }}
                          disabled={aiCriteriaPreset !== "CUSTOM"}
                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-xs"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    </div>

                    <div>
                      <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-300">
                        Vận dụng cao
                      </span>
                      <div className="flex items-center gap-1 mt-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={aiRatioVeryHard}
                          onChange={(e) => { setAiRatioVeryHard(Number(e.target.value)); setAiCriteriaPreviewList([]); }}
                          disabled={aiCriteriaPreset !== "CUSTOM"}
                          className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center font-bold text-xs"
                        />
                        <span className="text-xs font-bold text-slate-500">%</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={handleTriggerAiCriteriaSelection}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Sparkles size={14} />
                      <span>Lọc câu hỏi & Xem trước</span>
                    </button>
                    {aiCriteriaPreviewIsCurrent && (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setManualExamCustomScored(false);
                            setManualExamQuestionScores(
                              buildEqualBankScoreMap(
                                aiCriteriaPreviewList.map((q) => q.id),
                                manualExamTargetScore,
                              ),
                            );
                          }}
                          className="text-indigo-600 font-bold hover:underline cursor-pointer"
                        >
                          Chia đều điểm
                        </button>
                        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                          ✓ Đã chọn {aiCriteriaPreviewList.length} câu hỏi theo mốc
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Danh sách câu hỏi AI đã lọc để giáo viên kiểm tra và chỉnh điểm từng câu */}
                  {aiCriteriaPreviewIsCurrent && (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {aiCriteriaPreviewList.map((q, idx) => (
                        <div
                          key={q.id || idx}
                          className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300">
                                Câu {idx + 1}
                              </span>
                              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {q.type}
                              </span>
                              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                                {q.difficulty}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Điểm:</span>
                              <ScoreStepperInput
                                ariaLabel={`Điểm câu ma trận ${idx + 1}`}
                                stepTargetLabel={`câu ma trận ${idx + 1}`}
                                min={0.25}
                                max={1000}
                                value={manualExamQuestionScores[q.id] ?? 1}
                                onChange={(val) => {
                                  setManualExamCustomScored(true);
                                  setManualExamQuestionScores((prev) => {
                                    const next = { ...prev, [q.id]: val };
                                    const sum =
                                      Math.round(
                                        aiCriteriaPreviewList.reduce(
                                          (acc, item) => acc + (Number(next[item.id]) || 0),
                                          0,
                                        ) * 100,
                                      ) / 100;
                                    if (sum >= 0.25) setManualExamTargetScore(sum);
                                    return next;
                                  });
                                }}
                              />
                            </div>
                          </div>
                          <RichText className="font-semibold text-slate-800 dark:text-slate-200 text-xs [&>p]:my-0">
                            {q.content}
                          </RichText>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiCriteriaPreviewList.length > 0 && !aiCriteriaPreviewIsCurrent && (
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                      Ngân hàng câu hỏi đã thay đổi. Hãy lọc lại để xem trước danh sách hiện tại.
                    </p>
                  )}
                </div>
              )}

              {/* =================================================================
                  NỘI DUNG KIỂU 3: BỐC NGẪU NHIÊN CÂU HỎI (CHỈ BỐC ĐÚNG LOẠI ĐỀ)
                  ================================================================= */}
              {examCreationMode === "RANDOM" && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                      {bankBuilderAssignmentType === "ESSAY"
                        ? `Số lượng câu tự luận cần bốc ngẫu nhiên (tối đa ${scopedPublishedBankQuestions.length} câu đã xuất bản):`
                        : `Số lượng câu trắc nghiệm cần bốc ngẫu nhiên (tối đa ${scopedPublishedBankQuestions.length} câu đã xuất bản):`}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, scopedPublishedBankQuestions.length)}
                      value={randomQuestionCount}
                      onChange={(e) => setRandomQuestionCount(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                    />
                  </div>

                  {bankBuilderAssignmentType === "MULTIPLE_CHOICE" && (
                    <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={randomShuffle}
                        onChange={(e) => setRandomShuffle(e.target.checked)}
                        className="rounded accent-indigo-600"
                      />
                      <div>
                        <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                          Xáo trộn ngẫu nhiên thứ tự các câu hỏi
                        </strong>
                        <span className="text-[11px] text-slate-500">
                          Đảm bảo cấu trúc đề thi đa dạng và khách quan cho học sinh
                        </span>
                      </div>
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-between items-center gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                {openedFromCreationHub && (
                  <button
                    type="button"
                    disabled={examSaving}
                    onClick={handleReturnToCreationHub}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                  >
                    <ArrowLeft size={14} />
                    <span>Quay lại chọn cách tạo khác</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setManualExamModalOpen(false);
                    setOpenedFromCreationHub(false);
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy
                </button>
              </div>

              {examCreationMode === "MANUAL" && (
                <button
                  type="button"
                  onClick={handleCreateExamManual}
                   disabled={examSaving || manualExamSelectedQuestions.length === 0}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs cursor-pointer disabled:opacity-40"
                >
                   {examSaving
                     ? "Đang phát hành..."
                     : bankBuilderAssignmentType === "ESSAY"
                       ? `Tạo bài tự luận (${manualExamSelectedQuestions.length} câu)`
                       : `Tạo đề trắc nghiệm (${manualExamSelectedQuestions.length} câu)`}
                </button>
              )}

              {examCreationMode === "AI_CRITERIA" && (
                <button
                  type="button"
                  onClick={handleCreateExamAiCriteria}
                   disabled={examSaving || !aiCriteriaPreviewIsCurrent}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs cursor-pointer"
                >
                   {examSaving
                     ? "Đang phát hành..."
                     : bankBuilderAssignmentType === "ESSAY"
                       ? "Xác nhận & Tạo bài tự luận theo ma trận"
                       : "Xác nhận & Tạo đề trắc nghiệm theo ma trận"}
                </button>
              )}

              {examCreationMode === "RANDOM" && (
                <button
                  type="button"
                  onClick={handleCreateExamRandom}
                   disabled={examSaving}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-xs cursor-pointer"
                >
                   {examSaving
                     ? "Đang phát hành..."
                     : bankBuilderAssignmentType === "ESSAY"
                       ? "Bốc ngẫu nhiên & Tạo bài tự luận"
                       : "Bốc ngẫu nhiên & Tạo đề trắc nghiệm"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Di chuyển Bài giảng / Tài liệu sang lớp và thư mục khác thuộc quyền giảng dạy */}
      {moveItemModalOpen && itemForMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FolderInput size={20} className="text-amber-600" />
              <span>Di chuyển {itemForMove.kind === "LECTURE" ? "bài giảng" : "tài liệu"}</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn lớp và thư mục đích hợp lệ để chuyển <strong className="text-slate-900 dark:text-slate-100">&quot;{itemForMove.title}&quot;</strong>:
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Lớp đích:
                </label>
                <select
                  value={targetDestinationClassId}
                  onChange={(e) => setTargetDestinationClassId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  {movableDestinationClasses.length === 0 && (
                    <option value="">Không có lớp khả dụng</option>
                  )}
                  {movableDestinationClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      📁 {cls.name} ({cls.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Thư mục đích:
                </label>
                <select
                  value={targetDestinationFolder}
                  disabled={loadingDestinationFolders || targetDestinationFolders.length === 0}
                  onChange={(e) => setTargetDestinationFolder(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  {loadingDestinationFolders && <option value="">Đang tải thư mục...</option>}
                  {!loadingDestinationFolders && targetDestinationFolders.length === 0 && (
                    <option value="">Lớp đích chưa có thư mục phù hợp</option>
                  )}
                  {targetDestinationFolders.map((folderName) => (
                    <option key={folderName} value={folderName}>
                      {folderName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMoveItemModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={!targetDestinationClassId || !targetDestinationFolder}
                onClick={handleConfirmMoveItem}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs cursor-pointer"
              >
                Xác nhận di chuyển
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

