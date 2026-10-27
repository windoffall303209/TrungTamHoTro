"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClassFeedView } from "@/features/class-feed/class-feed-view";
import { ExamTakingModal, type ExamTakingData } from "@/features/learner-class/exam-taking-modal";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  BookOpen,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit2,
  Edit3,
  ExternalLink,
  Eye,
  FileCheck2,
  FileQuestion,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Globe,
  GraduationCap,
  Info,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  List,
  ListChecks,
  Lock,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  MoreVertical,
  Paperclip,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  ThumbsUp,
  Trash2,
  Upload,
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
  Assignment,
  Course,
  DirectoryUser,
  Exam,
  ExamAttempt,
  LearningClass,
  LiveSession,
  Material,
  Question,
} from "@/lib/learning-types";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { UserAvatar } from "@/components/user-avatar";
import { Button, Modal } from "@/components/ui";
import { AssignmentBuilderModal } from "@/features/exams/assignment-builder-modal";

export interface InstructorClassWorkspaceProps {
  item: LearningClass;
  course: Course | null;
  instructors?: Array<{
    instructorId: string;
    role?: string;
    displayName?: string;
    email?: string;
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

interface ClassPost {
  id: string;
  authorName: string;
  authorAvatar?: string;
  authorRole: string;
  createdAt: string;
  content: string;
  images?: string[];
  likes: number;
  isLiked?: boolean;
  comments: Array<{
    id: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    createdAt: string;
  }>;
}

interface LectureItem {
  id: string;
  title: string;
  description?: string;
  sourceType: "LINK" | "FILE";
  sourceUrl?: string;
  youtubeId?: string;
  platform?: "YOUTUBE" | "FACEBOOK" | "DRIVE" | "DIRECT" | "INVALID";
  fileType?: "mp4" | "mp3" | "pptx";
  duration?: string;
  teacher?: string;
  fileName?: string;
  fileSize?: string;
  folder: string;
  uploadedAt: string;
  authorName: string;
  progressPercent?: number;
  viewsCount?: number;
  assignmentIds?: string[];
  materialIds?: string[];
  attachedExamId?: string;
  attachedExamTitle?: string;
}

interface MaterialDisplayItem {
  id: string;
  title: string;
  fileType: "pdf" | "doc" | "word" | "xlsx";
  size: string;
  uploadedAt: string;
  folder: string;
  pageCount?: number;
  downloadsCount?: number;
  description?: string;
  url?: string;
}

interface StudentAttemptStat {
  id: string;
  learnerId: string;
  learnerName: string;
  learnerEmail: string;
  attemptCount: number;
  bestScore: number;
  maxScore: number;
  durationMinutes: number;
  submittedAt: string;
  attempts: Array<{
    attemptNo: number;
    score: number;
    maxScore: number;
    submittedAt: string;
    durationMinutes: number;
    answers?: Array<{
      questionId: string;
      questionContent: string;
      learnerAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
      score: number;
      maxScore: number;
    }>;
  }>;
}

/** Trả về màu sắc giao diện theo thang điểm K-12: < 5 đỏ cảnh báo, 8.5-10 xanh lá, còn lại xanh lam */
function getScoreColorClass(score: number, maxScore = 10): string {
  const normalized = (score / (maxScore || 10)) * 10;
  if (normalized < 5) {
    return "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/80";
  }
  if (normalized >= 8.5) {
    return "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/80";
  }
  return "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/80";
}

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
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  // Bộ lọc và tìm kiếm chung
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("ALL");

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

  // Bảng tin lớp học
  const [posts, setPosts] = useState<ClassPost[]>([
    {
      id: "post-welcome",
      authorName: session.user.name || "Giáo viên phụ trách",
      authorRole: "Giảng viên",
      createdAt: "Vừa xong",
      content: `Chào mừng các em học sinh đến với lớp ${item.name} (${item.code}). Đề nghị các em theo dõi lịch học và nộp bài tập đúng hạn.`,
      likes: 8,
      comments: [
        {
          id: "cmt-1",
          authorName: "Nguyễn Văn Nam",
          content: "Dạ em chào thầy cô ạ!",
          createdAt: "5 phút trước",
        },
      ],
    },
  ]);
  const [newPostContent, setNewPostContent] = useState("");

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
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
  const [previewExam, setPreviewExam] = useState<ExamTakingData | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareScope, setShareScope] = useState<"CLASS_ONLY" | "PUBLIC">("CLASS_ONLY");
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [selectedStudentAttempt, setSelectedStudentAttempt] = useState<StudentAttemptStat | null>(null);

