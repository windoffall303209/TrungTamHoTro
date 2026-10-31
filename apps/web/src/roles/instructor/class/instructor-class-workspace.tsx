"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { ClassScheduleMonthList } from "@/features/class-detail/class-schedule-month-list";
import { LectureSidebarNavigation } from "@/features/class-detail/lecture-sidebar-navigation";
import { ClassFolderEntry } from "@/features/class-detail/class-folder-entry";
import { ExamTakingModal, type ExamTakingData } from "@/roles/learner/class/exam-taking-modal";
import {
  ArrowLeft,
  Award,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  Edit3,
  Eye,
  FileCheck2,
  FileQuestion,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Info,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Wand2,
  Scan,
  Image as ImageIcon,
  X,
} from "lucide-react";
import type {
  AiGeneratedExamResult,
  Assignment,
  AssignmentSubmission,
  Course,
  DirectoryUser,
  Exam,
  GradebookRow,
  LearningClass,
  Material,
  Question,
  QuestionImportResult,
} from "@/lib/learning-types";
import { apiRequest, downloadApiFile } from "@/lib/api-client";
import { copyTextToClipboard } from "@/lib/clipboard";
import { isExamQuestionPreviewCurrent, toggleVisibleExamQuestions } from "@/lib/exam-question-selection";
import { isMaterialForClass, loadAllMaterials } from "@/lib/materials";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/shared/ui/user-avatar";
import { AssignmentBuilderModal, type AssignmentBuilderModalProps } from "@/features/exams/assignment-builder-modal";
import {
  detectLectureLinkPlatform,
  exportAssignmentsCsv,
  exportGradebookCsv,
  filterClassQuestions,
  filterClassResources,
  getClassFolderNames,
  getClassQuestionStats,
  getScoreColorClass,
  getLectureYoutubeId,
  isLectureMaterial,
  toClassQuestion,
  toLectureItem,
  toMaterialDisplayItem,
  type ClassQuestion,
  type LectureItem,
  type MaterialDisplayItem,
} from "./instructor-class-workspace.helpers";

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
}: InstructorClassWorkspaceProps) {
  const router = useRouter();
  const { session, notify } = useApp();

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
  const [assignments, setAssignments] = useState<AssignmentPreview[]>([]);
  const [gradebook, setGradebook] = useState<GradebookRow[]>([]);
  const [submissionsByAssignment, setSubmissionsByAssignment] = useState<Record<string, AssignmentSubmission[]>>({});

  // Chế độ xem lịch học: dạng tuần (lưới) hoặc dạng tháng (danh sách)
  const [scheduleView, setScheduleView] = useState<"week" | "month">("week");

  // Bộ lọc và tìm kiếm chung
  const [searchQuery, setSearchQuery] = useState("");

  // Quản lý thư mục cho Bài tập, Bài giảng, Tài liệu
  const [selectedFolder, setSelectedFolder] = useState<string>("Tất cả");
  const [customFolders, setCustomFolders] = useState<string[]>([
    "Tất cả",
    "Tuần 1 - Nhập môn",
    "Tuần 2 - Cơ bản",
    "Ôn tập giữa kỳ",
  ]);
  const [newFolderInput, setNewFolderInput] = useState("");
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);

  // Chế độ xem bài tập: "list" (danh sách 3 cột theo Ảnh 2) hoặc "detail" (chi tiết & bảng điểm theo Ảnh 1)
  const [assignmentViewMode, setAssignmentViewMode] = useState<"list" | "detail">("list");
  const [assignmentDetailSubTab, setAssignmentDetailSubTab] = useState<
    "gradebook" | "overview" | "stats" | "exam_content" | "solution"
  >("gradebook");
  const [assignmentStatusFilter, setAssignmentStatusFilter] = useState<
    "ALL" | "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED"
  >("ALL");
  const [assignmentStudentSearch, setAssignmentStudentSearch] = useState("");
  const [assignmentListDisplayMode, setAssignmentListDisplayMode] = useState<"list" | "grid">("list");

  // Bài tập được chọn ở Cột 3
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentPreview | null>(null);
  const [previewExam, setPreviewExam] = useState<ExamTakingData | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareScope, setShareScope] = useState<"CLASS_ONLY" | "PUBLIC">("CLASS_ONLY");
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [selectedStudentAttempt, setSelectedStudentAttempt] = useState<AssignmentSubmission | null>(null);

  // Bài giảng được nạp từ danh sách học liệu của API, cùng nguồn với học viên.
  const [lectures, setLectures] = useState<LectureItem[]>([]);

  const [selectedLectureForPage, setSelectedLectureForPage] = useState<LectureItem | null>(null);
  const [selectedLectureId, setSelectedLectureId] = useState<string>("");
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureSort, setLectureSort] = useState<"alpha" | "newest" | "type">("newest");
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");
  const [lectureFolderExpanded, setLectureFolderExpanded] = useState<Record<string, boolean>>({});

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
  const [lectureFormDesc, setLectureFormDesc] = useState("");
  const [lectureFormFolder, setLectureFormFolder] = useState("Toán 1");
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
  const [editLectureFormDesc, setEditLectureFormDesc] = useState("");
  const [editLectureFormFolder, setEditLectureFormFolder] = useState("Toán 1");

  // Modal tạo Bài tập mới
  const [addAssignmentModalOpen, setAddAssignmentModalOpen] = useState(false);

  // Modal Chỉnh sửa Bài tập (áp dụng tương tự)
  const [editAssignmentModalOpen, setEditAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [editAssignmentTitle, setEditAssignmentTitle] = useState("");
  const [editAssignmentDesc, setEditAssignmentDesc] = useState("");
  const [editAssignmentInstructions, setEditAssignmentInstructions] = useState("");
  const [editAssignmentDue, setEditAssignmentDue] = useState("");
  const [editAssignmentMaxScore, setEditAssignmentMaxScore] = useState(10);
  const [editAssignmentSaving, setEditAssignmentSaving] = useState(false);

  // Modal Hub điều phối 5 cách tạo Bài tập & Soạn câu hỏi
  const [creationHubOpen, setCreationHubOpen] = useState(false);
  const [creationTarget, setCreationTarget] = useState<"ASSIGNMENT" | "QUESTION">("ASSIGNMENT");

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

  // Cách 2: Quét đề bằng AI OCR
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanStatus, setScanStatus] = useState<"IDLE" | "SCANNING" | "DONE">("IDLE");
  const [scanSaving, setScanSaving] = useState(false);
  const [scannedExamQuestions, setScannedExamQuestions] = useState<Array<{
    type: Question["type"];
    content: string;
    options: string[];
    correctAnswers: string[];
    difficulty: Question["difficulty"];
    tags: string[];
    confidence: number;
    warnings: string[];
  }>>([]);
  const [scanProviderLabel, setScanProviderLabel] = useState("");

  // Cách 3: Tạo đề thi bằng AI
  const [aiExamModalOpen, setAiExamModalOpen] = useState(false);
  const [aiSubject, setAiSubject] = useState("Toán học");
  const [aiTopic, setAiTopic] = useState("Hàm số & Khảo sát đồ thị");
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiRequestRef = useRef<{ signature: string; id: string } | null>(null);
  const [aiGeneratedExam, setAiGeneratedExam] = useState<AiGeneratedExamResult | null>(null);

  // Cách 4: Tạo đề thi từ ngân hàng câu hỏi (3 kiểu: 1. Thủ công, 2. Chọn mốc để AI chọn, 3. Ngẫu nhiên)
  const [manualExamModalOpen, setManualExamModalOpen] = useState(false);
  const [examCreationMode, setExamCreationMode] = useState<"MANUAL" | "AI_CRITERIA" | "RANDOM">("MANUAL");
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDuration, setManualExamDuration] = useState(45);
  const [manualExamDueAt, setManualExamDueAt] = useState("");
  const [examSaving, setExamSaving] = useState(false);
  const [manualExamSelectedQuestions, setManualExamSelectedQuestions] = useState<string[]>([]);
  const [manualExamFilterScope, setManualExamFilterScope] = useState<"ALL" | "MULTIPLE_CHOICE" | "ESSAY">("ALL");

  // Kiểu 2: Chọn mốc để AI chọn câu hỏi
  const [aiCriteriaQuestionCount, setAiCriteriaQuestionCount] = useState(10);
  const [aiCriteriaPreset, setAiCriteriaPreset] = useState<"STANDARD" | "BASIC" | "ADVANCED" | "CUSTOM">("STANDARD");
  const [aiRatioBasic, setAiRatioBasic] = useState(40);
  const [aiRatioMedium, setAiRatioMedium] = useState(30);
  const [aiRatioHard, setAiRatioHard] = useState(20);
  const [aiRatioVeryHard, setAiRatioVeryHard] = useState(10);
  const [aiCriteriaScope, setAiCriteriaScope] = useState<"ALL" | "MULTIPLE_CHOICE" | "ESSAY">("ALL");
  const [aiCriteriaPreviewList, setAiCriteriaPreviewList] = useState<ClassQuestion[]>([]);

  // Kiểu 3: Ngẫu nhiên
  const [randomQuestionCount, setRandomQuestionCount] = useState(10);
  const [randomTypeScope, setRandomTypeScope] = useState<"ALL" | "MULTIPLE_CHOICE" | "ESSAY">("ALL");
  const [randomShuffle, setRandomShuffle] = useState(true);

  // Bộ lọc cho Tab 9: Ngân hàng câu hỏi
  const [questionBankTab, setQuestionBankTab] = useState<"ALL" | "MULTIPLE_CHOICE" | "ESSAY">("ALL");
  const [questionBankSearch, setQuestionBankSearch] = useState("");
  const [questionBankDifficulty, setQuestionBankDifficulty] = useState("ALL");

  // Chỉnh sửa câu hỏi trong ngân hàng
  const [editingQuestionModalOpen, setEditingQuestionModalOpen] = useState(false);
  const [editingQuestionSaving, setEditingQuestionSaving] = useState(false);
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

  // Chỉ dùng câu hỏi đã xuất bản khi lập đề; câu nháp vẫn hiển thị trong ngân hàng.
  const publishedClassQuestions = useMemo(
    () => classQuestions.filter((question) => question.status === "PUBLISHED"),
    [classQuestions],
  );
  const aiCriteriaPreviewIsCurrent = useMemo(
    () => isExamQuestionPreviewCurrent(aiCriteriaPreviewList, classQuestions),
    [aiCriteriaPreviewList, classQuestions],
  );
  const manualExamVisibleQuestions = useMemo(
    () => filterClassQuestions(publishedClassQuestions, manualExamFilterScope),
    [publishedClassQuestions, manualExamFilterScope],
  );
  const manualExamAllVisibleSelected = manualExamVisibleQuestions.length > 0 &&
    manualExamVisibleQuestions.every((question) => manualExamSelectedQuestions.includes(question.id));
  const publishedQuestionStats = useMemo(() => getClassQuestionStats(publishedClassQuestions), [publishedClassQuestions]);

  // Thống kê phân loại Ngân hàng câu hỏi riêng của lớp
  const classQuestionStats = useMemo(() => getClassQuestionStats(classQuestions), [classQuestions]);

  // Danh sách câu hỏi sau lọc trong Tab 9
  const filteredClassQuestions = useMemo(() => {
    return filterClassQuestions(classQuestions, questionBankTab, questionBankDifficulty, questionBankSearch);
  }, [classQuestions, questionBankTab, questionBankDifficulty, questionBankSearch]);

  // API là nguồn dữ liệu duy nhất để tránh hiện tài liệu đã xóa/di chuyển hoặc bản ghi giả.
  const [materialsList, setMaterialsList] = useState<MaterialDisplayItem[]>([]);

  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialSort, setMaterialSort] = useState<"alpha" | "newest" | "type">("alpha");
  const [selectedMaterialFolder, setSelectedMaterialFolder] = useState<string>("__ALL__");
  const [materialFolderExpanded, setMaterialFolderExpanded] = useState<Record<string, boolean>>({
    "Hình học": true,
    "Toán 1": true,
  });

  // Modal tải & chỉnh sửa tài liệu
  const [addMaterialModalOpen, setAddMaterialModalOpen] = useState(false);
  const [editMaterialModalOpen, setEditMaterialModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialDisplayItem | null>(null);

  const [materialFormTitle, setMaterialFormTitle] = useState("");
  const [materialFormFolder, setMaterialFormFolder] = useState("Toán 1");
  const [materialUploadFile, setMaterialUploadFile] = useState<File | null>(null);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialFormDesc, setMaterialFormDesc] = useState("");

  // State chỉnh sửa tài liệu (hỗ trợ thay tệp mới từ máy)
  const [editMaterialFileObj, setEditMaterialFileObj] = useState<File | null>(null);
  const [editMaterialFormTitle, setEditMaterialFormTitle] = useState("");
  const [editMaterialFormFolder, setEditMaterialFormFolder] = useState("Toán 1");
  const [editMaterialFormDesc, setEditMaterialFormDesc] = useState("");

  // Modal Di chuyển Bài giảng & Tài liệu sang lớp khác hoặc Cần phân cấp lại
  const [moveItemModalOpen, setMoveItemModalOpen] = useState(false);
  const [itemForMove, setItemForMove] = useState<{ id: string; title: string; kind: "LECTURE" | "MATERIAL" } | null>(null);
  const [targetDestinationClassId, setTargetDestinationClassId] = useState<string>("unclassified");
  const [allInstructorClasses, setAllInstructorClasses] = useState<LearningClass[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<LearningClass[]>("/instructor/classes", {
      roleCode: session.roleCode,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) setAllInstructorClasses(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.warn("Lỗi nạp danh sách lớp:", err);
      });
    return () => controller.abort();
  }, [session.roleCode]);

/** Đảm nhiệm handleOpenMoveItem trong phạm vi module hiện tại. */
  const handleOpenMoveItem = (id: string, title: string, kind: "LECTURE" | "MATERIAL") => {
    setItemForMove({ id, title, kind });
    setTargetDestinationClassId("unclassified");
    setMoveItemModalOpen(true);
  };

