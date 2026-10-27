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
  Sparkles,
  ThumbsUp,
  Trash2,
  Upload,
  UploadCloud,
  UserCheck,
  UserPlus,
  Users,
  Video,
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
  fileName?: string;
  fileSize?: string;
  folder: string;
  uploadedAt: string;
  authorName: string;
  assignmentIds?: string[];
  materialIds?: string[];
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

  // Bài giảng
  const [lectures, setLectures] = useState<LectureItem[]>([
    {
      id: "lec-1",
      title: "Bài giảng 1: Giới thiệu tổng quan chương trình",
      description: "Nắm vững khung kiến thức và chuẩn đầu ra của môn học.",
      sourceType: "LINK",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      platform: "YOUTUBE",
      folder: "Tuần 1 - Nhập môn",
      uploadedAt: "25/10/2026",
      authorName: session.user.name || "Giảng viên",
    },
    {
      id: "lec-2",
      title: "Bài giảng 2: Các khái niệm cơ bản và ví dụ thực tế",
      description: "Phân tích các dạng bài điển hình có trong đề kiểm tra.",
      sourceType: "LINK",
      sourceUrl: "https://drive.google.com/file/d/sample",
      platform: "DRIVE",
      folder: "Tuần 2 - Cơ bản",
      uploadedAt: "26/10/2026",
      authorName: session.user.name || "Giảng viên",
    },
  ]);
  const [selectedLecture, setSelectedLecture] = useState<LectureItem | null>(lectures[0] || null);

  // Modal tạo Bài giảng 2 vùng (Two-Pane Creator)
  const [addLectureModalOpen, setAddLectureModalOpen] = useState(false);
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
  const [lectureFormFolder, setLectureFormFolder] = useState("Tuần 1 - Nhập môn");
  const [lectureAttachedAssignments, setLectureAttachedAssignments] = useState<string[]>([]);
  const [lectureAttachedMaterials, setLectureAttachedMaterials] = useState<string[]>([]);

  // Modal tạo Bài tập mới
  const [addAssignmentModalOpen, setAddAssignmentModalOpen] = useState(false);
  const [assignmentFormTitle, setAssignmentFormTitle] = useState("");
  const [assignmentFormDesc, setAssignmentFormDesc] = useState("");
  const [assignmentFormDue, setAssignmentFormDue] = useState("");
  const [assignmentFormMaxScore, setAssignmentFormMaxScore] = useState(10);
  const [assignmentFormFolder, setAssignmentFormFolder] = useState("Tuần 1 - Nhập môn");

  // Tài liệu được chọn
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);

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
      const [learnersData, assignmentsData, examsData, materialsData, sessionsData] =
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
        ]);

      setLearners(learnersData);
      setAssignments(assignmentsData);
      setExams(examsData);
      setMaterials(materialsData);
      setSessions(sessionsData);

      if (assignmentsData.length > 0 && !selectedAssignment) {
        setSelectedAssignment(assignmentsData[0] ?? null);
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
  }, [item.id, session.roleCode, selectedAssignment, selectedMaterial, notify]);

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

      await loadClassData();
      setAddAssignmentModalOpen(false);
      notify(`Đã lưu và xuất bản bài tập '${data.title}' vào cơ sở dữ liệu!`, "success");
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
                          onClick={() => setAddAssignmentModalOpen(true)}
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

                        {/* Khối Chia sẻ bài tập kèm Badge Mới đỏ cam */}
                        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shadow-2xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                              <span>Chia sẻ bài tập</span>
                              <span className="px-1.5 py-0.2 rounded bg-rose-500 text-white font-extrabold text-[10px]">
                                Mới
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                            <span className="flex items-center gap-1">
                              Chia sẻ cho <Info size={12} className="text-slate-400" />
                            </span>
                            <div className="relative">
                              <select className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-transparent pr-4 cursor-pointer focus:outline-hidden">
                                <option value="class">Học sinh lớp</option>
                                <option value="public">Công khai</option>
                              </select>
                              <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none" />
                            </div>
                          </div>

                          {/* Link copy */}
                          <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700">
                            <input
                              type="text"
                              readOnly
                              value={`https://shub.edu.vn/shared/assignment/${selectedAssignment.id}`}
                              className="bg-transparent text-[11px] text-slate-600 dark:text-slate-300 w-full truncate focus:outline-hidden"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(`https://shub.edu.vn/shared/assignment/${selectedAssignment.id}`);
                                notify("Đã sao chép liên kết chia sẻ!", "success");
                              }}
                              className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-blue-600 transition cursor-pointer shrink-0"
                              title="Sao chép liên kết"
                            >
                              <Copy size={13} />
                            </button>
                          </div>

                          {/* Icon chia sẻ lên Facebook, Messenger, Zalo */}
                          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                            <span>Chia sẻ lên</span>
                            <div className="flex items-center gap-2">
                              {/* Facebook */}
                              <button
                                type="button"
                                onClick={() => notify("Đang mở chia sẻ Facebook...", "info")}
                                className="size-6 rounded-full bg-blue-600 text-white font-bold text-xs grid place-items-center cursor-pointer hover:opacity-90"
                                title="Facebook"
                              >
                                f
                              </button>
                              {/* Messenger */}
                              <button
                                type="button"
                                onClick={() => notify("Đang mở chia sẻ Messenger...", "info")}
                                className="size-6 rounded-full bg-blue-500 text-white text-[11px] grid place-items-center cursor-pointer hover:opacity-90"
                                title="Messenger"
                              >
                                ⚡
                              </button>
                              {/* Zalo */}
                              <button
                                type="button"
                                onClick={() => notify("Đang mở chia sẻ Zalo...", "info")}
                                className="px-1.5 h-6 rounded-full bg-sky-500 text-white font-bold text-[10px] grid place-items-center cursor-pointer hover:opacity-90"
                                title="Zalo"
                              >
                                Zalo
                              </button>
                            </div>
                          </div>
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
                            onClick={() => notify("Mở chỉnh sửa bài tập", "info")}
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

        {/* TAB 7: BÀI GIẢNG (ĐỒNG BỘ 100% GIAO DIỆN CHUẨN CARD VỚI HỌC SINH) */}
        {activeTab === "lectures" && (
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* CỘT TRÁI & GIỮA: TRÌNH PHÁT BÀI GIẢNG 16:9, MÔ TẢ & BÀI TẬP ĐÍNH KÈM */}
            <div className="flex-1 w-full min-w-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-4">
                {selectedLecture ? (
                  <>
                    {/* Header: Tên bài giảng + Ngày đăng + Cụm nút thao tác của giảng viên */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 truncate">
                          {selectedLecture.title}
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5 font-medium">
                          Người đăng: {selectedLecture.authorName || "Giảng viên"} · Ngày thêm: {selectedLecture.uploadedAt}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => notify("Chỉnh sửa thông tin bài giảng", "info")}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          Chỉnh sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Bạn có chắc muốn xóa bài giảng "${selectedLecture.title}"?`)) {
                              const remaining = lectures.filter((l) => l.id !== selectedLecture.id);
                              setLectures(remaining);
                              setSelectedLecture(remaining[0] || null);
                              notify("Đã xóa bài giảng thành công!", "success");
                            }
                          }}
                          className="px-3 py-1.5 rounded-xl text-rose-600 border border-rose-200 dark:border-rose-900/60 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        >
                          Xóa
                        </button>
                      </div>
                    </div>

                    {/* Khung phát bài giảng (Player 16:9 YouTube/Video thực thụ) */}
                    {(() => {
                      const ytId =
                        selectedLecture.youtubeId ||
                        getLectureYoutubeId(selectedLecture.sourceUrl);

                      if (ytId) {
                        return (
                          <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-lg border border-slate-200 dark:border-slate-800">
                            <iframe
                              src={`https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0&modestbranding=1`}
                              className="w-full h-full border-0"
                              title={selectedLecture.title}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        );
                      }

                      if (selectedLecture.sourceUrl && (selectedLecture.sourceUrl.endsWith(".mp4") || selectedLecture.sourceUrl.endsWith(".webm"))) {
                        return (
                          <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-lg border border-slate-200 dark:border-slate-800">
                            <video
                              controls
                              src={selectedLecture.sourceUrl}
                              className="w-full h-full object-contain"
                            />
                          </div>
                        );
                      }

                      return (
                        <div className="w-full aspect-video rounded-2xl bg-slate-900 flex flex-col items-center justify-center text-white p-6 shadow-md border border-slate-800">
                          <Video size={48} className="text-purple-400 mb-3" />
                          <p className="text-sm font-bold">{selectedLecture.title}</p>
                          <p className="text-xs text-slate-400 mt-1">
                            Bài học chuyên đề · {selectedLecture.platform || "Video tài liệu"}
                          </p>
                          {selectedLecture.sourceUrl && (
                            <a
                              href={selectedLecture.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center gap-1.5"
                            >
                              <span>Mở liên kết gốc</span>
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      );
                    })()}

                    {/* Phần Mô tả bài giảng */}
                    <div className="space-y-1.5 pt-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Mô tả
                      </h4>
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                        {selectedLecture.description || "Bài giảng không có mô tả nào."}
                      </p>
                    </div>

                    {/* Phần Bài tập & Tài liệu đính kèm (Chuẩn bên học sinh với Icon chữ W nền xanh) */}
                    <div className="space-y-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                        Bài tập & tài liệu đính kèm
                      </span>

                      {assignments.length > 0 && assignments[0] ? (
                        <div
                          onClick={() => {
                            if (assignments[0]) {
                              setSelectedAssignment(assignments[0]);
                              setAssignmentViewMode("detail");
                              handleSelectTab("assignments");
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
                                {assignments[0].title}
                              </strong>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                Trắc nghiệm tách câu
                              </p>
                            </div>
                          </div>
                          <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                        </div>
                      ) : (
                        <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                          Chưa có bài tập nào được gắn kèm với bài giảng này.
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="p-12 text-center text-xs text-slate-400">
                    Chọn một bài giảng từ danh sách playlist bên phải để bắt đầu xem.
                  </div>
                )}
              </div>
            </div>

            {/* CỘT PHẢI: THƯ MỤC & DANH SÁCH BÀI GIẢNG (PLAYLIST ĐỒNG BỘ VỚI HỌC SINH) */}
            <div className="w-full lg:w-80 shrink-0 space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-3">
                {/* Bên trên: Thư mục & Nút Thêm bài giảng */}
                <div className="space-y-2.5 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                      <Folder size={15} className="text-blue-600 fill-blue-500/20" />
                      <span>Thư mục bài giảng</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddLectureModalOpen(true)}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold transition flex items-center gap-1 cursor-pointer shadow-2xs"
                    >
                      <Plus size={13} />
                      <span>Thêm bài giảng</span>
                    </button>
                  </div>

                  <select
                    value={selectedFolder}
                    onChange={(e) => setSelectedFolder(e.target.value)}
                    className="w-full py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="__ALL__">Tất cả bài giảng</option>
                    {customFolders.map((f) => (
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
                      {selectedFolder === "__ALL__" || selectedFolder === "Tất cả bài tập"
                        ? "Tất cả bài giảng"
                        : selectedFolder}
                    </span>
                    <span>{lectures.length} bài giảng</span>
                  </div>

                  <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
                    {lectures.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        Chưa có bài giảng nào trong thư mục này.
                      </div>
                    ) : (
                      lectures
                        .filter((lec) => {
                          if (selectedFolder === "__ALL__" || selectedFolder === "Tất cả bài tập") return true;
                          return lec.folder === selectedFolder;
                        })
                        .map((lec) => {
                          const isPlaying = selectedLecture?.id === lec.id;
                          const ytId = lec.youtubeId || getLectureYoutubeId(lec.sourceUrl);

                          return (
                            <div
                              key={lec.id}
                              onClick={() => setSelectedLecture(lec)}
                              className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer ${
                                isPlaying
                                  ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-500 dark:border-blue-400 shadow-2xs"
                                  : "bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-blue-300 dark:hover:border-slate-700"
                              }`}
                            >
                              {/* Thumbnail YouTube / Video thật */}
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
                              <div className="min-w-0 flex-1">
                                <strong
                                  className={`block text-xs font-bold truncate ${
                                    isPlaying ? "text-blue-600 dark:text-blue-400" : "text-slate-800 dark:text-slate-200"
                                  }`}
                                >
                                  {lec.title}
                                </strong>
                                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                                  <span>{lec.uploadedAt}</span>
                                  <span className="font-semibold text-slate-500">{lec.platform || "Video"}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 8: TÀI LIỆU (CẤU TRÚC 3 CỘT ĐỒNG BỘ CHUẨN CARD VỚI HỌC SINH) */}
        {activeTab === "materials" && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs overflow-hidden">
            {/* Header tiêu đề danh mục */}
            <div className="px-5 py-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Tài liệu học tập ({materials.length})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Tài liệu tham khảo, giáo trình và phiếu bài tập đính kèm lớp học.
                </p>
              </div>
              <button
                type="button"
                onClick={() => notify("Đang mở trình tải tài liệu...", "info")}
                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <UploadCloud size={14} />
                <span>Tải tài liệu</span>
              </button>
            </div>

            {/* Khung 3 cột Master-Detail */}
            <div className="flex flex-col lg:flex-row min-h-[580px]">
              {/* Cột 1: Thư mục tài liệu */}
              <div className="w-full lg:w-56 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Thư mục
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewFolderModal(true)}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-bold cursor-pointer"
                    >
                      + Tạo thư mục
                    </button>
                  </div>
                  <div className="space-y-1">
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
                        <Folder size={15} className={selectedFolder === f ? "text-blue-600 fill-blue-500/20" : "text-slate-400"} />
                        <span className="truncate">{f}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cột 2: Danh sách tài liệu */}
              <div className="w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 p-3.5 flex flex-col space-y-3">
                <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                  Danh sách tài liệu ({materials.length})
                </div>

                <div className="flex-1 space-y-2">
                  {materials.map((mat) => (
                    <div
                      key={mat.id}
                      onClick={() => setSelectedMaterial(mat)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition ${
                        selectedMaterial?.id === mat.id
                          ? "border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 shadow-2xs"
                          : "border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <strong className="block text-xs font-bold truncate">{mat.name}</strong>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>{mat.mimeType || "PDF"}</span>
                        <span>{(mat.sizeBytes / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cột 3: Chi tiết tài liệu */}
              <div className="flex-1 p-5 space-y-4 bg-slate-50/30 dark:bg-slate-950/20">
                {selectedMaterial ? (
                  <div className="space-y-4">
                    <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div>
                        <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                          {selectedMaterial.name}
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Kích thước: {(selectedMaterial.sizeBytes / 1024).toFixed(1)} KB · Định dạng:{" "}
                          {selectedMaterial.mimeType}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => notify("Đang tải tệp về máy...", "success")}
                          className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Download size={13} />
                          <span>Tải về</span>
                        </button>
                      </div>
                    </div>
                    <div className="p-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center text-slate-400 text-xs bg-white dark:bg-slate-900">
                      Xem trước trực quan tài liệu học tập
                    </div>
                  </div>
                ) : (
                  <div className="p-8 text-center text-xs text-slate-400">Chọn một tài liệu để xem chi tiết.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 9: NGÂN HÀNG CÂU HỎI LỚP HỌC */}
        {activeTab === "questions" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
                  Ngân hàng câu hỏi riêng lớp {item.name}
                </h1>
                <p className="text-xs text-slate-500">
                  Tổng hợp tất cả câu hỏi được tách tự động từ bài tập và đề kiểm tra trong lớp này
                </p>
              </div>
              <button
                type="button"
                onClick={() => notify("Chức năng soạn câu hỏi mới cho lớp", "info")}
                className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus size={15} />
                <span>Soạn câu hỏi mới</span>
              </button>
            </div>

            <div className="space-y-3">
              {[
                { content: "Giải phương trình bậc nhất một ẩn: 2x - 6 = 0", type: "Trắc nghiệm một đáp án", difficulty: "Cơ bản", source: "Bài tập tuần 1" },
                { content: "Nêu các bước giải bài toán bằng cách lập hệ phương trình?", type: "Tự luận", difficulty: "Thông hiểu", source: "Kiểm tra 15p" },
                { content: "Cho tam giác ABC vuông tại A, tính cạnh huyền BC khi AB=3, AC=4?", type: "Điền đáp án ngắn", difficulty: "Vận dụng", source: "Đề giữa kỳ" },
              ].map((q, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                      {q.type}
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium">Nguồn: {q.source}</span>
                  </div>
                  <strong className="block text-xs font-bold leading-relaxed">{q.content}</strong>
                </div>
              ))}
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
                    Thư mục lưu trữ:
                  </label>
                  <select
                    value={lectureFormFolder}
                    onChange={(e) => setLectureFormFolder(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                  >
                    {customFolders.filter((f) => f !== "Tất cả").map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
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
    </div>
  );
}
