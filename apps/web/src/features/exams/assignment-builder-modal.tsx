"use client";

import { useState, useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Database,
  Edit3,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Music,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { useApp } from "@/providers/app-provider";

export interface ParsedQuestionItem {
  id: string;
  order: number;
  content: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  type: "Điền khuyết" | "Trắc nghiệm một đáp án" | "Nhiều đáp án" | "Đúng / Sai";
  score: number;
  solutionVideoUrl?: string;
  hint?: string;
}

export interface AssignmentBuilderModalProps {
  open: boolean;
  onClose: () => void;
  targetClassName?: string;
  targetClassId?: string;
  onSaveAssignment: (assignmentData: {
    title: string;
    description: string;
    type: "MULTIPLE_CHOICE" | "ESSAY";
    source: "LIBRARY" | "UPLOAD";
    questions: ParsedQuestionItem[];
    submissionMethods: string[];
    settings: {
      durationMinutes: number;
      hasDuration: boolean;
      startAt: string;
      hasStartAt: boolean;
      dueAt: string;
      hasDueAt: boolean;
      allowLateSubmission: boolean;
      isExamLabel: boolean;
      blockReviewAfterSubmit: boolean;
      studentPermission: string;
      maxAttempts: number;
      gradingMethod: string;
      shuffleQuestions: boolean;
      shuffleAnswers: boolean;
    };
    attachedFile?: { name: string; size: string; type: string };
  }) => void;
}

// Mẫu câu hỏi phân tích bằng AI trắc nghiệm theo chuẩn K-12 trong Ảnh 3
const INITIAL_AI_PARSED_QUESTIONS: ParsedQuestionItem[] = [
  {
    id: "q-ai-1",
    order: 1,
    content: "Kết quả của phép tính 3 475 + 2 618 là:",
    options: [
      { key: "A", text: "6 083" },
      { key: "B", text: "6 093" },
      { key: "C", text: "6 193" },
      { key: "D", text: "5 093" },
    ],
    correctAnswer: "B",
    type: "Điền khuyết",
    score: 2,
    solutionVideoUrl: "",
    hint: "Thực hiện phép cộng lần lượt từ hàng đơn vị sang hàng nghìn.",
  },
  {
    id: "q-ai-2",
    order: 2,
    content: "Kết quả của phép chia 864 : 8 là:",
    options: [
      { key: "A", text: "108" },
      { key: "B", text: "118" },
      { key: "C", text: "106" },
      { key: "D", text: "98" },
    ],
    correctAnswer: "A",
    type: "Điền khuyết",
    score: 2,
    solutionVideoUrl: "",
    hint: "8 chia 8 được 1, hạ 6; 6 chia 8 được 0, hạ 4; 64 chia 8 được 8.",
  },
  {
    id: "q-ai-3",
    order: 3,
    content: "Phân số thích hợp điền vào chỗ chấm: 3/8 + 2/8 = ...",
    options: [
      { key: "A", text: "5/16" },
      { key: "B", text: "1/8" },
      { key: "C", text: "5/8" },
      { key: "D", text: "6/8" },
    ],
    correctAnswer: "C",
    type: "Điền khuyết",
    score: 2,
    solutionVideoUrl: "",
    hint: "Hai phân số cùng mẫu: cộng tử với tử, giữ nguyên mẫu.",
  },
  {
    id: "q-ai-4",
    order: 4,
    content: "Một hình chữ nhật có chiều dài 12 cm, chiều rộng 8 cm. Chu vi của hình chữ nhật đó là:",
    options: [
      { key: "A", text: "20 cm" },
      { key: "B", text: "40 cm" },
      { key: "C", text: "96 cm²" },
      { key: "D", text: "24 cm" },
    ],
    correctAnswer: "B",
    type: "Điền khuyết",
    score: 2,
    solutionVideoUrl: "",
    hint: "Chu vi hình chữ nhật = (chiều dài + chiều rộng) x 2.",
  },
  {
    id: "q-ai-5",
    order: 5,
    content: "Giá trị của biểu thức 45 - 5 x (12 - 9) là:",
    options: [
      { key: "A", text: "120" },
      { key: "B", text: "40" },
      { key: "C", text: "30" },
      { key: "D", text: "15" },
    ],
    correctAnswer: "C",
    type: "Điền khuyết",
    score: 2,
    solutionVideoUrl: "",
    hint: "Tính trong ngoặc trước: 12 - 9 = 3, sau đó 5 x 3 = 15, cuối cùng 45 - 15 = 30.",
  },
];

// Trình tạo bài tập và đề kiểm tra toàn diện hỗ trợ AI tách câu và tùy chọn nộp bài
export function AssignmentBuilderModal({
  open,
  onClose,
  targetClassName = "Lớp 6A1",
  onSaveAssignment,
}: AssignmentBuilderModalProps) {
  const { notify } = useApp();
  // Bước thực hiện: STEP_1_SOURCE (chọn nguồn), STEP_2_AI_SPLIT (tách câu trắc nghiệm), STEP_3_SETTINGS (cấu hình đề)
  const [step, setStep] = useState<"SOURCE" | "AI_SPLIT" | "ESSAY_SETUP" | "SETTINGS">("SOURCE");

  // Nguồn bài tập: "LIBRARY" (từ kho học liệu) hoặc "UPLOAD" (tải lên từ máy)
  const [sourceType, setSourceType] = useState<"LIBRARY" | "UPLOAD">("UPLOAD");
  const [assignmentType, setAssignmentType] = useState<"MULTIPLE_CHOICE" | "ESSAY">("MULTIPLE_CHOICE");

  // Thông tin cơ bản
  const [title, setTitle] = useState("Bài tập ôn tập trắc nghiệm số 1");
  const [description, setDescription] = useState("Học sinh hoàn thành các câu hỏi trắc nghiệm dưới đây để củng cố kiến thức.");

  // Tệp tải lên
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string; type: string } | null>({
    name: "Trac_nghiem_Toan_lop_6_Chuong1.docx",
    size: "1.4 MB",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const [isAiProcessing, setIsAiProcessing] = useState(false);

  // Danh sách câu hỏi đã tách (Ảnh 3)
  const [questions, setQuestions] = useState<ParsedQuestionItem[]>(INITIAL_AI_PARSED_QUESTIONS);
  const [activeTabRight, setActiveTabRight] = useState<"1. Đáp án" | "2. Mở rộng" | "3. Thông tin phần">("1. Đáp án");
  const [isRandomQuestions, setIsRandomQuestions] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  // Tùy chọn nộp bài cho dạng Tự luận (Ảnh 2)
  const [submissionMethods, setSubmissionMethods] = useState<string[]>([
    "Chụp hình ảnh và nộp",
    "Nộp bằng word, pdf",
  ]);

  // Bộ cấu hình bài tập / đề thi (Ảnh 2 & Ảnh 4)
  const [hasDuration, setHasDuration] = useState(true);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [hasStartAt, setHasStartAt] = useState(false);
  const [startAt, setStartAt] = useState("2026-10-28T08:00");
  const [hasDueAt, setHasDueAt] = useState(true);
  const [dueAt, setDueAt] = useState("2026-11-05T23:59");
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [isExamLabel, setIsExamLabel] = useState(false);
  const [blockReviewAfterSubmit, setBlockReviewAfterSubmit] = useState(false);
  const [studentPermission, setStudentPermission] = useState("Chỉ xem điểm");
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [gradingMethod, setGradingMethod] = useState("Lấy điểm lần làm bài đầu tiên");
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [shuffleAnswers, setShuffleAnswers] = useState(false);

  // Tính tổng điểm
  const totalScore = useMemo(() => {
    return questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0);
  }, [questions]);

  if (!open) return null;

  // Xử lý nạp tệp từ máy tính và giả lập tách câu tự động bằng AI
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFile({
      name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      type: file.type || "file",
    });
    setTitle(file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " "));

    // Kích hoạt mô phỏng AI tách câu
    setIsAiProcessing(true);
    setTimeout(() => {
      setIsAiProcessing(false);
      notify("Trí tuệ nhân tạo (AI) đã tách thành công 5 câu hỏi từ tệp!", "success");
    }, 900);
  };

  // Cập nhật đáp án hoặc điểm của câu hỏi
  const handleUpdateQuestion = (id: string, updates: Partial<ParsedQuestionItem>) => {
    setQuestions((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...updates } : q))
    );
  };

  // Toggle hình thức nộp bài
  const handleToggleSubmissionMethod = (method: string) => {
    setSubmissionMethods((prev) =>
      prev.includes(method) ? prev.filter((m) => m !== method) : [...prev, method]
    );
  };

  // Hoàn tất lưu bài tập
  const handleFinishSave = () => {
    onSaveAssignment({
      title: title.trim() || "Bài tập mới",
      description: description.trim(),
      type: assignmentType,
      source: sourceType,
      questions: assignmentType === "MULTIPLE_CHOICE" ? questions : [],
      submissionMethods,
      settings: {
        durationMinutes,
        hasDuration,
        startAt,
        hasStartAt,
        dueAt,
        hasDueAt,
        allowLateSubmission,
        isExamLabel,
        blockReviewAfterSubmit,
        studentPermission,
        maxAttempts,
        gradingMethod,
        shuffleQuestions,
        shuffleAnswers,
      },
      attachedFile: uploadedFile || undefined,
    });
    notify(`Đã tạo bài tập '${title}' thành công cho ${targetClassName}!`, "success");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 dark:bg-black/80 backdrop-blur-xs overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col my-auto">
        {/* =========================================================================
            HEADER THANH TIÊU ĐỀ & BREADCRUMB
            ========================================================================= */}
        <div className="px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="hover:text-blue-600 cursor-pointer" onClick={() => setStep("SOURCE")}>
              Bài tập
            </span>
            <ChevronRight size={14} />
            <span className="hover:text-blue-600 cursor-pointer" onClick={() => setStep("SOURCE")}>
              Tạo bài tập
            </span>
            <ChevronRight size={14} />
            <span className="text-blue-600 font-bold">
              {step === "SOURCE"
                ? "Chọn phương thức & Dạng đề"
                : step === "AI_SPLIT"
                ? "Chọn dạng đề & Tách câu AI"
                : step === "ESSAY_SETUP"
                ? "Thiết lập đề tự luận & Tệp đính kèm"
                : "Cấu hình làm bài & Nộp bài"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {step === "AI_SPLIT" || step === "ESSAY_SETUP" ? (
              <button
                type="button"
                onClick={() => setStep("SETTINGS")}
                className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <span>Tiếp tục</span>
                <ArrowRight size={14} />
              </button>
            ) : null}

            {step === "SETTINGS" ? (
              <button
                type="button"
                onClick={handleFinishSave}
                className="px-5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <Check size={14} />
                <span>Hoàn tất & Phát hành</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* =========================================================================
            BƯỚC 1: CHỌN NGUỒN VÀ DẠNG ĐỀ (TỪ KHO HỌC LIỆU HOẶC TẢI LÊN MÁY TÍNH)
            ========================================================================= */}
        {step === "SOURCE" && (
          <div className="p-6 overflow-y-auto space-y-6">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Thêm bài tập / bài kiểm tra mới
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Lựa chọn nguồn đề thi và hình thức bài tập phù hợp cho {targetClassName}.
              </p>
            </div>

            {/* Khung 2 cách thêm: Từ kho học liệu hoặc Tải lên từ máy */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                onClick={() => setSourceType("UPLOAD")}
                className={`p-5 rounded-2xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  sourceType === "UPLOAD"
                    ? "border-blue-600 bg-blue-50/40 dark:bg-blue-950/30 shadow-xs"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="space-y-2">
                  <div className="size-11 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 grid place-items-center">
                    <UploadCloud size={24} />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Cách 1: Thêm bằng tải lên từ máy tính
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Tải lên file Word (.docx, .doc), PDF hoặc Ảnh. Hệ thống sử dụng AI để tự động tách câu hỏi và đáp án cho đề trắc nghiệm.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-bold text-blue-600">
                  {sourceType === "UPLOAD" ? "✓ Đang chọn" : "Nhấn để chọn"}
                </div>
              </div>

              <div
                onClick={() => setSourceType("LIBRARY")}
                className={`p-5 rounded-2xl border-2 transition cursor-pointer flex flex-col justify-between ${
                  sourceType === "LIBRARY"
                    ? "border-blue-600 bg-blue-50/40 dark:bg-blue-950/30 shadow-xs"
                    : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
                }`}
              >
                <div className="space-y-2">
                  <div className="size-11 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-600 dark:text-purple-400 grid place-items-center">
                    <Database size={24} />
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Cách 2: Thêm từ kho học liệu
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Chọn các đề đã có sẵn từ cây thư mục Kho học liệu phân cấp theo Khối, Môn hoặc từ mục "Đề chưa phân loại".
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] font-bold text-blue-600">
                  {sourceType === "LIBRARY" ? "✓ Đang chọn" : "Nhấn để chọn"}
                </div>
              </div>
            </div>

            {/* Chọn dạng bài tập: Trắc nghiệm (tách câu AI) hoặc Tự luận (giữ file) */}
            <div className="space-y-3 pt-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Chọn định dạng đề thi:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  onClick={() => setAssignmentType("MULTIPLE_CHOICE")}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    assignmentType === "MULTIPLE_CHOICE"
                      ? "border-blue-600 bg-blue-50/30 dark:bg-blue-950/20 ring-1 ring-blue-500"
                      : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="assignType"
                    checked={assignmentType === "MULTIPLE_CHOICE"}
                    onChange={() => setAssignmentType("MULTIPLE_CHOICE")}
                    className="accent-blue-600"
                  />
                  <div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      Đề trắc nghiệm (Tự động tách câu bằng AI)
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      Tự động nhận diện câu hỏi, lựa chọn A, B, C, D và đáp án
                    </span>
                  </div>
                </label>

                <label
                  onClick={() => setAssignmentType("ESSAY")}
                  className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    assignmentType === "ESSAY"
                      ? "border-blue-600 bg-blue-50/30 dark:bg-blue-950/20 ring-1 ring-blue-500"
                      : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="assignType"
                    checked={assignmentType === "ESSAY"}
                    onChange={() => setAssignmentType("ESSAY")}
                    className="accent-blue-600"
                  />
                  <div>
                    <strong className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                      Đề tự luận (Giữ nguyên tệp Word / PDF / Ảnh)
                    </strong>
                    <span className="text-[11px] text-slate-500">
                      Hiển thị tệp đính kèm nguyên vẹn và mở các hình thức nộp bài
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* Vùng chọn file nếu chọn UPLOAD */}
            {sourceType === "UPLOAD" && (
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Tải lên tệp đề bài (Word, PDF, Ảnh):
                </label>
                <label className="border-2 border-dashed border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 rounded-2xl p-6 block text-center cursor-pointer hover:border-blue-500 transition">
                  <input
                    type="file"
                    accept=".doc,.docx,.pdf,.png,.jpg,.jpeg"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <UploadCloud size={32} className="mx-auto text-blue-600 mb-2" />
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    {uploadedFile ? uploadedFile.name : "Nhấp vào đây để chọn file Word, PDF hoặc Ảnh"}
                  </span>
                  <span className="block text-[11px] text-slate-400 mt-1">
                    {uploadedFile
                      ? `Kích thước: ${uploadedFile.size} · Đã nạp thành công`
                      : "Hỗ trợ .docx, .doc, .pdf, .jpg, .png (Tối đa 50MB)"}
                  </span>
                </label>
              </div>
            )}

            {/* Vùng chọn từ kho học liệu nếu chọn LIBRARY */}
            {sourceType === "LIBRARY" && (
              <div className="space-y-2 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Chọn đề có sẵn trong kho học liệu:
                </label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {[
                    { id: "lib-1", title: "Test bài tập (Word .docx)", tag: "Đề chưa phân loại" },
                    { id: "lib-2", title: "Trac_nghiem_Toan_lop_4_Chuong1.docx", tag: "Đề chưa phân loại" },
                    { id: "lib-3", title: "Đề cương ôn tập Toán 6 giữa kỳ I.pdf", tag: "Khối 6 > Toán" },
                    { id: "lib-4", title: "Bộ câu hỏi kiểm tra 15 phút Số học.docx", tag: "Khối 6 > Toán" },
                  ].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setTitle(item.title);
                        setUploadedFile({ name: item.title, size: "1.2 MB", type: "docx" });
                        notify(`Đã chọn '${item.title}' từ kho học liệu`, "success");
                      }}
                      className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-900 cursor-pointer flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-6 rounded bg-blue-600 text-white font-bold text-[10px] grid place-items-center">
                          W
                        </span>
                        <span className="font-semibold">{item.title}</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {item.tag}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Nút chuyển tiếp */}
            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  if (assignmentType === "MULTIPLE_CHOICE") {
                    setStep("AI_SPLIT");
                  } else {
                    setStep("ESSAY_SETUP");
                  }
                }}
                disabled={isAiProcessing}
                className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs"
              >
                {isAiProcessing ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>AI đang phân tích & tách câu...</span>
                  </>
                ) : (
                  <>
                    <span>Tiếp tục bước tiếp theo</span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            BƯỚC 2A: TÁCH CÂU TỰ ĐỘNG BẰNG AI CHO ĐỀ TRẮC NGHIỆM (CHUẨN 100% ẢNH 3)
            ========================================================================= */}
        {step === "AI_SPLIT" && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-[580px]">
            {/* ---------------------------------------------------------------------
                CỘT TRÁI: DANH SÁCH CÂU HỎI ĐÃ ĐƯỢC TÁCH (PREVIEW NỘI DUNG VÀ ĐÁP ÁN)
                --------------------------------------------------------------------- */}
            <div className="w-full lg:w-7/12 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-4 sm:p-6 overflow-y-auto space-y-6 bg-slate-50/30 dark:bg-slate-900/40">
              {questions.map((q) => (
                <div
                  key={q.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-2xs space-y-3"
                >
                  {/* Tiêu đề câu và nút Sửa */}
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-sm font-bold text-blue-600 dark:text-blue-400">
                      Câu {q.order}
                    </strong>
                    <button
                      type="button"
                      onClick={() => setEditingQuestionId(editingQuestionId === q.id ? null : q.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      <Edit3 size={12} />
                      <span>Sửa</span>
                    </button>
                  </div>

                  {/* Nội dung câu hỏi */}
                  {editingQuestionId === q.id ? (
                    <textarea
                      rows={2}
                      value={q.content}
                      onChange={(e) => handleUpdateQuestion(q.id, { content: e.target.value })}
                      className="w-full p-2 rounded-xl border border-blue-400 text-xs bg-slate-50 dark:bg-slate-800"
                    />
                  ) : (
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-relaxed">
                      {q.content}
                    </p>
                  )}

                  {/* Bảng các phương án lựa chọn (A, B, C, D) dạng khung lưới chuẩn Ảnh 3 */}
                  <div className="border border-slate-300 dark:border-slate-700 rounded-lg overflow-hidden text-xs">
                    <div className="grid grid-cols-2 divide-x divide-slate-300 dark:divide-slate-700 border-b border-slate-300 dark:border-slate-700">
                      <div className="p-2 font-bold text-slate-800 dark:text-slate-200">
                        {q.options.find((o) => o.key === "A")?.key}. {q.options.find((o) => o.key === "A")?.text}
                      </div>
                      <div className="p-2 font-bold text-slate-800 dark:text-slate-200">
                        {q.options.find((o) => o.key === "B")?.key}. {q.options.find((o) => o.key === "B")?.text}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-slate-300 dark:divide-slate-700">
                      <div className="p-2 font-bold text-slate-800 dark:text-slate-200">
                        {q.options.find((o) => o.key === "C")?.key}. {q.options.find((o) => o.key === "C")?.text}
                      </div>
                      <div className="p-2 font-bold text-slate-800 dark:text-slate-200">
                        {q.options.find((o) => o.key === "D")?.key}. {q.options.find((o) => o.key === "D")?.text}
                      </div>
                    </div>
                  </div>

                  {/* Thanh Đáp án bên dưới có tick xanh chuẩn Ảnh 3 */}
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-500">Đáp án</span>
                      <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                        {q.correctAnswer}
                      </span>
                    </div>
                    <div className="size-6 rounded-md bg-emerald-600 text-white grid place-items-center shadow-2xs">
                      <Check size={14} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ---------------------------------------------------------------------
                CỘT PHẢI: BẢNG ĐIỀU KHIỂN & CẤU HÌNH ĐÁP ÁN TỪNG CÂU (CHUẨN ẢNH 3)
                --------------------------------------------------------------------- */}
            <div className="w-full lg:w-5/12 p-4 sm:p-5 overflow-y-auto space-y-4 bg-white dark:bg-slate-900">
              {/* 3 Tab điều hướng trên đầu */}
              <div className="grid grid-cols-3 rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-bold text-center">
                {(["1. Đáp án", "2. Mở rộng", "3. Thông tin phần"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTabRight(tab)}
                    className={`py-1.5 rounded-lg transition cursor-pointer ${
                      activeTabRight === tab
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {/* Thanh công cụ: Số câu, Tổng điểm, Nhập nhanh, Ngẫu nhiên, Lưu ý */}
              <div className="space-y-3 p-3.5 rounded-2xl bg-blue-600 text-white shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold whitespace-nowrap">Số câu</span>
                    <input
                      type="number"
                      value={questions.length}
                      readOnly
                      className="w-14 px-2 py-1 rounded-lg bg-white text-slate-900 text-center font-bold text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold whitespace-nowrap">Tổng điểm</span>
                    <input
                      type="number"
                      value={totalScore}
                      readOnly
                      className="w-14 px-2 py-1 rounded-lg bg-white text-slate-900 text-center font-bold text-xs"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => notify("Chức năng nhập nhanh đáp án hàng loạt", "info")}
                    className="flex-1 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold transition text-center cursor-pointer"
                  >
                    Nhập nhanh
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRandomQuestions(!isRandomQuestions);
                      notify(`Đã ${!isRandomQuestions ? "bật" : "tắt"} chế độ ngẫu nhiên`, "info");
                    }}
                    className="flex-1 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold transition text-center cursor-pointer"
                  >
                    Ngẫu nhiên: {isRandomQuestions ? "Bật" : "Tắt"}
                  </button>
                  <button
                    type="button"
                    onClick={() => notify("Lưu ý: Tùy chỉnh chi tiết đáp án và điểm từng câu bên dưới", "info")}
                    className="px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold transition text-center cursor-pointer"
                  >
                    Lưu ý
                  </button>
                </div>
              </div>

              {/* Lưới các thẻ cấu hình từng câu (Câu 1: B, Câu 2: A, Câu 3: C...) */}
              <div className="space-y-3">
                {questions.map((q) => (
                  <div
                    key={q.id}
                    className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2 text-xs"
                  >
                    {/* Hàng 1: Tiêu đề thẻ */}
                    <div className="flex items-center justify-between font-bold text-blue-600 dark:text-blue-400">
                      <span>Câu {q.order}: {q.correctAnswer}</span>
                    </div>

                    {/* Hàng 2: Loại câu hỏi */}
                    <div className="grid grid-cols-3 items-center gap-2">
                      <span className="text-slate-500 font-semibold">Loại</span>
                      <select
                        value={q.type}
                        onChange={(e) => handleUpdateQuestion(q.id, { type: e.target.value as any })}
                        className="col-span-2 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium"
                      >
                        <option value="Điền khuyết">Điền khuyết</option>
                        <option value="Trắc nghiệm một đáp án">Trắc nghiệm một đáp án</option>
                        <option value="Nhiều đáp án">Nhiều đáp án</option>
                        <option value="Đúng / Sai">Đúng / Sai</option>
                      </select>
                    </div>

                    {/* Hàng 3: Đáp án đúng */}
                    <div className="grid grid-cols-3 items-center gap-2">
                      <span className="text-slate-500 font-semibold">Đáp án</span>
                      <input
                        type="text"
                        value={q.correctAnswer}
                        onChange={(e) => handleUpdateQuestion(q.id, { correctAnswer: e.target.value.toUpperCase() })}
                        className="col-span-2 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                      />
                    </div>

                    {/* Hàng 4: Điểm số */}
                    <div className="grid grid-cols-3 items-center gap-2">
                      <span className="text-slate-500 font-semibold">Điểm</span>
                      <input
                        type="number"
                        value={q.score}
                        onChange={(e) => handleUpdateQuestion(q.id, { score: Number(e.target.value) })}
                        className="col-span-2 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                      />
                    </div>

                    {/* Hàng 5: Video lời giải */}
                    <div className="grid grid-cols-3 items-center gap-2">
                      <span className="text-slate-500 font-semibold truncate">Video lời giải</span>
                      <input
                        type="url"
                        placeholder="Dán link video..."
                        value={q.solutionVideoUrl || ""}
                        onChange={(e) => handleUpdateQuestion(q.id, { solutionVideoUrl: e.target.value })}
                        className="col-span-2 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      />
                    </div>

                    {/* Hàng 6: Gợi ý kèm bộ 4 icons (Chữ, Ảnh, Nhạc, Video) */}
                    <div className="grid grid-cols-3 items-center gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                      <span className="text-slate-500 font-semibold">Gợi ý</span>
                      <div className="col-span-2 flex items-center gap-3 text-slate-400">
                        <button
                          type="button"
                          onClick={() => notify(`Nhập gợi ý văn bản cho câu ${q.order}`, "info")}
                          className="hover:text-blue-600 cursor-pointer"
                          title="Gợi ý văn bản"
                        >
                          <Type size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => notify(`Đính kèm ảnh minh họa cho câu ${q.order}`, "info")}
                          className="hover:text-blue-600 cursor-pointer"
                          title="Ảnh minh họa"
                        >
                          <ImageIcon size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => notify(`Đính kèm âm thanh cho câu ${q.order}`, "info")}
                          className="hover:text-blue-600 cursor-pointer"
                          title="Âm thanh"
                        >
                          <Music size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => notify(`Đính kèm video cho câu ${q.order}`, "info")}
                          className="hover:text-blue-600 cursor-pointer"
                          title="Video"
                        >
                          <Video size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            BƯỚC 2B: THIẾT LẬP ĐỀ TỰ LUẬN (GIỮ NGUYÊN FILE & MỞ CÁC HÌNH THỨC NỘP BÀI)
            ========================================================================= */}
        {step === "ESSAY_SETUP" && (
          <div className="p-6 overflow-y-auto space-y-6">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Thiết lập đề bài tự luận
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Tệp Word / PDF sẽ được giữ nguyên hiển thị trên màn hình làm bài của học sinh.
              </p>
            </div>

            {/* Thông tin bài tập */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tiêu đề bài tập / đề thi *:
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Yêu cầu / Hướng dẫn làm bài:
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
                />
              </div>
            </div>

            {/* Xem trước tệp đính kèm nguyên vẹn */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-3">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                Tệp đề bài đính kèm (Giữ nguyên cho học sinh xem):
              </span>
              <div className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <span className="size-9 rounded-xl bg-blue-600 text-white font-extrabold grid place-items-center text-xs">
                    W
                  </span>
                  <div>
                    <strong className="block text-xs font-bold">{uploadedFile?.name || "De_kiem_tra_tu_luan.docx"}</strong>
                    <span className="text-[11px] text-slate-400">Word Document · {uploadedFile?.size || "1.8 MB"} · Giữ nguyên định dạng</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-emerald-600">✓ Sẵn sàng hiển thị</span>
              </div>
            </div>

            {/* PHẦN CHỌN HÌNH THỨC NỘP BÀI CỦA HỌC SINH (CHUẨN ẢNH 2) */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                Chọn hình thức nộp bài của học sinh
              </h3>
              <div className="flex flex-wrap gap-3">
                {[
                  "Chụp hình ảnh và nộp",
                  "Nộp bằng word, pdf",
                  "Nộp bài bằng file âm thanh, video",
                  "Nhập văn bản",
                  "URL trang web",
                ].map((method) => {
                  const isChecked = submissionMethods.includes(method);
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => handleToggleSubmissionMethod(method)}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                        isChecked
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-2xs"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      <span className={`size-4 rounded-full border grid place-items-center text-[10px] ${
                        isChecked ? "bg-white text-slate-900 border-white dark:bg-slate-900 dark:text-white" : "border-slate-400"
                      }`}>
                        {isChecked ? "✓" : ""}
                      </span>
                      <span>{method}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Nút tiếp tục */}
            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setStep("SETTINGS")}
                className="px-6 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <span>Cấu hình thời gian & làm bài</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            BƯỚC 3: CẤU HÌNH BÀI TẬP / ĐỀ THI TOÀN DIỆN (CHUẨN ẢNH 2 & ẢNH 4)
            ========================================================================= */}
        {step === "SETTINGS" && (
          <div className="p-6 overflow-y-auto space-y-5">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Cấu hình bài tập & Quy chế thi
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Thiết lập thời lượng, hạn nộp, quyền xem điểm, đảo đề và phương thức tính điểm.
              </p>
            </div>

            <div className="space-y-4 max-w-3xl divide-y divide-slate-100 dark:divide-slate-800">
              {/* Mục 1: Thời lượng làm bài và nộp bài */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Thời lượng làm bài và nộp bài (phút)
                    </strong>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Thời lượng làm bài bao gồm cả thời gian nộp bài
                  </p>
                  {hasDuration && (
                    <div className="mt-2">
                      <input
                        type="number"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(Number(e.target.value))}
                        className="w-24 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold"
                      />
                    </div>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={hasDuration}
                    onChange={(e) => setHasDuration(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 2: Thời gian bắt đầu */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Thời gian bắt đầu
                    </strong>
                  </div>
                  {hasStartAt && (
                    <div className="mt-2">
                      <input
                        type="datetime-local"
                        value={startAt}
                        onChange={(e) => setStartAt(e.target.value)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      />
                    </div>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={hasStartAt}
                    onChange={(e) => setHasStartAt(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 3: Hạn chót nộp bài */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Hạn chót nộp bài
                    </strong>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Học sinh không thể nộp bài sau thời gian này
                  </p>
                  {hasDueAt && (
                    <div className="mt-2">
                      <input
                        type="datetime-local"
                        value={dueAt}
                        onChange={(e) => setDueAt(e.target.value)}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      />
                    </div>
                  )}
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={hasDueAt}
                    onChange={(e) => setHasDueAt(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 4: Cho phép học sinh nộp bổ sung bài sau khi quá thời hạn */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Cho phép học sinh nộp bổ sung bài sau khi quá thời hạn cho phép
                    </strong>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={allowLateSubmission}
                    onChange={(e) => setAllowLateSubmission(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 5: Gán nhãn bài tập là kiểm tra */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Gán nhãn bài tập là kiểm tra
                    </strong>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={isExamLabel}
                    onChange={(e) => setIsExamLabel(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 6: Chặn học sinh xem lại đề sau khi làm xong */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Chặn học sinh xem lại đề sau khi làm xong
                    </strong>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={blockReviewAfterSubmit}
                    onChange={(e) => setBlockReviewAfterSubmit(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* Mục 7: Quyền của học sinh */}
              <div className="pt-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs">❔</span>
                  <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Quyền của học sinh
                  </strong>
                </div>
                <select
                  value={studentPermission}
                  onChange={(e) => setStudentPermission(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="Chỉ xem điểm">Chỉ xem điểm</option>
                  <option value="Xem điểm và bài làm">Xem điểm và bài làm</option>
                  <option value="Xem điểm, đáp án và lời giải">Xem điểm, đáp án và lời giải</option>
                  <option value="Không được xem gì">Không được xem gì</option>
                </select>
              </div>

              {/* Mục 8: Số lần làm bài */}
              <div className="pt-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs">❔</span>
                  <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Số lần làm bài
                  </strong>
                </div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold"
                />
              </div>

              {/* Mục 9: Thiết lập bảng điểm */}
              <div className="pt-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs">❔</span>
                  <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Thiết lập bảng điểm
                  </strong>
                </div>
                <select
                  value={gradingMethod}
                  onChange={(e) => setGradingMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                >
                  <option value="Lấy điểm lần làm bài đầu tiên">Lấy điểm lần làm bài đầu tiên</option>
                  <option value="Lấy điểm cao nhất">Lấy điểm cao nhất</option>
                  <option value="Lấy điểm lần làm bài cuối cùng">Lấy điểm lần làm bài cuối cùng</option>
                  <option value="Lấy điểm trung bình">Lấy điểm trung bình</option>
                </select>
              </div>

              {/* Mục 10: Đảo thứ tự câu trong đề kèm alert vàng */}
              <div className="pt-3 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 text-xs">❔</span>
                    <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Đảo thứ tự câu trong đề
                    </strong>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={shuffleQuestions}
                      onChange={(e) => setShuffleQuestions(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                {!shuffleQuestions && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs font-medium">
                    <AlertTriangle size={15} className="shrink-0 text-amber-600" />
                    <span>Khi làm bài, mọi học sinh đều có đề giống nhau (Không đảo thứ tự câu)</span>
                  </div>
                )}
              </div>

              {/* Mục 11: Đảo thứ tự đáp án trong câu */}
              <div className="pt-3 flex items-start justify-between gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 text-xs">❔</span>
                  <strong className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Đảo thứ tự đáp án trong câu
                  </strong>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={shuffleAnswers}
                    onChange={(e) => setShuffleAnswers(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>

            {/* Nút lưu hoàn tất */}
            <div className="flex justify-between items-center pt-6 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setStep(assignmentType === "MULTIPLE_CHOICE" ? "AI_SPLIT" : "ESSAY_SETUP")}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                ← Quay lại
              </button>
              <button
                type="button"
                onClick={handleFinishSave}
                className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-xs"
              >
                <Check size={15} />
                <span>Hoàn tất & Lưu bài tập</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