/** Đảm nhiệm handleConfirmMoveItem trong phạm vi module hiện tại. */
  const handleConfirmMoveItem = async () => {
    if (!itemForMove) return;
    const isUnclassified = targetDestinationClassId === "unclassified";
    try {
      await apiRequest(`/instructor/materials/${itemForMove.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: isUnclassified ? null : targetDestinationClassId,
          scope: isUnclassified ? "SHARED" : "CLASS",
        }),
      });

      if (targetDestinationClassId !== item.id) {
        if (itemForMove.kind === "LECTURE") {
          setLectures((prev) => prev.filter((l) => l.id !== itemForMove.id));
        } else {
          setMaterialsList((prev) => prev.filter((m) => m.id !== itemForMove.id));
        }
      }

      const targetCls = allInstructorClasses.find((c) => c.id === targetDestinationClassId);
      const destName = isUnclassified ? "Cần phân cấp lại (Chưa phân loại)" : targetCls?.name || "lớp mới";
      notify(`Đã di chuyển '${itemForMove.title}' sang ${destName} thành công!`, "success");
    } catch (err) {
      console.warn("Lỗi di chuyển học liệu trong CSDL:", err);
      notify("Có lỗi khi di chuyển học liệu. Vui lòng thử lại!", "error");
    } finally {
      setMoveItemModalOpen(false);
      setItemForMove(null);
    }
  };

  // Cài đặt lớp học (Settings)
  const [classSettings, setClassSettings] = useState({
    displayName: item.name,
    description: course?.description || "Lớp học tiêu chuẩn theo chương trình phổ thông.",
    allowStudentPost: true,
    allowLateSubmission: false,
    maxAttempts: 2,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settingsSaveTimer.current !== null) clearTimeout(settingsSaveTimer.current);
  }, []);

  // Modal thêm đồng giáo viên
  const [addCoInstructorOpen, setAddCoInstructorOpen] = useState(false);
  const [coInstructorRole, setCoInstructorRole] = useState<"CO_INSTRUCTOR" | "ASSISTANT">("CO_INSTRUCTOR");
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [allAvailableInstructors, setAllAvailableInstructors] = useState<DirectoryUser[]>([]);
  const classDataRequestRef = useRef(0);
  const classDataControllerRef = useRef<AbortController | null>(null);

  /** Tải dữ liệu toàn diện của lớp học từ cơ sở dữ liệu vật lý */
  const loadClassData = useCallback(async () => {
    const requestId = ++classDataRequestRef.current;
    classDataControllerRef.current?.abort();
    const controller = new AbortController();
    classDataControllerRef.current = controller;
    try {
      const [learnersResult, assignmentsResult, materialsResult, questionsResult, gradebookResult] =
        await Promise.allSettled([
          apiRequest<DirectoryUser[]>(`/instructor/classes/${item.id}/learners`, {
            roleCode: session.roleCode,
            signal: controller.signal,
          }),
          apiRequest<Assignment[]>(`/academic/assignments?classId=${item.id}`, {
            roleCode: session.roleCode,
            signal: controller.signal,
          }),
          loadAllMaterials<Material>("/materials", {
            roleCode: session.roleCode,
            signal: controller.signal,
          }),
          apiRequest<Array<Question & { solution?: string; createdAt?: string }>>(
            item.courseId ? `/instructor/question-bank/questions?courseId=${item.courseId}` : `/instructor/question-bank/questions`,
            { roleCode: session.roleCode, signal: controller.signal }
          ),
          apiRequest<GradebookRow[]>(`/academic/classes/${item.id}/gradebook`, {
            roleCode: session.roleCode,
            signal: controller.signal,
          }),
        ]);

      if (requestId !== classDataRequestRef.current || controller.signal.aborted) return;
      const failedSources = [
        ["học viên", learnersResult],
        ["bài tập", assignmentsResult],
        ["tài liệu", materialsResult],
        ["ngân hàng câu hỏi", questionsResult],
        ["bảng điểm", gradebookResult],
      ] as const;
      for (const [source, result] of failedSources) {
        if (result.status === "rejected") console.warn(`Không tải được ${source} của lớp:`, result.reason);
      }
      if (failedSources.some(([, result]) => result.status === "rejected")) {
        notify("Một số dữ liệu lớp học không tải được. Vui lòng thử lại.", "error");
      }
      if (learnersResult.status === "fulfilled") setLearners(learnersResult.value);
      if (gradebookResult.status === "fulfilled") setGradebook(gradebookResult.value);
      // API is authoritative; legacy local entries may contain fabricated IDs or stale publication states.
      if (assignmentsResult.status === "fulfilled") setAssignments(assignmentsResult.value);

      // Đồng bộ câu hỏi thật từ CSDL vào ngân hàng câu hỏi riêng của lớp
      if (questionsResult.status === "fulfilled") {
        setClassQuestions(questionsResult.value.map(toClassQuestion));
      }

      // Đồng bộ tài liệu thật từ CSDL vào danh sách tài liệu lớp
      if (materialsResult.status === "fulfilled") {
        const classMaterials = materialsResult.value.filter((m) => isMaterialForClass(m, item.id, item.courseId));
        const mappedLectures = classMaterials.filter(isLectureMaterial)
          .map((material) => toLectureItem(material, session.user.name || "Giảng viên"));
        setLectures(mappedLectures);
        setSelectedLectureId((current) => mappedLectures.some((lecture) => lecture.id === current) ? current : (mappedLectures[0]?.id ?? ""));
        setSelectedLectureForPage((current) => mappedLectures.find((lecture) => lecture.id === current?.id) ?? null);
        const mappedMats = classMaterials.map(toMaterialDisplayItem);
        setMaterialsList(mappedMats);
        setSelectedMaterialId((current) => mappedMats.some((m) => m.id === current) ? current : (mappedMats[0]?.id ?? ""));
      }

      if (assignmentsResult.status === "fulfilled") {
        setSelectedAssignment((current) => assignmentsResult.value.find((assignment) => assignment.id === current?.id) ?? assignmentsResult.value[0] ?? null);
      }

      // Tải danh sách giáo viên có thể mời làm đồng giáo viên
      let directoryInstructors: DirectoryUser[] | null = null;
      try {
        directoryInstructors = await apiRequest<DirectoryUser[]>("/users?role=INSTRUCTOR", {
          roleCode: session.roleCode,
          signal: controller.signal,
        });
      } catch (error) {
        if (!controller.signal.aborted) console.warn("Không tải được danh sách giáo viên:", error);
      }
      if (requestId !== classDataRequestRef.current || controller.signal.aborted) return;
      if (directoryInstructors !== null) setAllAvailableInstructors(directoryInstructors);
    } catch (error) {
      if (!controller.signal.aborted) console.error("Lỗi tải dữ liệu lớp học:", error);
      if (requestId === classDataRequestRef.current && !controller.signal.aborted) {
        notify("Không tải được toàn bộ dữ liệu lớp học", "error");
      }
    }
  }, [item.id, item.courseId, session.roleCode, session.user.name, notify]);

  useEffect(() => {
    void loadClassData();
    return () => { classDataRequestRef.current += 1; classDataControllerRef.current?.abort(); };
  }, [loadClassData]);

  const assignmentIds = assignments.map((assignment) => assignment.id).join("|");

  // Tải bài nộp theo từng bài tập để thống kê chính xác và tránh dùng dữ liệu giả.
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const ids = assignmentIds ? assignmentIds.split("|") : [];
    if (ids.length === 0) {
      setSubmissionsByAssignment({});
      return;
    }
    void Promise.allSettled(ids.map((id) => apiRequest<AssignmentSubmission[]>(
      `/instructor/assignments/${id}/submissions`, { roleCode: session.roleCode, signal: controller.signal },
    ))).then((results) => {
      if (!active) return;
      const next: Record<string, AssignmentSubmission[]> = {};
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next[ids[index]!] = result.value;
        else console.warn(`Không tải được bài nộp của ${ids[index]}:`, result.reason);
      });
      setSubmissionsByAssignment(next);
    });
    return () => { active = false; controller.abort(); };
  // Chỉ tải lại khi danh sách ID thực sự thay đổi, không phụ thuộc identity của mảng assignments.
  }, [assignmentIds, session.roleCode]);

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

  // Lưu tệp bài giảng qua API multipart và chỉ báo thành công sau khi máy chủ xác nhận.
  const handleSaveLecture = async () => {
    if (lectureSaving) return;
    if (!lectureFormTitle.trim()) {
      notify("Vui lòng nhập tên bài giảng!", "error");
      return;
    }
    if (lectureMethod === "LINK") {
      notify("Máy chủ chưa hỗ trợ lưu liên kết bài giảng. Hãy chọn tệp để lưu lên lớp.", "error");
      return;
    }
    if (!lectureFileObj || lectureFileObj.size === 0) {
      notify("Vui lòng chọn tệp bài giảng hợp lệ.", "error");
      return;
    }
    setLectureSaving(true);
    let uploadedId: string | null = null;
    try {
      const tags = ["LECTURE", ...(lectureFormDesc.trim() ? [`Mô tả: ${lectureFormDesc.trim().replace(/,/g, "，")}`] : []),
        ...lectureAttachedAssignments.map((id) => `assignmentId:${id}`)];
      const form = new FormData();
      form.append("file", lectureFileObj);
      form.append("folder", lectureFormFolder);
      form.append("tags", tags.join(","));
      form.append("scope", "CLASS");
      const created = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/material-uploads`, {
        method: "POST", roleCode: session.roleCode, body: form,
      });
      if (!created?.id) throw new Error("Máy chủ không trả về ID bài giảng vừa tải lên.");
      uploadedId = created.id;
      if (lectureFormTitle.trim() !== created.name) {
        await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(created.id)}`, {
          method: "PATCH", roleCode: session.roleCode,
          body: JSON.stringify({ name: lectureFormTitle.trim() }),
        });
      }
      await loadClassData();
      setSelectedLectureId(created.id);
      setAddLectureModalOpen(false);
      notify("Đã tải bài giảng lên máy chủ ở trạng thái nháp.", "success");

      // Reset form
      setLectureFormTitle("");
      setLectureFormDesc("");
      setLectureInputUrl("");
      setLectureFileObj(null);
    } catch (err) {
      console.error("Lỗi khi lưu bài giảng:", err);
      if (uploadedId) await loadClassData();
      const detail = err instanceof Error ? err.message : "Không thể lưu bài giảng vào cơ sở dữ liệu";
      notify(uploadedId ? `Tệp đã tải lên nhưng chưa hoàn tất cập nhật: ${detail}` : detail, "error");
    } finally {
      setLectureSaving(false);
    }
  };

  // Kiểm tra dữ liệu từ biểu mẫu và lưu bài thi hoặc bài tự luận qua API.
  const handleSaveFromBuilder = async (data: Parameters<AssignmentBuilderModalProps["onSaveAssignment"]>[0]) => {
    const title = data.title.trim();
    if (title.length < 3) throw new Error("Tên bài cần ít nhất 3 ký tự.");
    if (item.status === "CLOSED") throw new Error("Lớp đã đóng, không thể tạo bài mới.");

    const now = Date.now();
    const classEnd = new Date(item.endAt).getTime();
    const openAt = data.settings.hasStartAt ? new Date(data.settings.startAt).getTime() : now;
    const dueAt = data.settings.hasDueAt
      ? new Date(data.settings.dueAt).getTime()
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
        const validOptions = question.options
          .filter((option) => option.text.trim())
          .map((option) => ({ key: option.key.trim().toUpperCase(), value: option.key.trim().toUpperCase() + ". " + option.text.trim() }));
        const answer = validOptions.find((option) => option.key === question.correctAnswer.trim().toUpperCase());
        if (question.type !== "Trắc nghiệm một đáp án" ||
          question.content.trim().length < 5 ||
          validOptions.length < 2 ||
          new Set(validOptions.map((option) => option.key)).size !== validOptions.length ||
          new Set(validOptions.map((option) => option.value.slice(option.value.indexOf(".") + 1).trim())).size !== validOptions.length ||
          !answer) {
          throw new Error("Câu " + (index + 1) + ": cần nội dung hợp lệ, phương án khác nhau và đáp án đúng.");
        }
        if (!Number.isFinite(question.score) || question.score < 0.01 ||
          Math.abs(Math.round(question.score * 100) - question.score * 100) > 0.000001) {
          throw new Error("Câu " + (index + 1) + ": điểm phải từ 0,01 và có tối đa hai chữ số thập phân.");
        }
        return {
          courseId: item.courseId,
          content: question.content.trim(),
          type: "SINGLE_CHOICE" as const,
          options: validOptions.map((option) => option.value),
          correctAnswers: [answer.value],
          difficulty: 2,
          tags: ["Trắc nghiệm", "Tạo đề trong lớp"],
        };
      });
      const totalScore = data.questions.reduce((sum, question) => sum + question.score, 0);
      if (!Number.isFinite(totalScore) || totalScore < 1) {
        throw new Error("Tổng điểm đề thi phải ít nhất 1 điểm.");
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
      const published = await Promise.allSettled(questionIds.map((questionId) =>
        apiRequest<{ status: string }>("/instructor/question-bank/questions/" + questionId + "/publish", {
          method: "POST",
          roleCode: session.roleCode,
        }),
      ));
      const unpublished = published.flatMap((result, index) =>
        result.status === "fulfilled" && result.value.status === "PUBLISHED" ? [] : [questionIds[index]!],
      );
      if (unpublished.length) {
        throw new Error("Đã nhập câu hỏi nhưng các câu " + unpublished.join(", ") + " chưa được xuất bản. Hãy kiểm tra quy trình duyệt câu hỏi trước khi tạo đề.");
      }

      await apiRequest<Exam>("/instructor/exams", {
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
          scoreAllocations: questionIds.map((questionId, index) => ({
            questionId,
            score: data.questions[index]!.score,
          })),
        }),
      });
      notify("Đã tạo đề trắc nghiệm dạng nháp. Hãy kiểm tra và phát hành đề trước khi giao cho học viên.", "success");
    } else {
      if (data.attachedFile) {
        throw new Error("Tệp đề tự luận chưa thể được lưu qua trình tạo này. Hãy nhập nội dung yêu cầu trực tiếp để tránh thất lạc tệp.");
      }
      const description = data.description.trim() || "Bài tập tự luận: " + title;
      const instructions = [description, ...data.submissionMethods].filter(Boolean).join("\n");
      const created = await apiRequest<Assignment>("/instructor/classes/" + item.id + "/assignments", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title,
          description: description.length >= 10 ? description : "Bài tập tự luận: " + title,
          instructions: instructions.length >= 5 ? instructions : "Hoàn thành bài tập: " + title,
          dueAt: new Date(dueAt).toISOString(),
          maxScore: 10,
          rubric: [{
            title: "Mức độ hoàn thành",
            description: "Đánh giá chất lượng và mức độ hoàn thành bài làm.",
            maxPoints: 10,
          }],
        }),
      });
      setSelectedAssignment(created);
      notify("Đã lưu bài tập tự luận ở trạng thái nháp. Hãy kiểm tra và phát hành trước khi giao học viên.", "success");
    }

    await loadClassData();
    setAddAssignmentModalOpen(false);
  };
  // Tạo thư mục mới
  const handleCreateFolder = () => {
    if (!newFolderInput.trim()) return;
    if (customFolders.includes(newFolderInput.trim())) {
      notify("Thư mục đã tồn tại!", "error");
      return;
    }
    setCustomFolders([...customFolders, newFolderInput.trim()]);
    setSelectedFolder(newFolderInput.trim());
    setNewFolderInput("");
    setShowNewFolderModal(false);
    notify("Đã tạo thư mục mới!", "success");
  };

  // Thư mục bài giảng
  const lectureFolders = useMemo(() => getClassFolderNames(lectures), [lectures]);

  // Danh sách bài giảng lọc
  const filteredLectures = useMemo(
    () => filterClassResources(lectures, selectedLectureFolder, lectureSearch, lectureSort, false),
    [lectures, selectedLectureFolder, lectureSearch, lectureSort],
  );

  // Bài giảng đang được chọn ở Cột 3
  const activeLectureItem = useMemo(() => {
    if (filteredLectures.length === 0) return null;
    return filteredLectures.find((l) => l.id === selectedLectureId) || filteredLectures[0] || null;
  }, [filteredLectures, selectedLectureId]);

  // Thư mục tài liệu
  const materialFolders = useMemo(() => getClassFolderNames(materialsList), [materialsList]);

  // Danh sách tài liệu lọc
  const filteredMaterials = useMemo(
    () => filterClassResources(materialsList, selectedMaterialFolder, materialSearch, materialSort, true),
    [materialsList, selectedMaterialFolder, materialSearch, materialSort],
  );

  // Tài liệu đang được chọn ở Cột 3
  const activeMaterialItem = useMemo(() => {
    if (filteredMaterials.length === 0) return null;
    return filteredMaterials.find((m) => m.id === selectedMaterialId) || filteredMaterials[0] || null;
  }, [filteredMaterials, selectedMaterialId]);

  // Xóa học liệu bài giảng tại máy chủ rồi đồng bộ lại danh sách.
  const handleDeleteLecture = async (lectureId: string, lectureTitle: string) => {
    if (lectureSaving || !window.confirm(`Bạn có chắc muốn xóa bài giảng "${lectureTitle}" không?`)) return;
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

  // Mở modal sửa bài giảng với đầy đủ dữ liệu nguồn (Link hoặc File)
  const handleOpenEditLecture = (lec: LectureItem) => {
    setEditingLecture({ ...lec });
    setEditLectureFormTitle(lec.title);
    setEditLectureFormDesc(lec.description || "");
    setEditLectureFormFolder(lec.folder);
    setEditLectureFileObj(null);

    if (lec.youtubeId || (lec.sourceUrl && (lec.sourceUrl.startsWith("http") || lec.fileType === "mp4"))) {
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
    if (editLectureMethod === "LINK") {
      const originalId = editingLecture.youtubeId;
      if (!originalId || getLectureYoutubeId(editLectureInputUrl) !== originalId) {
        notify("Máy chủ chưa hỗ trợ thay đổi nguồn sang liên kết mới.", "error");
        return;
      }
    } else if (editingLecture.sourceType === "LINK" && !editLectureFileObj) {
      notify("Cần chọn tệp để thay thế nguồn liên kết hiện tại.", "error");
      return;
    }
    const tags = (editingLecture.tags ?? []).filter((tag) =>
      !tag.startsWith("Mô tả: ") && !(editLectureFileObj && tag.startsWith("youtube:")));
    if (!tags.some((tag) => /^(lecture|bài giảng)$/i.test(tag))) tags.push("LECTURE");
    if (editLectureFormDesc.trim()) tags.push(`Mô tả: ${editLectureFormDesc.trim().replace(/,/g, "，")}`);
    setLectureSaving(true);
    let versionUploaded = false;
    try {
      const path = `/instructor/materials/${encodeURIComponent(editingLecture.id)}`;
      if (editLectureFileObj) {
        if (editLectureFileObj.size === 0) throw new Error("Tệp thay thế không có dữ liệu.");
        const form = new FormData();
        form.append("file", editLectureFileObj);
        form.append("folder", editLectureFormFolder);
        form.append("tags", tags.join(","));
        await apiRequest<Material>(`${path}/versions`, {
          method: "POST", roleCode: session.roleCode, body: form,
        });
        versionUploaded = true;
      }
      await apiRequest<Material>(path, {
        method: "PATCH", roleCode: session.roleCode,
        body: JSON.stringify({ name: editLectureFormTitle.trim(), folder: editLectureFormFolder, tags }),
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
    if (materialSaving || !window.confirm(`Bạn có chắc muốn xóa tài liệu "${materialTitle}" không?`)) return;
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
    setEditMaterialFormDesc(mat.description || "");
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
    setMaterialSaving(true);
    let versionUploaded = false;
    try {
      const path = `/instructor/materials/${encodeURIComponent(editingMaterial.id)}`;
      const tags = editMaterialFormDesc.trim().split(",").map((tag) => tag.trim()).filter(Boolean);
      if (editMaterialFileObj) {
        const form = new FormData();
        form.append("file", editMaterialFileObj);
        form.append("folder", editMaterialFormFolder);
        form.append("tags", tags.join(","));
        await apiRequest<Material>(`${path}/versions`, { method: "POST", roleCode: session.roleCode, body: form });
        versionUploaded = true;
      }
      await apiRequest<Material>(path, {
        method: "PATCH", roleCode: session.roleCode,
        body: JSON.stringify({ name: editMaterialFormTitle.trim(), folder: editMaterialFormFolder, tags }),
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

  // Chỉ cho sửa nội dung bài nháp theo hợp đồng của API.
  const handleOpenEditAssignment = (assign: Assignment) => {
    if (assign.status !== "DRAFT") {
      notify("Chỉ bài tập nháp mới có thể chỉnh sửa nội dung.", "error");
      return;
    }
    setEditingAssignment({ ...assign });
    setEditAssignmentTitle(assign.title);
    setEditAssignmentDesc(assign.description || "");
    setEditAssignmentInstructions(assign.instructions || "");
    const due = new Date(assign.dueAt);
    setEditAssignmentDue(Number.isFinite(due.getTime())
      ? new Date(due.getTime() - due.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
      : "");
    setEditAssignmentMaxScore(assign.maxScore);
    setEditAssignmentModalOpen(true);
  };

  // Lưu bài nháp qua API với expectedVersion và chỉ báo thành công khi máy chủ xác nhận.
  const handleSaveEditAssignment = async () => {
    if (!editingAssignment || editAssignmentSaving) return;
    const title = editAssignmentTitle.trim();
    const description = editAssignmentDesc.trim();
    const instructions = editAssignmentInstructions.trim();
    const dueAt = new Date(editAssignmentDue);
    const maxScore = editAssignmentMaxScore;
    if (title.length < 3 || title.length > 255 || description.length < 10 || description.length > 5000 ||
      instructions.length < 5 || instructions.length > 10_000 || !Number.isFinite(dueAt.getTime()) ||
      dueAt.getTime() <= Date.now() || !Number.isFinite(maxScore) || maxScore < 0.25 || maxScore > 1000 ||
      Math.round(maxScore * 100) !== maxScore * 100) {
      notify("Kiểm tra tiêu đề (3–255 ký tự), mô tả (10–5000), hướng dẫn (5–10000), hạn nộp tương lai và thang điểm hợp lệ.", "error");
      return;
    }
    if (editingAssignment.status !== "DRAFT") {
      notify("Bài tập đã công bố không thể sửa nội dung.", "error");
      return;
    }
    const rubric = editingAssignment.rubric.map(({ title: rubricTitle, description: rubricDescription, maxPoints }) => ({
      title: rubricTitle, description: rubricDescription, maxPoints,
    }));
    if (rubric.length === 1) rubric[0]!.maxPoints = maxScore;
    if (!rubric.length || Math.abs(rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0) - maxScore) > 0.001) {
      notify("Tổng điểm các tiêu chí chấm phải bằng điểm tối đa. Không thể đổi thang điểm của rubric nhiều tiêu chí tại đây.", "error");
      return;
    }
    setEditAssignmentSaving(true);
    try {
      await apiRequest<Assignment>(`/instructor/assignments/${encodeURIComponent(editingAssignment.id)}`, {
        method: "PATCH", roleCode: session.roleCode,
        body: JSON.stringify({ title, description, instructions, dueAt: dueAt.toISOString(), maxScore, rubric, expectedVersion: editingAssignment.version }),
      });
      await loadClassData();
      setEditAssignmentModalOpen(false);
      setEditingAssignment(null);
      notify("Đã cập nhật bài tập trên máy chủ.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể lưu bài tập.", "error");
    } finally {
      setEditAssignmentSaving(false);
    }
  };

  // Mở Hub điều phối chọn 1 trong 5 cách tạo Bài tập hoặc Soạn câu hỏi
  const handleOpenCreationHub = (target: "ASSIGNMENT" | "QUESTION") => {
    setCreationTarget(target);
    setCreationHubOpen(true);
  };

  /** Lưu câu hỏi vào ngân hàng thật; câu mới bắt đầu ở trạng thái nháp chờ duyệt. */
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
      await loadClassData();
      setAuthoringModalOpen(false);
      setAuthoringContent("");
      notify("Đã lưu câu hỏi nháp vào ngân hàng. Cần duyệt và xuất bản trước khi tạo đề thi.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không lưu được câu hỏi.", "error");
    } finally {
      setAuthoringSaving(false);
    }
  };

  /** Đọc tệp ảnh thực tế bằng API OCR; giữ kết quả nguyên vẹn để kiểm tra trước khi nhập. */
  const handleTriggerScanExam = async () => {
    if (scanStatus === "SCANNING") return;
    if (!scanFile || !scanFile.type.startsWith("image/") || scanFile.size > 12 * 1024 * 1024) {
      notify("Chọn một ảnh đề thi hợp lệ, dung lượng tối đa 12 MB.", "error");
      return;
    }
    setScanStatus("SCANNING");
    setScannedExamQuestions([]);
    try {
      const data = new FormData();
      data.append("file", scanFile);
      const result = await apiRequest<{
        questions: typeof scannedExamQuestions;
        provider: string;
        model: string;
        warnings: string[];
      }>("/instructor/question-bank/scan-image", {
        method: "POST", roleCode: session.roleCode, body: data,
      });
      setScannedExamQuestions(result.questions);
      setScanProviderLabel(`${result.provider} / ${result.model}`);
      setScanStatus("DONE");
      notify(`Đã bóc tách ${result.questions.length} câu. Hãy kiểm tra đáp án trước khi nhập.`, "success");
      if (result.warnings.length) console.warn("Cảnh báo OCR:", result.warnings);
    } catch (error) {
      setScanStatus("IDLE");
      notify(error instanceof Error ? error.message : "Không quét được ảnh đề thi.", "error");
    }
  };

  /** Nhập bản nháp OCR vào ngân hàng thật và báo rõ các dòng không nhập được. */
  const handleSaveScannedExam = async () => {
    if (scanSaving || scanStatus !== "DONE" || !scannedExamQuestions.length) return;
    if (!item.courseId) {
      notify("Lớp chưa gắn môn học để nhập câu hỏi.", "error");
      return;
    }
    setScanSaving(true);
    try {
      const results = await apiRequest<QuestionImportResult[]>("/instructor/question-bank/questions/import", {
        method: "POST", roleCode: session.roleCode,
        body: JSON.stringify({ questions: scannedExamQuestions.map((q) => ({
          courseId: item.courseId,
          type: q.type,
          content: q.content,
          options: q.options,
          correctAnswers: q.correctAnswers,
          difficulty: q.difficulty,
          tags: q.tags,
        })) }),
      });
      const imported = results.filter((r) => r.status === "IMPORTED").length;
      const failed = results.filter((r) => r.status === "FAILED");
      await loadClassData();
      notify(`Đã nhập ${imported}/${results.length} câu hỏi nháp.${failed.length ? ` Lỗi: ${failed.map((r) => `dòng ${r.row}: ${r.message}`).join("; ")}` : ""}`, failed.length ? "error" : "success");
      if (!failed.length) {
        setScanModalOpen(false);
        setScannedExamQuestions([]);
        setScanStatus("IDLE");
      } else {
        const failedRows = new Set(failed.map((r) => r.row));
        setScannedExamQuestions((current) => current.filter((_, i) => failedRows.has(i + 1)));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không nhập được câu hỏi OCR.", "error");
    } finally {
      setScanSaving(false);
    }
  };

  /** Sinh đề AI bằng API thật; dùng cùng request ID khi người dùng thử lại cùng cấu hình. */
  const handleTriggerAiExamGen = async () => {
    if (aiGenerating) return;
    const topic = aiTopic.trim();
    if (topic.length < 5 || !Number.isInteger(aiQuestionCount) || aiQuestionCount < 1 || aiQuestionCount > 50) {
      notify("Chuyên đề phải có ít nhất 5 ký tự và số câu trong khoảng 1–50.", "error");
      return;
    }
    const signature = JSON.stringify([item.id, aiSubject, topic, aiQuestionCount, aiDifficulty]);
    if (aiRequestRef.current?.signature !== signature) {
      aiRequestRef.current = { signature, id: crypto.randomUUID() };
    }
    const openAt = new Date();
    setAiGeneratedExam(null);
    setAiGenerating(true);
    try {
      const result = await apiRequest<AiGeneratedExamResult>("/instructor/exams/ai-generate", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          classId: item.id,
          title: `Đề AI: ${topic} (${aiSubject})`,
          focus: `${aiSubject}: ${topic}`,
          difficulty: aiDifficulty === "EASY" ? 1 : aiDifficulty === "MEDIUM" ? 2 : 3,
          distribution: [{ type: "SINGLE_CHOICE", count: aiQuestionCount }],
          durationMinutes: 45,
          totalScore: 10,
          openAt: openAt.toISOString(),
          closeAt: new Date(openAt.getTime() + 7 * 86400000).toISOString(),
          attemptLimit: 1,
          clientRequestId: aiRequestRef.current.id,
        }),
      });
      setAiGeneratedExam(result);
      await loadClassData();
      notify(`Đã tạo đề nháp ${result.generatedQuestionCount} câu. Cần kiểm tra câu hỏi và gửi duyệt trước khi xuất bản.`, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không tạo được đề thi AI.", "error");
    } finally {
      setAiGenerating(false);
    }
  };

  // Mở modal chỉnh sửa câu hỏi trong ngân hàng lớp
  const handleOpenEditQuestion = (q: ClassQuestion) => {
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
        await loadClassData();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể cập nhật câu hỏi.", "error");
      return;
    } finally {
      setEditingQuestionSaving(false);
    }

    setEditingQuestionModalOpen(false);
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

  /** Tạo đề thi DRAFT thật; chỉ chấp nhận câu hỏi đã xuất bản và thông báo lỗi từ API. */
  const persistAndCacheExam = async (
    title: string,
    selectedQuestions: ClassQuestion[],
    shuffleQuestions = false,
  ): Promise<boolean> => {
    if (examSaving) return false;
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      notify("Tiêu đề đề thi cần ít nhất 3 ký tự.", "error");
      return false;
    }
    if (!Number.isInteger(manualExamDuration) || manualExamDuration < 1) {
      notify("Thời lượng đề thi phải là số phút nguyên dương.", "error");
      return false;
    }
    if (!selectedQuestions.length || selectedQuestions.some((question) => question.status !== "PUBLISHED")) {
      notify("Chỉ được tạo đề từ câu hỏi đã xuất bản.", "error");
      return false;
    }
    const openAt = new Date();
    const closeAt = manualExamDueAt ? new Date(manualExamDueAt) : new Date(openAt.getTime() + 7 * 86400000);
    if (!Number.isFinite(closeAt.getTime()) || closeAt <= openAt) {
      notify("Hạn đóng đề thi phải hợp lệ và muộn hơn thời điểm mở đề.", "error");
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
          totalScore: 10,
          openAt: openAt.toISOString(),
          closeAt: closeAt.toISOString(),
          attemptLimit: 1,
          shuffleQuestions,
        }),
      });
      if (!created?.id) throw new Error("Máy chủ không trả về đề thi vừa tạo.");
      notify("Đã lưu đề thi nháp '" + created.title + "' gồm " + selectedQuestions.length + " câu. Hãy gửi duyệt để xuất bản.", "success");
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
    if (await persistAndCacheExam(manualExamTitle, selected)) {
      setManualExamModalOpen(false);
      setManualExamTitle("");
      setManualExamSelectedQuestions([]);
    }
  };

  /** Chọn đúng số câu theo ma trận từ nhóm PUBLISHED và kiểm tra đủ nguồn theo từng mức. */
  const handleTriggerAiCriteriaSelection = () => {
    const pool = filterClassQuestions(publishedClassQuestions, aiCriteriaScope);
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
    setAiCriteriaPreviewList(shuffleQuestionPool(picked));
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
    if (await persistAndCacheExam(manualExamTitle, aiCriteriaPreviewList)) {
      setManualExamModalOpen(false);
      setManualExamTitle("");
      setAiCriteriaPreviewList([]);
    }
  };

  /** Bốc đủ số câu từ câu hỏi đã xuất bản và tạo đề thi thật. */
  const handleCreateExamRandom = async () => {
    const pool = filterClassQuestions(publishedClassQuestions, randomTypeScope);
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

  // Xóa câu hỏi khỏi ngân hàng của lớp
  const handleDeleteClassQuestion = async (questionId: string) => {
    if (window.confirm("Bạn có chắc muốn xóa câu hỏi này khỏi ngân hàng câu hỏi lớp không?")) {
      try {
        await apiRequest(`/instructor/question-bank/questions/${questionId}`, {
          method: "DELETE",
          roleCode: session.roleCode,
        });
        await loadClassData();
        notify("Đã xóa câu hỏi khỏi ngân hàng lớp!", "success");
      } catch (error) {
        console.warn("Không thể xóa câu hỏi khỏi ngân hàng lớp:", error);
        notify(error instanceof Error ? error.message : "Không thể xóa câu hỏi.", "error");
      }
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
    setMaterialSaving(true);
    let uploadedId: string | null = null;
    try {
      const tags = materialFormDesc.trim().split(",").map((tag) => tag.trim()).filter(Boolean);
      const form = new FormData();
      form.append("file", materialUploadFile);
      form.append("folder", materialFormFolder);
      form.append("tags", tags.join(","));
      form.append("scope", "CLASS");
      const created = await apiRequest<Material>(`/instructor/classes/${encodeURIComponent(item.id)}/material-uploads`, {
        method: "POST", roleCode: session.roleCode, body: form,
      });
      if (!created?.id) throw new Error("Máy chủ không trả về ID tài liệu vừa tải lên.");
      uploadedId = created.id;
      if (materialFormTitle.trim() !== created.name) {
        await apiRequest<Material>(`/instructor/materials/${encodeURIComponent(created.id)}`, {
          method: "PATCH", roleCode: session.roleCode,
          body: JSON.stringify({ name: materialFormTitle.trim() }),
        });
      }
      await loadClassData();
      setSelectedMaterialId(created.id);
      setAddMaterialModalOpen(false);
      setMaterialFormTitle("");
      setMaterialFormDesc("");
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
                </div>
              </div>

              {/* Khung phát bài giảng (Player 16:9 YouTube/Video hoặc Phiếu bài tập trắc nghiệm toán học chuẩn Ảnh 2) */}
              {selectedLectureForPage.youtubeId ? (
                <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-lg border border-slate-200 dark:border-slate-800">
                  <iframe
                    src={`https://www.youtube.com/embed/${selectedLectureForPage.youtubeId}?autoplay=0&rel=0&modestbranding=1`}
                    className="w-full h-full border-0"
                    title={selectedLectureForPage.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : selectedLectureForPage.fileType === "pptx" || selectedLectureForPage.title.includes("Phiếu") ? (
                /* Giao diện Phiếu bài tập / Slide trình chiếu (chuẩn Ảnh 2 của người dùng) */
                <div className="w-full min-h-[420px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-6 shadow-sm space-y-5">
                  <div className="text-center space-y-1 pb-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-base sm:text-lg font-extrabold uppercase text-slate-900 dark:text-slate-100 tracking-wide">
                      PHIẾU BÀI TẬP TRẮC NGHIỆM TOÁN HỌC
                    </h3>
                    <p className="text-xs text-slate-500">Thời gian gợi ý: 15 phút</p>
                    <div className="flex justify-center gap-8 text-xs text-slate-500 pt-2">
                      <span>Họ và tên: ........................................................</span>
                      <span>Lớp: .......................................</span>
                    </div>
                  </div>

                  <div className="space-y-4 text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                    <p className="font-semibold italic text-slate-600 dark:text-slate-400">
                      Khoanh tròn vào chữ cái trước đáp án đúng.
                    </p>
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800 space-y-2">
                      <p className="font-bold">Câu 1. Kết quả của phép tính 3 475 + 2 618 là:</p>
                      <div className="grid grid-cols-2 gap-2 text-slate-700 dark:text-slate-300">
                        <span>A. 6 083</span>
                        <span>B. 6 093</span>
                        <span>C. 6 193</span>
                        <span>D. 5 093</span>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800 space-y-2">
                      <p className="font-bold">Câu 2. Kết quả của phép chia 864 : 8 là:</p>
                      <div className="grid grid-cols-2 gap-2 text-slate-700 dark:text-slate-300">
                        <span>A. 108</span>
                        <span>B. 118</span>
                        <span>C. 106</span>
                        <span>D. 98</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full aspect-video rounded-2xl bg-slate-900 flex flex-col items-center justify-center text-white p-6 shadow-md">
                  <Video size={48} className="text-purple-400 mb-3" />
                  <p className="text-sm font-bold">{selectedLectureForPage.title}</p>
                  <p className="text-xs text-slate-400 mt-1">Trình phát video bài học chuyên đề</p>
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

              {/* Phần Bài tập & Tài liệu đính kèm (chuẩn Ảnh 2) */}
              <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Bài tập & tài liệu đính kèm
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
                        {assignments[0]?.title || "Kiểm tra giữa kỳ Web Full-stack"}
                      </strong>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Trắc nghiệm tách câu
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              </div>
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
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 line-clamp-1" title={item.name || item.code}>
                {item.name || item.code}
              </h2>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                Mã lớp: <strong className="text-blue-600 dark:text-blue-400">{item.code}</strong>
              </p>

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
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Lịch học của {item.name || item.code}
                </h3>
                <p className="text-xs text-slate-500">
                  Theo dõi và quản lý các ca học, phòng học trực tuyến của lớp này.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Nút chuyển đổi: Dạng tuần (Lưới) & Dạng tháng (Danh sách) */}
                <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setScheduleView("week")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
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
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      scheduleView === "month"
                        ? "bg-white dark:bg-slate-900 text-blue-600 shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    <List size={14} />
                    <span>Dạng tháng (Danh sách)</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => notify("Chức năng thêm buổi học mới đã sẵn sàng.", "info")}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus size={14} />
                  <span>Thêm buổi học mới</span>
                </button>
              </div>
            </div>

            {scheduleView === "week" ? (
              /* CHẾ ĐỘ DẠNG TUẦN: HIỂN THỊ DẠNG LƯỚI 7 NGÀY CỦA LỚP */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 pt-2">
                {[
                  { day: "Thứ 2", date: "26/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 01: Nhập môn & Quy chế", isToday: false },
                  { day: "Thứ 3", date: "27/10", hasClass: false, isToday: true },
                  { day: "Thứ 4", date: "28/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 02: Phương trình & Hệ thức", isToday: false },
                  { day: "Thứ 5", date: "29/10", hasClass: false, isToday: false },
                  { day: "Thứ 6", date: "30/10", hasClass: true, time: "19:30 - 21:00", title: "Buổi 03: Bài tập chuyên đề 1", isToday: false },
                  { day: "Thứ 7", date: "31/10", hasClass: false, isToday: false },
                  { day: "Chủ nhật", date: "01/11", hasClass: false, isToday: false },
                ].map((col, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex flex-col justify-between min-h-40 ${
                      col.hasClass
                        ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/60"
                        : "bg-slate-50/60 dark:bg-slate-800/40 border-slate-100 dark:border-slate-800"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between border-b border-slate-200/60 dark:border-slate-800 pb-1.5 mb-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{col.day}</span>
                        <span className="text-[10px] text-slate-400">{col.date}</span>
                      </div>

                      {col.hasClass ? (
                        <div className="space-y-1.5">
                          <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[10px] font-bold block w-fit">
                            Trực tuyến
                          </span>
                          <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug">
                            {col.title}
                          </p>
                          <p className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Clock size={11} /> {col.time}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-400 italic pt-6 text-center">Nghỉ</p>
                      )}
                    </div>

                    {col.hasClass && (
                      <div className="space-y-1 mt-2">
                        <button
                          type="button"
                          onClick={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
                          className="w-full py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          Vào phòng
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              /* CHẾ ĐỘ DẠNG THÁNG: HIỂN THỊ DẠNG DANH SÁCH */
              <ClassScheduleMonthList
                rows={[
                  { date: "26/10/2026", time: "19:30 - 21:00", title: "Buổi 01: Nhập môn & Hướng dẫn phương pháp học", status: "Đã diễn ra" },
                  { date: "28/10/2026", time: "19:30 - 21:00", title: "Buổi 02: Phương trình & Biến đổi đại số nâng cao", status: "Hôm nay" },
                  { date: "30/10/2026", time: "19:30 - 21:00", title: "Buổi 03: Chữa bài tập chuyên đề và Kiểm tra 15p", status: "Sắp diễn ra" },
                  { date: "02/11/2026", time: "19:30 - 21:00", title: "Buổi 04: Chuyên đề nâng cao và Vận dụng thực tế", status: "Sắp diễn ra" },
                ]}
                onJoin={() => notify("Đang kết nối phòng học trực tuyến...", "info")}
              />
            )}
          </div>
        )}

        {/* TAB 3: THÀNH VIÊN */}
        {activeTab === "members" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Thành viên lớp học ({learners.length} học sinh)
                </h1>
                <p className="text-xs text-slate-500">Danh sách học sinh và giáo viên phụ trách trong lớp</p>
              </div>
              <div className="relative w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Tìm học sinh theo tên/email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden shadow-xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase font-extrabold text-[10px]">
                  <tr>
                    <th className="px-4 py-3">Họ và tên</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Vai trò</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3 text-right">Nhắn tin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {/* Giáo viên */}
                  <tr className="bg-blue-50/40 dark:bg-blue-950/20">
                    <td className="px-4 py-3 font-bold flex items-center gap-2">
                      <UserAvatar name={session.user.name} className="size-6 text-[10px]" />
                      <span>{session.user.name}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{session.user.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold text-[10px]">
                        Giảng viên chính
                      </span>
                    </td>
                    <td className="px-4 py-3 text-emerald-600 font-bold">Phụ trách</td>
                    <td className="px-4 py-3 text-right text-slate-400">—</td>
                  </tr>

                  {/* Học sinh */}
                  {learners
                    .filter((l) => !searchQuery || l.displayName.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-medium flex items-center gap-2">
                          <UserAvatar name={l.displayName} className="size-6 text-[10px]" />
                          <span>{l.displayName}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{l.email}</td>
                        <td className="px-4 py-3 text-slate-500">Học sinh</td>
                        <td className="px-4 py-3 text-emerald-600 font-bold">Đang học</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              window.dispatchEvent(
                                new CustomEvent("open-mini-chat", {
                                  detail: {
                                    id: l.id,
                                    name: l.displayName,
                                    role: "LEARNER",
                                  },
                                }),
                              );
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                            title={`Nhắn tin với ${l.displayName}`}
                          >
                            <MessageCircle size={14} />
                            <span>Nhắn tin</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: VAI TRÒ (THÊM ĐỒNG GIÁO VIÊN ĐỂ CHẤM ĐIỂM) */}
        {activeTab === "roles" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Vai trò & Phân quyền giảng dạy
                </h1>
                <p className="text-xs text-slate-500">
                  Thêm đồng giáo viên hoặc trợ giảng để cùng chấm bài và quản lý lớp học
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAddCoInstructorOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <UserPlus size={15} />
                <span>Thêm đồng giáo viên</span>
              </button>
            </div>

            <div className="space-y-3">
              {/* Giảng viên chính */}
              <div className="rounded-2xl border border-blue-200 dark:border-blue-800/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-3">
                  <UserAvatar name={session.user.name} className="size-10" />
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-xs font-bold">{session.user.name}</strong>
                      <span className="px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                        Giảng viên chính (Primary)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">{session.user.email}</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Toàn quyền</span>
              </div>

              {/* Các đồng giáo viên hiện có */}
              {instructors
                .filter((ins) => ins.instructorId !== session.user.id)
                .map((ins, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 flex items-center justify-between shadow-xs"
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar name={ins.displayName || "Đồng giáo viên"} className="size-10" />
                      <div>
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-bold">{ins.displayName || "Đồng giáo viên"}</strong>
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold">
                            {ins.role === "ASSISTANT" ? "Trợ giảng" : "Đồng giáo viên"}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">{ins.email || "teacher@wind.edu.vn"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(
                            new CustomEvent("open-mini-chat", {
                              detail: {
                                id: ins.instructorId,
                                name: ins.displayName || "Đồng giáo viên",
                                role: "INSTRUCTOR",
                              },
                            }),
                          );
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-xs font-bold transition-colors cursor-pointer shrink-0"
                        title={`Nhắn tin với ${ins.displayName || "Đồng giáo viên"}`}
                      >
                        <MessageCircle size={14} />
                        <span>Nhắn tin</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => notify("Đã gỡ quyền đồng giáo viên!", "success")}
                        className="text-xs text-rose-600 hover:underline font-bold cursor-pointer"
                      >
                        Gỡ quyền
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* TAB 5: BÀI TẬP (HỖ TRỢ CHUYỂN ĐỔI CHẾ ĐỘ DANH SÁCH 3 CỘT VÀ TRANG CHI TIẾT/BẢNG ĐIỂM RIÊNG BIỆT THEO ẢNH MẪU) */}
        {activeTab === "assignments" && (
          <>
            {assignmentViewMode === "detail" && selectedAssignment ? (
              /* =========================================================================
                 TRANG CHI TIẾT BÀI TẬP & BẢNG ĐIỂM HỌC SINH (CHUẨN ẢNH 1 CỦA NGƯỜI DÙNG)
                 ========================================================================= */
              <div className="space-y-4">
                {/* Header: Breadcrumb bên trái + 5 nút tab con bên phải */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                  {/* Breadcrumb: Bài tập > Tên bài tập */}
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setAssignmentViewMode("list")}
                      className="font-bold text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer flex items-center gap-1"
                    >
                      <ArrowLeft size={16} className="text-slate-400" />
                      <span>Bài tập</span>
                    </button>
                    <ChevronRight size={14} className="text-slate-400" />
                    <span className="font-extrabold text-slate-900 dark:text-slate-100 truncate max-w-[280px] sm:max-w-md">
                      {selectedAssignment.title}
                    </span>
                  </div>

                  {/* Cụm 5 nút Tab bên phải */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setAssignmentDetailSubTab("gradebook")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentDetailSubTab === "gradebook"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Bảng điểm
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentDetailSubTab("overview")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentDetailSubTab === "overview"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Tổng quan
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentDetailSubTab("stats")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentDetailSubTab === "stats"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Thông số câu
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentDetailSubTab("exam_content");
                        setPreviewExam({
                          id: selectedAssignment.id,
                          title: selectedAssignment.title,
                          durationMinutes: selectedAssignment.durationMinutes || 45,
                          totalQuestions: selectedAssignment.totalQuestions || 10,
                          remainingAttempts: null,
                          totalScore: selectedAssignment.maxScore,
                        });
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentDetailSubTab === "exam_content"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Đề bài
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentDetailSubTab("solution");
                        notify("Xem hướng dẫn giải chi tiết cho đề thi này", "info");
                      }}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentDetailSubTab === "solution"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Lời giải
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEditAssignment(selectedAssignment)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/80 transition cursor-pointer"
                    >
                      <Edit3 size={13} />
                      <span>Chỉnh sửa bài tập</span>
                    </button>
                  </div>
                </div>

                {/* Toolbar lọc trạng thái & tìm kiếm theo Ảnh 1 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {/* Nhóm 4 nút trạng thái: Tất cả, Chưa làm, Đang làm, Đã nộp */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAssignmentStatusFilter("ALL")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentStatusFilter === "ALL"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Tất cả
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentStatusFilter("NOT_STARTED")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentStatusFilter === "NOT_STARTED"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Chưa làm
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentStatusFilter("IN_PROGRESS")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentStatusFilter === "IN_PROGRESS"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Đang làm
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignmentStatusFilter("SUBMITTED")}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                        assignmentStatusFilter === "SUBMITTED"
                          ? "bg-blue-600 text-white shadow-xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                      }`}
                    >
                      Đã nộp
                    </button>
                  </div>

                  {/* Bên phải: Dropdown đối tượng + Ô tìm kiếm + Icon máy in */}
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer pr-7">
                        <option value="class">Học sinh lớp</option>
                        <option value="all">Tất cả đối tượng</option>
                      </select>
                      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>

                    <div className="relative w-48 sm:w-60">
                      <input
                        type="text"
                        placeholder="Nhập để tìm kiếm..."
                        value={assignmentStudentSearch}
                        onChange={(e) => setAssignmentStudentSearch(e.target.value)}
                        className="w-full pl-3 pr-8 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        notify("Đang chuẩn bị bảng in điểm học sinh...", "info");
                        if (typeof window !== "undefined") window.print();
                      }}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                      title="In bảng điểm"
                    >
                      <Printer size={15} />
                    </button>
                  </div>
                </div>

                {/* BẢNG ĐIỂM CHI TIẾT (CHUẨN ẢNH 1 VỚI DỮ LIỆU THẬT TỪ POSTGRESQL CỦA LỚP) */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-3 w-10 text-center">
                          <input type="checkbox" className="rounded text-blue-600 cursor-pointer" />
                        </th>
                        <th className="px-3 py-3 w-12 text-slate-500">#</th>
                        <th className="px-4 py-3 min-w-48 text-slate-700 dark:text-slate-200">
                          <div className="flex items-center gap-1 cursor-pointer">
                            <span>Họ và tên</span>
                            <ChevronDown size={13} className="text-slate-400" />
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center min-w-24 text-slate-600 dark:text-slate-300">
                          Đã làm
                        </th>
                        <th className="px-4 py-3 text-center min-w-24 text-slate-600 dark:text-slate-300">
                          <div className="flex items-center justify-center gap-1 cursor-pointer">
                            <span>Điểm</span>
                            <span className="text-slate-400">↓</span>
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center min-w-28 text-slate-600 dark:text-slate-300">
                          <div className="flex items-center justify-center gap-1 cursor-pointer">
                            <span>Thời lượng</span>
                            <ChevronDown size={13} className="text-slate-400" />
                          </div>
                        </th>
                        <th className="px-4 py-3 text-center min-w-32 text-slate-600 dark:text-slate-300">
                          Ngày nộp
                        </th>
                        <th className="px-4 py-3 text-center min-w-24 text-slate-600 dark:text-slate-300">
                          Rời khỏi
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {learners.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-slate-400">
                            Chưa có học sinh nào tham gia lớp học này.
                          </td>
                        </tr>
                      ) : (
                        learners
                          .filter((l) => {
                            if (!assignmentStudentSearch) return true;
                            const name = l.displayName || l.email || "";
                            return (
                              name.toLowerCase().includes(assignmentStudentSearch.toLowerCase()) ||
                              (l.email?.toLowerCase().includes(assignmentStudentSearch.toLowerCase()) ?? false)
                            );
                          })
                          .filter((l) => {
                            const submission = selectedSubmissions.find((entry) => entry.learnerId === l.id);
                            if (assignmentStatusFilter === "SUBMITTED") return !!submission;
                            if (assignmentStatusFilter === "NOT_STARTED") return !submission;
                            return true;
                          })
                          .map((learner, index) => {
                            const studentName = learner.displayName || learner.email || "Học sinh";
                            const submission = selectedSubmissions.find((entry) => entry.learnerId === learner.id);
                            const initials = studentName
                              .split(" ")
                              .map((n: string) => n[0] || "")
                              .slice(-2)
                              .join("")
                              .toUpperCase() || "TN";

                            return (
                              <tr
                                key={learner.id}
                                className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition"
                              >
                                <td className="px-4 py-3.5 text-center">
                                  <input type="checkbox" className="rounded text-blue-600 cursor-pointer" />
                                </td>
                                <td className="px-3 py-3.5 text-slate-400 font-medium">
                                  {index + 1}
                                </td>
                                <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-slate-100">
                                  <div className="flex items-center gap-2.5">
                                    <div className="size-7 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-extrabold text-[11px] grid place-items-center shrink-0">
                                      {initials}
                                    </div>
                                    <span className="truncate">{studentName}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-600 dark:text-slate-400 font-medium">
                                  {submission ? "1/1" : "0/1"}
                                </td>
                                <td className="px-4 py-3.5 text-center font-bold">
                                  {submission?.score !== undefined ? (
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getScoreColorClass(
                                        submission.score,
                                        selectedAssignment?.maxScore ?? 10
                                      )}`}
                                    >
                                      {submission.score}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">--</span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  —
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  {submission ? new Date(submission.submittedAt).toLocaleString("vi-VN") : "—"}
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  —
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
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
                          <select className="py-1.5 pl-3 pr-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
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

                    {/* Danh sách thẻ bài tập (Theo Ảnh 2: Thẻ W xanh, tiêu đề, loại đề, x/y đã làm) */}
                    <div className="flex-1 space-y-2 overflow-y-auto max-h-[540px] pr-1">
                      {assignments.length === 0 ? (
                        <div className="p-8 text-center text-xs text-slate-400">
                          Chưa có bài tập nào. Bấm &quot;+ Tạo bài tập&quot; để thêm mới.
                        </div>
                      ) : (
                        assignments
                          .filter((assign) => !searchQuery || assign.title.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map((assign) => {
                            const isSelected = selectedAssignment?.id === assign.id;
                            const submittedCount = new Set((submissionsByAssignment[assign.id] ?? []).map((submission) => submission.learnerId)).size;
                            const totalLearnersCount = Math.max(learners.length, 1);

                            return (
                              <div
                                key={assign.id}
                                onClick={() => setSelectedAssignment(assign)}
                                className={`p-3.5 rounded-xl border text-left cursor-pointer transition flex items-center justify-between gap-3 ${
                                  isSelected
                                    ? "border-blue-400 dark:border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 shadow-2xs"
                                    : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 bg-white dark:bg-slate-900"
                                }`}
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  {/* Icon đề bài: W xanh hoặc 3 màu */}
                                  <div className="size-8 rounded-lg bg-blue-600 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-xs">
                                    W
                                  </div>
                                  <div className="min-w-0">
                                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                      {assign.title}
                                    </strong>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                      Trắc nghiệm tách câu
                                    </p>
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                    {submittedCount}/{totalLearnersCount} đã làm
                                  </span>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>

                  {/* CỘT 3: PANEL XEM NHANH THÔNG TIN BÀI TẬP & CỤM NÚT CHỨC NĂNG (CHUẨN ẢNH 2) */}
                  <div className="w-full lg:w-80 shrink-0 p-5 space-y-5 bg-slate-50/30 dark:bg-slate-950/20 flex flex-col justify-between">
                    {selectedAssignment ? (
                      <div className="space-y-4">
                        {/* Tiêu đề bài tập to */}
                        <div>
                          <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100">
                            {selectedAssignment.title}
                          </h3>
                        </div>

                        {/* Khối thông số chi tiết của bài tập */}
                        <div className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-slate-800/80 pt-1">
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-slate-500">Số lần làm bài</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">1</span>
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-slate-500">Lấy điểm</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">Lần đầu tiên</span>
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-slate-500">Loại</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-right max-w-[160px] truncate">
                              Trắc nghiệm tách câu được tách tự động
                            </span>
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <span className="text-slate-500">Ngày tạo</span>
                            <span className="font-bold text-slate-900 dark:text-slate-100">27 tháng 10</span>
                          </div>
                        </div>

                        {/* Icon chevron-down thu gọn */}
                        <div className="flex justify-center pt-1">
                          <ChevronDown size={16} className="text-slate-400" />
                        </div>

                        {/* DANH SÁCH NÚT CHỨC NĂNG DỌC (THEO ẢNH 2) */}
                        <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                          {/* Làm thử */}
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewExam({
                                id: selectedAssignment.id,
                                title: selectedAssignment.title,
                                durationMinutes: selectedAssignment.durationMinutes ?? 45,
                                totalQuestions: selectedAssignment.totalQuestions ?? 0,
                                remainingAttempts: null,
                              });
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                          >
                            <span>Làm thử</span>
                            <Eye size={16} className="text-slate-400" />
                          </button>

                          {/* Chi tiết -> CHUYỂN SANG TRANG CHI TIẾT THEO ẢNH 1 */}
                          <button
                            type="button"
                            onClick={() => setAssignmentViewMode("detail")}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer"
                          >
                            <span>Chi tiết</span>
                            <Info size={16} className="text-blue-600 dark:text-blue-400" />
                          </button>

                          {/* Chỉnh sửa */}
                          {selectedAssignment.status === "DRAFT" && (
                            <button
                              type="button"
                              onClick={() => handleOpenEditAssignment(selectedAssignment)}
                              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                            >
                              <span>Chỉnh sửa</span>
                              <Edit2 size={16} className="text-slate-400" />
                            </button>
                          )}

                          {/* Xuất dữ liệu */}
                          <button
                            type="button"
                            onClick={() => exportAssignmentsCsv(assignments, item.code)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                          >
                            <span>Xuất dữ liệu</span>
                            <Download size={16} className="text-slate-400" />
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
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Bảng điểm tổng hợp ({item.name})
                </h1>
                <p className="text-xs text-slate-500">
                  Điểm thi, điểm bài tập và trạng thái chấm bài được tổng hợp từ hệ thống.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên hoặc email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => exportGradebookCsv(gradebook, item.name)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download size={14} />
                  <span>Xuất CSV</span>
                </button>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-extrabold text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 min-w-44">Học sinh</th>
                    <th className="px-4 py-3 text-center">Điểm thi</th>
                    <th className="px-4 py-3 text-center">Điểm bài tập</th>
                    <th className="px-4 py-3 text-center">Tổng (%)</th>
                    <th className="px-4 py-3 text-center">Chờ chấm</th>
                    <th className="px-4 py-3 text-center">Chưa nộp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {gradebook
                    .filter((row) => !searchQuery || `${row.learnerName} ${row.learnerEmail}`.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((row) => (
                      <tr key={row.learnerId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-bold">
                            <UserAvatar name={row.learnerName} className="size-6 text-[10px]" />
                            <span>{row.learnerName}</span>
                          </div>
                          <span className="text-slate-500">{row.learnerEmail}</span>
                        </td>
                        <td className="px-4 py-3 text-center">{row.examEarned} / {row.examPossible}</td>
                        <td className="px-4 py-3 text-center">{row.assignmentEarned} / {row.assignmentPossible}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 border font-bold ${getScoreColorClass(row.totalPercent, 100)}`}>
                            {row.totalPercent.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">{row.awaitingGrade}</td>
                        <td className="px-4 py-3 text-center">{row.notSubmitted}</td>
                      </tr>
                    ))}
                  {gradebook.filter((row) => !searchQuery || `${row.learnerName} ${row.learnerEmail}`.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        {searchQuery ? "Không tìm thấy học sinh phù hợp." : "Chưa có dữ liệu bảng điểm."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {/* TAB 7: BÀI GIẢNG (GIAO DIỆN 3 CỘT MASTER-DETAIL CHUẨN ẢNH 1 ĐỒNG BỘ VỚI HỌC SINH + TÍNH NĂNG GIẢNG VIÊN) */}
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
              <button
                type="button"
                onClick={() => {
                  const defaultFolder = selectedLectureFolder !== "__ALL__" ? selectedLectureFolder : (lectureFolders[0] || "Hình học");
                  setLectureFormFolder(defaultFolder);
                  setAddLectureModalOpen(true);
                }}
                className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus size={14} />
                <span>Thêm bài giảng</span>
              </button>
            </div>

            {/* Khung 3 cột Master-Detail chuẩn Ảnh 1 */}
            <div className="flex flex-col lg:flex-row min-h-[580px]">
              {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
              <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                  <span>Thư mục</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowNewFolderModal(true)}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-bold cursor-pointer"
                      title="Tạo thư mục mới"
                    >
                      + Tạo
                    </button>
                    <SlidersHorizontal size={14} className="text-slate-400" />
                  </div>
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
                      toggleCursor
                    />
                  ))}
                </div>
              </div>

              {/* CỘT 2: DANH SÁCH BÀI GIẢNG (FLEX-1 CHUẨN ẢNH 1) */}
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
                              <div className="w-full max-w-[200px] h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-purple-500 rounded-full"
                                  style={{ width: `${lec.progressPercent || 0}%` }}
                                />
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {lec.duration} · GV: {lec.teacher}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400">
                              {lec.progressPercent ?? 0}% đã xem
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* CỘT 3: CHI TIẾT BÀI GIẢNG (~320px CHUẨN ẢNH 1 + NÚT CHỈNH SỬA / XÓA BÀI GIẢNG) */}
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
                        {activeLectureItem.uploadedAt}
                      </span>
                    </div>

                    {/* Nút Xem bài giảng: Mở trang chi tiết xem bài giảng chuẩn Ảnh 2 */}
                    <div className="pt-2 space-y-2">
                      <button
                        type="button"
                        onClick={() => setSelectedLectureForPage(activeLectureItem)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        <Play size={14} />
                        <span>Xem bài giảng</span>
                      </button>

                      {/* Các nút dành riêng cho Giảng viên: Chỉnh sửa, Di chuyển và Xóa bài giảng */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditLecture(activeLectureItem)}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <Edit3 size={13} />
                          <span>Chỉnh sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenMoveItem(activeLectureItem.id, activeLectureItem.title, "LECTURE")}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <FolderInput size={13} />
                          <span>Di chuyển</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteLecture(activeLectureItem.id, activeLectureItem.title)}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <Trash2 size={13} />
                          <span>Xóa</span>
                        </button>
                      </div>
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

        {/* TAB 8: TÀI LIỆU (CẤU TRÚC 3 CỘT ĐỒNG BỘ 100% VỚI HỌC SINH + TÍNH NĂNG GIẢNG VIÊN) */}
        {activeTab === "materials" && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
            {/* Header tiêu đề danh mục */}
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Tài liệu ({materialsList.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Học liệu số, giáo trình và tài liệu tham khảo phân loại theo thư mục chuyên đề.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const defaultFolder = selectedMaterialFolder !== "__ALL__" ? selectedMaterialFolder : (materialFolders[0] || "Toán 1");
                  setMaterialFormFolder(defaultFolder);
                  setAddMaterialModalOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <UploadCloud size={14} />
                <span>Tải tài liệu</span>
              </button>
            </div>

            {/* Khung 3 cột Master-Detail */}
            <div className="flex flex-col lg:flex-row min-h-[580px]">
              {/* CỘT 1: CÂY THƯ MỤC (~220px) */}
              <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-200 pb-2 border-b border-slate-200/60 dark:border-slate-800/60">
                  <span>Thư mục</span>
                  <button
                    type="button"
                    onClick={() => setShowNewFolderModal(true)}
                    className="text-blue-600 dark:text-blue-400 hover:underline text-[11px] font-bold cursor-pointer"
                  >
                    + Tạo
                  </button>
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
                                {mat.size} · Tải lên {mat.uploadedAt}
                              </p>
                            </div>
                          </div>

                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* CỘT 3: CHI TIẾT TÀI LIỆU (~320px + NÚT CHỈNH SỬA / XÓA TÀI LIỆU) */}
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
                      {activeMaterialItem.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                          {activeMaterialItem.description}
                        </p>
                      )}
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
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                        <span>Ngày tải lên</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {activeMaterialItem.uploadedAt}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 space-y-2">
                      <button
                        type="button"
                        onClick={() => void handleDownloadMaterial(activeMaterialItem.id)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        <Download size={14} />
                        <span>Tải xuống tài liệu</span>
                      </button>

                      {/* Các nút dành riêng cho Giảng viên: Chỉnh sửa, Di chuyển và Xóa tài liệu */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditMaterial(activeMaterialItem)}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <Edit3 size={13} />
                          <span>Chỉnh sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenMoveItem(activeMaterialItem.id, activeMaterialItem.title, "MATERIAL")}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <FolderInput size={13} />
                          <span>Di chuyển</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMaterial(activeMaterialItem.id, activeMaterialItem.title)}
                          className="w-full inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                        >
                          <Trash2 size={13} />
                          <span>Xóa</span>
                        </button>
                      </div>
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

        {/* TAB 9: NGÂN HÀNG CÂU HỎI LỚP HỌC */}
        {activeTab === "questions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Ngân hàng câu hỏi riêng lớp {item.name}
                </h1>
                <p className="text-xs text-slate-500">
                  Tổng hợp tất cả câu hỏi được tách tự động từ bài tập và đề kiểm tra trong lớp này
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExamCreationMode("MANUAL");
                    setManualExamTitle(`Đề kiểm tra lớp ${item.name} - ${new Date().toLocaleDateString("vi-VN")}`);
                    setManualExamModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <FileCheck2 size={15} />
                  <span>Tạo đề</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenCreationHub("QUESTION")}
                  className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Plus size={15} />
                  <span>Soạn câu hỏi mới</span>
                </button>
              </div>
            </div>

            {/* Thanh phân loại Trắc nghiệm / Tự luận và Tìm kiếm */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setQuestionBankTab("ALL")}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    questionBankTab === "ALL"
                      ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  <span>Tất cả</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold">
                    {classQuestionStats.total}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQuestionBankTab("MULTIPLE_CHOICE")}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    questionBankTab === "MULTIPLE_CHOICE"
                      ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  <span>Trắc nghiệm</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold">
                    {classQuestionStats.multipleChoice}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setQuestionBankTab("ESSAY")}
                  className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                    questionBankTab === "ESSAY"
                      ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs font-extrabold"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                  }`}
                >
                  <span>Tự luận</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 font-bold">
                    {classQuestionStats.essay}
                  </span>
                </button>
              </div>

              {/* Ô tìm kiếm và lọc độ khó */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-60">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Tìm câu hỏi, nguồn..."
                    value={questionBankSearch}
                    onChange={(e) => setQuestionBankSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <select
                  value={questionBankDifficulty}
                  onChange={(e) => setQuestionBankDifficulty(e.target.value)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">Tất cả độ khó</option>
                  <option value="Cơ bản">Cơ bản</option>
                  <option value="Thông hiểu">Thông hiểu</option>
                  <option value="Vận dụng">Vận dụng</option>
                  <option value="Vận dụng cao">Vận dụng cao</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {filteredClassQuestions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center space-y-3">
                  <FileQuestion size={32} className="mx-auto text-slate-400" />
                  <p className="text-xs text-slate-500 font-medium">
                    {classQuestions.length === 0
                      ? "Chưa có câu hỏi nào trong ngân hàng riêng của lớp."
                      : "Không tìm thấy câu hỏi nào phù hợp với bộ lọc hiện tại."}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleOpenCreationHub("QUESTION")}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer shadow-xs inline-flex items-center gap-1.5"
                  >
                    <Sparkles size={14} />
                    <span>Khởi tạo câu hỏi bằng AI hoặc Thủ công</span>
                  </button>
                </div>
              ) : (
                filteredClassQuestions.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/60">
                          {q.type}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                          {q.difficulty}
                        </span>
                        <span className="text-[11px] text-slate-400 font-medium">
                          Nguồn: <strong className="text-slate-600 dark:text-slate-300">{q.source}</strong>
                        </span>
                        <span className="text-[10px] text-slate-400">({q.createdAt})</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEditQuestion(q)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 size={12} />
                          <span>Chỉnh sửa</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClassQuestion(q.id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          title="Xóa câu hỏi khỏi ngân hàng"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <strong className="block text-xs font-bold leading-relaxed text-slate-800 dark:text-slate-200">
                      {q.content}
                    </strong>

                    {/* Danh sách lựa chọn nếu là trắc nghiệm */}
                    {q.options && q.options.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {q.options.map((opt, optIdx) => {
                          const isCorrect = q.correctAnswers?.includes(optIdx);
                          const prefix = String.fromCharCode(65 + optIdx);
                          return (
                            <div
                              key={optIdx}
                              className={`p-2 rounded-xl text-xs flex items-center gap-2 border ${
                                isCorrect
                                  ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold"
                                  : "border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              <span
                                className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 ${
                                  isCorrect
                                    ? "bg-emerald-500 text-white"
                                    : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                }`}
                              >
                                {prefix}
                              </span>
                              <span className="truncate">{opt}</span>
                              {isCorrect && (
                                <span className="ml-auto text-[10px] font-extrabold text-emerald-600">
                                  ✓ Đúng
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Lời giải chi tiết nếu có */}
                    {q.solution && (
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                        <span className="font-bold text-slate-700 dark:text-slate-200 block mb-0.5">
                          💡 Hướng dẫn giải:
                        </span>
                        <span>{q.solution}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 10: CÀI ĐẶT LỚP HỌC (TÁCH BIỆT)
            ========================================================================= */}
        {activeTab === "settings" && (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                Cài đặt lớp học ({item.name})
              </h1>
              <p className="text-xs text-slate-500">
                Điều chỉnh thông tin hiển thị, quy tắc bài tập và cấu hình thảo luận của lớp
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 shadow-xs space-y-5">
              {/* Thông tin lớp học */}
              <div className="space-y-4">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  Thông tin lớp học
                </h3>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tên hiển thị của lớp:
                  </label>
                  <input
                    type="text"
                    value={classSettings.displayName}
                    onChange={(e) => setClassSettings({ ...classSettings, displayName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả lớp học:
                  </label>
                  <textarea
                    rows={2}
                    value={classSettings.description}
                    onChange={(e) => setClassSettings({ ...classSettings, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                  />
                </div>

                {/* Các trường Readonly do Quản lý đặt */}
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold">MÃ LỚP CHÍNH THỨC</span>
                    <strong className="text-slate-700 dark:text-slate-200">{item.code}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold">KHÓA HỌC / HỌC PHẦN</span>
                    <strong className="text-slate-700 dark:text-slate-200">{course?.name || item.courseId}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold">KHỐI HỌC</span>
                    <strong className="text-slate-700 dark:text-slate-200">Khối {item.grade || 10}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold">MÔN HỌC</span>
                    <strong className="text-slate-700 dark:text-slate-200">{item.subject || "Toán"}</strong>
                  </div>
                </div>
              </div>

              {/* Bảng tin & Quy tắc bài tập */}
              <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  Quy tắc & Thảo luận
                </h3>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div>
                    <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Cho phép học sinh đăng chủ đề mới lên bảng tin
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      Nếu tắt, chỉ giáo viên mới được đăng bài; học sinh chỉ được bình luận
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={classSettings.allowStudentPost}
                    onChange={(e) => setClassSettings({ ...classSettings, allowStudentPost: e.target.checked })}
                    className="size-4 text-blue-600 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div>
                    <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Cho phép nộp bài tập muộn
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      Học sinh nộp sau thời hạn sẽ được đánh dấu &quot;Nộp muộn&quot;
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={classSettings.allowLateSubmission}
                    onChange={(e) => setClassSettings({ ...classSettings, allowLateSubmission: e.target.checked })}
                    className="size-4 text-blue-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Số lần làm bài tập mặc định:
                  </label>
                  <select
                    value={classSettings.maxAttempts}
                    onChange={(e) => setClassSettings({ ...classSettings, maxAttempts: Number(e.target.value) })}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium cursor-pointer"
                  >
                    <option value={1}>1 lần duy nhất</option>
                    <option value={2}>2 lần</option>
                    <option value={3}>3 lần</option>
                    <option value={999}>Không giới hạn</option>
                  </select>
                </div>
              </div>

              {/* Nút hành động Lưu & Hủy (KHÔNG có nút đóng lớp) */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => notify("Đã hủy các thay đổi", "info")}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Hủy thay đổi
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (settingsSaveTimer.current !== null) clearTimeout(settingsSaveTimer.current);
                    setSettingsSaving(true);
                    settingsSaveTimer.current = setTimeout(() => {
                      settingsSaveTimer.current = null;
                      setSettingsSaving(false);
                      notify("Đã lưu cấu hình lớp học thành công!", "success");
                    }, 500);
                  }}
                  disabled={settingsSaving}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition cursor-pointer shadow-xs"
                >
                  {settingsSaving ? "Đang lưu..." : "Lưu cài đặt"}
                </button>
              </div>
            </div>
          </div>
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
                    Mô tả bài giảng:
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Tóm tắt nội dung bài giảng..."
                    value={lectureFormDesc}
                    onChange={(e) => setLectureFormDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                  />
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
                      {Array.from(new Set([...lectureFolders, "Hình học", "Toán 1", lectureFormFolder].filter(Boolean))).map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Hoặc gõ tên thư mục..."
                      value={lectureFormFolder}
                      onChange={(e) => setLectureFormFolder(e.target.value)}
                      className="w-1/2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
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
      <AssignmentBuilderModal
        open={addAssignmentModalOpen}
        onClose={() => setAddAssignmentModalOpen(false)}
        targetClassName={item.name || item.code}
        onSaveAssignment={handleSaveFromBuilder}
      />

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
                      Nộp lúc {new Date(selectedStudentAttempt.submittedAt).toLocaleString("vi-VN")}
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
                      {selectedStudentAttempt.attachments.map((attachment) => (
                        <div key={attachment.id} className="text-xs">
                          {attachment.originalName} ({(attachment.sizeBytes / 1024).toFixed(1)} KB)
                        </div>
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
                          <td className="px-4 py-3">{new Date(submission.submittedAt).toLocaleString("vi-VN")}</td>
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
      {shareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold">Chia sẻ bài tập</h3>
              <button type="button" onClick={() => setShareModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="shareScope"
                  checked={shareScope === "CLASS_ONLY"}
                  onChange={() => setShareScope("CLASS_ONLY")}
                />
                <div>
                  <strong className="block">Chỉ học sinh trong lớp</strong>
                  <span className="text-slate-500 text-[11px]">Chỉ thành viên lớp mới được xem và làm bài</span>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="shareScope"
                  checked={shareScope === "PUBLIC"}
                  onChange={() => setShareScope("PUBLIC")}
                />
                <div>
                  <strong className="block">Bất kỳ ai có liên kết</strong>
                  <span className="text-slate-500 text-[11px]">Học sinh có liên kết đều có thể tham gia làm thử</span>
                </div>
              </label>
            </div>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await copyTextToClipboard(window.location.href);
                    notify("Đã sao chép liên kết chia sẻ!", "success");
                  } catch {
                    notify("Không thể sao chép liên kết lớp học.", "error");
                  }
                  setShareModalOpen(false);
                }}
                className="px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Sao chép liên kết & Lưu
              </button>
            </div>
          </div>
        </div>
      )}

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
      {addCoInstructorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-extrabold">Thêm đồng giáo viên vào lớp</h3>
              <button type="button" onClick={() => setAddCoInstructorOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-bold mb-1">Chọn giáo viên trong hệ thống:</label>
                <select
                  value={selectedInstructorId}
                  onChange={(e) => setSelectedInstructorId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="">-- Chọn giảng viên --</option>
                  {allAvailableInstructors
                    .filter((ins) => ins.id !== session.user.id)
                    .map((ins) => (
                      <option key={ins.id} value={ins.id}>
                        {ins.displayName} ({ins.email})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Vai trò phân công:</label>
                <select
                  value={coInstructorRole}
                  onChange={(e) => setCoInstructorRole(e.target.value as "CO_INSTRUCTOR" | "ASSISTANT")}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <option value="CO_INSTRUCTOR">Đồng giảng viên (Tạo bài, chấm điểm, quản lý)</option>
                  <option value="ASSISTANT">Trợ giảng (Hỗ trợ chấm điểm và diễn đàn)</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddCoInstructorOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!selectedInstructorId) {
                    notify("Vui lòng chọn giảng viên!", "error");
                    return;
                  }
                  notify("Đã thêm đồng giáo viên thành công!", "success");
                  setAddCoInstructorOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Xác nhận thêm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal làm thử / xem đề dành cho giáo viên */}
      <ExamTakingModal
        open={Boolean(previewExam)}
        onClose={() => setPreviewExam(null)}
        exam={previewExam}
        isInstructorPreview={true}
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
                  <select
                    value={editLectureFormFolder}
                    onChange={(e) => setEditLectureFormFolder(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100"
                  >
                    <option value="Toán 1">Toán 1</option>
                    <option value="Hình học">Hình học</option>
                    {customFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Mô tả bài giảng:
                  </label>
                  <textarea
                    rows={3}
                    value={editLectureFormDesc}
                    onChange={(e) => setEditLectureFormDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-900 dark:text-slate-100 resize-none"
                  />
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

              <div className="grid grid-cols-2 gap-3">
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
                      {Array.from(new Set([...materialFolders, "Toán 1", "Hình học", materialFormFolder].filter(Boolean))).map((f) => (
                        <option key={f} value={f}>
                          📁 {f}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Hoặc gõ tên thư mục..."
                      value={materialFormFolder}
                      onChange={(e) => setMaterialFormFolder(e.target.value)}
                      className="w-1/2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
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
                  Mô tả tài liệu:
                </label>
                <textarea
                  rows={3}
                  placeholder="Mô tả tóm tắt nội dung tài liệu..."
                  value={materialFormDesc}
                  onChange={(e) => setMaterialFormDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                />
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
                    <option value="Toán 1">Toán 1</option>
                    <option value="Hình học">Hình học</option>
                    {customFolders.map((f) => (
                      <option key={f} value={f}>
                        {f}
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
                  Mô tả tài liệu:
                </label>
                <textarea
                  rows={2}
                  value={editMaterialFormDesc}
                  onChange={(e) => setEditMaterialFormDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                />
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
          MODAL CHỈNH SỬA BÀI TẬP DÀNH CHO GIẢNG VIÊN (ÁP DỤNG TƯƠNG TỰ)
          ========================================================================= */}
      {editAssignmentModalOpen && editingAssignment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Chỉnh sửa bài tập: {editingAssignment.title}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditAssignmentModalOpen(false);
                  setEditingAssignment(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tiêu đề bài tập <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={editAssignmentTitle}
                  onChange={(e) => setEditAssignmentTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                />
              </div>

              <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Điểm tối đa:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editAssignmentMaxScore}
                    onChange={(e) => setEditAssignmentMaxScore(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hạn nộp bài (Deadline):
                </label>
                <input
                  type="datetime-local"
                  value={editAssignmentDue}
                  onChange={(e) => setEditAssignmentDue(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Mô tả bài tập:
                </label>
                <textarea
                  rows={2}
                  value={editAssignmentDesc}
                  onChange={(e) => setEditAssignmentDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hướng dẫn làm bài:
                </label>
                <textarea
                  rows={2}
                  value={editAssignmentInstructions}
                  onChange={(e) => setEditAssignmentInstructions(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setEditAssignmentModalOpen(false);
                  setEditingAssignment(null);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditAssignment}
                disabled={editAssignmentSaving}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer disabled:opacity-50"
              >
                {editAssignmentSaving ? "Đang lưu..." : "Lưu bài tập"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL HUB ĐIỀU PHỐI 5 PHƯƠNG THỨC TẠO BÀI TẬP & SOẠN CÂU HỎI
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
                      : `Soạn câu hỏi mới vào ngân hàng câu hỏi`}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chọn 1 trong 5 phương thức khởi tạo thông minh dưới đây:
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

            {/* Danh sách 5 phương thức */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Cách 1: Tạo đề thủ công */}
              <button
                type="button"
                onClick={() => {
                  setCreationHubOpen(false);
                  setManualExamModalOpen(true);
                }}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-600 bg-white dark:bg-slate-800/60 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Edit3 size={18} />
                </div>
                <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                    1. Tạo đề thủ công
                </strong>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                    Chọn câu hỏi trong ngân hàng, sắp xếp thành đề thi và cấu hình thời lượng, hạn nộp.
                </p>
              </button>

              {/* Cách 2: Quét đề bằng AI OCR */}
              <button
                type="button"
                onClick={() => {
                  setCreationHubOpen(false);
                  setScanModalOpen(true);
                }}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600 bg-white dark:bg-slate-800/60 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Scan size={18} />
                </div>
                <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  2. Quét đề thông minh (AI OCR)
                </strong>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Tải ảnh đề thi chụp thực tế, AI tự động quét nhận diện và bóc tách toàn bộ câu hỏi đối chiếu với ảnh gốc.
                </p>
              </button>

              {/* Cách 3: Tạo đề bằng AI */}
              <button
                type="button"
                onClick={() => {
                  setCreationHubOpen(false);
                  setAiExamModalOpen(true);
                }}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 bg-white dark:bg-slate-800/60 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Wand2 size={18} />
                </div>
                <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  3. Tạo đề bằng AI
                </strong>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Chỉ cần nhập môn học và chủ đề bài học, AI tự động sinh đề trắc nghiệm chuẩn kiến thức kèm lời giải đầy đủ.
                </p>
              </button>

              {/* Cách 4: Soạn đề thi từ ngân hàng câu hỏi */}
              <button
                type="button"
                onClick={() => {
                  setCreationHubOpen(false);
                  setManualExamModalOpen(true);
                }}
                className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-amber-400 dark:hover:border-amber-600 bg-white dark:bg-slate-800/60 hover:bg-amber-50/50 dark:hover:bg-amber-950/30 text-left transition space-y-2 cursor-pointer group shadow-2xs"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                  <Layers size={18} />
                </div>
                <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                  4. Soạn đề từ Ngân hàng câu hỏi
                </strong>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Chọn lọc từ các câu hỏi có sẵn trong ngân hàng để đóng gói thành bài kiểm tra 15p, 45p hoặc giữa kỳ.
                </p>
              </button>

              {/* Cách 5: Tạo bài tập đa năng (AssignmentBuilderModal) */}
              <button
                type="button"
                onClick={() => {
                  setCreationHubOpen(false);
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
                      5. Tạo bài tập đa năng (AI tách câu Word/PDF & Tự luận)
                    </strong>
                    <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                      Khuyến nghị cho bài tập tổng hợp và tự luận
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  Tải tệp Word/PDF có sẵn để AI tự tách câu hỏi, hoặc tạo bài tập tự luận với rubric chấm điểm và cấu hình nộp bài nâng cao.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CÁCH 1: MODAL SOẠN CÂU HỎI THỦ CÔNG
          ========================================================================= */}
      {authoringModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                <span>Soạn câu hỏi thủ công</span>
              </h3>
              <button
                type="button"
                onClick={() => setAuthoringModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
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
                Câu hỏi mới được lưu dạng nháp trong ngân hàng. Sau khi duyệt, có thể dùng câu hỏi để tạo đề thi.
              </p>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setAuthoringModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
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
      )}

      {/* =========================================================================
          CÁCH 2: MODAL QUÉT ĐỀ THÔNG MINH BẰNG AI (OCR)
          ========================================================================= */}
      {scanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Scan size={18} className="text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Quét đề thi thông minh (AI OCR & Đối chiếu)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setScanModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid md:grid-cols-2 gap-6">
              {/* Cột trái: Tệp ảnh đề thi gốc */}
              <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-0 md:pr-6 text-xs">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-600 block">
                  Vùng 1: Ảnh chụp hoặc Tệp đề thi gốc
                </span>

                <div className="border-2 border-dashed border-indigo-200 dark:border-indigo-900/60 rounded-2xl p-6 text-center space-y-2 bg-indigo-50/20 dark:bg-indigo-950/20">
                  <ImageIcon size={32} className="mx-auto text-indigo-500" />
                  <p className="font-bold text-slate-700 dark:text-slate-200">
                    {scanFile?.name ?? "Chưa chọn ảnh đề thi"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {scanFile ? (scanFile.size / 1024 / 1024).toFixed(2) + " MB" : "Chọn một ảnh đề thi để quét."}
                  </p>
                </div>

                <div className="space-y-2">
                  <label htmlFor="scan-exam-file" className="block text-xs font-bold text-slate-700 dark:text-slate-300">Ảnh đề thi (tối đa 12 MB):</label>
                  <input id="scan-exam-file" type="file" accept="image/*"
                    disabled={scanSaving || scanStatus === "SCANNING"}
                    onChange={(event) => {
                      setScanFile(event.target.files?.[0] ?? null);
                      setScanStatus("IDLE");
                      setScannedExamQuestions([]);
                      setScanProviderLabel("");
                    }}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 p-2" />
                  {scanProviderLabel && <p className="text-slate-500">Đã nhận diện bằng: {scanProviderLabel}</p>}
                </div>

                <button
                  type="button"
                  onClick={handleTriggerScanExam}
                  disabled={scanStatus === "SCANNING" || scanSaving || !scanFile}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Scan size={15} />
                  <span>
                    {scanStatus === "SCANNING" ? "Đang quét và bóc tách..." : "Bắt đầu quét AI"}
                  </span>
                </button>
              </div>

              {/* Cột phải: Kết quả bóc tách câu hỏi & đáp án */}
              <div className="space-y-3 text-xs overflow-y-auto max-h-[460px]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 block">
                    Vùng 2: Kết quả bóc tách ({scannedExamQuestions.length} câu)
                  </span>
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                    {scanStatus === "DONE" ? "Cần kiểm tra đáp án" : "Chưa có kết quả"}
                  </span>
                </div>

                <div className="space-y-3">
                  {scannedExamQuestions.map((q, index) => (
                    <div
                      key={index}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850 space-y-2"
                    >
                      <strong className="block font-bold text-slate-800 dark:text-slate-200">
                        {q.content}
                      </strong>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        {q.options.map((opt, optIdx) => {
                          const prefix = String.fromCharCode(65 + optIdx);
                          const isCorrect = q.correctAnswers.includes(opt);
                          return (
                            <div
                              key={optIdx}
                              className={`p-1.5 rounded-lg text-[11px] flex items-center gap-1.5 border ${
                                isCorrect
                                  ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-bold"
                                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                              }`}
                            >
                              <span className="font-bold">{prefix}.</span>
                              <span className="truncate">{opt}</span>
                            </div>
                          );
                        })}
                      </div>
                      {q.correctAnswers.length > 0 && <p className="text-[11px] text-emerald-700">Đáp án nhận diện: {q.correctAnswers.join("; ")}</p>}
                      <p className="text-[11px] text-slate-500">Độ tin cậy: {Math.round(q.confidence * 100)}%</p>
                      {q.warnings.map((warning, warningIndex) => <p key={warningIndex} className="text-[11px] text-amber-700">{warning}</p>)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setScanModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleSaveScannedExam}
                disabled={scanSaving || scanStatus !== "DONE" || !scannedExamQuestions.length}
                className="px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 transition cursor-pointer"
              >
                {scanSaving ? "Đang nhập..." : "Nhập câu hỏi nháp vào ngân hàng"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CÁCH 3: MODAL TẠO ĐỀ THÔNG MINH BẰNG AI
          ========================================================================= */}
      {aiExamModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Wand2 size={18} className="text-emerald-600" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Tạo đề thi trắc nghiệm bằng AI
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAiExamModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Môn học:
                  </label>
                  <select
                    value={aiSubject}
                    onChange={(e) => setAiSubject(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-semibold"
                  >
                    <option value="Toán học">Toán học</option>
                    <option value="Vật lý">Vật lý</option>
                    <option value="Hóa học">Hóa học</option>
                    <option value="Sinh học">Sinh học</option>
                    <option value="Tiếng Anh">Tiếng Anh</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Chuyên đề / Bài học:
                  </label>
                  <input
                    type="text"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="Ví dụ: Hàm số, Hình học không gian..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Số lượng câu hỏi:
                  </label>
                  <select
                    value={aiQuestionCount}
                    onChange={(e) => setAiQuestionCount(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value={5}>5 câu hỏi nhanh</option>
                    <option value={10}>10 câu hỏi chuẩn</option>
                    <option value={20}>20 câu hỏi kiểm tra</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Độ khó:
                  </label>
                  <select
                    value={aiDifficulty}
                    onChange={(e) => setAiDifficulty(e.target.value as typeof aiDifficulty)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="EASY">Cơ bản (Nhận biết)</option>
                    <option value="MEDIUM">Thông hiểu</option>
                    <option value="HARD">Vận dụng & Phân hóa</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleTriggerAiExamGen}
                disabled={aiGenerating}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Sparkles size={15} />
                <span>{aiGenerating ? "AI đang suy nghĩ và sinh câu hỏi..." : "Bắt đầu tạo đề AI"}</span>
              </button>

              {aiGeneratedExam && (
                <div className="space-y-2 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/20 p-4" role="status">
                  <strong className="block text-emerald-700 dark:text-emerald-300">
                    Đã tạo đề nháp: {aiGeneratedExam.exam.title}
                  </strong>
                  <p>{aiGeneratedExam.generatedQuestionCount} câu hỏi đã được lưu. Kiểm tra và gửi duyệt trước khi xuất bản.</p>
                  <p>Trạng thái: {aiGeneratedExam.exam.status} · Nguồn AI: {aiGeneratedExam.provider} / {aiGeneratedExam.model}</p>
                  {aiGeneratedExam.context.materialNames.length > 0 && (
                    <p>Tài liệu tham chiếu: {aiGeneratedExam.context.materialNames.join(", ")}</p>
                  )}
                  {aiGeneratedExam.warnings.map((warning, index) => (
                    <p key={index} className="text-amber-700 dark:text-amber-300">{warning}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setAiExamModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: CHỈNH SỬA CÂU HỎI TRONG NGÂN HÀNG CÂU HỎI LỚP
          ========================================================================= */}
      {editingQuestionModalOpen && editingQuestionData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Edit3 size={18} className="text-blue-600" />
                <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  Chỉnh sửa câu hỏi ngân hàng lớp
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionModalOpen(false);
                  setEditingQuestionData(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
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

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hướng dẫn giải chi tiết / Gợi ý:
                </label>
                <textarea
                  rows={2}
                  value={editingQuestionData.solution}
                  onChange={(e) =>
                    setEditingQuestionData({ ...editingQuestionData, solution: e.target.value })
                  }
                  placeholder="Nhập hướng dẫn giải, kiến thức áp dụng..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nguồn câu hỏi / Xuất xứ đề:
                </label>
                <input
                  type="text"
                  value={editingQuestionData.source}
                  onChange={(e) =>
                    setEditingQuestionData({ ...editingQuestionData, source: e.target.value })
                  }
                  placeholder="Ví dụ: Đề kiểm tra giữa kỳ 1, Tách từ Word..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionModalOpen(false);
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
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-indigo-50/30 dark:bg-indigo-950/20">
              <div className="flex items-center gap-2">
                <FileCheck2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Tạo đề thi / bài tập từ Ngân hàng câu hỏi
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Ngân hàng lớp hiện có {classQuestions.length} câu ({classQuestionStats.multipleChoice} trắc nghiệm, {classQuestionStats.essay} tự luận)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualExamModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
              {/* Thông tin chung */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tiêu đề bài kiểm tra / bài tập <span className="text-rose-500">*</span>:
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Kiểm tra 15 phút Toán học số 1..."
                    value={manualExamTitle}
                    onChange={(e) => setManualExamTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-medium"
                  />
                </div>

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
              </div>

              <div>
                <label htmlFor="manual-exam-due-at" className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hạn đóng đề (để trống: sau 7 ngày):
                </label>
                <input
                  id="manual-exam-due-at"
                  type="datetime-local"
                  value={manualExamDueAt}
                  onChange={(event) => setManualExamDueAt(event.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

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
                  NỘI DUNG KIỂU 1: GIÁO VIÊN CHỌN THỦ CÔNG
                  ================================================================= */}
              {examCreationMode === "MANUAL" && (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-700 dark:text-slate-300">
                        Chọn câu hỏi ({manualExamSelectedQuestions.length}/{publishedClassQuestions.length} câu đã xuất bản):
                      </span>
                      <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg text-[11px]">
                        {(["ALL", "MULTIPLE_CHOICE", "ESSAY"] as const).map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            onClick={() => setManualExamFilterScope(sc)}
                            className={`px-2 py-0.5 rounded-md font-semibold cursor-pointer ${
                              manualExamFilterScope === sc
                                ? "bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-2xs"
                                : "text-slate-500"
                            }`}
                          >
                            {sc === "ALL" ? "Tất cả" : sc === "MULTIPLE_CHOICE" ? "Trắc nghiệm" : "Tự luận"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const visibleIds = manualExamVisibleQuestions.map((question) => question.id);
                        setManualExamSelectedQuestions((selected) => toggleVisibleExamQuestions(selected, visibleIds));
                      }}
                      disabled={manualExamVisibleQuestions.length === 0}
                      className="text-indigo-600 font-bold hover:underline cursor-pointer"
                    >
                      {manualExamAllVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {manualExamVisibleQuestions
                      .map((q) => {
                        const isSelected = manualExamSelectedQuestions.includes(q.id);
                        return (
                          <label
                            key={q.id}
                            className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer transition ${
                              isSelected
                                ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30"
                                : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setManualExamSelectedQuestions((selected) =>
                                    selected.includes(q.id) ? selected : [...selected, q.id]
                                  );
                                } else {
                                  setManualExamSelectedQuestions(
                                    (selected) => selected.filter((id) => id !== q.id)
                                  );
                                }
                              }}
                              className="mt-0.5 rounded text-indigo-600 accent-indigo-600"
                            />
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {q.type}
                                </span>
                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                                  {q.difficulty}
                                </span>
                                <span className="text-[10px] text-slate-400">Nguồn: {q.source}</span>
                              </div>
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{q.content}</p>
                            </div>
                          </label>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* =================================================================
                  NỘI DUNG KIỂU 2: CHỌN MỐC RỒI ĐỂ AI CHỌN
                  ================================================================= */}
              {examCreationMode === "AI_CRITERIA" && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Tổng số lượng câu hỏi trong đề:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, publishedClassQuestions.length)}
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
                        Phạm vi câu hỏi:
                      </label>
                      <select
                        value={aiCriteriaScope}
                        onChange={(e) => {
                          setAiCriteriaScope(e.target.value as typeof aiCriteriaScope);
                          setAiCriteriaPreviewList([]);
                        }}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                      >
                        <option value="ALL">Tất cả (Trắc nghiệm & Tự luận)</option>
                        <option value="MULTIPLE_CHOICE">Chỉ trắc nghiệm</option>
                        <option value="ESSAY">Chỉ tự luận</option>
                      </select>
                    </div>
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

                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={handleTriggerAiCriteriaSelection}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Sparkles size={14} />
                      <span>Lọc câu hỏi & Xem trước</span>
                    </button>
                    {aiCriteriaPreviewIsCurrent && (
                      <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        ✓ Đã chọn {aiCriteriaPreviewList.length} câu hỏi theo mốc
                      </span>
                    )}
                  </div>

                  {/* Danh sách câu hỏi AI đã lọc để giáo viên kiểm tra */}
                  {aiCriteriaPreviewIsCurrent && (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                      {aiCriteriaPreviewList.map((q, idx) => (
                        <div
                          key={q.id || idx}
                          className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/20 space-y-1"
                        >
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
                          <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                            {q.content}
                          </p>
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
                  NỘI DUNG KIỂU 3: BỐC NGẪU NHIÊN CÂU HỎI
                  ================================================================= */}
              {examCreationMode === "RANDOM" && (
                <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Số lượng câu cần bốc ngẫu nhiên:
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, publishedClassQuestions.length)}
                        value={randomQuestionCount}
                        onChange={(e) => setRandomQuestionCount(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Phạm vi bốc câu hỏi:
                      </label>
                      <select
                        value={randomTypeScope}
                        onChange={(e) => setRandomTypeScope(e.target.value as typeof randomTypeScope)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                      >
                        <option value="ALL">Tất cả câu hỏi ({publishedQuestionStats.total} câu)</option>
                        <option value="MULTIPLE_CHOICE">Chỉ trắc nghiệm ({publishedQuestionStats.multipleChoice} câu)</option>
                        <option value="ESSAY">Chỉ tự luận ({publishedQuestionStats.essay} câu)</option>
                      </select>
                    </div>
                  </div>

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
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setManualExamModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Hủy
              </button>

              {examCreationMode === "MANUAL" && (
                <button
                  type="button"
                  onClick={handleCreateExamManual}
                   disabled={examSaving || manualExamSelectedQuestions.length === 0}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs cursor-pointer disabled:opacity-40"
                >
                   {examSaving ? "Đang tạo đề..." : `Tạo đề thi thủ công (${manualExamSelectedQuestions.length} câu)`}
                </button>
              )}

              {examCreationMode === "AI_CRITERIA" && (
                <button
                  type="button"
                  onClick={handleCreateExamAiCriteria}
                   disabled={examSaving || !aiCriteriaPreviewIsCurrent}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs cursor-pointer"
                >
                   {examSaving ? "Đang tạo đề..." : "Xác nhận & Tạo đề thi theo ma trận"}
                </button>
              )}

              {examCreationMode === "RANDOM" && (
                <button
                  type="button"
                  onClick={handleCreateExamRandom}
                   disabled={examSaving}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-xs cursor-pointer"
                >
                   {examSaving ? "Đang tạo đề..." : "Bốc ngẫu nhiên & Tạo đề thi"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Di chuyển Bài giảng / Tài liệu sang lớp khác hoặc Cần phân cấp lại */}
      {moveItemModalOpen && itemForMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FolderInput size={20} className="text-amber-600" />
              <span>Di chuyển {itemForMove.kind === "LECTURE" ? "bài giảng" : "tài liệu"}</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Chọn thư mục / lớp đích để chuyển <strong className="text-slate-900 dark:text-slate-100">&quot;{itemForMove.title}&quot;</strong>:
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Thư mục / Lớp đích:
              </label>
              <select
                value={targetDestinationClassId}
                onChange={(e) => setTargetDestinationClassId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-1 focus:ring-blue-500 cursor-pointer"
              >
                <option value="unclassified">📍 Cần phân cấp lại (Chưa phân loại)</option>
                {allInstructorClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    📁 {cls.name} ({cls.code})
                  </option>
                ))}
              </select>
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
                onClick={handleConfirmMoveItem}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs cursor-pointer"
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