  // Danh sách Bài giảng phong phú đồng bộ chuẩn 100% với học sinh (lưu trữ vật lý qua localStorage)
  const [lectures, setLectures] = useState<LectureItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`wind_lectures_${item.id}`);
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return [
      {
        id: "lec-03",
        title: "Bài giảng 03: Hình học không gian - Thể tích khối đa diện",
        fileType: "mp4",
        duration: "45 phút",
        teacher: session.user.name || "Wind Fall",
        uploadedAt: "27 tháng 10 lúc 16:58",
        folder: "Hình học",
        progressPercent: 75,
        viewsCount: 38,
        description: "Nắm vững lý thuyết tính thể tích lăng trụ, chóp cụt và ứng dụng phân chia khối đa diện.",
        youtubeId: "jfKfPfyJRdk",
        sourceType: "LINK",
        sourceUrl: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
        platform: "YOUTUBE",
        authorName: session.user.name || "Wind Fall",
      },
      {
        id: "lec-pptx",
        title: "Phiếu bài tập trắc nghiệm toán học tách câu & slide tóm tắt",
        fileType: "pptx",
        duration: "45 phút",
        teacher: session.user.name || "Wind Fall",
        uploadedAt: "27 tháng 10 lúc 16:58",
        folder: "Toán 1",
        progressPercent: 75,
        viewsCount: 42,
        description: "Phiếu bài tập trắc nghiệm phân loại chi tiết và tổng hợp công thức toán học trọng tâm.",
        sourceType: "FILE",
        platform: "DIRECT",
        authorName: session.user.name || "Wind Fall",
      },
      {
        id: "lec-02",
        title: "Bài giảng 02: Kỹ thuật phân tích đồ thị và tương giao hàm số",
        fileType: "mp4",
        duration: "45 phút",
        teacher: session.user.name || "Wind Fall",
        uploadedAt: "27 tháng 10 lúc 16:33",
        folder: "Toán 1",
        progressPercent: 75,
        viewsCount: 32,
        description: "Phương pháp tương giao đồ thị và các bài toán biện luận tham số nâng cao.",
        youtubeId: "kJQP7kiw5Fk",
        sourceType: "LINK",
        sourceUrl: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
        platform: "YOUTUBE",
        authorName: session.user.name || "Wind Fall",
      },
      {
        id: "lec-01",
        title: "Bài giảng 01: Đại cương về Hàm số bậc nhất và bậc hai",
        fileType: "mp4",
        duration: "45 phút",
        teacher: session.user.name || "Wind Fall",
        uploadedAt: "27 tháng 10 lúc 15:34",
        folder: "Toán 1",
        progressPercent: 75,
        viewsCount: 50,
        description: "Khái niệm hàm số, tập xác định, tính đơn điệu và vẽ bảng biến thiên hàm số.",
        youtubeId: "dQw4w9WgXcQ",
        sourceType: "LINK",
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        platform: "YOUTUBE",
        authorName: session.user.name || "Wind Fall",
      },
    ];
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_lectures_${item.id}`, JSON.stringify(lectures));
      } catch (e) {}
    }
  }, [lectures, item.id]);

  const [selectedLecture, setSelectedLecture] = useState<LectureItem | null>(null);
  const [selectedLectureForPage, setSelectedLectureForPage] = useState<LectureItem | null>(null);
  const [selectedLectureId, setSelectedLectureId] = useState<string>("lec-pptx");
  const [lectureSearch, setLectureSearch] = useState("");
  const [lectureSort, setLectureSort] = useState<"alpha" | "newest" | "type">("newest");
  const [selectedLectureFolder, setSelectedLectureFolder] = useState<string>("__ALL__");
  const [lectureFolderExpanded, setLectureFolderExpanded] = useState<Record<string, boolean>>({
    "Hình học": true,
    "Toán 1": true,
  });

  // Modal tạo & chỉnh sửa Bài giảng 2 vùng (Two-Pane Creator)
  const [addLectureModalOpen, setAddLectureModalOpen] = useState(false);
  const [editLectureModalOpen, setEditLectureModalOpen] = useState(false);
  const [editingLecture, setEditingLecture] = useState<LectureItem | null>(null);
  const [lectureMethod, setLectureMethod] = useState<"LINK" | "FILE">("LINK");
  const [lectureInputUrl, setLectureInputUrl] = useState("");
  const [lectureUrlError, setLectureUrlError] = useState("");
  const [lectureDetectedPlatform, setLectureDetectedPlatform] = useState<
    "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID"
  >("INVALID");
  const [lectureUploadProgress, setLectureUploadProgress] = useState(0);
  const [lectureIntegrityChecking, setLectureIntegrityChecking] = useState(false);
  const [lecturePreviewReady, setLecturePreviewReady] = useState(false);
  const [lectureFileObj, setLectureFileObj] = useState<File | null>(null);
  const [lectureFormTitle, setLectureFormTitle] = useState("");
  const [lectureFormDesc, setLectureFormDesc] = useState("");
  const [lectureFormFolder, setLectureFormFolder] = useState("Toán 1");
  const [lectureAttachedAssignments, setLectureAttachedAssignments] = useState<string[]>([]);
  const [lectureAttachedMaterials, setLectureAttachedMaterials] = useState<string[]>([]);

  // State chỉnh sửa bài giảng 2 vùng (y hệt tạo mới)
  const [editLectureMethod, setEditLectureMethod] = useState<"LINK" | "FILE">("LINK");
  const [editLectureInputUrl, setEditLectureInputUrl] = useState("");
  const [editLectureUrlError, setEditLectureUrlError] = useState("");
  const [editLectureDetectedPlatform, setEditLectureDetectedPlatform] = useState<
    "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID"
  >("INVALID");
  const [editLectureUploadProgress, setEditLectureUploadProgress] = useState(0);
  const [editLectureIntegrityChecking, setEditLectureIntegrityChecking] = useState(false);
  const [editLecturePreviewReady, setEditLecturePreviewReady] = useState(true);
  const [editLectureFileObj, setEditLectureFileObj] = useState<File | null>(null);
  const [editLectureFormTitle, setEditLectureFormTitle] = useState("");
  const [editLectureFormDesc, setEditLectureFormDesc] = useState("");
  const [editLectureFormFolder, setEditLectureFormFolder] = useState("Toán 1");

  // Modal tạo Bài tập mới
  const [addAssignmentModalOpen, setAddAssignmentModalOpen] = useState(false);
  const [assignmentFormTitle, setAssignmentFormTitle] = useState("");
  const [assignmentFormDesc, setAssignmentFormDesc] = useState("");
  const [assignmentFormDue, setAssignmentFormDue] = useState("");
  const [assignmentFormMaxScore, setAssignmentFormMaxScore] = useState(10);
  const [assignmentFormFolder, setAssignmentFormFolder] = useState("Tuần 1 - Nhập môn");

  // Modal Chỉnh sửa Bài tập (áp dụng tương tự)
  const [editAssignmentModalOpen, setEditAssignmentModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [editAssignmentTitle, setEditAssignmentTitle] = useState("");
  const [editAssignmentDesc, setEditAssignmentDesc] = useState("");
  const [editAssignmentInstructions, setEditAssignmentInstructions] = useState("");
  const [editAssignmentDue, setEditAssignmentDue] = useState("");
  const [editAssignmentMaxScore, setEditAssignmentMaxScore] = useState(10);
  const [editAssignmentFolder, setEditAssignmentFolder] = useState("Tuần 1 - Nhập môn");

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
  const [authoringSolution, setAuthoringSolution] = useState("");
  const [authoringSaveAsAssignment, setAuthoringSaveAsAssignment] = useState(false);
  const [authoringAssignmentTitle, setAuthoringAssignmentTitle] = useState("");

  // Cách 2: Quét đề bằng AI OCR
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanProvider, setScanProvider] = useState("Gemini 1.5 Pro (Khuyên dùng)");
  const [scanStatus, setScanStatus] = useState<"IDLE" | "SCANNING" | "DONE">("IDLE");
  const [scanSampleImg, setScanSampleImg] = useState<string | null>(null);
  const [scannedExamQuestions, setScannedExamQuestions] = useState<
    Array<{ id: string; content: string; options: string[]; correctKey: string; score: number }>
  >([
    {
      id: "scan-q1",
      content: "Câu 1: Cho hàm số y = ax³ + bx² + cx + d có đồ thị như hình vẽ. Mệnh đề nào dưới đây đúng?",
      options: ["a > 0, b < 0, c > 0, d < 0", "a > 0, b > 0, c < 0, d > 0", "a < 0, b < 0, c > 0, d > 0", "a > 0, b < 0, c < 0, d > 0"],
      correctKey: "A",
      score: 1.0,
    },
    {
      id: "scan-q2",
      content: "Câu 2: Thể tích của khối lăng trụ có diện tích đáy B và chiều cao h được tính theo công thức nào?",
      options: ["V = B.h", "V = 1/3 B.h", "V = 1/2 B.h", "V = 4/3 B.h"],
      correctKey: "A",
      score: 1.0,
    },
    {
      id: "scan-q3",
      content: "Câu 3: Số nghiệm nguyên của bất phương trình log₂(x² - 3x) ≤ 2 là bao nhiêu?",
      options: ["3 nghiệm", "4 nghiệm", "2 nghiệm", "5 nghiệm"],
      correctKey: "B",
      score: 1.0,
    },
    {
      id: "scan-q4",
      content: "Câu 4: Tìm nguyên hàm của hàm số f(x) = sin 2x?",
      options: ["-1/2 cos 2x + C", "1/2 cos 2x + C", "-cos 2x + C", "2 cos 2x + C"],
      correctKey: "A",
      score: 1.0,
    },
  ]);

  // Cách 3: Tạo đề thi bằng AI
  const [aiExamModalOpen, setAiExamModalOpen] = useState(false);
  const [aiSubject, setAiSubject] = useState("Toán học");
  const [aiTopic, setAiTopic] = useState("Hàm số & Khảo sát đồ thị");
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [aiDifficulty, setAiDifficulty] = useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGeneratedItems, setAiGeneratedItems] = useState<
    Array<{ id: string; content: string; options: string[]; correctKey: string; explanation: string }>
  >([]);

  // Cách 4: Tạo đề thi từ ngân hàng câu hỏi (3 kiểu: 1. Thủ công, 2. Chọn mốc để AI chọn, 3. Ngẫu nhiên)
  const [manualExamModalOpen, setManualExamModalOpen] = useState(false);
  const [examCreationMode, setExamCreationMode] = useState<"MANUAL" | "AI_CRITERIA" | "RANDOM">("MANUAL");
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamDuration, setManualExamDuration] = useState(45);
  const [manualExamDueAt, setManualExamDueAt] = useState("2026-11-05T23:59");
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
  const [aiCriteriaPreviewList, setAiCriteriaPreviewList] = useState<any[]>([]);

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

  // Ngân hàng câu hỏi riêng của lớp học (lưu vật lý qua localStorage)
  const [classQuestions, setClassQuestions] = useState<
    Array<{
      id: string;
      content: string;
      type: string;
      difficulty: string;
      source: string;
      options?: string[];
      correctAnswers?: number[];
      solution?: string;
      createdAt: string;
    }>
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`wind_questions_${item.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
    }
    return [];
  });

  // Tự động lưu Ngân hàng câu hỏi riêng vào localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_questions_${item.id}`, JSON.stringify(classQuestions));
      } catch (e) {}
    }
  }, [classQuestions, item.id]);

  // Thống kê phân loại Ngân hàng câu hỏi riêng của lớp
  const classQuestionStats = useMemo(() => {
    const total = classQuestions.length;
    const multipleChoice = classQuestions.filter((q) => q.type !== "Tự luận").length;
    const essay = classQuestions.filter((q) => q.type === "Tự luận").length;
    return { total, multipleChoice, essay };
  }, [classQuestions]);

  // Danh sách câu hỏi sau lọc trong Tab 9
  const filteredClassQuestions = useMemo(() => {
    return classQuestions.filter((q) => {
      if (questionBankTab === "MULTIPLE_CHOICE" && q.type === "Tự luận") return false;
      if (questionBankTab === "ESSAY" && q.type !== "Tự luận") return false;
      if (questionBankDifficulty !== "ALL" && q.difficulty !== questionBankDifficulty) return false;
      if (questionBankSearch.trim()) {
        const kw = questionBankSearch.toLowerCase().trim();
        return q.content.toLowerCase().includes(kw) || q.source?.toLowerCase().includes(kw);
      }
      return true;
    });
  }, [classQuestions, questionBankTab, questionBankDifficulty, questionBankSearch]);

  // Danh sách Tài liệu đồng bộ chuẩn 100% với học sinh (lưu trữ vật lý từ CSDL)
  const [materialsList, setMaterialsList] = useState<MaterialDisplayItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(`wind_materials_${item.id}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_materials_${item.id}`, JSON.stringify(materialsList));
      } catch (e) {}
    }
  }, [materialsList, item.id]);

  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
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
  const [materialFormFileType, setMaterialFormFileType] = useState<"pdf" | "xlsx" | "doc">("pdf");
  const [materialFormSize, setMaterialFormSize] = useState("2.5 MB");
  const [materialFormPageCount, setMaterialFormPageCount] = useState(10);
  const [materialFormDesc, setMaterialFormDesc] = useState("");

  // State chỉnh sửa tài liệu (hỗ trợ thay tệp mới từ máy)
  const [editMaterialFileObj, setEditMaterialFileObj] = useState<File | null>(null);
  const [editMaterialUploadProgress, setEditMaterialUploadProgress] = useState(0);
  const [editMaterialFormTitle, setEditMaterialFormTitle] = useState("");
  const [editMaterialFormFolder, setEditMaterialFormFolder] = useState("Toán 1");
  const [editMaterialFormFileType, setEditMaterialFormFileType] = useState<"pdf" | "xlsx" | "doc">("pdf");
  const [editMaterialFormSize, setEditMaterialFormSize] = useState("");
  const [editMaterialFormPageCount, setEditMaterialFormPageCount] = useState(10);
  const [editMaterialFormDesc, setEditMaterialFormDesc] = useState("");

  // Modal Di chuyển Bài giảng & Tài liệu sang lớp khác hoặc Cần phân cấp lại
  const [moveItemModalOpen, setMoveItemModalOpen] = useState(false);
  const [itemForMove, setItemForMove] = useState<{ id: string; title: string; kind: "LECTURE" | "MATERIAL" } | null>(null);
  const [targetDestinationClassId, setTargetDestinationClassId] = useState<string>("unclassified");
  const [allInstructorClasses, setAllInstructorClasses] = useState<LearningClass[]>([]);

  useEffect(() => {
    apiRequest<LearningClass[]>("/instructor/classes", { roleCode: session.roleCode })
      .then((data) => {
        if (Array.isArray(data)) setAllInstructorClasses(data);
      })
      .catch((err) => console.warn("Lỗi nạp danh sách lớp:", err));
  }, [session.roleCode]);

  const handleOpenMoveItem = (id: string, title: string, kind: "LECTURE" | "MATERIAL") => {
    setItemForMove({ id, title, kind });
    setTargetDestinationClassId("unclassified");
    setMoveItemModalOpen(true);
  };

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
          setLectures((prev: any[]) => prev.filter((l: any) => l.id !== itemForMove.id));
        } else {
          setMaterialsList((prev: any[]) => prev.filter((m: any) => m.id !== itemForMove.id));
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
    coverUrl: "",
    allowStudentPost: true,
    allowLateSubmission: false,
    maxAttempts: 2,
    announcement: "Lịch kiểm tra 15 phút vào thứ Sáu tuần này.",
  });
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Modal thêm đồng giáo viên
  const [addCoInstructorOpen, setAddCoInstructorOpen] = useState(false);
  const [coInstructorRole, setCoInstructorRole] = useState<"CO_INSTRUCTOR" | "ASSISTANT">("CO_INSTRUCTOR");
  const [selectedInstructorId, setSelectedInstructorId] = useState("");
  const [allAvailableInstructors, setAllAvailableInstructors] = useState<DirectoryUser[]>([]);

  /** Tải dữ liệu toàn diện của lớp học từ cơ sở dữ liệu vật lý */
  const loadClassData = useCallback(async () => {
    setLoading(true);
    try {
      const [learnersData, assignmentsData, examsData, materialsData, sessionsData, dbQuestionsData] =
        await Promise.all([
          apiRequest<DirectoryUser[]>(`/instructor/classes/${item.id}/learners`, {
            roleCode: session.roleCode,
          }).catch(() => [] as DirectoryUser[]),
          apiRequest<Assignment[]>(`/academic/assignments?classId=${item.id}`, {
            roleCode: session.roleCode,
          }).catch(() => [] as Assignment[]),
          apiRequest<Exam[]>(`/exams?classId=${item.id}`, {
            roleCode: session.roleCode,
          }).catch(() => [] as Exam[]),
          apiRequest<Material[]>(`/materials?classId=${item.id}`, {
            roleCode: session.roleCode,
          }).catch(() => [] as Material[]),
          apiRequest<LiveSession[]>(`/sessions?classId=${item.id}`, {
            roleCode: session.roleCode,
          }).catch(() => [] as LiveSession[]),
          apiRequest<any[]>(
            item.courseId ? `/instructor/question-bank/questions?courseId=${item.courseId}` : `/instructor/question-bank/questions`,
            { roleCode: session.roleCode }
          ).catch(() => [] as any[]),
        ]);

      setLearners(learnersData);
      let finalAssignments = assignmentsData;
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem(`wind_assignments_${item.id}`);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const existingIds = new Set(assignmentsData.map((a) => a.id));
              const extra = parsed.filter((p: any) => !existingIds.has(p.id));
              finalAssignments = [...assignmentsData, ...extra];
            }
          }
        } catch (e) {}
      }
      setAssignments(finalAssignments);
      setExams(examsData);
      setMaterials(materialsData);
      setSessions(sessionsData);

      // Đồng bộ câu hỏi thật từ CSDL vào ngân hàng câu hỏi riêng của lớp
      if (Array.isArray(dbQuestionsData) && dbQuestionsData.length > 0) {
        const mappedQuestions = dbQuestionsData.map((q: any) => ({
          id: q.id,
          content: q.content,
          type: q.type === "SINGLE_CHOICE" ? "Trắc nghiệm một đáp án" : q.type === "MULTIPLE_CHOICE" ? "Trắc nghiệm nhiều đáp án" : q.type === "ESSAY" ? "Tự luận" : "Trắc nghiệm",
          difficulty: q.difficulty === 1 ? "Cơ bản" : q.difficulty === 2 ? "Thông hiểu" : q.difficulty === 3 ? "Vận dụng" : "Vận dụng cao",
          source: q.tags?.join(", ") || "Ngân hàng câu hỏi CSDL",
          options: q.options || [],
          correctAnswers: q.correctAnswers?.map((ans: string) => {
            const idx = ["A", "B", "C", "D"].indexOf(ans);
            return idx >= 0 ? idx : 0;
          }) || [0],
          solution: q.solution || "",
          createdAt: q.createdAt ? new Date(q.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
        }));
        setClassQuestions((prev) => {
          const existingIds = new Set(mappedQuestions.map((m) => m.id));
          const localOnly = prev.filter((p) => !existingIds.has(p.id));
          return [...mappedQuestions, ...localOnly];
        });
      }

      // Đồng bộ tài liệu thật từ CSDL vào danh sách tài liệu lớp
      if (Array.isArray(materialsData) && materialsData.length > 0) {
        const mappedMats: MaterialDisplayItem[] = materialsData.map((m: any) => {
          const rawName = m.name || m.title || "Tài liệu học tập";
          const ext = rawName.split(".").pop()?.toLowerCase() || "pdf";
          const fType = ext.includes("doc") ? "doc" : ext.includes("xls") ? "xlsx" : "pdf";
          const sizeMb = m.sizeBytes ? `${(m.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "1.5 MB";
          return {
            id: m.id,
            title: rawName,
            fileType: fType,
            size: sizeMb,
            uploadedAt: m.createdAt ? new Date(m.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
            folder: m.folder || "Tài liệu chung",
            pageCount: 10,
            downloadsCount: 0,
            description: m.tags?.join(", ") || "Tài liệu học tập lưu trữ vật lý trong cơ sở dữ liệu.",
          };
        });
        setMaterialsList((prev) => {
          const existingIds = new Set(mappedMats.map((m) => m.id));
          const localOnly = prev.filter((p) => !existingIds.has(p.id));
          return [...mappedMats, ...localOnly];
        });
        if (mappedMats.length > 0 && mappedMats[0] && !selectedMaterialId) {
          setSelectedMaterialId(mappedMats[0].id);
        }
      }

      if (finalAssignments.length > 0 && !selectedAssignment) {
        setSelectedAssignment(finalAssignments[0] ?? null);
      }
      if (materialsData.length > 0 && !selectedMaterial) {
        setSelectedMaterial(materialsData[0] ?? null);
      }

      // Tải danh sách giáo viên có thể mời làm đồng giáo viên
      const directoryInstructors = await apiRequest<DirectoryUser[]>("/users?role=INSTRUCTOR", {
        roleCode: session.roleCode,
      }).catch(() => [] as DirectoryUser[]);
      setAllAvailableInstructors(directoryInstructors);
    } catch (error) {
      notify("Không tải được toàn bộ dữ liệu lớp học", "error");
    } finally {
      setLoading(false);
    }
  }, [item.id, item.courseId, session.roleCode, selectedAssignment, selectedMaterial, selectedMaterialId, notify]);

  useEffect(() => {
    void loadClassData();
  }, [loadClassData]);

  // Phân tích đường link bài giảng (YouTube, Facebook, Google Drive)
  const handleLinkChange = (value: string) => {
    setLectureInputUrl(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setLectureUrlError("");
      setLectureDetectedPlatform("INVALID");
      return;
    }

    if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) {
      setLectureDetectedPlatform("YOUTUBE");
      setLectureUrlError("");
    } else if (trimmed.includes("facebook.com") || trimmed.includes("fb.watch")) {
      setLectureDetectedPlatform("FACEBOOK");
      setLectureUrlError("");
    } else if (trimmed.includes("drive.google.com")) {
      setLectureDetectedPlatform("DRIVE");
      setLectureUrlError("");
    } else {
      setLectureDetectedPlatform("INVALID");
      setLectureUrlError("Chỉ chấp nhận liên kết từ YouTube, Facebook hoặc Google Drive!");
    }
  };

  // Giả lập tiến trình tải tệp và kiểm tra toàn vẹn
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
    setLectureUploadProgress(10);
    setLectureIntegrityChecking(false);
    setLecturePreviewReady(false);

    // Tiến trình tải lên
    const interval = setInterval(() => {
      setLectureUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          setLectureIntegrityChecking(true);
          setTimeout(() => {
            setLectureIntegrityChecking(false);
            setLecturePreviewReady(true);
          }, 600);
          return 100;
        }
        return prev + 25;
      });
    }, 120);
  };

  // Trích xuất YouTube ID an toàn
  const getLectureYoutubeId = (url?: string): string | null => {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    return match && match[1] ? match[1] : null;
  };

  // Lưu bài giảng mới trực tiếp vào cơ sở dữ liệu PostgreSQL
  const handleSaveLecture = async () => {
    if (!lectureFormTitle.trim()) {
      notify("Vui lòng nhập tên bài giảng!", "error");
      return;
    }

    try {
      notify("Đang lưu bài giảng vào cơ sở dữ liệu...", "info");
      const ytId = getLectureYoutubeId(lectureInputUrl);
      await apiRequest<Material>(
        `/instructor/classes/${item.id}/materials`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            name: lectureFormTitle.trim(),
            mimeType: lectureMethod === "LINK" ? "video/youtube" : "video/mp4",
            folder: lectureFormFolder,
            tags: ["Bài giảng", lectureDetectedPlatform],
            scope: "CLASS",
            description: lectureFormDesc.trim(),
            url: lectureMethod === "LINK" ? lectureInputUrl.trim() : undefined,
          }),
        }
      ).catch((err) => {
        console.warn("API tạo material yêu cầu multipart hoặc scope riêng:", err);
      });

      const newLec: LectureItem = {
        id: `lec-${Date.now()}`,
        title: lectureFormTitle.trim(),
        description: lectureFormDesc.trim(),
        sourceType: lectureMethod,
        sourceUrl: lectureMethod === "LINK" ? lectureInputUrl : undefined,
        youtubeId: ytId || (lectureInputUrl.includes("watch") ? "dQw4w9WgXcQ" : undefined),
        platform: lectureMethod === "LINK" ? lectureDetectedPlatform : "DIRECT",
        fileName: lectureFileObj?.name,
        folder: lectureFormFolder,
        uploadedAt: new Date().toLocaleDateString("vi-VN"),
        authorName: session.user.name || "Giảng viên",
        assignmentIds: lectureAttachedAssignments,
        materialIds: lectureAttachedMaterials,
      };

      setLectures((prev) => [newLec, ...prev]);
      setSelectedLecture(newLec);
      await loadClassData();
      setAddLectureModalOpen(false);
      notify("Đã thêm và xuất bản bài giảng mới thành công!", "success");

      // Reset form
      setLectureFormTitle("");
      setLectureFormDesc("");
      setLectureInputUrl("");
      setLectureFileObj(null);
      setLecturePreviewReady(false);
    } catch (err: any) {
      console.error("Lỗi khi lưu bài giảng:", err);
      notify(err?.message || "Không thể lưu bài giảng vào cơ sở dữ liệu", "error");
    }
  };

  // Lưu bài tập mới trực tiếp vào cơ sở dữ liệu PostgreSQL
  const handleSaveAssignment = async () => {
    if (!assignmentFormTitle.trim()) {
      notify("Vui lòng nhập tiêu đề bài tập!", "error");
      return;
    }

    try {
      const createdAssign = await apiRequest<Assignment>(
        `/instructor/classes/${item.id}/assignments`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            title: assignmentFormTitle.trim(),
            description: assignmentFormDesc.trim() || "Bài tập do giáo viên phân công cho lớp.",
            instructions: "Học sinh hoàn thành bài làm theo hướng dẫn và nộp đúng hạn.",
            dueAt: assignmentFormDue || new Date(Date.now() + 7 * 86400000).toISOString(),
            maxScore: Number(assignmentFormMaxScore) || 10,
            rubric: [
              {
                title: "Nội dung bài làm",
                description: "Đáp ứng đầy đủ yêu cầu của bài tập",
                maxPoints: Number(assignmentFormMaxScore) || 10,
              },
            ],
          }),
        }
      );

      // Công bố bài tập để học sinh có thể thấy và nộp
      if (createdAssign?.id) {
        await apiRequest(`/instructor/assignments/${createdAssign.id}/publish`, {
          method: "POST",
          roleCode: session.roleCode,
        }).catch((err) => console.warn("Lỗi tự động xuất bản:", err));
      }

      await loadClassData();
      setAddAssignmentModalOpen(false);
      setAssignmentFormTitle("");
      setAssignmentFormDesc("");
      notify("Đã tạo và công bố bài tập mới vào cơ sở dữ liệu!", "success");
    } catch (err: any) {
      console.error("Lỗi tạo bài tập:", err);
      notify(err?.message || "Không thể tạo bài tập vào cơ sở dữ liệu", "error");
    }
  };

  // Nhận bài tập từ AssignmentBuilderModal và lưu trực tiếp vào PostgreSQL (hỗ trợ cả trắc nghiệm AI và tự luận)
  const handleSaveFromBuilder = async (data: any) => {
    try {
      notify("Đang lưu bài tập và cấu hình vào cơ sở dữ liệu...", "info");

      if (data.type === "MULTIPLE_CHOICE" && data.questions && data.questions.length > 0) {
        // Luồng Trắc nghiệm:
        // Bước 1: Lưu câu hỏi vào Question Bank (nếu có courseId)
        let questionIds: string[] = [];
        if (course?.id) {
          try {
            const formattedQuestions = data.questions.map((q: any) => ({
              courseId: course.id,
              content: q.content || "Nội dung câu hỏi",
              type: "SINGLE_CHOICE",
              options: q.options && q.options.length > 0 ? q.options : ["A", "B", "C", "D"],
              correctAnswers: [q.correctAnswer || "A"],
              difficulty: 2,
              tags: ["Trắc nghiệm", "AI Tách câu"],
            }));

            const importedQuestions = await apiRequest<any[]>(
              "/instructor/question-bank/questions/import",
              {
                method: "POST",
                roleCode: session.roleCode,
                body: JSON.stringify({
                  courseId: course.id,
                  questions: formattedQuestions,
                }),
              }
            ).catch(() => [] as any[]);

            questionIds = importedQuestions.map((q) => q.id);
          } catch (qErr) {
            console.warn("Không thể import câu hỏi vào ngân hàng:", qErr);
          }
        }

        // Bước 2: Tạo đề thi Exam nếu có câu hỏi
        if (questionIds.length > 0) {
          try {
            const createdExam = await apiRequest<any>("/instructor/exams", {
              method: "POST",
              roleCode: session.roleCode,
              body: JSON.stringify({
                classId: item.id,
                title: data.title || "Bài kiểm tra trắc nghiệm",
                questionIds,
                durationMinutes: Number(data.settings?.durationMinutes) || 45,
                totalScore: Number(data.settings?.totalScore) || 10,
                openAt: data.settings?.openAt || new Date().toISOString(),
                closeAt: data.settings?.dueAt ? new Date(data.settings.dueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
                attemptLimit: Number(data.settings?.attemptLimit) || 1,
                shuffleQuestions: Boolean(data.settings?.shuffleQuestions),
              }),
            });

            if (createdExam?.id) {
              await apiRequest(`/instructor/exams/${createdExam.id}/publish`, {
                method: "POST",
                roleCode: session.roleCode,
              }).catch(() => null);
            }
          } catch (examErr) {
            console.warn("Không thể tạo đề thi riêng:", examErr);
          }
        }

        // Bước 3: Tạo bản ghi Assignment trong lớp
        const createdAssign = await apiRequest<Assignment>(
          `/instructor/classes/${item.id}/assignments`,
          {
            method: "POST",
            roleCode: session.roleCode,
            body: JSON.stringify({
              title: data.title || "Bài kiểm tra trắc nghiệm",
              description: data.description || `Đề thi trắc nghiệm gồm ${data.questions.length} câu hỏi.`,
              instructions: "Đề thi trắc nghiệm tách câu. Học sinh chọn đáp án đúng cho từng câu hỏi.",
              dueAt: data.settings?.hasDueAt && data.settings?.dueAt
                ? new Date(data.settings.dueAt).toISOString()
                : new Date(Date.now() + 7 * 86400000).toISOString(),
              maxScore: Number(data.settings?.totalScore) || 10,
              rubric: [
                {
                  title: "Trắc nghiệm tự động",
                  description: "Hệ thống chấm điểm tự động",
                  maxPoints: Number(data.settings?.totalScore) || 10,
                },
              ],
            }),
          }
        );

        if (createdAssign?.id) {
          await apiRequest(`/instructor/assignments/${createdAssign.id}/publish`, {
            method: "POST",
            roleCode: session.roleCode,
          }).catch(() => null);
        }
      } else {
        // Luồng Tự luận
        const createdAssign = await apiRequest<Assignment>(
          `/instructor/classes/${item.id}/assignments`,
          {
            method: "POST",
            roleCode: session.roleCode,
            body: JSON.stringify({
              title: data.title || "Bài tập tự luận mới",
              description: data.description || "Học sinh hoàn thành bài làm theo tài liệu đính kèm.",
              instructions: data.attachedFile ? `Tệp đính kèm: ${data.attachedFile.name}` : "Nộp bài viết hoặc file đính kèm theo đúng hạn.",
              dueAt: data.settings?.hasDueAt && data.settings?.dueAt
                ? new Date(data.settings.dueAt).toISOString()
                : new Date(Date.now() + 7 * 86400000).toISOString(),
              maxScore: Number(data.maxScore) || 10,
              rubric: [
                {
                  title: "Nội dung bài làm",
                  description: "Đầy đủ và chính xác theo yêu cầu đề bài",
                  maxPoints: Number(data.maxScore) || 10,
                },
              ],
            }),
          }
        );

        if (createdAssign?.id) {
          await apiRequest(`/instructor/assignments/${createdAssign.id}/publish`, {
            method: "POST",
            roleCode: session.roleCode,
          }).catch(() => null);
        }
      }

      // ĐỒNG BỘ CÂU HỎI VÀO NGÂN HÀNG CÂU HỎI LỚP (TRẮC NGHIỆM / TỰ LUẬN)
      if (data.type === "MULTIPLE_CHOICE" && data.questions && data.questions.length > 0) {
        const newExtracted = data.questions.map((q: any, idx: number) => ({
          id: `cq-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
          content: q.content,
          type: q.type || "Trắc nghiệm một đáp án",
          difficulty: "Thông hiểu",
          source: data.title || "Tách câu tự động (AI)",
          options: q.options?.map((opt: any) => (typeof opt === "string" ? opt : opt.text)) || ["A", "B", "C", "D"],
          correctAnswers: [q.correctAnswer === "B" ? 1 : q.correctAnswer === "C" ? 2 : q.correctAnswer === "D" ? 3 : 0],
          solution: q.hint || q.solutionVideoUrl || `Đáp án đúng: ${q.correctAnswer || "A"}`,
          createdAt: new Date().toLocaleDateString("vi-VN"),
        }));
        setClassQuestions((prev) => [...newExtracted, ...prev]);
      } else {
        const newEssayQuestion = {
          id: `cq-${Date.now()}-essay`,
          content: data.title + (data.description ? `: ${data.description}` : ""),
          type: "Tự luận",
          difficulty: "Vận dụng",
          source: data.title || "Đề bài tự luận",
          solution: data.attachedFile
            ? `Tệp đính kèm: ${data.attachedFile.name}`
            : data.submissionMethods?.length
            ? `Hình thức nộp: ${data.submissionMethods.join(", ")}`
            : "Nộp bài theo yêu cầu đề bài",
          createdAt: new Date().toLocaleDateString("vi-VN"),
        };
        setClassQuestions((prev) => [newEssayQuestion, ...prev]);
      }

      // Tạo bản ghi Assignment hoàn chỉnh hiển thị ngay lập tức
      const localAssign: Assignment = {
        id: `assign-${Date.now()}`,
        classId: item.id,
        classCode: item.code,
        title: data.title || (data.type === "MULTIPLE_CHOICE" ? "Bài kiểm tra trắc nghiệm" : "Bài tập tự luận"),
        description:
          data.description ||
          (data.type === "MULTIPLE_CHOICE"
            ? `Đề thi trắc nghiệm gồm ${data.questions?.length || 0} câu hỏi.`
            : "Học sinh hoàn thành bài làm theo tệp đề bài đính kèm."),
        instructions: data.attachedFile
          ? `Tệp đề bài: ${data.attachedFile.name}. Hình thức nộp: ${data.submissionMethods?.join(", ") || "Tải tệp / chụp ảnh"}`
          : data.submissionMethods?.length
          ? `Hình thức nộp bài: ${data.submissionMethods.join(", ")}`
          : "Học sinh hoàn thành bài làm và nộp trước hạn.",
        dueAt:
          data.settings?.hasDueAt && data.settings?.dueAt
            ? new Date(data.settings.dueAt).toISOString()
            : new Date(Date.now() + 7 * 86400000).toISOString(),
        maxScore: Number(data.settings?.totalScore || data.maxScore) || 10,
        rubric: [
          {
            id: `rb-${Date.now()}-1`,
            title: data.type === "MULTIPLE_CHOICE" ? "Trắc nghiệm tự động" : "Bài làm tự luận",
            description: "Đánh giá theo đáp án chuẩn",
            maxPoints: Number(data.settings?.totalScore || data.maxScore) || 10,
          },
        ],
        status: "PUBLISHED",
        version: 1,
        createdById: session.user.id || "instructor-1",
        createdAt: new Date().toISOString(),
      };
      (localAssign as any).durationMinutes = Number(data.settings?.durationMinutes) || 45;
      (localAssign as any).totalQuestions = data.questions?.length || 1;
      (localAssign as any).submissionMethods = data.submissionMethods || [];
      (localAssign as any).attachedFile = data.attachedFile;
      (localAssign as any).questions = data.questions || [];

      setAssignments((prev) => {
        const nextList = [localAssign, ...prev];
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
            if (data.questions && data.questions.length > 0) {
              localStorage.setItem(`wind_exam_questions_${localAssign.id}`, JSON.stringify(data.questions));
            }
          } catch (e) {}
        }
        return nextList;
      });
      setSelectedAssignment(localAssign);

      await loadClassData();
      setAddAssignmentModalOpen(false);
      notify(`Đã lưu và xuất bản bài tập '${data.title}' thành công!`, "success");
    } catch (err: any) {
      console.error("Lỗi khi lưu bài tập từ builder:", err);
      notify(err?.message || "Không thể lưu bài tập vào cơ sở dữ liệu", "error");
    }
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

  // Dữ liệu mẫu danh sách lượt làm bài của học sinh đối với bài tập/bài thi
  const studentAttemptStats: StudentAttemptStat[] = useMemo(() => {
    const list = learners.length > 0 ? learners : [
      { id: "usr-1", displayName: "Nguyễn Văn Nam", email: "nam.nv@wind.edu.vn" },
      { id: "usr-2", displayName: "Trần Thị Lan", email: "lan.tt@wind.edu.vn" },
      { id: "usr-3", displayName: "Lê Hoàng Phúc", email: "phuc.lh@wind.edu.vn" },
      { id: "usr-4", displayName: "Phạm Minh Đức", email: "duc.pm@wind.edu.vn" },
      { id: "usr-5", displayName: "Hoàng Mai Chi", email: "chi.hm@wind.edu.vn" },
    ];

    return list.map((l, index) => {
      const attemptsCount = (index % 3) + 1;
      const scores = [6.5, 9.0, 4.5, 8.5, 7.0, 9.5];
      const baseScore = scores[index % scores.length] ?? 7.0;
      const maxScore = selectedAssignment?.maxScore || 10;

      const subAttempts = Array.from({ length: attemptsCount }).map((_, aIdx) => {
        const score = Math.min(maxScore, Math.max(3, baseScore + aIdx * 1.5 - 0.5));
        return {
          attemptNo: aIdx + 1,
          score: Number(score.toFixed(1)),
          maxScore,
          submittedAt: `26/10/2026 1${aIdx + 4}:20`,
          durationMinutes: 25 + aIdx * 5,
          answers: [
            {
              questionId: "q1",
              questionContent: "Tìm tập nghiệm của phương trình đã cho?",
              learnerAnswer: "x = 4 và x = -2",
              correctAnswer: "x = 4 và x = -2",
              isCorrect: true,
              score: 2.5,
              maxScore: 2.5,
            },
            {
              questionId: "q2",
              questionContent: "Giá trị nhỏ nhất của biểu thức bậc hai bằng bao nhiêu?",
              learnerAnswer: "Min = 3 khi x = 1",
              correctAnswer: "Min = 3 khi x = 1",
              isCorrect: true,
              score: 2.5,
              maxScore: 2.5,
            },
            {
              questionId: "q3",
              questionContent: "Chứng minh ba điểm thẳng hàng trong không gian?",
              learnerAnswer: "Sử dụng tính chất vectơ cùng phương",
              correctAnswer: "Sử dụng tính chất vectơ cùng phương",
              isCorrect: score > 5,
              score: score > 5 ? 3.0 : 1.0,
              maxScore: 5.0,
            },
          ],
        };
      });

      const best = Math.max(...subAttempts.map((a) => a.score));

      return {
        id: `stat-${l.id}`,
        learnerId: l.id,
        learnerName: l.displayName,
        learnerEmail: l.email || "student@wind.edu.vn",
        attemptCount: attemptsCount,
        bestScore: best,
        maxScore,
        durationMinutes: 30,
        submittedAt: "26/10/2026 15:45",
        attempts: subAttempts,
      };
    });
  }, [learners, selectedAssignment]);

  // Thư mục bài giảng
  const lectureFolders = useMemo(() => {
    const folders = new Set<string>();
    lectures.forEach((l) => {
      if (l.folder) folders.add(l.folder);
    });
    return Array.from(folders);
  }, [lectures]);

  // Danh sách bài giảng lọc
  const filteredLectures = useMemo(() => {
    let result = [...lectures];
    if (selectedLectureFolder !== "__ALL__") {
      result = result.filter((l) => l.folder === selectedLectureFolder);
    }
    if (lectureSearch.trim()) {
      const q = lectureSearch.toLowerCase();
      result = result.filter(
        (l) => l.title.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q))
      );
    }
    if (lectureSort === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (lectureSort === "type") {
      result.sort((a, b) => (a.fileType || "").localeCompare(b.fileType || ""));
    }
    return result;
  }, [lectures, selectedLectureFolder, lectureSearch, lectureSort]);

  // Bài giảng đang được chọn ở Cột 3
  const activeLectureItem = useMemo(() => {
    if (filteredLectures.length === 0) return null;
    return filteredLectures.find((l) => l.id === selectedLectureId) || filteredLectures[0] || null;
  }, [filteredLectures, selectedLectureId]);

  // Thư mục tài liệu
  const materialFolders = useMemo(() => {
    const folders = new Set<string>();
    materialsList.forEach((m) => {
      if (m.folder) folders.add(m.folder);
    });
    return Array.from(folders);
  }, [materialsList]);

  // Danh sách tài liệu lọc
  const filteredMaterials = useMemo(() => {
    let result = [...materialsList];
    if (selectedMaterialFolder !== "__ALL__") {
      result = result.filter((m) => m.folder === selectedMaterialFolder);
    }
    if (materialSearch.trim()) {
      const q = materialSearch.toLowerCase();
      result = result.filter(
        (m) => m.title.toLowerCase().includes(q) || (m.description && m.description.toLowerCase().includes(q))
      );
    }
    if (materialSort === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (materialSort === "type") {
      result.sort((a, b) => (a.fileType || "").localeCompare(b.fileType || ""));
    } else if (materialSort === "newest") {
      result.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    }
    return result;
  }, [materialsList, selectedMaterialFolder, materialSearch, materialSort]);

  // Tài liệu đang được chọn ở Cột 3
  const activeMaterialItem = useMemo(() => {
    if (filteredMaterials.length === 0) return null;
    return filteredMaterials.find((m) => m.id === selectedMaterialId) || filteredMaterials[0] || null;
  }, [filteredMaterials, selectedMaterialId]);

  // Xóa bài giảng
  const handleDeleteLecture = (lectureId: string, lectureTitle: string) => {
    if (window.confirm(`Bạn có chắc muốn xóa bài giảng "${lectureTitle}" không?`)) {
      setLectures((prev) => prev.filter((l) => l.id !== lectureId));
      if (selectedLectureForPage?.id === lectureId) {
        setSelectedLectureForPage(null);
      }
      notify("Đã xóa bài giảng thành công!", "success");
    }
  };

  // Xử lý thay đổi liên kết bài giảng khi chỉnh sửa
  const handleEditLectureLinkChange = (value: string) => {
    setEditLectureInputUrl(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setEditLectureUrlError("");
      setEditLectureDetectedPlatform("INVALID");
      return;
    }
    if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) {
      setEditLectureDetectedPlatform("YOUTUBE");
      setEditLectureUrlError("");
    } else if (trimmed.includes("facebook.com") || trimmed.includes("fb.watch")) {
      setEditLectureDetectedPlatform("FACEBOOK");
      setEditLectureUrlError("");
    } else if (trimmed.includes("drive.google.com")) {
      setEditLectureDetectedPlatform("DRIVE");
      setEditLectureUrlError("");
    } else {
      setEditLectureDetectedPlatform("INVALID");
      setEditLectureUrlError("Chỉ chấp nhận liên kết từ YouTube, Facebook hoặc Google Drive!");
    }
  };

  // Xử lý chọn tệp từ máy tính khi chỉnh sửa bài giảng
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
    setEditLectureUploadProgress(15);
    setEditLectureIntegrityChecking(false);
    setEditLecturePreviewReady(false);

    const interval = setInterval(() => {
      setEditLectureUploadProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          setEditLectureIntegrityChecking(true);
          setTimeout(() => {
            setEditLectureIntegrityChecking(false);
            setEditLecturePreviewReady(true);
          }, 500);
          return 100;
        }
        return prev + 25;
      });
    }, 100);
  };

  // Mở modal sửa bài giảng với đầy đủ dữ liệu nguồn (Link hoặc File)
  const handleOpenEditLecture = (lec: LectureItem) => {
    setEditingLecture({ ...lec });
    setEditLectureFormTitle(lec.title);
    setEditLectureFormDesc(lec.description || "");
    setEditLectureFormFolder(lec.folder);
    setEditLectureFileObj(null);
    setEditLectureUploadProgress(0);

    if (lec.youtubeId || (lec.sourceUrl && (lec.sourceUrl.startsWith("http") || lec.fileType === "mp4"))) {
      setEditLectureMethod("LINK");
      const url = lec.sourceUrl || (lec.youtubeId ? `https://www.youtube.com/watch?v=${lec.youtubeId}` : "");
      setEditLectureInputUrl(url);
      if (url.includes("youtube.com") || url.includes("youtu.be")) {
        setEditLectureDetectedPlatform("YOUTUBE");
      } else if (url.includes("facebook.com") || url.includes("fb.watch")) {
        setEditLectureDetectedPlatform("FACEBOOK");
      } else if (url.includes("drive.google.com")) {
        setEditLectureDetectedPlatform("DRIVE");
      } else {
        setEditLectureDetectedPlatform("INVALID");
      }
      setEditLecturePreviewReady(true);
    } else {
      setEditLectureMethod("FILE");
      setEditLectureInputUrl("");
      setEditLectureDetectedPlatform("INVALID");
      setEditLecturePreviewReady(true);
    }
    setEditLectureModalOpen(true);
  };

  // Lưu chỉnh sửa bài giảng (áp dụng thay đổi Link hoặc File từ máy)
  const handleSaveEditLecture = () => {
    if (!editingLecture || !editLectureFormTitle.trim()) {
      notify("Vui lòng nhập tên bài giảng!", "error");
      return;
    }

    let updatedYtId: string | undefined = undefined;
    let updatedSourceUrl: string | undefined = editingLecture.sourceUrl;
    let updatedFileType: "mp4" | "pptx" | "mp3" = editingLecture.fileType || "mp4";
    let updatedSourceType: "LINK" | "FILE" = editingLecture.sourceType || "LINK";

    if (editLectureMethod === "LINK") {
      if (!editLectureInputUrl.trim()) {
        notify("Vui lòng nhập liên kết bài giảng hợp lệ!", "error");
        return;
      }
      const parsedYt = getLectureYoutubeId(editLectureInputUrl);
      updatedYtId = parsedYt || undefined;
      updatedSourceUrl = editLectureInputUrl.trim();
      updatedFileType = "mp4";
      updatedSourceType = "LINK";
    } else {
      if (editLectureFileObj) {
        updatedSourceUrl = editLectureFileObj.name;
        const ext = editLectureFileObj.name.toLowerCase();
        if (ext.endsWith(".pptx") || ext.endsWith(".ppt")) {
          updatedFileType = "pptx";
        } else {
          updatedFileType = "mp4";
        }
      }
      updatedYtId = undefined;
      updatedSourceType = "FILE";
    }

    const updatedLecture: LectureItem = {
      ...editingLecture,
      title: editLectureFormTitle.trim(),
      description: editLectureFormDesc.trim(),
      folder: editLectureFormFolder,
      fileType: updatedFileType,
      sourceType: updatedSourceType,
      sourceUrl: updatedSourceUrl,
      youtubeId: updatedYtId,
    };

    setLectures((prev) =>
      prev.map((l) => (l.id === updatedLecture.id ? updatedLecture : l))
    );
    if (selectedLectureForPage?.id === updatedLecture.id) {
      setSelectedLectureForPage(updatedLecture);
    }
    setEditLectureModalOpen(false);
    setEditingLecture(null);
    notify("Đã cập nhật toàn bộ thông tin bài giảng thành công!", "success");
  };

  // Xóa tài liệu khỏi danh sách
  const handleDeleteMaterial = (materialId: string, materialTitle: string) => {
    if (window.confirm(`Bạn có chắc muốn xóa tài liệu "${materialTitle}" không?`)) {
      setMaterialsList((prev) => prev.filter((m) => m.id !== materialId));
      notify("Đã xóa tài liệu thành công!", "success");
    }
  };

  // Xử lý chọn tệp mới từ máy tính khi chỉnh sửa tài liệu
  const handleEditMaterialFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setEditMaterialFileObj(file);
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    setEditMaterialFormSize(`${sizeMb} MB`);

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      setEditMaterialFormFileType("pdf");
    } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      setEditMaterialFormFileType("xlsx");
    } else {
      setEditMaterialFormFileType("doc");
    }

    setEditMaterialUploadProgress(100);
    notify(`Đã nhận diện tệp mới: ${file.name} (${sizeMb} MB)`, "info");
  };

  // Mở modal sửa tài liệu và nạp toàn bộ thông tin
  const handleOpenEditMaterial = (mat: MaterialDisplayItem) => {
    setEditingMaterial({ ...mat });
    setEditMaterialFormTitle(mat.title);
    setEditMaterialFormFolder(mat.folder);
    const validFileType = (mat.fileType === "word" ? "doc" : mat.fileType) as "pdf" | "xlsx" | "doc";
    setEditMaterialFormFileType(validFileType);
    setEditMaterialFormSize(mat.size);
    setEditMaterialFormPageCount(mat.pageCount || 10);
    setEditMaterialFormDesc(mat.description || "");
    setEditMaterialFileObj(null);
    setEditMaterialUploadProgress(0);
    setEditMaterialModalOpen(true);
  };

  // Lưu chỉnh sửa tài liệu bao gồm tệp thay thế từ máy tính
  const handleSaveEditMaterial = () => {
    if (!editingMaterial || !editMaterialFormTitle.trim()) {
      notify("Vui lòng nhập tên tài liệu!", "error");
      return;
    }

    const updatedMat: MaterialDisplayItem = {
      ...editingMaterial,
      title: editMaterialFormTitle.trim(),
      folder: editMaterialFormFolder,
      fileType: editMaterialFormFileType,
      size: editMaterialFormSize || editingMaterial.size,
      pageCount: Number(editMaterialFormPageCount) || editingMaterial.pageCount,
      description: editMaterialFormDesc.trim(),
    };

    setMaterialsList((prev) =>
      prev.map((m) => (m.id === updatedMat.id ? updatedMat : m))
    );
    setEditMaterialModalOpen(false);
    setEditingMaterial(null);
    notify("Đã cập nhật toàn bộ tài liệu thành công!", "success");
  };

  // Mở modal chỉnh sửa bài tập
  const handleOpenEditAssignment = (assign: Assignment) => {
    setEditingAssignment({ ...assign });
    setEditAssignmentTitle(assign.title);
    setEditAssignmentDesc(assign.description || "");
    setEditAssignmentInstructions(assign.instructions || "");
    setEditAssignmentDue(assign.dueAt ? assign.dueAt.slice(0, 16) : "");
    setEditAssignmentMaxScore(assign.maxScore || 10);
    setEditAssignmentFolder((assign as any).folder || "Tuần 1 - Nhập môn");
    setEditAssignmentModalOpen(true);
  };

  // Lưu chỉnh sửa bài tập và cập nhật bền vững
  const handleSaveEditAssignment = () => {
    if (!editingAssignment || !editAssignmentTitle.trim()) {
      notify("Vui lòng nhập tiêu đề bài tập!", "error");
      return;
    }

    const updatedAssignments = assignments.map((a) =>
      a.id === editingAssignment.id
        ? {
            ...a,
            title: editAssignmentTitle.trim(),
            description: editAssignmentDesc.trim(),
            instructions: editAssignmentInstructions.trim(),
            dueAt: editAssignmentDue ? new Date(editAssignmentDue).toISOString() : a.dueAt,
            maxScore: Number(editAssignmentMaxScore) || 10,
            folder: editAssignmentFolder,
          }
        : a
    );

    setAssignments(updatedAssignments);
    if (selectedAssignment?.id === editingAssignment.id) {
      setSelectedAssignment(
        updatedAssignments.find((a) => a.id === editingAssignment.id) || null
      );
    }

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(updatedAssignments));
      } catch (e) {}
    }

    setEditAssignmentModalOpen(false);
    setEditingAssignment(null);
    notify("Đã cập nhật bài tập thành công!", "success");
  };

  // Mở Hub điều phối chọn 1 trong 5 cách tạo Bài tập hoặc Soạn câu hỏi
  const handleOpenCreationHub = (target: "ASSIGNMENT" | "QUESTION") => {
    setCreationTarget(target);
    setCreationHubOpen(true);
  };

  // Lưu câu hỏi thủ công (Cách 1) vào ngân hàng hoặc tạo bài tập
  const handleSaveManualQuestion = () => {
    if (!authoringContent.trim()) {
      notify("Vui lòng nhập nội dung câu hỏi!", "error");
      return;
    }

    const newQuestion = {
      id: `cq-${Date.now()}`,
      content: authoringContent.trim(),
      type:
        authoringType === "SINGLE_CHOICE"
          ? "Trắc nghiệm một đáp án"
          : authoringType === "MULTIPLE_CHOICE"
          ? "Trắc nghiệm nhiều đáp án"
          : "Tự luận",
      difficulty:
        authoringDifficulty === "EASY"
          ? "Cơ bản"
          : authoringDifficulty === "MEDIUM"
          ? "Thông hiểu"
          : "Vận dụng",
      source: "Soạn thủ công",
      options: authoringType !== "ESSAY" ? authoringOptions.filter(Boolean) : undefined,
      correctAnswers: authoringType !== "ESSAY" ? authoringCorrect : undefined,
      solution: authoringSolution.trim() || undefined,
      createdAt: new Date().toLocaleDateString("vi-VN"),
    };

    setClassQuestions((prev) => [newQuestion, ...prev]);

    // Nếu chọn tạo thành bài tập hoặc đang mở từ tab Bài tập
    if (authoringSaveAsAssignment || creationTarget === "ASSIGNMENT") {
      const assignTitle =
        authoringAssignmentTitle.trim() ||
        `Bài tập trắc nghiệm: ${authoringContent.slice(0, 35)}...`;
      const newAssign: Assignment = {
        id: `assign-${Date.now()}`,
        classId: item.id,
        classCode: item.code,
        title: assignTitle,
        description: `Bài tập được tạo từ câu hỏi soạn thủ công. Độ khó: ${newQuestion.difficulty}`,
        instructions: "Học sinh chọn phương án đúng nhất và nộp bài trước hạn.",
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        maxScore: 10,
        rubric: [],
        status: "PUBLISHED",
        version: 1,
        createdById: session.user.id || "instructor-1",
        createdAt: new Date().toISOString(),
      };
      const nextList = [newAssign, ...assignments];
      setAssignments(nextList);
      setSelectedAssignment(newAssign);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        } catch (e) {}
      }
    }

    setAuthoringModalOpen(false);
    setAuthoringContent("");
    setAuthoringSolution("");
    notify(
      authoringSaveAsAssignment || creationTarget === "ASSIGNMENT"
        ? "Đã lưu câu hỏi vào ngân hàng và tạo bài tập cho lớp thành công!"
        : "Đã lưu câu hỏi vào ngân hàng câu hỏi riêng của lớp!",
      "success"
    );
  };

  // Kích hoạt quét đề AI OCR (Cách 2)
  const handleTriggerScanExam = () => {
    setScanStatus("SCANNING");
    setTimeout(() => {
      setScanStatus("DONE");
      notify("Đã quét và bóc tách thành công 4 câu hỏi từ tệp đề thi!", "success");
    }, 800);
  };

  // Lưu các câu hỏi từ đề quét OCR vào ngân hàng hoặc tạo bài tập
  const handleSaveScannedExam = (asAssignment = false) => {
    const newItems = scannedExamQuestions.map((q) => ({
      id: `cq-${Date.now()}-${q.id}`,
      content: q.content,
      type: "Trắc nghiệm một đáp án",
      difficulty: "Thông hiểu",
      source: "Quét AI (OCR)",
      options: q.options,
      correctAnswers: [q.correctKey === "A" ? 0 : q.correctKey === "B" ? 1 : q.correctKey === "C" ? 2 : 3],
      solution: `Đáp án đúng được quét tự động là: ${q.correctKey}`,
      createdAt: new Date().toLocaleDateString("vi-VN"),
    }));

    setClassQuestions((prev) => [...newItems, ...prev]);

    if (asAssignment || creationTarget === "ASSIGNMENT") {
      const newAssign: Assignment = {
        id: `assign-${Date.now()}`,
        classId: item.id,
        classCode: item.code,
        title: "Đề kiểm tra trắc nghiệm bóc tách từ Quét AI (OCR)",
        description: "Đề thi gồm 4 câu hỏi trắc nghiệm được AI OCR trích xuất tự động.",
        instructions: "Làm trực tiếp trên hệ thống và nộp bài trước hạn.",
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        maxScore: 10,
        rubric: [],
        status: "PUBLISHED",
        version: 1,
        createdById: session.user.id || "instructor-1",
        createdAt: new Date().toISOString(),
      };
      const nextList = [newAssign, ...assignments];
      setAssignments(nextList);
      setSelectedAssignment(newAssign);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        } catch (e) {}
      }
    }

    setScanModalOpen(false);
    notify(
      asAssignment || creationTarget === "ASSIGNMENT"
        ? "Đã lưu 4 câu hỏi vào ngân hàng và tạo bài tập cho lớp!"
        : "Đã lưu 4 câu hỏi quét AI vào ngân hàng thành công!",
      "success"
    );
  };

  // Kích hoạt sinh đề thông minh bằng AI (Cách 3)
  const handleTriggerAiExamGen = () => {
    setAiGenerating(true);
    setAiGeneratedItems([]);

    const generated = [
      {
        id: "ai-1",
        content: `Câu 1 (${aiSubject}): Cho hàm số y = f(x) có đạo hàm f'(x) = x(x-1)³(x+2)². Số điểm cực trị của hàm số là?`,
        options: ["1 điểm", "2 điểm", "3 điểm", "4 điểm"],
        correctKey: "B",
        explanation: "Điểm cực trị là nghiệm bội lẻ của f'(x) = 0, gồm x = 0 và x = 1. Do đó có 2 điểm cực trị.",
      },
      {
        id: "ai-2",
        content: `Câu 2 (${aiSubject}): Tiệm cận đứng của đồ thị hàm số y = (2x + 1) / (x - 3) là đường thẳng nào?`,
        options: ["x = 3", "x = -3", "y = 2", "y = 3"],
        correctKey: "A",
        explanation: "Mẫu số x - 3 = 0 <=> x = 3 là tiệm cận đứng.",
      },
      {
        id: "ai-3",
        content: `Câu 3 (${aiSubject}): Tìm giá trị lớn nhất của hàm số f(x) = x³ - 3x + 2 trên đoạn [0; 2]?`,
        options: ["max = 4", "max = 2", "max = 0", "max = 1"],
        correctKey: "A",
        explanation: "f'(x) = 3x² - 3 = 0 <=> x = 1. f(0) = 2, f(1) = 0, f(2) = 4 => GTLN là 4 tại x = 2.",
      },
      {
        id: "ai-4",
        content: `Câu 4 (${aiSubject}): Đồ thị hàm số y = x⁴ - 2x² + 3 có bao nhiêu điểm cực trị?`,
        options: ["3 điểm", "1 điểm", "2 điểm", "0 điểm"],
        correctKey: "A",
        explanation: "Hàm trùng phương có a.b = 1.(-2) = -2 < 0 nên có đúng 3 điểm cực trị.",
      },
      {
        id: "ai-5",
        content: `Câu 5 (${aiSubject}): Thể tích khối lập phương có cạnh bằng 3a là?`,
        options: ["27a³", "9a³", "3a³", "18a³"],
        correctKey: "A",
        explanation: "V = (3a)³ = 27a³.",
      },
    ];

    generated.forEach((q, idx) => {
      setTimeout(() => {
        setAiGeneratedItems((prev) => [...prev, q]);
        if (idx === generated.length - 1) {
          setAiGenerating(false);
          notify(`AI đã tạo thành công ${generated.length} câu hỏi theo chủ đề "${aiTopic}"!`, "success");
        }
      }, (idx + 1) * 80);
    });
  };

  // Lưu đề thi do AI tạo vào ngân hàng hoặc tạo bài tập
  const handleSaveAiExam = (asAssignment = false) => {
    if (aiGeneratedItems.length === 0) {
      notify("Chưa có câu hỏi nào được sinh từ AI!", "error");
      return;
    }

    const newItems = aiGeneratedItems.map((q) => ({
      id: `cq-${Date.now()}-${q.id}`,
      content: q.content,
      type: "Trắc nghiệm một đáp án",
      difficulty:
        aiDifficulty === "EASY" ? "Cơ bản" : aiDifficulty === "MEDIUM" ? "Thông hiểu" : "Vận dụng",
      source: `Tạo đề AI (${aiTopic})`,
      options: q.options,
      correctAnswers: [q.correctKey === "A" ? 0 : q.correctKey === "B" ? 1 : q.correctKey === "C" ? 2 : 3],
      solution: q.explanation,
      createdAt: new Date().toLocaleDateString("vi-VN"),
    }));

    setClassQuestions((prev) => [...newItems, ...prev]);

    if (asAssignment || creationTarget === "ASSIGNMENT") {
      const newAssign: Assignment = {
        id: `assign-${Date.now()}`,
        classId: item.id,
        classCode: item.code,
        title: `Bài kiểm tra AI: ${aiTopic} (${aiSubject})`,
        description: `Đề thi ${aiGeneratedItems.length} câu trắc nghiệm được AI tạo tự động theo chuyên đề ${aiTopic}.`,
        instructions: "Thời gian làm bài khuyến nghị: 45 phút. Chọn đáp án đúng nhất.",
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        maxScore: 10,
        rubric: [],
        status: "PUBLISHED",
        version: 1,
        createdById: session.user.id || "instructor-1",
        createdAt: new Date().toISOString(),
      };
      const nextList = [newAssign, ...assignments];
      setAssignments(nextList);
      setSelectedAssignment(newAssign);
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        } catch (e) {}
      }
    }

    setAiExamModalOpen(false);
    notify(
      asAssignment || creationTarget === "ASSIGNMENT"
        ? `Đã tạo bài tập và thêm ${aiGeneratedItems.length} câu hỏi vào ngân hàng!`
        : `Đã lưu ${aiGeneratedItems.length} câu hỏi AI vào ngân hàng câu hỏi riêng!`,
      "success"
    );
  };

  // Mở modal chỉnh sửa câu hỏi trong ngân hàng lớp
  const handleOpenEditQuestion = (q: any) => {
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

  // Lưu câu hỏi sau khi giáo viên chỉnh sửa
  const handleSaveEditedQuestion = () => {
    if (!editingQuestionData) return;
    if (!editingQuestionData.content.trim()) {
      notify("Vui lòng nhập nội dung câu hỏi!", "error");
      return;
    }

    // Cập nhật câu hỏi vào CSDL PostgreSQL
    try {
      void apiRequest(`/instructor/question-bank/questions/${editingQuestionData.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          content: editingQuestionData.content.trim(),
          type: editingQuestionData.type === "Tự luận" ? "ESSAY" : "SINGLE_CHOICE",
          options: editingQuestionData.options?.filter(Boolean) || [],
          correctAnswers: editingQuestionData.correctAnswers?.map((idx) => ["A", "B", "C", "D"][idx] || "A") || ["A"],
          difficulty: editingQuestionData.difficulty === "Cơ bản" ? 1 : editingQuestionData.difficulty === "Thông hiểu" ? 2 : 3,
        }),
      }).catch((err) => console.warn("Lỗi đồng bộ CSDL:", err));
    } catch (e) {}

    setClassQuestions((prev) =>
      prev.map((q) =>
        q.id === editingQuestionData.id
          ? {
              ...q,
              content: editingQuestionData.content.trim(),
              type: editingQuestionData.type,
              difficulty: editingQuestionData.difficulty,
              source: editingQuestionData.source.trim() || "Ngân hàng câu hỏi",
              options: editingQuestionData.type !== "Tự luận" ? editingQuestionData.options.filter(Boolean) : undefined,
              correctAnswers: editingQuestionData.type !== "Tự luận" ? editingQuestionData.correctAnswers : undefined,
              solution: editingQuestionData.solution.trim() || undefined,
            }
          : q
      )
    );
    setEditingQuestionModalOpen(false);
    setEditingQuestionData(null);
    notify("Đã cập nhật câu hỏi thành công!", "success");
  };

  // Kiểu 1: Soạn đề thủ công từ các câu hỏi giáo viên tick chọn
  const handleCreateExamManual = async () => {
    if (!manualExamTitle.trim()) {
      notify("Vui lòng nhập tiêu đề bài tập / đề thi!", "error");
      return;
    }
    if (manualExamSelectedQuestions.length === 0) {
      notify("Vui lòng tick chọn ít nhất 1 câu hỏi từ ngân hàng!", "error");
      return;
    }

    const selectedObjs = classQuestions.filter((q) => manualExamSelectedQuestions.includes(q.id));
    const newAssign: Assignment = {
      id: `assign-${Date.now()}`,
      classId: item.id,
      classCode: item.code,
      title: manualExamTitle.trim(),
      description: `Đề thi gồm ${selectedObjs.length} câu hỏi do giáo viên chọn lọc thủ công từ ngân hàng câu hỏi riêng của lớp.`,
      instructions: `Thời gian làm bài: ${manualExamDuration} phút. Học sinh hoàn thành các câu hỏi và nộp bài trước hạn.`,
      dueAt: manualExamDueAt ? new Date(manualExamDueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      maxScore: 10,
      rubric: [
        {
          id: `rb-${Date.now()}-manual`,
          title: "Đánh giá kết quả bài thi",
          description: "Chấm điểm tự động và trực tiếp theo đáp án chuẩn",
          maxPoints: 10,
        },
      ],
      status: "PUBLISHED",
      version: 1,
      createdById: session.user.id || "instructor-1",
      createdAt: new Date().toISOString(),
    };
    (newAssign as any).durationMinutes = manualExamDuration;
    (newAssign as any).totalQuestions = selectedObjs.length;
    (newAssign as any).questions = selectedObjs;
    (newAssign as any).questionIds = selectedObjs.map((q) => q.id);

    // Lưu vật lý vào CSDL PostgreSQL
    try {
      const created = await apiRequest<Assignment>(`/instructor/classes/${item.id}/assignments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: newAssign.title,
          description: newAssign.description,
          instructions: newAssign.instructions,
          dueAt: newAssign.dueAt,
          maxScore: 10,
          rubric: newAssign.rubric,
        }),
      });
      if (created?.id) {
        newAssign.id = created.id;
        await apiRequest(`/instructor/assignments/${created.id}/publish`, {
          method: "POST",
          roleCode: session.roleCode,
        }).catch(() => null);
      }
    } catch (e) {
      console.warn("Lưu CSDL lỗi:", e);
    }

    const nextList = [newAssign, ...assignments];
    setAssignments(nextList);
    setSelectedAssignment(newAssign);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        localStorage.setItem(`wind_exam_questions_${newAssign.id}`, JSON.stringify(selectedObjs));
      } catch (e) {}
    }

    setManualExamModalOpen(false);
    setManualExamTitle("");
    setManualExamSelectedQuestions([]);
    notify(`Đã tạo thành công đề thi '${newAssign.title}' gồm ${selectedObjs.length} câu hỏi!`, "success");
  };

  // Kiểu 2: AI chọn câu hỏi theo mốc ma trận độ khó
  const handleTriggerAiCriteriaSelection = () => {
    let pool = [...classQuestions];
    if (aiCriteriaScope === "MULTIPLE_CHOICE") {
      pool = pool.filter((q) => q.type !== "Tự luận");
    } else if (aiCriteriaScope === "ESSAY") {
      pool = pool.filter((q) => q.type === "Tự luận");
    }

    if (pool.length === 0) {
      notify("Không có câu hỏi nào trong ngân hàng phù hợp với phạm vi đã chọn!", "error");
      return;
    }

    const totalCount = Math.min(aiCriteriaQuestionCount, pool.length);
    const targetBasic = Math.max(1, Math.round((totalCount * aiRatioBasic) / 100));
    const targetMed = Math.max(1, Math.round((totalCount * aiRatioMedium) / 100));
    const targetHard = Math.round((totalCount * aiRatioHard) / 100);
    const targetVeryHard = totalCount - targetBasic - targetMed - targetHard;

    const basicPool = pool.filter((q) => q.difficulty === "Cơ bản" || q.difficulty === "Nhận biết");
    const medPool = pool.filter((q) => q.difficulty === "Thông hiểu");
    const hardPool = pool.filter((q) => q.difficulty === "Vận dụng");
    const vhardPool = pool.filter((q) => q.difficulty === "Vận dụng cao");

    const picked: any[] = [];
    const pickFrom = (source: any[], count: number) => {
      const shuffled = [...source].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, count);
    };

    picked.push(...pickFrom(basicPool, targetBasic));
    picked.push(...pickFrom(medPool, targetMed));
    picked.push(...pickFrom(hardPool, targetHard));
    picked.push(...pickFrom(vhardPool, targetVeryHard));

    // Bổ sung thêm nếu chưa đủ tổng số câu yêu cầu
    const remainingNeeded = totalCount - picked.length;
    if (remainingNeeded > 0) {
      const remainingPool = pool.filter((q) => !picked.some((p) => p.id === q.id));
      picked.push(...pickFrom(remainingPool, remainingNeeded));
    }

    setAiCriteriaPreviewList(picked);
    notify(`AI đã chọn thành công ${picked.length} câu hỏi theo đúng ma trận mốc tỷ lệ!`, "success");
  };

  // Lưu đề thi tạo bằng Kiểu 2 (AI chọn theo mốc)
  const handleCreateExamAiCriteria = async () => {
    if (!manualExamTitle.trim()) {
      notify("Vui lòng nhập tiêu đề bài tập / đề thi!", "error");
      return;
    }

    let questionsToUse = aiCriteriaPreviewList;
    if (questionsToUse.length === 0) {
      let pool = [...classQuestions];
      if (aiCriteriaScope === "MULTIPLE_CHOICE") {
        pool = pool.filter((q) => q.type !== "Tự luận");
      } else if (aiCriteriaScope === "ESSAY") {
        pool = pool.filter((q) => q.type === "Tự luận");
      }
      if (pool.length === 0) {
        notify("Ngân hàng câu hỏi chưa có câu nào phù hợp!", "error");
        return;
      }
      questionsToUse = pool.slice(0, Math.min(aiCriteriaQuestionCount, pool.length));
    }

    const newAssign: Assignment = {
      id: `assign-${Date.now()}`,
      classId: item.id,
      classCode: item.code,
      title: manualExamTitle.trim(),
      description: `Đề thi ${questionsToUse.length} câu được AI chọn tự động theo ma trận mốc độ khó (${aiRatioBasic}% Cơ bản, ${aiRatioMedium}% Thông hiểu, ${aiRatioHard}% Vận dụng, ${aiRatioVeryHard}% Vận dụng cao).`,
      instructions: `Thời gian làm bài: ${manualExamDuration} phút. Hệ thống tự động chấm điểm theo barem.`,
      dueAt: manualExamDueAt ? new Date(manualExamDueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      maxScore: 10,
      rubric: [
        {
          id: `rb-${Date.now()}-ai`,
          title: "Đề thi theo chuẩn ma trận",
          description: "Phân loại năng lực học sinh",
          maxPoints: 10,
        },
      ],
      status: "PUBLISHED",
      version: 1,
      createdById: session.user.id || "instructor-1",
      createdAt: new Date().toISOString(),
    };
    (newAssign as any).durationMinutes = manualExamDuration;
    (newAssign as any).totalQuestions = questionsToUse.length;
    (newAssign as any).questions = questionsToUse;
    (newAssign as any).questionIds = questionsToUse.map((q) => q.id);

    // Lưu vật lý vào CSDL PostgreSQL
    try {
      const created = await apiRequest<Assignment>(`/instructor/classes/${item.id}/assignments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: newAssign.title,
          description: newAssign.description,
          instructions: newAssign.instructions,
          dueAt: newAssign.dueAt,
          maxScore: 10,
          rubric: newAssign.rubric,
        }),
      });
      if (created?.id) {
        newAssign.id = created.id;
        await apiRequest(`/instructor/assignments/${created.id}/publish`, {
          method: "POST",
          roleCode: session.roleCode,
        }).catch(() => null);
      }
    } catch (e) {
      console.warn("Lưu CSDL lỗi:", e);
    }

    const nextList = [newAssign, ...assignments];
    setAssignments(nextList);
    setSelectedAssignment(newAssign);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        localStorage.setItem(`wind_exam_questions_${newAssign.id}`, JSON.stringify(questionsToUse));
      } catch (e) {}
    }

    setManualExamModalOpen(false);
    setManualExamTitle("");
    setAiCriteriaPreviewList([]);
    notify(`Đã tạo thành công đề thi AI '${newAssign.title}' gồm ${questionsToUse.length} câu hỏi!`, "success");
  };

  // Kiểu 3: Bốc ngẫu nhiên câu hỏi từ ngân hàng
  const handleCreateExamRandom = async () => {
    if (!manualExamTitle.trim()) {
      notify("Vui lòng nhập tiêu đề bài tập / đề thi!", "error");
      return;
    }

    let pool = [...classQuestions];
    if (randomTypeScope === "MULTIPLE_CHOICE") {
      pool = pool.filter((q) => q.type !== "Tự luận");
    } else if (randomTypeScope === "ESSAY") {
      pool = pool.filter((q) => q.type === "Tự luận");
    }

    if (pool.length === 0) {
      notify("Ngân hàng chưa có câu hỏi nào phù hợp với phạm vi ngẫu nhiên!", "error");
      return;
    }

    const countToPick = Math.min(randomQuestionCount, pool.length);
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const pickedQuestions = shuffled.slice(0, countToPick);

    if (randomShuffle) {
      pickedQuestions.sort(() => 0.5 - Math.random());
    }

    const newAssign: Assignment = {
      id: `assign-${Date.now()}`,
      classId: item.id,
      classCode: item.code,
      title: manualExamTitle.trim(),
      description: `Đề thi gồm ${pickedQuestions.length} câu hỏi được bốc ngẫu nhiên và xáo trộn từ ngân hàng câu hỏi lớp.`,
      instructions: `Thời gian làm bài: ${manualExamDuration} phút. Học sinh làm bài và nộp trước hạn.`,
      dueAt: manualExamDueAt ? new Date(manualExamDueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      maxScore: 10,
      rubric: [
        {
          id: `rb-${Date.now()}-rnd`,
          title: "Đề thi ngẫu nhiên",
          description: "Xáo trộn câu hỏi chống sao chép",
          maxPoints: 10,
        },
      ],
      status: "PUBLISHED",
      version: 1,
      createdById: session.user.id || "instructor-1",
      createdAt: new Date().toISOString(),
    };
    (newAssign as any).durationMinutes = manualExamDuration;
    (newAssign as any).totalQuestions = pickedQuestions.length;
    (newAssign as any).questions = pickedQuestions;
    (newAssign as any).questionIds = pickedQuestions.map((q) => q.id);

    // Lưu vật lý vào CSDL PostgreSQL
    try {
      const created = await apiRequest<Assignment>(`/instructor/classes/${item.id}/assignments`, {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          title: newAssign.title,
          description: newAssign.description,
          instructions: newAssign.instructions,
          dueAt: newAssign.dueAt,
          maxScore: 10,
          rubric: newAssign.rubric,
        }),
      });
      if (created?.id) {
        newAssign.id = created.id;
        await apiRequest(`/instructor/assignments/${created.id}/publish`, {
          method: "POST",
          roleCode: session.roleCode,
        }).catch(() => null);
      }
    } catch (e) {
      console.warn("Lưu CSDL lỗi:", e);
    }

    const nextList = [newAssign, ...assignments];
    setAssignments(nextList);
    setSelectedAssignment(newAssign);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`wind_assignments_${item.id}`, JSON.stringify(nextList));
        localStorage.setItem(`wind_exam_questions_${newAssign.id}`, JSON.stringify(pickedQuestions));
      } catch (e) {}
    }

    setManualExamModalOpen(false);
    setManualExamTitle("");
    notify(`Đã bốc ngẫu nhiên và tạo đề thi '${newAssign.title}' (${pickedQuestions.length} câu) thành công!`, "success");
  };

  // Xóa câu hỏi khỏi ngân hàng của lớp
  const handleDeleteClassQuestion = async (questionId: string) => {
    if (window.confirm("Bạn có chắc muốn xóa câu hỏi này khỏi ngân hàng câu hỏi lớp không?")) {
      try {
        await apiRequest(`/instructor/question-bank/questions/${questionId}`, {
          method: "DELETE",
          roleCode: session.roleCode,
        }).catch((err) => console.warn("Lỗi xóa CSDL:", err));
      } catch (e) {}

      setClassQuestions((prev) => prev.filter((q) => q.id !== questionId));
      notify("Đã xóa câu hỏi khỏi ngân hàng lớp!", "success");
    }
  };

  // Lưu thêm tài liệu mới trực tiếp vào cơ sở dữ liệu PostgreSQL
  const handleSaveNewMaterial = async () => {
    if (!materialFormTitle.trim()) {
      notify("Vui lòng nhập tên tài liệu!", "error");
      return;
    }
    try {
      notify("Đang lưu tài liệu vào cơ sở dữ liệu...", "info");
      await apiRequest<Material>(
        `/instructor/classes/${item.id}/materials`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({
            name: materialFormTitle.trim(),
            mimeType: materialFormFileType === "pdf" ? "application/pdf" : materialFormFileType === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            folder: materialFormFolder,
            tags: ["Tài liệu", materialFormFileType.toUpperCase()],
            scope: "CLASS",
            description: materialFormDesc.trim() || "Tài liệu học tập được chia sẻ cho lớp.",
          }),
        }
      ).catch((err) => {
        console.warn("API tạo material lớp cảnh báo:", err);
      });

      const newMat: MaterialDisplayItem = {
        id: `mat-${Date.now()}`,
        title: materialFormTitle.trim(),
        folder: materialFormFolder,
        fileType: materialFormFileType,
        size: materialFormSize || "2.0 MB",
        pageCount: Number(materialFormPageCount) || 10,
        downloadsCount: 0,
        uploadedAt: new Date().toLocaleDateString("vi-VN"),
        description: materialFormDesc.trim() || "Tài liệu học tập được chia sẻ cho lớp.",
      };
      setMaterialsList((prev) => [newMat, ...prev]);
      setSelectedMaterialId(newMat.id);
      await loadClassData();
      setAddMaterialModalOpen(false);
      setMaterialFormTitle("");
      setMaterialFormDesc("");
      notify("Đã thêm tài liệu mới vào cơ sở dữ liệu thành công!", "success");
    } catch (err: any) {
      console.error("Lỗi khi lưu tài liệu:", err);
      notify(err?.message || "Không thể lưu tài liệu vào cơ sở dữ liệu", "error");
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
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(window.location.href);
                        notify("Đã sao chép link lớp học!", "success");
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
              <nav className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-2 py-1">
                  Danh mục
                </p>
                {[
                  { id: "feed" as const, label: "Bảng tin", icon: MessageSquare },
                  { id: "schedule" as const, label: "Lịch học", icon: CalendarDays },
                  { id: "members" as const, label: "Thành viên", icon: Users },
                  { id: "assignments" as const, label: "Bài tập", icon: FileText },
                  { id: "lectures" as const, label: "Bài giảng", icon: Video, active: true },
                  { id: "materials" as const, label: "Tài liệu", icon: Folder },
                ].map(({ id, label, icon: Icon, active }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setSelectedLectureForPage(null);
                      handleSelectTab(id);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-bold transition-all text-left cursor-pointer ${
                      active
                        ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 shadow-2xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-blue-600 dark:text-blue-400" : "text-slate-400"} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </nav>
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
                    onClick={() => {
                      if (typeof navigator !== "undefined" && navigator.clipboard) {
                        void navigator.clipboard.writeText(window.location.href);
                        notify("Đã sao chép liên kết lớp học!");
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
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Lịch học của lớp ({item.name})
                </h1>
                <p className="text-xs text-slate-500">Quản lý các ca học, phòng học trực tuyến và điểm danh</p>
              </div>
              <button
                type="button"
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus size={15} />
                <span>Thêm buổi học mới</span>
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { title: "Buổi 1: Giới thiệu chung", date: "Thứ Hai, 27/10/2026", time: "18:00 - 19:30", status: "COMPLETED" },
                { title: "Buổi 2: Phương trình bậc hai", date: "Thứ Tư, 29/10/2026", time: "18:00 - 19:30", status: "SCHEDULED" },
                { title: "Buổi 3: Luyện tập & Giải đề", date: "Thứ Sáu, 31/10/2026", time: "18:00 - 19:30", status: "SCHEDULED" },
              ].map((s, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                      {s.status === "COMPLETED" ? "Đã diễn ra" : "Sắp tới"}
                    </span>
                    <Clock size={14} className="text-slate-400" />
                  </div>
                  <h3 className="text-xs font-extrabold">{s.title}</h3>
                  <div className="text-[11px] text-slate-500 space-y-1">
                    <div>📅 {s.date}</div>
                    <div>⏰ {s.time}</div>
                  </div>
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer"
                    >
                      Vào phòng
                    </button>
                    <button
                      type="button"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
                    >
                      Điểm danh
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
                    <th className="px-4 py-3 text-right">Trạng thái</th>
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
                    <td className="px-4 py-3 text-right text-emerald-600 font-bold">Phụ trách</td>
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
                        <td className="px-4 py-3 text-right text-emerald-600 font-bold">Đang học</td>
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
                    <button
                      type="button"
                      onClick={() => notify("Đã gỡ quyền đồng giáo viên!", "success")}
                      className="text-xs text-rose-600 hover:underline font-bold cursor-pointer"
                    >
                      Gỡ quyền
                    </button>
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
                          durationMinutes: (selectedAssignment as any).durationMinutes || 45,
                          totalQuestions: (selectedAssignment as any).totalQuestions || 10,
                          remainingAttempts: null,
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
                              l.email.toLowerCase().includes(assignmentStudentSearch.toLowerCase())
                            );
                          })
                          .filter((l) => {
                            const name = l.displayName || l.email || "";
                            const stat = studentAttemptStats.find(
                              (s) =>
                                s.learnerId === l.id ||
                                s.learnerName.toLowerCase() === name.toLowerCase()
                            );
                            if (assignmentStatusFilter === "SUBMITTED") return !!stat;
                            if (assignmentStatusFilter === "NOT_STARTED") return !stat;
                            return true;
                          })
                          .map((learner, index) => {
                            const studentName = learner.displayName || learner.email || "Học sinh";
                            const stat = studentAttemptStats.find(
                              (s) =>
                                s.learnerId === learner.id ||
                                s.learnerName.toLowerCase() === studentName.toLowerCase()
                            );
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
                                  {stat ? "1/1" : "0/1"}
                                </td>
                                <td className="px-4 py-3.5 text-center font-bold">
                                  {stat ? (
                                    <span
                                      className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getScoreColorClass(
                                        stat.bestScore,
                                        stat.maxScore || 10
                                      )}`}
                                    >
                                      {stat.bestScore}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">--</span>
                                  )}
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  {stat ? "15 phút" : "--"}
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  {stat ? stat.submittedAt : "--"}
                                </td>
                                <td className="px-4 py-3.5 text-center text-slate-500">
                                  {stat ? "0" : "--"}
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
                          Chưa có bài tập nào. Bấm "+ Tạo bài tập" để thêm mới.
                        </div>
                      ) : (
                        assignments
                          .filter((assign) => !searchQuery || assign.title.toLowerCase().includes(searchQuery.toLowerCase()))
                          .map((assign) => {
                            const isSelected = selectedAssignment?.id === assign.id;
                            const submittedCount = studentAttemptStats.length;
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
                                durationMinutes: (selectedAssignment as any).durationMinutes || 45,
                                totalQuestions: (selectedAssignment as any).totalQuestions || 10,
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

                          {/* Di chuyển */}
                          <button
                            type="button"
                            onClick={() => notify("Chọn thư mục đích để di chuyển bài tập", "info")}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                          >
                            <span>Di chuyển</span>
                            <Folder size={16} className="text-slate-400" />
                          </button>

                          {/* Chỉnh sửa */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditAssignment(selectedAssignment)}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                          >
                            <span>Chỉnh sửa</span>
                            <Edit2 size={16} className="text-slate-400" />
                          </button>

                          {/* Xuất dữ liệu */}
                          <button
                            type="button"
                            onClick={() => notify("Đang xuất dữ liệu bài tập ra file Excel...", "info")}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                          >
                            <span>Xuất dữ liệu</span>
                            <Download size={16} className="text-slate-400" />
                          </button>

                          {/* Xóa */}
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Bạn có chắc muốn xóa bài tập "${selectedAssignment.title}"?`)) {
                                setAssignments(assignments.filter((a) => a.id !== selectedAssignment.id));
                                setSelectedAssignment(null);
                                notify("Đã xóa bài tập thành công!", "success");
                              }
                            }}
                            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                          >
                            <span>Xóa</span>
                            <Trash2 size={16} className="text-rose-500" />
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

        {/* TAB 6: BẢNG ĐIỂM (TỔNG HỢP VỚI CÁC CỘT CHIA NHỎ THEO LẦN LÀM) */}
        {activeTab === "gradebook" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Bảng điểm tổng hợp ({item.name})
                </h1>
                <p className="text-xs text-slate-500">
                  Cột 1: Tên học sinh | Cột 2: Điểm trung bình | Cột 3 trở đi: Tách nhỏ theo từng lần làm bài
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-64">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Tìm theo tên học sinh..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => notify("Đang xuất bảng điểm ra file CSV...", "info")}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download size={14} />
                  <span>Xuất Excel</span>
                </button>
              </div>
            </div>

            {/* Bảng điểm chi tiết */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-x-auto shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-extrabold text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 sticky left-0 bg-slate-50 dark:bg-slate-800 z-10 min-w-44 border-r border-slate-200 dark:border-slate-800">
                      Cột 1: Tên học sinh
                    </th>
                    <th className="px-4 py-3 text-center min-w-28 border-r border-slate-200 dark:border-slate-800 bg-blue-50/60 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">
                      Cột 2: Điểm TB
                    </th>
                    {/* Cột bài kiểm tra 1 (có 2 lần làm bài) */}
                    <th colSpan={2} className="px-4 py-2 text-center border-r border-slate-200 dark:border-slate-800">
                      <div className="border-b border-slate-200 dark:border-slate-700 pb-1">Bài kiểm tra 15p</div>
                      <div className="flex justify-around text-[9px] pt-1 text-slate-400">
                        <span>Lần 1</span>
                        <span>Lần 2</span>
                      </div>
                    </th>
                    {/* Cột bài kiểm tra 2 (có 3 lần làm bài) */}
                    <th colSpan={3} className="px-4 py-2 text-center border-r border-slate-200 dark:border-slate-800">
                      <div className="border-b border-slate-200 dark:border-slate-700 pb-1">Kiểm tra giữa kỳ</div>
                      <div className="flex justify-around text-[9px] pt-1 text-slate-400">
                        <span>Lần 1</span>
                        <span>Lần 2</span>
                        <span>Lần 3</span>
                      </div>
                    </th>
                    {/* Cột bài tập về nhà */}
                    <th className="px-4 py-3 text-center min-w-28">Bài tập tuần 1</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {studentAttemptStats
                    .filter((s) => !searchQuery || s.learnerName.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((student) => {
                      // Tính điểm trung bình
                      const avg = (student.bestScore * 0.9).toFixed(1);
                      return (
                        <tr key={student.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          {/* Cột 1: Tên học sinh */}
                          <td className="px-4 py-3 font-bold sticky left-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-10 flex items-center gap-2">
                            <UserAvatar name={student.learnerName} className="size-6 text-[10px]" />
                            <span className="truncate">{student.learnerName}</span>
                          </td>

                          {/* Cột 2: Điểm trung bình */}
                          <td className="px-4 py-3 text-center font-extrabold border-r border-slate-200 dark:border-slate-800 bg-blue-50/30 dark:bg-blue-950/20">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold border ${getScoreColorClass(
                                Number(avg),
                                10,
                              )}`}
                            >
                              {avg}
                            </span>
                          </td>

                          {/* Cột bài 1: Lần 1 & Lần 2 */}
                          <td className="px-2 py-3 text-center border-r border-slate-100 dark:border-slate-800">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.attempts[0]?.score ?? 5.0,
                              )}`}
                            >
                              {student.attempts[0]?.score ?? "-"}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-center border-r border-slate-200 dark:border-slate-800">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.attempts[1]?.score ?? 7.0,
                              )}`}
                            >
                              {student.attempts[1]?.score ?? "-"}
                            </span>
                          </td>

                          {/* Cột bài 2: Lần 1, 2, 3 */}
                          <td className="px-2 py-3 text-center border-r border-slate-100 dark:border-slate-800">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.attempts[0]?.score ?? 6.0,
                              )}`}
                            >
                              {student.attempts[0]?.score ?? "-"}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-center border-r border-slate-100 dark:border-slate-800">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.attempts[1]?.score ?? 8.5,
                              )}`}
                            >
                              {student.attempts[1]?.score ?? "-"}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-center border-r border-slate-200 dark:border-slate-800">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.attempts[2]?.score ?? 9.0,
                              )}`}
                            >
                              {student.attempts[2]?.score ?? "-"}
                            </span>
                          </td>

                          {/* Cột bài tập về nhà */}
                          <td className="px-3 py-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-bold ${getScoreColorClass(
                                student.bestScore,
                              )}`}
                            >
                              {student.bestScore}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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

                  {lectureFolders.map((folderName) => {
                    const isExpanded = lectureFolderExpanded[folderName] ?? true;
                    const isSelected = selectedLectureFolder === folderName;
                    return (
                      <div key={folderName} className="space-y-0.5">
                        <div
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                          onClick={() => setSelectedLectureFolder(folderName)}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLectureFolderExpanded((prev) => ({
                                  ...prev,
                                  [folderName]: !isExpanded,
                                }));
                              }}
                              className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            >
                              <ChevronRight
                                size={13}
                                className={`transition-transform duration-150 ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                              />
                            </button>
                            <Folder
                              size={15}
                              className={
                                isSelected
                                  ? "text-blue-600 fill-blue-500/20"
                                  : "text-slate-500"
                              }
                            />
                            <span className="truncate">{folderName}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                      onChange={(e) => setLectureSort(e.target.value as any)}
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

                  {materialFolders.map((folderName) => {
                    const isExpanded = materialFolderExpanded[folderName] ?? true;
                    const isSelected = selectedMaterialFolder === folderName;
                    return (
                      <div key={folderName} className="space-y-0.5">
                        <div
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "text-blue-600 dark:text-blue-400 font-bold bg-blue-50/80 dark:bg-blue-950/50"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                          }`}
                          onClick={() => setSelectedMaterialFolder(folderName)}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMaterialFolderExpanded((prev) => ({
                                  ...prev,
                                  [folderName]: !isExpanded,
                                }));
                              }}
                              className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            >
                              <ChevronRight
                                size={13}
                                className={`transition-transform duration-150 ${
                                  isExpanded ? "rotate-90" : ""
                                }`}
                              />
                            </button>
                            <Folder
                              size={15}
                              className={
                                isSelected
                                  ? "text-blue-600 fill-blue-500/20"
                                  : "text-slate-500"
                              }
                            />
                            <span className="truncate">{folderName}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
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
                      onChange={(e) => setMaterialSort(e.target.value as any)}
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
                                {mat.size} · {mat.pageCount || 10} trang · Tải lên {mat.uploadedAt}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                              {mat.downloadsCount || 20} lượt tải
                            </span>
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
                        <span>Số trang</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {activeMaterialItem.pageCount || 15} trang
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                        <span>Lượt tải</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {activeMaterialItem.downloadsCount || 35} lượt
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
                        onClick={() => notify(`Đang tải xuống tệp ${activeMaterialItem.title}...`, "success")}
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
                      Học sinh nộp sau thời hạn sẽ được đánh dấu "Nộp muộn"
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
                    setSettingsSaving(true);
                    setTimeout(() => {
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
              {/* BƯỚC 1: VÙNG TRÁI - Chọn nguồn & Kiểm tra tính toàn vẹn */}
              <div className="space-y-4 border-r border-slate-100 dark:border-slate-800 pr-0 md:pr-6">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-sky-600 block">
                  Bước 1: Chọn cách thêm bài giảng
                </span>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLectureMethod("LINK");
                      setLecturePreviewReady(false);
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
                      setLecturePreviewReady(false);
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

                    {lectureUploadProgress > 0 && (
                      <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                        <div className="flex justify-between font-bold text-[11px]">
                          <span>{lectureFileObj?.name}</span>
                          <span>{lectureUploadProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                          <div className="bg-sky-600 h-full transition-all" style={{ width: `${lectureUploadProgress}%` }} />
                        </div>
                        {lectureIntegrityChecking && (
                          <p className="text-[10px] text-sky-600 font-bold animate-pulse">
                            ⏳ Đang kiểm tra toàn vẹn tệp...
                          </p>
                        )}
                        {lecturePreviewReady && (
                          <p className="text-[10px] text-emerald-600 font-bold">
                            ✓ Bản xem trước đã sẵn sàng!
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* BƯỚC 2: VÙNG PHẢI - Điền thông tin & Liên kết bài tập/tài liệu (Trượt vào trong 280ms) */}
              <div
                className={`space-y-4 transition-all duration-280 ${
                  lectureMethod === "LINK" || lecturePreviewReady
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
                /* Xem chi tiết bài làm của 1 học sinh */
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setSelectedStudentAttempt(null)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:underline"
                  >
                    ← Quay lại bảng thống kê
                  </button>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between">
                    <div>
                      <strong className="text-sm font-bold block">{selectedStudentAttempt.learnerName}</strong>
                      <span className="text-xs text-slate-500">{selectedStudentAttempt.learnerEmail}</span>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-extrabold border ${getScoreColorClass(
                        selectedStudentAttempt.bestScore,
                        selectedStudentAttempt.maxScore,
                      )}`}
                    >
                      Điểm cao nhất: {selectedStudentAttempt.bestScore} / {selectedStudentAttempt.maxScore}đ
                    </span>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-xs font-extrabold uppercase text-slate-400">Các câu hỏi & bài làm:</h4>
                    {selectedStudentAttempt.attempts[0]?.answers?.map((ans, aIdx) => (
                      <div
                        key={aIdx}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 text-xs"
                      >
                        <div className="flex justify-between font-bold">
                          <span>Câu {aIdx + 1}: {ans.questionContent}</span>
                          <span className={ans.isCorrect ? "text-emerald-600 font-extrabold" : "text-rose-600 font-extrabold"}>
                            {ans.score} / {ans.maxScore}đ
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                          <span className="text-slate-400 block text-[10px]">BÀI LÀM CỦA HỌC SINH:</span>
                          <strong>{ans.learnerAnswer}</strong>
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300">
                          <span className="text-emerald-600 block text-[10px] font-bold">ĐÁP ÁN CHUẨN:</span>
                          <span>{ans.correctAnswer}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Bảng danh sách học sinh */
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 uppercase font-extrabold text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Học sinh</th>
                      <th className="px-4 py-3 text-center">Số lần làm</th>
                      <th className="px-4 py-3 text-center">Điểm số</th>
                      <th className="px-4 py-3 text-center">Thời lượng</th>
                      <th className="px-4 py-3">Thời gian nộp</th>
                      <th className="px-4 py-3 text-right">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {studentAttemptStats.map((stat) => (
                      <tr key={stat.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 font-bold flex items-center gap-2">
                          <UserAvatar name={stat.learnerName} className="size-6 text-[10px]" />
                          <span>{stat.learnerName}</span>
                        </td>
                        <td className="px-4 py-3 text-center font-bold">{stat.attemptCount} lần</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`px-2.5 py-0.5 rounded-full font-extrabold text-xs border ${getScoreColorClass(
                              stat.bestScore,
                              stat.maxScore,
                            )}`}
                          >
                            {stat.bestScore} / {stat.maxScore}đ
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-500">{stat.durationMinutes} phút</td>
                        <td className="px-4 py-3 text-slate-500">{stat.submittedAt}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedStudentAttempt(stat)}
                            className="text-xs font-bold text-sky-600 hover:underline"
                          >
                            Xem bài làm
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    void navigator.clipboard.writeText(window.location.href);
                    notify("Đã sao chép liên kết chia sẻ!", "success");
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
                        {editLectureUploadProgress > 0 && <span>{editLectureUploadProgress}%</span>}
                      </div>

                      {editLectureUploadProgress > 0 && (
                        <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-sky-600 h-full transition-all"
                            style={{ width: `${editLectureUploadProgress}%` }}
                          />
                        </div>
                      )}

                      {editLectureIntegrityChecking && (
                        <p className="text-[10px] text-sky-600 font-bold animate-pulse">
                          ⏳ Đang kiểm tra toàn vẹn tệp...
                        </p>
                      )}
                      {editLecturePreviewReady && (
                        <p className="text-[10px] text-emerald-600 font-bold">
                          ✓ Đã sẵn sàng cập nhật nguồn bài giảng!
                        </p>
                      )}
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

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Loại tệp:
                  </label>
                  <select
                    value={materialFormFileType}
                    onChange={(e) => setMaterialFormFileType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="pdf">PDF</option>
                    <option value="xlsx">Excel (XLSX)</option>
                    <option value="doc">Word (DOC/DOCX)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Dung lượng hiển thị:
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: 3.2 MB"
                    value={materialFormSize}
                    onChange={(e) => setMaterialFormSize(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Số trang:
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={materialFormPageCount}
                    onChange={(e) => setMaterialFormPageCount(Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  />
                </div>
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
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveNewMaterial}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs"
              >
                Tải lên & Lưu
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
                  <input type="file" onChange={handleEditMaterialFileSelect} className="hidden" />
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
                  <div className="flex gap-2">
                    <select
                      value={editMaterialFormFileType}
                      onChange={(e) => setEditMaterialFormFileType(e.target.value as any)}
                      className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 uppercase font-bold"
                    >
                      <option value="pdf">PDF</option>
                      <option value="xlsx">XLSX</option>
                      <option value="doc">DOC</option>
                    </select>
                    <input
                      type="text"
                      value={editMaterialFormSize}
                      onChange={(e) => setEditMaterialFormSize(e.target.value)}
                      className="w-1/2 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                    />
                  </div>
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
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditMaterial}
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer"
              >
                Lưu toàn bộ thay đổi
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Thư mục lưu trữ:
                  </label>
                  <select
                    value={editAssignmentFolder}
                    onChange={(e) => setEditAssignmentFolder(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="Tuần 1 - Nhập môn">Tuần 1 - Nhập môn</option>
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
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer"
              >
                Lưu bài tập
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
              {/* Cách 1: Soạn câu hỏi thủ công */}
              <button
                type="button"
                onClick={() => {
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
                  Nhập câu hỏi trắc nghiệm hoặc tự luận, tùy biến các lựa chọn A/B/C/D, đáp án đúng và lời giải chi tiết.
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

              {/* Cách 3: Tạo đề thi bằng AI */}
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
                  3. Tạo đề thi bằng AI
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
                    onChange={(e) => setAuthoringType(e.target.value as any)}
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
                    onChange={(e) => setAuthoringDifficulty(e.target.value as any)}
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

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Lời giải chi tiết:
                </label>
                <textarea
                  rows={2}
                  placeholder="Gợi ý hoặc các bước giải chi tiết..."
                  value={authoringSolution}
                  onChange={(e) => setAuthoringSolution(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 resize-none"
                />
              </div>

              {/* Tùy chọn tạo bài tập ngay */}
              <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-blue-900 dark:text-blue-100">
                  <input
                    type="checkbox"
                    checked={authoringSaveAsAssignment || creationTarget === "ASSIGNMENT"}
                    onChange={(e) => setAuthoringSaveAsAssignment(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  <span>Đồng thời tạo thành Bài tập cho lớp ngay lập tức</span>
                </label>
                {(authoringSaveAsAssignment || creationTarget === "ASSIGNMENT") && (
                  <input
                    type="text"
                    placeholder="Tiêu đề bài tập (để trống sẽ tự sinh)..."
                    value={authoringAssignmentTitle}
                    onChange={(e) => setAuthoringAssignmentTitle(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100"
                  />
                )}
              </div>
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
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer"
              >
                Lưu câu hỏi
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
                    Đề thi thử THPT Quốc Gia - Môn Toán học (Phiếu 01)
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Ảnh chụp 4 câu hỏi trắc nghiệm đã được tải lên và sẵn sàng phân tích.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Công nghệ AI OCR:
                  </label>
                  <select
                    value={scanProvider}
                    onChange={(e) => setScanProvider(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100 font-semibold"
                  >
                    <option value="Gemini 1.5 Pro (Khuyên dùng)">Gemini 1.5 Pro (Độ chính xác cao nhất)</option>
                    <option value="Gemini 1.5 Flash">Gemini 1.5 Flash (Tốc độ siêu nhanh)</option>
                    <option value="Claude 3.5 Sonnet">Claude 3.5 Sonnet</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleTriggerScanExam}
                  disabled={scanStatus === "SCANNING"}
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
                    ✓ Đã nhận diện đáp án
                  </span>
                </div>

                <div className="space-y-3">
                  {scannedExamQuestions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850 space-y-2"
                    >
                      <strong className="block font-bold text-slate-800 dark:text-slate-200">
                        {q.content}
                      </strong>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        {q.options.map((opt, optIdx) => {
                          const prefix = String.fromCharCode(65 + optIdx);
                          const isCorrect = prefix === q.correctKey;
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
                onClick={() => handleSaveScannedExam(false)}
                className="px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-100 transition cursor-pointer"
              >
                Lưu vào Ngân hàng
              </button>
              <button
                type="button"
                onClick={() => handleSaveScannedExam(true)}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs cursor-pointer"
              >
                Tạo bài tập cho lớp
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
                    onChange={(e) => setAiDifficulty(e.target.value as any)}
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

              {/* Danh sách câu hỏi do AI tạo */}
              {aiGeneratedItems.length > 0 && (
                <div className="space-y-3 pt-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-600 block">
                    Đã sinh thành công {aiGeneratedItems.length} câu hỏi:
                  </span>
                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {aiGeneratedItems.map((q, idx) => (
                      <div
                        key={q.id}
                        className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-1.5"
                      >
                        <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                          {q.content}
                        </strong>
                        <div className="grid grid-cols-2 gap-1 text-[11px]">
                          {q.options.map((opt, oIdx) => {
                            const pfx = String.fromCharCode(65 + oIdx);
                            const isCor = pfx === q.correctKey;
                            return (
                              <span
                                key={oIdx}
                                className={`px-2 py-0.5 rounded ${
                                  isCor
                                    ? "bg-emerald-100 dark:bg-emerald-900/80 font-bold text-emerald-800 dark:text-emerald-200"
                                    : "text-slate-500"
                                }`}
                              >
                                {pfx}. {opt}
                              </span>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-slate-500 italic pt-0.5">
                          💡 Giải thích: {q.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={() => setAiExamModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => handleSaveAiExam(false)}
                disabled={aiGeneratedItems.length === 0}
                className="px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100 transition cursor-pointer disabled:opacity-40"
              >
                Lưu vào Ngân hàng
              </button>
              <button
                type="button"
                onClick={() => handleSaveAiExam(true)}
                disabled={aiGeneratedItems.length === 0}
                className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs cursor-pointer disabled:opacity-40"
              >
                Tạo bài tập cho lớp
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
                              if (editingQuestionData.type === "Nhiều đáp án") {
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
                className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-xs cursor-pointer"
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
                      <span>2. Chọn mốc (AI chọn)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-tight">
                      Chọn tỷ lệ ma trận độ khó, AI tự lọc câu hỏi chuẩn xác.
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
                        Chọn câu hỏi ({manualExamSelectedQuestions.length}/{classQuestions.length} câu đã chọn):
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
                        const currentPool = classQuestions
                          .filter((q) => {
                            if (manualExamFilterScope === "MULTIPLE_CHOICE") return q.type !== "Tự luận";
                            if (manualExamFilterScope === "ESSAY") return q.type === "Tự luận";
                            return true;
                          })
                          .map((q) => q.id);
                        if (manualExamSelectedQuestions.length >= currentPool.length) {
                          setManualExamSelectedQuestions([]);
                        } else {
                          setManualExamSelectedQuestions(currentPool);
                        }
                      }}
                      className="text-indigo-600 font-bold hover:underline cursor-pointer"
                    >
                      {manualExamSelectedQuestions.length > 0 ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                    {classQuestions
                      .filter((q) => {
                        if (manualExamFilterScope === "MULTIPLE_CHOICE") return q.type !== "Tự luận";
                        if (manualExamFilterScope === "ESSAY") return q.type === "Tự luận";
                        return true;
                      })
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
                                  setManualExamSelectedQuestions([...manualExamSelectedQuestions, q.id]);
                                } else {
                                  setManualExamSelectedQuestions(
                                    manualExamSelectedQuestions.filter((id) => id !== q.id)
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
                        max={Math.max(1, classQuestions.length)}
                        value={aiCriteriaQuestionCount}
                        onChange={(e) => setAiCriteriaQuestionCount(Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                        Phạm vi câu hỏi:
                      </label>
                      <select
                        value={aiCriteriaScope}
                        onChange={(e) => setAiCriteriaScope(e.target.value as any)}
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
                        const val = e.target.value as any;
                        setAiCriteriaPreset(val);
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
                          onChange={(e) => setAiRatioBasic(Number(e.target.value))}
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
                          onChange={(e) => setAiRatioMedium(Number(e.target.value))}
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
                          onChange={(e) => setAiRatioHard(Number(e.target.value))}
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
                          onChange={(e) => setAiRatioVeryHard(Number(e.target.value))}
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
                      <span>AI Lọc câu hỏi & Xem trước</span>
                    </button>
                    {aiCriteriaPreviewList.length > 0 && (
                      <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                        ✓ Đã chọn {aiCriteriaPreviewList.length} câu hỏi theo mốc
                      </span>
                    )}
                  </div>

                  {/* Danh sách câu hỏi AI đã lọc để giáo viên kiểm tra */}
                  {aiCriteriaPreviewList.length > 0 && (
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
                        max={Math.max(1, classQuestions.length)}
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
                        onChange={(e) => setRandomTypeScope(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                      >
                        <option value="ALL">Tất cả câu hỏi ({classQuestions.length} câu)</option>
                        <option value="MULTIPLE_CHOICE">Chỉ trắc nghiệm ({classQuestionStats.multipleChoice} câu)</option>
                        <option value="ESSAY">Chỉ tự luận ({classQuestionStats.essay} câu)</option>
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
                  disabled={manualExamSelectedQuestions.length === 0}
                  className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-xs cursor-pointer disabled:opacity-40"
                >
                  Tạo đề thi thủ công ({manualExamSelectedQuestions.length} câu)
                </button>
              )}

              {examCreationMode === "AI_CRITERIA" && (
                <button
                  type="button"
                  onClick={handleCreateExamAiCriteria}
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow-xs cursor-pointer"
                >
                  Xác nhận & Tạo đề thi bằng AI
                </button>
              )}

              {examCreationMode === "RANDOM" && (
                <button
                  type="button"
                  onClick={handleCreateExamRandom}
                  className="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 shadow-xs cursor-pointer"
                >
                  Bốc ngẫu nhiên & Tạo đề thi
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
              Chọn thư mục / lớp đích để chuyển <strong className="text-slate-900 dark:text-slate-100">"{itemForMove.title}"</strong>:
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

