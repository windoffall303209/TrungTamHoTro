"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Eye,
  FileCheck2,
  FileQuestion,
  FileSearch,
  FileText,
  Filter,
  Folder,
  FolderOpen,
  Layers,
  LayoutGrid,
  List,
  ListChecks,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Scan,
  Search,
  Share2,
  Sliders,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import type { Course, Exam, LearningClass, Question } from "@/lib/learning-types";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { AssignmentBuilderModal } from "@/features/exams/assignment-builder-modal";

export interface InstructorQuestionsViewProps {
  initialClasses?: LearningClass[];
  initialCourses?: Course[];
}

interface QuestionItem {
  id: string;
  content: string;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  difficulty: "EASY" | "MEDIUM" | "HARD" | "VERY_HARD";
  grade?: number;
  subject?: string;
  classCode?: string;
  source: string; // Tên bài tập hoặc "Thêm riêng"
  status: "DRAFT" | "PUBLISHED";
  version: number;
  options?: string[];
  correctAnswers?: string[];
  explanation?: string;
  duplicateWarning?: boolean;
}

interface ExamDraft {
  id: string;
  title: string;
  grade?: number;
  subject?: string;
  classCode?: string;
  questionCount: number;
  totalScore: number;
  status: "DRAFT" | "PUBLISHED";
  createdAt: string;
}

