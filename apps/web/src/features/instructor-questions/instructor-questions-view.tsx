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

  // Nút Tạo mới Dropdown (4 lựa chọn)
  const [createMenuOpen, setCreateMenuOpen] = useState(false);

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

  // Dữ liệu câu hỏi ngân hàng
  const [questions, setQuestions] = useState<QuestionItem[]>([
    {
      id: "q-1",
      content: "Cho phương trình bậc hai ax² + bx + c = 0 (a ≠ 0). Biệt thức Δ được tính theo công thức nào sau đây?",
      type: "SINGLE_CHOICE",
      difficulty: "EASY",
      grade: 10,
      subject: "Toán",
      classCode: "TOAN-10A1",
      source: "Kiểm tra 15p chương 1",
      status: "PUBLISHED",
      version: 1,
      options: ["Δ = b² - 4ac", "Δ = b² + 4ac", "Δ = 2b - 4ac", "Δ = b² - 2ac"],
      correctAnswers: ["Δ = b² - 4ac"],
      explanation: "Công thức biệt thức chuẩn trong chương trình Toán 10.",
    },
    {
      id: "q-2",
      content: "Tìm tập xác định của hàm số y = √(2x - 4) trên tập số thực ℝ?",
      type: "SINGLE_CHOICE",
      difficulty: "MEDIUM",
      grade: 10,
      subject: "Toán",
      classCode: "TOAN-10A1",
      source: "Bài tập tuần 2",
      status: "PUBLISHED",
      version: 1,
      options: ["[2; +∞)", "(2; +∞)", "(-∞; 2]", "ℝ \\ {2}"],
      correctAnswers: ["[2; +∞)"],
    },
    {
      id: "q-3",
      content: "Nêu các biện pháp tu từ được sử dụng chủ yếu trong bài thơ và phân tích tác dụng biểu cảm của chúng?",
      type: "ESSAY",
      difficulty: "HARD",
      grade: 6,
      subject: "Ngữ văn",
      classCode: "VAN-6A1",
      source: "Đề thi giữa kỳ",
      status: "PUBLISHED",
      version: 2,
    },
    {
      id: "q-4",
      content: "Vận tốc trong chuyển động thẳng biến đổi đều được tính bằng công thức v = v₀ + at là đúng hay sai?",
      type: "TRUE_FALSE",
      difficulty: "EASY",
      grade: 10,
      subject: "Vật lí",
      classCode: "LY-10A1",
      source: "Thêm riêng",
      status: "DRAFT",
      version: 1,
      options: ["Đúng", "Sai"],
      correctAnswers: ["Đúng"],
    },
    {
      id: "q-5",
      content: "Nhập giá trị của x thỏa mãn: 3x - 9 = 0",
      type: "SHORT_ANSWER",
      difficulty: "EASY",
      grade: 6,
      subject: "Toán",
      classCode: "TOAN-6A1",
      source: "Bài tập tuần 1",
      status: "PUBLISHED",
      version: 1,
      correctAnswers: ["3", "x=3"],
    },
  ]);

  // Dữ liệu đề thi / bài tập
  const [examsList, setExamsList] = useState<ExamDraft[]>([
    {
      id: "ex-1",
      title: "Đề kiểm tra 15 phút Toán 10 - Chương 1",
      grade: 10,
      subject: "Toán",
      classCode: "TOAN-10A1",
      questionCount: 10,
      totalScore: 10,
      status: "PUBLISHED",
      createdAt: "25/10/2026",
    },
    {
      id: "ex-2",
      title: "Đề thi giữa học kỳ I môn Ngữ văn 6",
      grade: 6,
      subject: "Ngữ văn",
      classCode: "VAN-6A1",
      questionCount: 5,
      totalScore: 10,
      status: "DRAFT",
      createdAt: "26/10/2026",
    },
    {
      id: "ex-3",
      title: "Đề luyện tập Vật lí 10 - Động học chất điểm",
      grade: 10,
      subject: "Vật lí",
      classCode: "LY-10A1",
      questionCount: 15,
      totalScore: 10,
      status: "PUBLISHED",
      createdAt: "27/10/2026",
    },
  ]);

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

  /** Nạp danh sách lớp và môn của giáo viên */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const classData = await apiRequest<LearningClass[]>("/instructor/classes", {
        roleCode: session.roleCode,
      }).catch(() => [] as LearningClass[]);
      setClasses(classData);
    } catch {
      // Giữ classes ban đầu
    } finally {
      setLoading(false);
    }
  }, [session.roleCode]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Cây phân cấp Khối > Môn > Lớp
  const categoryTree = useMemo(() => {
    const grades = [6, 7, 8, 9, 10, 11, 12];
    const tree: Array<{ id: string; label: string; count: number; children?: Array<{ id: string; label: string; children?: Array<{ id: string; label: string }> }> }> = [
      { id: "ALL", label: "Tất cả câu hỏi", count: questions.length },
    ];

    grades.forEach((g) => {
      const gClasses = classes.filter((c) => c.grade === g);
      if (gClasses.length > 0 || g === 6 || g === 10) {
        tree.push({
          id: `grade-${g}`,
          label: `Khối ${g}`,
          count: questions.filter((q) => q.grade === g).length,
          children: [
            {
              id: `grade-${g}-toan`,
              label: "Môn Toán",
              children: gClasses.filter((c) => c.subject === "Toán").map((c) => ({ id: `cls-${c.code}`, label: `Lớp ${c.code}` })),
            },
          ],
        });
      }
    });

    tree.push({ id: "UNCLASSIFIED", label: "Chưa phân loại", count: questions.filter((q) => !q.classCode).length });
    return tree;
  }, [classes, questions]);

  // Lọc câu hỏi hiển thị
  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      // Tìm kiếm
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
  }, [questions, searchQuery, filterType, filterDifficulty, filterStatus, filterSource]);

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

  // Lưu câu hỏi mới (Hoặc phát hành tạo phiên bản mới)
  const handleSaveQuestion = (publish = false) => {
    if (!authoringContent.trim()) {
      notify("Vui lòng nhập nội dung câu hỏi!", "error");
      return;
    }

    const newQ: QuestionItem = {
      id: `q-${Date.now()}`,
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

    setQuestions([newQ, ...questions]);
    setAuthoringModalOpen(false);
    notify(publish ? "Đã phát hành câu hỏi vào ngân hàng!" : "Đã lưu nháp câu hỏi thành công!", "success");

    // Reset
    setAuthoringContent("");
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
                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700"
                        title="Chỉnh sửa (Tạo phiên bản mới)"
                      >
                        <Pencil size={14} />
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
              {examsList.map((ex) => (
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
    </div>
  );
}