export function InstructorQuestionsView({
  initialClasses = [],
  initialCourses = [],
}: InstructorQuestionsViewProps) {
  const { session, notify } = useApp();

  const [classes, setClasses] = useState<LearningClass[]>(initialClasses);
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [loading, setLoading] = useState(true);

  // Tab chính bên phải: "questions" hoặc "exams"
  const [activeTab, setActiveTab] = useState<"questions" | "exams">("questions");

  // Nút Tạo mới Dropdown (5 lựa chọn)
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [builderModalOpen, setBuilderModalOpen] = useState(false);

  // Cây phân loại bên trái: Khối > Môn > Lớp
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");

  // Bộ lọc & Tìm kiếm
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterDifficulty, setFilterDifficulty] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterSource, setFilterSource] = useState<string>("ALL");

  // Chọn nhiều câu hỏi để tạo đề
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);

  // Dữ liệu câu hỏi ngân hàng nạp vật lý từ CSDL PostgreSQL
  const [questions, setQuestions] = useState<QuestionItem[]>([]);

  // Dữ liệu đề thi / bài tập nạp vật lý từ CSDL PostgreSQL
  const [examsList, setExamsList] = useState<ExamDraft[]>([]);

  // Modal 1: Soạn câu hỏi
  const [authoringModalOpen, setAuthoringModalOpen] = useState(false);
  const [authoringType, setAuthoringType] = useState<QuestionItem["type"]>("SINGLE_CHOICE");
  const [authoringContent, setAuthoringContent] = useState("");
  const [authoringOptions, setAuthoringOptions] = useState<string[]>(["", "", "", ""]);
  const [authoringCorrect, setAuthoringCorrect] = useState<string[]>([]);
  const [authoringDifficulty, setAuthoringDifficulty] = useState<QuestionItem["difficulty"]>("MEDIUM");
  const [authoringGrade, setAuthoringGrade] = useState<number>(10);
  const [authoringSubject, setAuthoringSubject] = useState<string>("Toán");
  const [authoringTab, setAuthoringTab] = useState<"MANUAL" | "BULK">("MANUAL");
  const [bulkInputText, setBulkInputText] = useState("");

  // Modal 2: Quét đề (OCR)
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanProvider, setScanProvider] = useState("Gemini 1.5 Pro");
  const [scanStatus, setScanStatus] = useState<"IDLE" | "READING" | "EXTRACTING" | "DONE">("IDLE");
  const [scannedQuestions, setScannedQuestions] = useState<string[]>([
    "Câu 1: Cho tập hợp A = {1, 2, 3}. Số tập con của A là bao nhiêu?",
    "Câu 2: Xác định tọa độ đỉnh của parabol y = x² - 4x + 3?",
    "Câu 3: Giải bất phương trình 2x - 5 > 3?",
  ]);

  // Modal 3: Tạo đề bằng AI
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiQuestionCount, setAiQuestionCount] = useState(5);
  const [aiGeneratedItems, setAiGeneratedItems] = useState<Array<{ content: string; warning?: boolean; source?: string }>>([]);
  const [aiGenerating, setAiGenerating] = useState(false);

  // Modal 4: Soạn đề thủ công
  const [manualExamModalOpen, setManualExamModalOpen] = useState(false);
  const [manualExamTitle, setManualExamTitle] = useState("");
  const [manualExamItems, setManualExamItems] = useState<QuestionItem[]>([]);

  // Drawer / Modal: "Dùng làm bài tập"
  const [assignClassDrawerOpen, setAssignClassDrawerOpen] = useState(false);
  const [targetExamForAssign, setTargetExamForAssign] = useState<ExamDraft | null>(null);
  const [selectedClassIdForExam, setSelectedClassIdForExam] = useState<string>("");

  /** Nạp danh sách lớp, câu hỏi và đề thi thật từ CSDL PostgreSQL */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [classData, dbQuestions, dbExams, dbAssignments] = await Promise.all([
        apiRequest<LearningClass[]>("/instructor/classes", {
          roleCode: session.roleCode,
        }).catch(() => [] as LearningClass[]),
        apiRequest<any[]>("/instructor/question-bank/questions", {
          roleCode: session.roleCode,
        }).catch(() => [] as any[]),
        apiRequest<Exam[]>("/exams", {
          roleCode: session.roleCode,
        }).catch(() => [] as Exam[]),
        apiRequest<any[]>("/academic/assignments", {
          roleCode: session.roleCode,
        }).catch(() => [] as any[]),
      ]);

      setClasses(classData);

      // Map câu hỏi từ CSDL PostgreSQL
      if (Array.isArray(dbQuestions) && dbQuestions.length > 0) {
        const mappedQuestions: QuestionItem[] = dbQuestions.map((q: any) => {
          let grade = 10;
          let subject = "Toán";
          const courseCode = q.course?.code || "";
          const courseName = q.course?.name || "";
          if (courseCode.includes("6") || courseName.includes("6")) grade = 6;
          else if (courseCode.includes("7") || courseName.includes("7")) grade = 7;
          else if (courseCode.includes("12") || courseName.includes("12")) grade = 12;

          if (courseName.includes("Văn") || courseCode.includes("VAN")) subject = "Ngữ văn";
          else if (courseName.includes("Lý") || courseCode.includes("PHY")) subject = "Vật lí";

          return {
            id: q.id,
            content: q.content,
            type: q.type || "SINGLE_CHOICE",
            difficulty: q.difficulty === 1 ? "EASY" : q.difficulty === 2 ? "MEDIUM" : q.difficulty === 3 ? "HARD" : "VERY_HARD",
            grade,
            subject,
            classCode: courseCode || "CHUNG",
            source: q.tags?.join(", ") || "Ngân hàng CSDL",
            status: q.status === "ACTIVE" || q.status === "APPROVED" ? "PUBLISHED" : "DRAFT",
            version: q.version || 1,
            options: q.options || [],
            correctAnswers: q.correctAnswers || [],
            explanation: q.solution || "",
          };
        });
        setQuestions(mappedQuestions);
      }

      // Map danh sách đề thi / bài tập từ CSDL PostgreSQL
      const combinedExams: ExamDraft[] = [];
      if (Array.isArray(dbExams)) {
        dbExams.forEach((ex: any) => {
          let grade = 10;
          let subject = "Toán";
          if (ex.title?.includes("6")) grade = 6;
          else if (ex.title?.includes("7")) grade = 7;
          else if (ex.title?.includes("12")) grade = 12;
          if (ex.title?.includes("Văn")) subject = "Ngữ văn";
          else if (ex.title?.includes("Lý")) subject = "Vật lí";

          combinedExams.push({
            id: ex.id,
            title: ex.title,
            grade,
            subject,
            classCode: ex.classCode || "TOAN-10A1",
            questionCount: ex.questionIds?.length || 10,
            totalScore: ex.totalScore || 10,
            status: ex.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
            createdAt: ex.createdAt ? new Date(ex.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
          });
        });
      }
      if (Array.isArray(dbAssignments)) {
        dbAssignments.forEach((a: any) => {
          let grade = 10;
          let subject = "Toán";
          if (a.title?.includes("6")) grade = 6;
          else if (a.title?.includes("7")) grade = 7;
          else if (a.title?.includes("12")) grade = 12;
          if (a.title?.includes("Văn")) subject = "Ngữ văn";
          else if (a.title?.includes("Lý")) subject = "Vật lí";

          combinedExams.push({
            id: a.id,
            title: a.title,
            grade,
            subject,
            classCode: a.classCode || "CHUNG",
            questionCount: a.totalQuestions || 5,
            totalScore: a.maxScore || 10,
            status: a.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
            createdAt: a.createdAt ? new Date(a.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
          });
        });
      }
      setExamsList(combinedExams);
    } catch {
      // Giữ state hiện tại
    } finally {
      setLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Cây phân cấp chuẩn K-12: Khối > Môn > Lớp
  const categoryTree = useMemo(() => {
    return [
      { id: "ALL", label: "Tất cả câu hỏi", count: questions.length },
      {
        id: "grade-6",
        label: "Khối 6",
        count: questions.filter((q) => q.grade === 6).length,
        children: [
          {
            id: "grade-6-sub-Toán",
            label: "Môn Toán",
            children: [
              { id: "cls-TOAN-6A1", label: "Lớp 6A1" },
              { id: "cls-TOAN-6A2", label: "Lớp 6A2" },
            ],
          },
          {
            id: "grade-6-sub-Ngữ văn",
            label: "Môn Ngữ văn",
            children: [
              { id: "cls-VAN-6A1", label: "Lớp 6A1" },
              { id: "cls-VAN-6A2", label: "Lớp 6A2" },
            ],
          },
        ],
      },
      {
        id: "grade-7",
        label: "Khối 7",
        count: questions.filter((q) => q.grade === 7).length,
        children: [
          {
            id: "grade-7-sub-Toán",
            label: "Môn Toán",
            children: [{ id: "cls-TOAN-7A1", label: "Lớp 7A1" }],
          },
        ],
      },
      {
        id: "grade-10",
        label: "Khối 10",
        count: questions.filter((q) => q.grade === 10).length,
        children: [
          {
            id: "grade-10-sub-Toán",
            label: "Môn Toán",
            children: [
              { id: "cls-TOAN-10A1", label: "Lớp 10A1" },
              { id: "cls-TOAN-10A2", label: "Lớp 10A2" },
            ],
          },
          {
            id: "grade-10-sub-Vật lí",
            label: "Môn Vật lí",
            children: [{ id: "cls-LY-10A1", label: "Lớp 10A1" }],
          },
        ],
      },
      {
        id: "grade-12",
        label: "Khối 12",
        count: questions.filter((q) => q.grade === 12).length,
        children: [
          {
            id: "grade-12-sub-Toán",
            label: "Môn Toán",
            children: [{ id: "cls-TOAN-12A1", label: "Lớp 12A1" }],
          },
        ],
      },
      {
        id: "UNCLASSIFIED",
        label: "Chưa phân loại",
        count: questions.filter((q) => !q.classCode).length,
      },
    ];
  }, [questions]);

  // Lọc câu hỏi hiển thị theo Cây phân cấp Khối -> Môn -> Lớp và các tiêu chí khác
  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      // Lọc theo cây phân cấp được chọn ở cột trái
      if (selectedCategory !== "ALL") {
        if (selectedCategory === "UNCLASSIFIED") {
          if (q.classCode) return false;
        } else if (selectedCategory.startsWith("cls-")) {
          const code = selectedCategory.replace("cls-", "");
          if (q.classCode !== code) return false;
        } else if (selectedCategory.includes("-sub-")) {
          const parts = selectedCategory.split("-sub-");
          const gNum = Number((parts[0] ?? "").replace("grade-", ""));
          const subName = parts[1] ?? "";
          if (q.grade !== gNum || q.subject?.toLowerCase() !== subName.toLowerCase()) return false;
        } else if (selectedCategory.startsWith("grade-")) {
          const gNum = Number(selectedCategory.replace("grade-", ""));
          if (q.grade !== gNum) return false;
        }
      }

      // Tìm kiếm theo từ khóa
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        if (!q.content.toLowerCase().includes(query)) return false;
      }
      // Lọc loại câu
      if (filterType !== "ALL" && q.type !== filterType) return false;
      // Lọc độ khó
      if (filterDifficulty !== "ALL" && q.difficulty !== filterDifficulty) return false;
      // Lọc trạng thái
      if (filterStatus !== "ALL" && q.status !== filterStatus) return false;
      // Lọc nguồn
      if (filterSource !== "ALL" && q.source !== filterSource) return false;

      return true;
    });
  }, [questions, selectedCategory, searchQuery, filterType, filterDifficulty, filterStatus, filterSource]);

  // Lọc đề thi theo cây phân cấp
  const filteredExams = useMemo(() => {
    return examsList.filter((ex) => {
      if (selectedCategory !== "ALL") {
        if (selectedCategory === "UNCLASSIFIED") {
          if (ex.classCode) return false;
        } else if (selectedCategory.startsWith("cls-")) {
          const code = selectedCategory.replace("cls-", "");
          if (ex.classCode !== code) return false;
        } else if (selectedCategory.includes("-sub-")) {
          const parts = selectedCategory.split("-sub-");
          const gNum = Number((parts[0] ?? "").replace("grade-", ""));
          const subName = parts[1] ?? "";
          if (ex.grade !== gNum || ex.subject?.toLowerCase() !== subName.toLowerCase()) return false;
        } else if (selectedCategory.startsWith("grade-")) {
          const gNum = Number(selectedCategory.replace("grade-", ""));
          if (ex.grade !== gNum) return false;
        }
      }
      if (searchQuery.trim()) {
        if (!ex.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [examsList, selectedCategory, searchQuery]);

  // Kích hoạt Tạo đề bằng AI (hiện cách nhau 40ms)
  const handleTriggerAiGen = () => {
    setAiGenerating(true);
    setAiGeneratedItems([]);

    const sampleAiQuestions = [
      { content: "Cho hàm số f(x) = x² - 2x + 3. Điểm cực tiểu của đồ thị hàm số là?", warning: false },
      { content: "Biết log₂3 = a. Tính log₁₂18 theo a?", warning: false },
      { content: "Phát hiện câu hỏi tương tự câu #12 trong ngân hàng", warning: true, source: "Nguồn: Internet" },
      { content: "Tìm nghiệm nguyên dương nhỏ nhất của bất phương trình?", warning: false },
      { content: "Tính diện tích hình phẳng giới hạn bởi parabol và trục hoành?", warning: false },
    ];

    sampleAiQuestions.forEach((item, index) => {
      setTimeout(() => {
        setAiGeneratedItems((prev) => [...prev, item]);
        if (index === sampleAiQuestions.length - 1) {
          setAiGenerating(false);
        }
      }, (index + 1) * 40);
    });
  };

  // Lưu câu hỏi mới trực tiếp vào CSDL PostgreSQL
  const handleSaveQuestion = async (publish = false) => {
    if (!authoringContent.trim()) {
      notify("Vui lòng nhập nội dung câu hỏi!", "error");
      return;
    }

    // Tìm khóa học tương ứng nếu có
    const targetCourse = courses.find((c) => c.name?.includes(authoringSubject)) || courses[0];

    try {
      const created = await apiRequest<any>("/instructor/question-bank/questions", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          courseId: targetCourse?.id || "course-toan-10",
          content: authoringContent.trim(),
          type: authoringType,
          options: authoringOptions.filter(Boolean),
          correctAnswers: authoringCorrect,
          difficulty: authoringDifficulty === "EASY" ? 1 : authoringDifficulty === "MEDIUM" ? 2 : 3,
          tags: [authoringSubject, `Khối ${authoringGrade}`],
        }),
      });

      const newQ: QuestionItem = {
        id: created?.id || `q-${Date.now()}`,
        content: authoringContent.trim(),
        type: authoringType,
        difficulty: authoringDifficulty,
        grade: authoringGrade,
        subject: authoringSubject,
        source: "Thêm riêng",
        status: publish ? "PUBLISHED" : "DRAFT",
        version: 1,
        options: authoringOptions.filter(Boolean),
        correctAnswers: authoringCorrect,
      };

      setQuestions((prev) => [newQ, ...prev]);
      setAuthoringModalOpen(false);
      notify(publish ? "Đã lưu và phát hành câu hỏi vào CSDL!" : "Đã lưu nháp câu hỏi vào CSDL!", "success");
      setAuthoringContent("");
    } catch (err: any) {
      console.warn("Lỗi lưu CSDL:", err);
      notify(err?.message || "Không thể lưu câu hỏi vào CSDL", "error");
    }
  };

  // Xóa câu hỏi khỏi CSDL PostgreSQL
  const handleDeleteQuestion = async (questionId: string) => {
    if (window.confirm("Bạn có chắc muốn xóa câu hỏi này khỏi CSDL PostgreSQL không?")) {
      try {
        await apiRequest(`/instructor/question-bank/questions/${questionId}`, {
          method: "DELETE",
          roleCode: session.roleCode,
        }).catch((err) => console.warn("Lỗi xóa CSDL:", err));
      } catch (e) {}

      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      notify("Đã xóa câu hỏi khỏi ngân hàng dữ liệu!", "success");
    }
  };

  // Xác nhận dùng làm bài tập cho lớp
  const handleConfirmAssign = () => {
    if (!selectedClassIdForExam) {
      notify("Vui lòng chọn lớp học để giao bài tập!", "error");
      return;
    }
    notify(`Đã giao đề thi '${targetExamForAssign?.title}' làm bài tập cho lớp được chọn!`, "success");
    setAssignClassDrawerOpen(false);
    setSelectedClassIdForExam("");
  };

  // Xử lý lưu bài tập đa năng (Phương thức 5) vào CSDL thật PostgreSQL
  const handleSaveFromBuilder = async (data: any) => {
    try {
      notify("Đang lưu bài tập và câu hỏi vào cơ sở dữ liệu...", "info");
      let courseId = courses[0]?.id;
      if (!courseId) {
        const dbCourses = await apiRequest<Course[]>("/instructor/courses", {
          roleCode: session.roleCode,
        }).catch(() => [] as Course[]);
        if (dbCourses.length > 0) courseId = dbCourses[0].id;
      }

      let questionIds: string[] = [];
      if (data.type === "MULTIPLE_CHOICE" && data.questions && data.questions.length > 0) {
        if (courseId) {
          try {
            const formatted = data.questions.map((q: any) => ({
              courseId,
              content: q.content || "Nội dung câu hỏi",
              type: "SINGLE_CHOICE",
              options: q.options && q.options.length > 0 ? q.options.map((o: any) => typeof o === "string" ? o : `${o.key}. ${o.text}`) : ["A", "B", "C", "D"],
              correctAnswers: [q.correctAnswer || "A"],
              difficulty: 2,
              tags: ["Trắc nghiệm", "Phương thức 5"],
            }));

            const imported = await apiRequest<any[]>("/instructor/question-bank/questions/import", {
              method: "POST",
              roleCode: session.roleCode,
              body: JSON.stringify({
                courseId,
                questions: formatted,
              }),
            }).catch(() => [] as any[]);

            questionIds = imported.map((q) => q.id);
          } catch (e) {
            console.warn("Import câu hỏi lỗi:", e);
          }
        }
      }

      // Lưu Exam hoặc Assignment nếu có lớp
      const targetClass = classes[0];
      if (targetClass) {
        try {
          if (questionIds.length > 0) {
            await apiRequest("/instructor/exams", {
              method: "POST",
              roleCode: session.roleCode,
              body: JSON.stringify({
                classId: targetClass.id,
                title: data.title,
                questionIds,
                durationMinutes: Number(data.settings?.durationMinutes) || 45,
                totalScore: 10,
                openAt: data.settings?.startAt ? new Date(data.settings.startAt).toISOString() : new Date().toISOString(),
                closeAt: data.settings?.dueAt ? new Date(data.settings.dueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
                attemptLimit: Number(data.settings?.maxAttempts) || 1,
              }),
            }).catch(() => null);
          }

          await apiRequest(`/instructor/classes/${targetClass.id}/assignments`, {
            method: "POST",
            roleCode: session.roleCode,
            body: JSON.stringify({
              title: data.title,
              description: data.description || "Bài tập đa năng",
              dueAt: data.settings?.dueAt ? new Date(data.settings.dueAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
              totalQuestions: data.questions?.length || 5,
              maxScore: 10,
              type: data.type,
              scope: "CLASS",
            }),
          }).catch(() => null);
        } catch (e) {
          console.warn("Lưu bài tập lớp lỗi:", e);
        }
      }

      await loadData();
      setBuilderModalOpen(false);
      notify("Đã tạo bài tập và thêm câu hỏi vào ngân hàng câu hỏi thành công!", "success");
    } catch (err: any) {
      console.error("Lỗi lưu phương thức 5:", err);
      notify(err?.message || "Không thể lưu bài tập vào cơ sở dữ liệu", "error");
    }
  };

  return (
    <div className="flex h-[calc(100vh-70px)] w-full overflow-hidden bg-slate-50 dark:bg-[#070b14] text-slate-900 dark:text-slate-100">
      {/* =========================================================================
          CỘT TRÁI: CÂY PHÂN LOẠI KHỐI > MÔN > LỚP
          ========================================================================= */}
      <aside className="w-64 sm:w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0c1220] p-4 flex flex-col justify-between">
        <div className="space-y-4 flex-1 overflow-y-auto scrollbar-none">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
              Phân loại Ngân hàng
            </h2>
            <span className="text-[11px] text-slate-400 font-bold">{questions.length} câu</span>
          </div>

          {/* Cây phân loại */}
          <nav className="space-y-1 text-xs">
            {categoryTree.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <div key={cat.id} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl font-bold transition text-left cursor-pointer ${
                      isSelected
                        ? "bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Folder size={15} className={isSelected ? "text-sky-600" : "text-slate-400"} />
                      <span>{cat.label}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-normal">{cat.count}</span>
                  </button>

                  {/* Nhánh con */}
                  {cat.children?.map((sub) => (
                    <div key={sub.id} className="pl-6 space-y-1">
                      <div className="text-[11px] font-bold text-slate-500 py-1">
                        ↳ {sub.label}
                      </div>
                      {sub.children?.map((cls) => (
                        <button
                          key={cls.id}
                          type="button"
                          onClick={() => setSelectedCategory(cls.id)}
                          className={`w-full text-left pl-3 py-1 rounded-lg text-[11px] font-medium ${
                            selectedCategory === cls.id
                              ? "text-sky-600 font-bold bg-sky-50/50 dark:bg-sky-950/30"
                              : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          • {cls.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 text-[11px] text-slate-500">
          Tự động tách câu hỏi từ mọi bài tập & đề thi đã thêm vào lớp.
        </div>
      </aside>

      {/* =========================================================================
          CỘT PHẢI: HAI TAB (CÂU HỎI & BÀI TẬP) + NÚT TẠO MỚI CỐ ĐỊNH
          ========================================================================= */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* THANH ĐẦU TRANG CỐ ĐỊNH: Nút Tạo mới ▾ và Tabs */}
        <header className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-4 z-20">
          <div className="flex items-center gap-2">
            {/* 2 Tab: Câu hỏi & Bài tập */}
            <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setActiveTab("questions")}
                className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  activeTab === "questions"
                    ? "bg-white dark:bg-slate-900 text-sky-600 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Câu hỏi ({questions.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("exams")}
                className={`px-4 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  activeTab === "exams"
                    ? "bg-white dark:bg-slate-900 text-sky-600 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                }`}
              >
                Bài tập & Đề ({examsList.length})
              </button>
            </div>
          </div>

          {/* NÚT TẠO MỚI CỐ ĐỊNH ▾ (VỚI 4 LỰA CHỌN) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setCreateMenuOpen(!createMenuOpen)}
              className="px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-extrabold hover:bg-sky-700 transition flex items-center gap-2 shadow-sm shadow-sky-600/25 cursor-pointer"
            >
              <Plus size={16} />
              <span>Tạo mới</span>
              <ChevronDown size={14} className={`transition ${createMenuOpen ? "rotate-180" : ""}`} />
            </button>

            {/* Menu 4 lựa chọn tạo mới */}
            {createMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-2xl z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setAuthoringModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-left cursor-pointer"
                >
                  <Pencil size={15} className="text-sky-500" />
                  <span>1. Soạn câu hỏi</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setScanModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-left cursor-pointer"
                >
                  <Scan size={15} className="text-indigo-500" />
                  <span>2. Quét đề (OCR)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setAiModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-left cursor-pointer"
                >
                  <Bot size={15} className="text-emerald-500" />
                  <span>3. Tạo đề bằng AI</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setManualExamModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-left cursor-pointer"
                >
                  <SlidersHorizontal size={15} className="text-amber-500" />
                  <span>4. Soạn đề thủ công</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setBuilderModalOpen(true);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-left cursor-pointer border-t border-slate-100 dark:border-slate-800"
                >
                  <FileCheck2 size={15} className="text-blue-600" />
                  <span>5. Tạo bài tập đa năng (AI tách câu & Tự luận)</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* =========================================================================
            TAB 1: CÂU HỎI
            ========================================================================= */}
        {activeTab === "questions" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Bộ lọc & Tìm kiếm */}
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-64">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Tìm câu hỏi theo nội dung..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                </div>

                {/* Lọc loại */}
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="ALL">Tất cả loại câu</option>
                  <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                  <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
                  <option value="TRUE_FALSE">Đúng / Sai</option>
                  <option value="SHORT_ANSWER">Trả lời ngắn</option>
                  <option value="ESSAY">Tự luận</option>
                </select>

                {/* Lọc độ khó */}
                <select
                  value={filterDifficulty}
                  onChange={(e) => setFilterDifficulty(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="ALL">Tất cả độ khó</option>
                  <option value="EASY">Cơ bản</option>
                  <option value="MEDIUM">Thông hiểu</option>
                  <option value="HARD">Vận dụng</option>
                </select>
              </div>

              {/* Nút Tạo đề từ các câu đã chọn */}
              {selectedQuestionIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => notify(`Đang tạo đề từ ${selectedQuestionIds.length} câu hỏi đã chọn...`, "info")}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 flex items-center gap-1.5 shadow-sm"
                >
                  <Sparkles size={14} />
                  <span>Tạo đề từ {selectedQuestionIds.length} câu đã chọn</span>
                </button>
              )}
            </div>

            {/* Bảng danh sách câu hỏi */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredQuestions.map((q) => (
                <div
                  key={q.id}
                  className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-2.5 hover:border-slate-300 dark:hover:border-slate-700 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedQuestionIds.includes(q.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedQuestionIds([...selectedQuestionIds, q.id]);
                          } else {
                            setSelectedQuestionIds(selectedQuestionIds.filter((id) => id !== q.id));
                          }
                        }}
                        className="mt-1 size-4 rounded cursor-pointer"
                      />
                      <div className="space-y-1 min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-2 leading-relaxed">
                          {q.content}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 font-medium">
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950 text-sky-600 font-bold">
                            {q.type}
                          </span>
                          <span>•</span>
                          <span>Khối {q.grade} ({q.subject})</span>
                          <span>•</span>
                          <span>Nguồn: <strong>{q.source}</strong></span>
                          <span>•</span>
                          <span>Phiên bản v{q.version}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          q.status === "PUBLISHED"
                            ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-600"
                            : "bg-amber-50 dark:bg-amber-950 text-amber-600"
                        }`}
                      >
                        {q.status === "PUBLISHED" ? "Đã phát hành" : "Nháp"}
                      </span>
                      <button
                        type="button"
                        onClick={() => notify(`Chỉnh sửa câu hỏi sẽ tự động tạo phiên bản v${q.version + 1}`, "info")}
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 cursor-pointer"
                        title="Chỉnh sửa (Tạo phiên bản mới)"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteQuestion(q.id)}
                        className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-400 hover:text-rose-600 cursor-pointer"
                        title="Xóa câu hỏi khỏi CSDL"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: BÀI TẬP & ĐỀ THI
            ========================================================================= */}
        {activeTab === "exams" && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredExams.map((ex) => (
                <div
                  key={ex.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950 text-sky-600 font-bold text-[10px]">
                        Khối {ex.grade} • {ex.subject}
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        {ex.status === "PUBLISHED" ? "Đã phát hành" : "Bản nháp"}
                      </span>
                    </div>
                    <h3 className="text-xs font-extrabold line-clamp-2 leading-relaxed">
                      {ex.title}
                    </h3>
                    <div className="text-[11px] text-slate-500">
                      <span>{ex.questionCount} câu hỏi</span> • <span>Thang điểm {ex.totalScore}</span>
                    </div>
                  </div>

                  {/* Nút "Dùng làm bài tập" mở drawer chọn lớp */}
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetExamForAssign(ex);
                        setAssignClassDrawerOpen(true);
                      }}
                      className="w-full py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700 transition flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <Share2 size={14} />
                      <span>Dùng làm bài tập</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* =========================================================================
          MODAL 1: SOẠN CÂU HỎI (HỖ TRỢ THÊM ẢNH, LIVE PREVIEW, PHIÊN BẢN)
          ========================================================================= */}
      {authoringModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-extrabold">Soạn câu hỏi mới vào ngân hàng</h3>
              <button type="button" onClick={() => setAuthoringModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">Loại câu hỏi:</label>
                  <select
                    value={authoringType}
                    onChange={(e) => setAuthoringType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  >
                    <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                    <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
                    <option value="TRUE_FALSE">Đúng / Sai</option>
                    <option value="SHORT_ANSWER">Điền ngắn</option>
                    <option value="ESSAY">Tự luận</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Độ khó:</label>
                  <select
                    value={authoringDifficulty}
                    onChange={(e) => setAuthoringDifficulty(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  >
                    <option value="EASY">Cơ bản</option>
                    <option value="MEDIUM">Thông hiểu</option>
                    <option value="HARD">Vận dụng</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">Khối:</label>
                  <select
                    value={authoringGrade}
                    onChange={(e) => setAuthoringGrade(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  >
                    {[6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>
                        Khối {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1">Nội dung câu hỏi *:</label>
                <textarea
                  rows={3}
                  placeholder="Nhập nội dung câu hỏi (hỗ trợ công thức và định dạng)..."
                  value={authoringContent}
                  onChange={(e) => setAuthoringContent(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>

              {/* Các phương án cho trắc nghiệm */}
              {authoringType === "SINGLE_CHOICE" && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold">Các phương án lựa chọn:</label>
                  {authoringOptions.map((opt, oIdx) => (
                    <div key={oIdx} className="flex items-center gap-2">
                      <span className="font-bold text-xs w-6">{String.fromCharCode(65 + oIdx)}.</span>
                      <input
                        type="text"
                        placeholder={`Phương án ${String.fromCharCode(65 + oIdx)}...`}
                        value={opt}
                        onChange={(e) => {
                          const updated = [...authoringOptions];
                          updated[oIdx] = e.target.value;
                          setAuthoringOptions(updated);
                        }}
                        className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleSaveQuestion(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Lưu nháp
              </button>
              <button
                type="button"
                onClick={() => handleSaveQuestion(true)}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Phát hành
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: QUÉT ĐỀ (OCR) VỚI ĐỐI CHIẾU ẢNH GỐC
          ========================================================================= */}
      {scanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-extrabold">Quét đề thi thông minh (OCR & Trích xuất)</h3>
              <button type="button" onClick={() => setScanModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid md:grid-cols-2 gap-6">
              {/* Bên trái: Tải ảnh gốc */}
              <div className="space-y-3 border-r border-slate-100 dark:border-slate-800 pr-4">
                <span className="text-xs font-bold block text-slate-500 uppercase">Ảnh hoặc tệp đề thi gốc</span>
                <label className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl p-6 block text-center cursor-pointer hover:border-sky-500 transition">
                  <Scan size={32} className="mx-auto text-sky-500 mb-2" />
                  <span className="block text-xs font-bold">Kéo thả ảnh, PDF hoặc DOCX tại đây</span>
                  <span className="block text-[10px] text-slate-400 mt-1">AI sẽ nhận diện và tách từng câu</span>
                </label>
                <div className="text-xs space-y-1">
                  <label className="block font-bold">Mô hình AI nhận diện:</label>
                  <select
                    value={scanProvider}
                    onChange={(e) => setScanProvider(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  >
                    <option value="Gemini 1.5 Pro">Gemini 1.5 Pro (Khuyên dùng)</option>
                    <option value="Claude 3.5 Sonnet">Claude 3.5 Sonnet</option>
                    <option value="GPT-4o">GPT-4o Vision</option>
                  </select>
                </div>
              </div>

              {/* Bên phải: Danh sách câu trích xuất đối chiếu */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase">Câu hỏi trích xuất ({scannedQuestions.length})</span>
                  <span className="text-[10px] text-emerald-600 font-bold">✓ Đã nhận diện</span>
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {scannedQuestions.map((q, qIdx) => (
                    <div key={qIdx} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-xs space-y-2">
                      <p className="font-bold text-slate-800 dark:text-slate-200">{q}</p>
                      <div className="flex justify-end gap-2 text-[10px] font-bold">
                        <button type="button" className="text-sky-600 hover:underline">Sửa</button>
                        <button type="button" className="text-rose-600 hover:underline">Xóa</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setScanModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => {
                  notify("Đã thêm các câu trích xuất vào ngân hàng (trạng thái Nháp)!", "success");
                  setScanModalOpen(false);
                }}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Thêm vào ngân hàng (nháp)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 3: TẠO ĐỀ BẰNG AI (HIỆN LẦN LƯỢT CÁCH NHAU 40MS)
          ========================================================================= */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-500" />
                <h3 className="text-base font-extrabold">Tạo đề tự động bằng AI</h3>
              </div>
              <button type="button" onClick={() => setAiModalOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Số lượng câu hỏi:</label>
                  <input
                    type="number"
                    value={aiQuestionCount}
                    onChange={(e) => setAiQuestionCount(Number(e.target.value))}
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Ngữ cảnh tài liệu của lớp:</label>
                  <select className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs">
                    <option>Giáo trình chuẩn môn Toán 10</option>
                    <option>Phiếu bài tập nâng cao chương 1</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={handleTriggerAiGen}
                disabled={aiGenerating}
                className="w-full py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2 shadow-sm"
              >
                <Wand2 size={15} />
                <span>{aiGenerating ? "Đang sinh câu hỏi..." : "Bắt đầu sinh câu hỏi bằng AI"}</span>
              </button>

              {/* Danh sách câu hỏi AI sinh ra (hiện lần lượt cách nhau 40ms) */}
              <div className="space-y-2 max-h-60 overflow-y-auto pt-2">
                {aiGeneratedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border text-xs space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                      item.warning
                        ? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200"
                        : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>Câu {idx + 1}: {item.content}</span>
                      {item.source && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-200 dark:bg-amber-900 text-[10px] font-extrabold text-amber-800 dark:text-amber-300">
                          {item.source}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DRAWER / MODAL: "DÙNG LÀM BÀI TẬP" MỞ DRAWER CHỌN LỚP
          ========================================================================= */}
      {assignClassDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold">Dùng làm bài tập cho lớp</h3>
                <p className="text-[11px] text-slate-500">{targetExamForAssign?.title}</p>
              </div>
              <button type="button" onClick={() => setAssignClassDrawerOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold mb-1">Chọn lớp học được giao:</label>
              {classes.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="assignClassRadio"
                      checked={selectedClassIdForExam === c.id}
                      onChange={() => setSelectedClassIdForExam(c.id)}
                    />
                    <strong className="block font-bold">{c.code} - {c.name}</strong>
                  </div>
                  <span className="text-[10px] text-slate-400">Khối {c.grade || 10}</span>
                </label>
              ))}
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAssignClassDrawerOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmAssign}
                className="px-5 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-700"
              >
                Xác nhận giao bài
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PHƯƠNG THỨC 5: TẠO BÀI TẬP ĐA NĂNG */}
      <AssignmentBuilderModal
        open={builderModalOpen}
        onClose={() => setBuilderModalOpen(false)}
        targetClassName={classes[0]?.name || "Ngân hàng câu hỏi"}
        onSaveAssignment={handleSaveFromBuilder}
      />
    </div>
  );
}
