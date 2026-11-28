"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileCheck2,
  ImagePlus,
  LoaderCircle,
  Plus,
  Scan,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  defaultDueAt,
  distributeEqualQuestionScores,
  type AssignmentBuilderModalProps,
  type ParsedQuestionItem,
} from "@/features/exams/assignment-builder-modal";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import { toLocalDateTimeInput } from "@/lib/date-time";
import type { Question, QuestionImportResult } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";
import { ScoreStepperInput } from "@/shared/ui/score-stepper-input";
import { RichText } from "@/shared/ui/ui";

const MAX_SCAN_IMAGES = 5;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const OBJECTIVE_TYPES: ReadonlySet<Question["type"]> = new Set([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
]);

export type SmartScanTargetMode = "BANK_ONLY" | "MULTIPLE_CHOICE" | "ESSAY";

interface QueuedScanImage {
  id: string;
  file: File;
  previewUrl: string;
  scanned: boolean;
}

export interface EditableScannedQuestion {
  id: string;
  type: Question["type"];
  content: string;
  options: string[];
  correctIndices: number[];
  referenceAnswer: string;
  difficulty: Question["difficulty"];
  score: number;
  tags: string[];
  confidence: number;
  answerSource?: string;
  warnings: string[];
}

interface RawScanApiQuestion {
  type: Question["type"];
  content: string;
  options?: string[];
  correctAnswers?: string[];
  difficulty?: Question["difficulty"];
  tags?: string[];
  confidence?: number;
  answerSource?: string;
  warnings?: string[];
}

export interface SmartExamScanModalProps {
  open: boolean;
  courseId?: string;
  roleCode: RoleCode;
  targetMode?: SmartScanTargetMode;
  targetClassEndAt?: string;
  onClose: () => void;
  onBackToHub?: () => void;
  onImported: () => Promise<void> | void;
  onSaveAssignment?: AssignmentBuilderModalProps["onSaveAssignment"];
}

const fieldInputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

// Loại bỏ ký hiệu đầu dòng A., B), C: dư thừa trên phương án do AI trả về để giáo viên dễ chỉnh sửa.
function cleanOptionText(raw: string, index: number): string {
  const trimmed = raw.trim().replace(/\*\*/g, "");
  const expected = String.fromCharCode(65 + index);
  const match = trimmed.match(/^([A-F])[.:)]\s+(.+)$/iu);
  if (match && match[1]!.toUpperCase() === expected) {
    return match[2]!.trim();
  }
  return trimmed;
}

// Chia đều tổng 10 điểm cho danh sách câu hỏi quét được khi đang ở chế độ tạo đề trắc nghiệm.
function rebalanceScannedQuestionScores(
  items: EditableScannedQuestion[],
  targetTotal = 10,
): EditableScannedQuestion[] {
  const scores = distributeEqualQuestionScores(items.length, targetTotal);
  return items.map((item, idx) => ({
    ...item,
    score: scores[idx] ?? 1,
  }));
}

// Chuyển một bản nháp câu hỏi từ API OCR sang cấu trúc thẻ chỉnh sửa phù hợp với loại đề mục tiêu.
function mapApiQuestionToEditable(
  raw: RawScanApiQuestion,
  targetMode: SmartScanTargetMode,
): EditableScannedQuestion {
  const rawType: Question["type"] = raw.type ?? "SINGLE_CHOICE";
  const effectiveType: Question["type"] =
    targetMode === "ESSAY"
      ? "ESSAY"
      : targetMode === "MULTIPLE_CHOICE" && !OBJECTIVE_TYPES.has(rawType)
        ? "SINGLE_CHOICE"
        : rawType;

  const rawOptions =
    effectiveType === "TRUE_FALSE"
      ? raw.options && raw.options.length >= 2
        ? raw.options.slice(0, 2)
        : ["Đúng", "Sai"]
      : OBJECTIVE_TYPES.has(effectiveType)
        ? raw.options && raw.options.length >= 2
          ? raw.options.slice(0, 6)
          : ["", "", "", ""]
        : [];

  const options = rawOptions.map((opt, idx) => cleanOptionText(opt ?? "", idx));
  const rawAnswers = (raw.correctAnswers ?? []).map((ans) => ans.trim()).filter(Boolean);
  const correctIndices: number[] = [];

  if (OBJECTIVE_TYPES.has(effectiveType)) {
    for (const ans of rawAnswers) {
      const cleanAns = ans.replace(/\*\*/g, "").trim();
      const letterMatch = cleanAns.match(/^([A-F])(?:[.:)]\s*(.*))?$/iu);
      let matchedIndex = options.findIndex(
        (opt) => opt.trim().toLocaleLowerCase() === cleanAns.toLocaleLowerCase(),
      );
      if (matchedIndex < 0 && letterMatch) {
        const candidateIdx = letterMatch[1]!.toUpperCase().charCodeAt(0) - 65;
        if (candidateIdx >= 0 && candidateIdx < options.length) {
          matchedIndex = candidateIdx;
        }
      }
      if (matchedIndex >= 0 && !correctIndices.includes(matchedIndex)) {
        correctIndices.push(matchedIndex);
      }
    }
  }

  let baseContent = (raw.content ?? "").trim();
  if (targetMode === "ESSAY" && raw.options && raw.options.length > 0 && OBJECTIVE_TYPES.has(rawType)) {
    const subItems = raw.options
      .map((opt, idx) => `${String.fromCharCode(97 + idx)}) ${cleanOptionText(opt, idx)}`)
      .join("\n");
    baseContent = `${baseContent}\n${subItems}`.trim();
  }

  const warnings = [...(raw.warnings ?? [])];
  if (targetMode === "MULTIPLE_CHOICE" && !OBJECTIVE_TYPES.has(rawType)) {
    warnings.push("Câu gốc chưa có phương án A–D; hãy nhập phương án hoặc xóa nếu không thuộc đề trắc nghiệm.");
  }
  if (
    OBJECTIVE_TYPES.has(effectiveType) &&
    correctIndices.length === 0 &&
    !warnings.some((w) => /đáp án/iu.test(w))
  ) {
    warnings.push("AI chưa xác định chắc chắn đáp án đúng. Hãy tích chọn đáp án trước khi lưu.");
  }

  return {
    id: crypto.randomUUID(),
    type: effectiveType,
    content: baseContent,
    options,
    correctIndices:
      effectiveType === "SINGLE_CHOICE" || effectiveType === "TRUE_FALSE"
        ? correctIndices.slice(0, 1)
        : correctIndices,
    referenceAnswer: OBJECTIVE_TYPES.has(effectiveType) ? "" : rawAnswers.join("\n"),
    difficulty: raw.difficulty ?? 2,
    score: 2,
    tags: raw.tags?.length ? raw.tags : ["OCR"],
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.85,
    answerSource: raw.answerSource,
    warnings: targetMode === "ESSAY" ? warnings.filter((w) => !/đáp án/iu.test(w)) : warnings,
  };
}

// Khởi tạo một thẻ câu hỏi trống để giáo viên bổ sung thủ công ngay trong danh sách quét.
function createBlankEditableQuestion(targetMode: SmartScanTargetMode): EditableScannedQuestion {
  const isEssay = targetMode === "ESSAY";
  return {
    id: crypto.randomUUID(),
    type: isEssay ? "ESSAY" : "SINGLE_CHOICE",
    content: "",
    options: isEssay ? [] : ["", "", "", ""],
    correctIndices: [],
    referenceAnswer: "",
    difficulty: 2,
    score: 2,
    tags: ["OCR", "Soạn bổ sung"],
    confidence: 1,
    warnings: [],
  };
}

/** Modal quét đề thông minh hỗ trợ chọn tối đa 5 ảnh có preview, quét cộng dồn câu hỏi, xác nhận hủy phiên dở dang và lưu tạo đề trực tiếp. */
export function SmartExamScanModal({
  open,
  courseId,
  roleCode,
  targetMode = "BANK_ONLY",
  targetClassEndAt,
  onClose,
  onBackToHub,
  onImported,
  onSaveAssignment,
}: SmartExamScanModalProps) {
  const { notify } = useApp();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imagesRef = useRef<QueuedScanImage[]>([]);
  const scanAbortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);

  const [images, setImages] = useState<QueuedScanImage[]>([]);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<EditableScannedQuestion[]>([]);
  const [customScoresEdited, setCustomScoresEdited] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgressLabel, setScanProgressLabel] = useState("");
  const [providerLabel, setProviderLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [confirmDiscardAction, setConfirmDiscardAction] = useState<"CLOSE" | "BACK_TO_HUB" | null>(
    null,
  );

  // Cấu hình bài tập khi mở từ luồng "+ Tạo bài tập"
  const [assignmentTitle, setAssignmentTitle] = useState("");
  const [assignmentDescription, setAssignmentDescription] = useState("");
  const [dueAt, setDueAt] = useState(() => defaultDueAt(targetClassEndAt));
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [aiTutorEnabled, setAiTutorEnabled] = useState(false);
  const [targetScaleScore, setTargetScaleScore] = useState(10);
  const [essayMaxScore, setEssayMaxScore] = useState(10);
  const [attachFirstImage, setAttachFirstImage] = useState(true);

  const isAssignmentMode = targetMode !== "BANK_ONLY" && Boolean(onSaveAssignment);

  const totalObjectiveScore = useMemo(
    () =>
      Math.round(
        questions.reduce((sum, item) => sum + (Number(item.score) || 0), 0) * 100,
      ) / 100,
    [questions],
  );

  // Giữ tham chiếu danh sách ảnh mới nhất để giải phóng blob URL an toàn khi đóng hoặc hủy component.
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Làm mới toàn bộ phiên quét mỗi khi mở lại modal từ trạng thái đóng để không bao giờ sót ảnh cũ.
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (!openedRef.current) {
      openedRef.current = true;
      for (const item of imagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
      imagesRef.current = [];
      setImages([]);
      setActiveImageId(null);
      setQuestions([]);
      setCustomScoresEdited(false);
      setScanning(false);
      setScanProgressLabel("");
      setProviderLabel("");
      setSaving(false);
      setDragActive(false);
      setConfirmDiscardAction(null);
      setAssignmentTitle("");
      setAssignmentDescription("");
      setDueAt(defaultDueAt(targetClassEndAt));
      setDurationMinutes(45);
      setMaxAttempts(1);
      setShuffleQuestions(false);
      setAiTutorEnabled(false);
      setTargetScaleScore(10);
      setEssayMaxScore(10);
      setAttachFirstImage(true);
    }
  }, [open, targetClassEndAt]);

  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort();
      for (const item of imagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  if (!open) return null;

  const activeImage = images.find((img) => img.id === activeImageId) ?? images[0] ?? null;
  const unscannedCount = images.filter((img) => !img.scanned).length;
  const hasUnsavedWork = scanning || images.length > 0 || questions.length > 0;

  // Dừng mọi luồng quét đang chạy, giải phóng toàn bộ ảnh/câu hỏi nháp và thực thi hành động thoát.
  const wipeSessionAndExit = (destination: "CLOSE" | "BACK_TO_HUB") => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    for (const item of imagesRef.current) {
      URL.revokeObjectURL(item.previewUrl);
    }
    imagesRef.current = [];
    setImages([]);
    setActiveImageId(null);
    setQuestions([]);
    setCustomScoresEdited(false);
    setScanning(false);
    setScanProgressLabel("");
    setProviderLabel("");
    setAssignmentTitle("");
    setAssignmentDescription("");
    setConfirmDiscardAction(null);
    if (destination === "BACK_TO_HUB" && onBackToHub) {
      onBackToHub();
    } else {
      onClose();
    }
  };

  // Kiểm tra dữ liệu dở dang trước khi đóng hoặc quay lại chọn phương thức tạo khác.
  const requestExit = (destination: "CLOSE" | "BACK_TO_HUB") => {
    if (saving) return;
    if (hasUnsavedWork) {
      setConfirmDiscardAction(destination);
      return;
    }
    wipeSessionAndExit(destination);
  };

  // Mở hộp thoại chọn tệp ảnh khi giáo viên bấm vào Vùng 1 hoặc nút thêm ảnh.
  const openFilePicker = () => {
    if (scanning || saving) return;
    if (images.length >= MAX_SCAN_IMAGES) {
      notify("Tối đa 5 ảnh trong danh sách quét. Hãy xóa bớt ảnh cũ nếu muốn chọn ảnh khác.", "info");
      return;
    }
    fileInputRef.current?.click();
  };

  // Kiểm tra định dạng, dung lượng và thêm tối đa 5 ảnh vào hàng đợi kèm URL xem trước.
  const appendSelectedFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;

    const remainingSlots = MAX_SCAN_IMAGES - images.length;
    if (remainingSlots <= 0) {
      notify("Danh sách đã đủ 5 ảnh tối đa. Hãy xóa bớt ảnh trong Vùng 1 để thêm ảnh mới.", "error");
      return;
    }

    const accepted: QueuedScanImage[] = [];
    for (const file of incoming) {
      if (accepted.length >= remainingSlots) {
        notify("Chỉ cho phép chọn tối đa 5 ảnh đề thi cùng lúc.", "info");
        break;
      }
      if (!file.type.startsWith("image/") || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
        notify(`Tệp "${file.name}" không hợp lệ. Chỉ nhận ảnh dung lượng tối đa 12 MB.`, "error");
        continue;
      }
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        scanned: false,
      });
    }

    if (!accepted.length) return;
    setImages((prev) => [...prev, ...accepted]);
    setActiveImageId((prev) => prev ?? accepted[0]!.id);
    if (isAssignmentMode) {
      const baseName = accepted[0]!.file.name.replace(/\.[^.]+$/u, "");
      setAssignmentTitle((prev) =>
        prev.trim()
          ? prev
          : `${targetMode === "ESSAY" ? "Bài tự luận" : "Đề trắc nghiệm"}: ${baseName}`,
      );
    }
  };

  // Xử lý sự kiện chọn tệp từ thẻ input ẩn.
  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      appendSelectedFiles(event.target.files);
    }
    event.target.value = "";
  };

  // Hỗ trợ kéo-thả nhiều ảnh trực tiếp vào khung Vùng 1.
  const handleDropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (scanning || saving) return;
    if (event.dataTransfer.files?.length) {
      appendSelectedFiles(event.dataTransfer.files);
    }
  };

  // Xóa một ảnh khỏi hàng đợi xem trước nhưng vẫn giữ nguyên toàn bộ câu hỏi đã quét ở Vùng 2.
  const removeQueuedImage = (targetId: string) => {
    if (scanning || saving) return;
    setImages((prev) => {
      const removed = prev.find((item) => item.id === targetId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const next = prev.filter((item) => item.id !== targetId);
      if (activeImageId === targetId) {
        setActiveImageId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  // Quét lần lượt các ảnh mới (hoặc ảnh đang xem nếu tất cả đã quét) và cộng dồn câu hỏi vào Vùng 2.
  const handleScanImages = async (forceActiveImage = false) => {
    if (scanning || saving || !images.length) return;
    const targets = forceActiveImage
      ? activeImage
        ? [activeImage]
        : []
      : images.filter((img) => !img.scanned);

    const queue = targets.length > 0 ? targets : activeImage ? [activeImage] : [];
    if (!queue.length) return;

    const controller = new AbortController();
    scanAbortRef.current = controller;
    setScanning(true);
    let totalAdded = 0;
    try {
      for (let idx = 0; idx < queue.length; idx += 1) {
        if (controller.signal.aborted) return;
        const target = queue[idx]!;
        setActiveImageId(target.id);
        setScanProgressLabel(`Đang quét ảnh ${idx + 1}/${queue.length}: ${target.file.name}...`);

        const form = new FormData();
        form.append("file", target.file);
        const result = await apiRequest<{
          questions: RawScanApiQuestion[];
          provider: string;
          model: string;
          warnings?: string[];
        }>("/instructor/question-bank/scan-image", {
          method: "POST",
          roleCode,
          body: form,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        const mapped = (result.questions ?? []).map((q) =>
          mapApiQuestionToEditable(q, targetMode),
        );
        totalAdded += mapped.length;
        setProviderLabel(`${result.provider} / ${result.model}`);
        setQuestions((prev) => {
          const combined = [...prev, ...mapped];
          if (isAssignmentMode && !customScoresEdited) {
            const target = targetMode === "ESSAY" ? essayMaxScore : targetScaleScore;
            return rebalanceScannedQuestionScores(combined, target);
          }
          return combined;
        });
        setImages((prev) =>
          prev.map((img) => (img.id === target.id ? { ...img, scanned: true } : img)),
        );
      }

      notify(
        `Đã quét thêm ${totalAdded} câu hỏi từ ${queue.length} ảnh. Bạn có thể sửa hoặc xóa từng câu trước khi ${isAssignmentMode ? "tạo đề" : "nhập"}.`,
        "success",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      notify(error instanceof Error ? error.message : "Không quét được ảnh đề thi.", "error");
    } finally {
      if (scanAbortRef.current === controller) {
        scanAbortRef.current = null;
        setScanning(false);
        setScanProgressLabel("");
      }
    }
  };

  // Cập nhật thông tin một thẻ câu hỏi cụ thể trong danh sách bản nháp.
  const updateQuestion = (questionId: string, patch: Partial<EditableScannedQuestion>) => {
    setQuestions((prev) =>
      prev.map((item) => (item.id === questionId ? { ...item, ...patch } : item)),
    );
  };

  // Đổi loại câu hỏi và điều chỉnh danh sách phương án tương ứng.
  const handleChangeQuestionType = (question: EditableScannedQuestion, nextType: Question["type"]) => {
    if (nextType === "TRUE_FALSE") {
      updateQuestion(question.id, {
        type: nextType,
        options: ["Đúng", "Sai"],
        correctIndices: question.correctIndices.filter((i) => i < 2).slice(0, 1),
      });
      return;
    }
    if (OBJECTIVE_TYPES.has(nextType)) {
      const nextOptions = question.options.length >= 2 ? question.options : ["", "", "", ""];
      updateQuestion(question.id, {
        type: nextType,
        options: nextOptions,
        correctIndices:
          nextType === "SINGLE_CHOICE" ? question.correctIndices.slice(0, 1) : question.correctIndices,
      });
      return;
    }
    updateQuestion(question.id, {
      type: nextType,
      options: [],
      correctIndices: [],
    });
  };

  // Chọn hoặc bỏ chọn một phương án làm đáp án đúng và xóa cảnh báo thiếu đáp án.
  const toggleCorrectOption = (question: EditableScannedQuestion, optionIndex: number) => {
    const nextIndices =
      question.type === "MULTIPLE_CHOICE"
        ? question.correctIndices.includes(optionIndex)
          ? question.correctIndices.filter((i) => i !== optionIndex)
          : [...question.correctIndices, optionIndex].sort((a, b) => a - b)
        : [optionIndex];

    updateQuestion(question.id, {
      correctIndices: nextIndices,
      answerSource: "Giảng viên đã chọn đáp án",
      warnings: question.warnings.filter((w) => !/đáp án|phương án/iu.test(w)),
    });
  };

  // Kiểm tra tính hợp lệ của toàn bộ danh sách câu hỏi đang có trong Vùng 2.
  const validateScannedQuestions = (requireObjectiveOnly = false): boolean => {
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i]!;
      if (q.content.trim().length < 5) {
        notify(`Câu ${i + 1}: Nội dung câu hỏi cần ít nhất 5 ký tự.`, "error");
        return false;
      }
      if (requireObjectiveOnly && !OBJECTIVE_TYPES.has(q.type)) {
        notify(`Câu ${i + 1}: Đề trắc nghiệm chỉ nhận câu trắc nghiệm hoặc đúng/sai.`, "error");
        return false;
      }
      if (OBJECTIVE_TYPES.has(q.type)) {
        const filledOptions = q.options.map((o) => o.trim()).filter(Boolean);
        if (filledOptions.length < 2) {
          notify(`Câu ${i + 1}: Cần nhập ít nhất 2 phương án trả lời.`, "error");
          return false;
        }
        const uniqueLower = new Set(filledOptions.map((o) => o.toLocaleLowerCase()));
        if (uniqueLower.size !== filledOptions.length) {
          notify(`Câu ${i + 1}: Các phương án trả lời không được trùng nhau.`, "error");
          return false;
        }
        const validAnswers = q.correctIndices
          .map((idx) => q.options[idx]?.trim() ?? "")
          .filter(Boolean);
        if (!validAnswers.length) {
          notify(`Câu ${i + 1}: Vui lòng tích chọn đáp án đúng trước khi lưu.`, "error");
          return false;
        }
        if (
          requireObjectiveOnly &&
          (!Number.isFinite(q.score) ||
            q.score < 0.01 ||
            Math.abs(Math.round(q.score * 100) - q.score * 100) > 1e-6)
        ) {
          notify(`Câu ${i + 1}: Điểm câu hỏi phải từ 0,01 và tối đa 2 chữ số thập phân.`, "error");
          return false;
        }
      }
    }
    return true;
  };

  // Nhập câu hỏi vào ngân hàng (chỉ dùng cho chế độ thêm câu hỏi từ Tab Ngân hàng câu hỏi).
  const handleImportQuestions = async () => {
    if (saving || scanning || !questions.length) return;
    if (!courseId) {
      notify("Lớp chưa gắn môn học để nhập câu hỏi.", "error");
      return;
    }
    if (!validateScannedQuestions(false)) return;

    setSaving(true);
    try {
      const payloadQuestions = questions.map((q) => {
        if (OBJECTIVE_TYPES.has(q.type)) {
          const indexMap = new Map<number, string>();
          const cleanOpts: string[] = [];
          q.options.forEach((opt, idx) => {
            const trimmed = opt.trim();
            if (trimmed) {
              indexMap.set(idx, trimmed);
              cleanOpts.push(trimmed);
            }
          });
          const correctAnswers = q.correctIndices
            .map((idx) => indexMap.get(idx))
            .filter((val): val is string => Boolean(val));
          return {
            courseId,
            type: q.type,
            content: q.content.trim(),
            options: cleanOpts,
            correctAnswers,
            difficulty: q.difficulty,
            tags: q.tags,
          };
        }
        const refAnswers = q.referenceAnswer
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        return {
          courseId,
          type: q.type,
          content: q.content.trim(),
          options: [],
          correctAnswers: refAnswers,
          difficulty: q.difficulty,
          tags: q.tags,
        };
      });

      const results = await apiRequest<QuestionImportResult[]>(
        "/instructor/question-bank/questions/import",
        {
          method: "POST",
          roleCode,
          body: JSON.stringify({ questions: payloadQuestions }),
        },
      );

      const importedCount = results.filter((r) => r.status === "IMPORTED").length;
      const failed = results.filter((r) => r.status === "FAILED");
      await onImported();

      if (!failed.length) {
        notify(`Đã nhập thành công ${importedCount}/${results.length} câu hỏi vào ngân hàng.`, "success");
        wipeSessionAndExit("CLOSE");
      } else {
        const failedRowSet = new Set(failed.map((r) => r.row));
        setQuestions((prev) => prev.filter((_, idx) => failedRowSet.has(idx + 1)));
        notify(
          `Đã nhập ${importedCount}/${results.length} câu. Lỗi: ${failed
            .map((r) => `câu ${r.row}: ${r.message}`)
            .join("; ")}`,
          "error",
        );
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không nhập được câu hỏi vào ngân hàng.", "error");
    } finally {
      setSaving(false);
    }
  };

  // Lưu và đóng gói danh sách câu hỏi đã quét trực tiếp thành bài tập trắc nghiệm hoặc tự luận của lớp.
  const handleCreateAssignmentFromScan = async () => {
    if (!onSaveAssignment || saving || scanning || !questions.length) return;
    const cleanTitle = assignmentTitle.trim();
    if (cleanTitle.length < 3) {
      notify("Vui lòng nhập tên bài tập tối thiểu 3 ký tự.", "error");
      return;
    }
    const deadlineMs = new Date(dueAt).getTime();
    const classEndMs = targetClassEndAt ? Date.parse(targetClassEndAt) : NaN;
    if (
      !Number.isFinite(deadlineMs) ||
      deadlineMs <= Date.now() ||
      (Number.isFinite(classEndMs) && deadlineMs > classEndMs)
    ) {
      notify("Hạn nộp phải ở tương lai và không vượt quá ngày kết thúc lớp học.", "error");
      return;
    }

    const isMcAssignment = targetMode === "MULTIPLE_CHOICE";
    if (!validateScannedQuestions(isMcAssignment)) return;

    if (isMcAssignment) {
      if (totalObjectiveScore < 0.25) {
        notify("Tổng điểm đề trắc nghiệm phải đạt ít nhất 0,25 điểm.", "error");
        return;
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
        notify("Thời lượng làm bài cần nằm trong khoảng 1–600 phút.", "error");
        return;
      }
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
        notify("Số lượt làm bài cần nằm trong khoảng 1–10.", "error");
        return;
      }
    } else {
      for (let i = 0; i < questions.length; i += 1) {
        const sc = questions[i]!.score;
        if (!Number.isFinite(sc) || sc < 0.01 || Math.abs(Math.round(sc * 100) - sc * 100) > 1e-6) {
          notify(`Câu ${i + 1}: Điểm câu hỏi phải từ 0,01 và tối đa 2 chữ số thập phân.`, "error");
          return;
        }
      }
      if (!Number.isFinite(essayMaxScore) || essayMaxScore < 0.25 || essayMaxScore > 1000) {
        notify("Thang điểm bài tự luận cần nằm trong khoảng 0,25–1000.", "error");
        return;
      }
    }

    setSaving(true);
    try {
      const builderQuestions: ParsedQuestionItem[] = isMcAssignment
        ? questions.map((q, idx) => {
            const compactOptions: Array<{ key: string; text: string }> = [];
            const compactCorrectKeys: string[] = [];
            q.options.forEach((optText, rawOptIdx) => {
              const trimmed = optText.trim();
              if (!trimmed) return;
              const assignedKey = String.fromCharCode(65 + compactOptions.length);
              compactOptions.push({ key: assignedKey, text: trimmed });
              if (q.correctIndices.includes(rawOptIdx)) {
                compactCorrectKeys.push(assignedKey);
              }
            });
            return {
              id: q.id,
              order: idx + 1,
              content: q.content.trim(),
              options: compactOptions,
              correctAnswer: compactCorrectKeys[0] ?? "A",
              correctAnswers: compactCorrectKeys,
              questionType:
                q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE"
                  ? q.type
                  : "SINGLE_CHOICE",
              type: "Trắc nghiệm một đáp án",
              score: q.score,
              answerSource: q.answerSource,
              warnings: q.warnings.length ? q.warnings : undefined,
            };
          })
        : [];

      const essayEntries = !isMcAssignment
        ? questions
            .map((q) => ({ text: q.content.trim(), score: Math.round(q.score * 100) / 100 }))
            .filter((entry) => Boolean(entry.text))
        : [];

      await onSaveAssignment({
        title: cleanTitle,
        description: assignmentDescription.trim(),
        type: isMcAssignment ? "MULTIPLE_CHOICE" : "ESSAY",
        questions: builderQuestions,
        essayQuestions: essayEntries.map((entry) => entry.text),
        ...(!isMcAssignment && essayEntries.length > 0
          ? { essayQuestionScores: essayEntries.map((entry) => entry.score) }
          : {}),
        attachedFile:
          !isMcAssignment && attachFirstImage && images[0]?.file
            ? images[0].file
            : undefined,
        ...(isMcAssignment
          ? {}
          : {
              scoreBreakdown: {
                multipleChoicePoints: 0,
                essayPoints: Math.round(essayMaxScore * 100) / 100,
              },
            }),
        settings: {
          durationMinutes,
          hasDuration: isMcAssignment,
          startAt: toLocalDateTimeInput(new Date()),
          hasStartAt: false,
          dueAt,
          hasDueAt: true,
          maxAttempts,
          shuffleQuestions: isMcAssignment && shuffleQuestions,
          aiTutorEnabled: isMcAssignment && aiTutorEnabled,
        },
      });
      await onImported();
      wipeSessionAndExit("CLOSE");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Không thể tạo bài tập từ câu hỏi đã quét.", "error");
    } finally {
      setSaving(false);
    }
  };

  const modalTitle =
    targetMode === "MULTIPLE_CHOICE"
      ? "Quét ảnh tạo đề trắc nghiệm (AI OCR)"
      : targetMode === "ESSAY"
        ? "Quét ảnh tạo bài tập tự luận (AI OCR)"
        : "Quét đề thi thông minh (AI OCR & Đối chiếu)";

  const modalSubtitle =
    targetMode === "MULTIPLE_CHOICE"
      ? "Chọn tối đa 5 ảnh đề thi, quét cộng dồn câu hỏi, tự động chia đều tổng 10 điểm và lưu tạo đề trắc nghiệm."
      : targetMode === "ESSAY"
        ? "Chọn tối đa 5 ảnh đề tự luận, quét cộng dồn câu hỏi, chỉnh sửa nội dung và lưu tạo bài tập tự luận."
        : "Chọn tối đa 5 ảnh đề thi, quét cộng dồn câu hỏi và chỉnh sửa trực tiếp trước khi nhập vào ngân hàng.";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5 backdrop-blur-xs"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-exam-scan-title"
        className="relative flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Thanh tiêu đề */}
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Scan size={19} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id="smart-exam-scan-title"
                  className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100"
                >
                  {modalTitle}
                </h3>
                {isAssignmentMode && (
                  <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                    {targetMode === "ESSAY" ? "Đề Tự luận" : "Đề Trắc nghiệm · Thang 10 điểm"}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{modalSubtitle}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onBackToHub && (
              <button
                type="button"
                disabled={saving}
                onClick={() => requestExit("BACK_TO_HUB")}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>{isAssignmentMode ? "Chọn cách tạo khác" : "Chọn cách thêm khác"}</span>
              </button>
            )}
            <button
              type="button"
              aria-label="Đóng cửa sổ quét đề"
              disabled={saving}
              onClick={() => requestExit("CLOSE")}
              className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Thân modal 2 cột rộng rãi */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[420px_minmax(0,1fr)] overflow-hidden">
          {/* Cột trái: Vùng 1 — Chọn đa ảnh, Xem trước & Thiết lập bài tập */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-slate-200 p-5 lg:border-b-0 lg:border-r dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Vùng 1: Ảnh chụp đề thi gốc ({images.length}/{MAX_SCAN_IMAGES})
              </span>
              {images.length < MAX_SCAN_IMAGES && (
                <button
                  type="button"
                  disabled={scanning || saving}
                  onClick={openFilePicker}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950/60 dark:text-indigo-300 cursor-pointer"
                >
                  <ImagePlus size={14} />
                  Chọn thêm ảnh
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              id="smart-scan-image-input"
              type="file"
              accept="image/*"
              multiple
              disabled={scanning || saving}
              onChange={handleFileInputChange}
              className="sr-only"
            />

            {/* Khung bấm chọn ảnh trực tiếp ở Vùng 1 hoặc hiển thị Preview ảnh lớn */}
            <div
              onDragOver={(event) => {
                event.preventDefault();
                if (!scanning && !saving) setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDropFiles}
              className={`rounded-2xl border-2 border-dashed transition ${
                dragActive
                  ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40"
                  : "border-indigo-200 bg-indigo-50/20 dark:border-indigo-900/60 dark:bg-indigo-950/15"
              }`}
            >
              {!activeImage ? (
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={scanning || saving}
                  className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2.5 p-6 text-center hover:bg-indigo-50/40 dark:hover:bg-indigo-950/30 rounded-2xl transition cursor-pointer"
                >
                  <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300">
                    <ImagePlus size={28} />
                  </span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Bấm vào đây để chọn ảnh đề thi
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Hỗ trợ chọn nhiều ảnh cùng lúc (tối đa 5 ảnh · mỗi ảnh tối đa 12 MB) hoặc kéo thả vào khung này
                  </span>
                </button>
              ) : (
                <div className="p-3 space-y-2.5">
                  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-950/5 dark:border-slate-800 dark:bg-slate-950">
                    <Image
                      src={activeImage.previewUrl}
                      alt={`Xem trước ${activeImage.file.name}`}
                      width={800}
                      height={1000}
                      unoptimized
                      className="max-h-[280px] w-full object-contain"
                    />
                    <span
                      className={`absolute left-2.5 top-2.5 rounded-lg px-2 py-0.5 text-[11px] font-bold shadow-xs ${
                        activeImage.scanned
                          ? "bg-emerald-600 text-white"
                          : "bg-indigo-600 text-white"
                      }`}
                    >
                      {activeImage.scanned ? "Đã quét" : "Chờ quét"}
                    </span>
                    <button
                      type="button"
                      aria-label={`Xóa ảnh ${activeImage.file.name}`}
                      disabled={scanning || saving}
                      onClick={() => removeQueuedImage(activeImage.id)}
                      className="absolute right-2.5 top-2.5 rounded-lg bg-slate-900/75 p-1.5 text-white hover:bg-rose-600 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 px-1 text-xs">
                    <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                      {activeImage.file.name}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {(activeImage.file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Dải ảnh thu nhỏ (1..5 ảnh) + ô bấm thêm ảnh nhanh */}
            {images.length > 0 && (
              <div className="grid grid-cols-5 gap-2">
                {images.map((img, idx) => {
                  const isSelected = img.id === activeImage?.id;
                  return (
                    <div key={img.id} className="relative group">
                      <button
                        type="button"
                        onClick={() => setActiveImageId(img.id)}
                        className={`relative block aspect-square w-full overflow-hidden rounded-xl border-2 transition cursor-pointer ${
                          isSelected
                            ? "border-indigo-600 ring-2 ring-indigo-500/25"
                            : "border-slate-200 hover:border-indigo-300 dark:border-slate-700"
                        }`}
                      >
                        <Image
                          src={img.previewUrl}
                          alt={`Ảnh ${idx + 1}`}
                          width={120}
                          height={120}
                          unoptimized
                          className="h-full w-full object-cover"
                        />
                        {img.scanned && (
                          <span className="absolute bottom-1 right-1 rounded-full bg-emerald-600 p-0.5 text-white">
                            <CheckCircle2 size={11} />
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Bỏ ảnh ${idx + 1}`}
                        disabled={scanning || saving}
                        onClick={() => removeQueuedImage(img.id)}
                        className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-rose-600 text-white shadow-xs opacity-90 hover:opacity-100 disabled:opacity-40 cursor-pointer"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
                {images.length < MAX_SCAN_IMAGES && (
                  <button
                    type="button"
                    aria-label="Thêm ảnh đề thi mới"
                    disabled={scanning || saving}
                    onClick={openFilePicker}
                    className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/30 text-indigo-600 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 cursor-pointer"
                  >
                    <UploadCloud size={16} />
                    <span className="text-[10px] font-bold">Thêm</span>
                  </button>
                )}
              </div>
            )}

            {providerLabel && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Đã nhận diện bằng: <strong className="font-semibold">{providerLabel}</strong>
              </p>
            )}

            {/* Nút quét cộng dồn câu hỏi */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void handleScanImages(false)}
                disabled={scanning || saving || images.length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {scanning ? (
                  <>
                    <LoaderCircle size={16} className="animate-spin" />
                    <span>{scanProgressLabel || "Đang quét và bóc tách..."}</span>
                  </>
                ) : (
                  <>
                    <Scan size={16} />
                    <span>
                      {unscannedCount > 0
                        ? questions.length > 0
                          ? `Quét thêm ${unscannedCount} ảnh mới (cộng dồn câu hỏi)`
                          : `Bắt đầu quét AI (${unscannedCount} ảnh)`
                        : "Quét lại ảnh đang xem (cộng dồn câu hỏi)"}
                    </span>
                  </>
                )}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Mỗi lần chọn thêm ảnh mới và bấm quét, câu hỏi mới sẽ được nối tiếp vào cuối danh sách bên phải mà không làm mất các câu đã có.
              </p>
            </div>

            {/* Khung cấu hình bài tập khi mở từ luồng Tạo bài tập */}
            {isAssignmentMode && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <div className="flex items-center gap-2">
                  <FileCheck2 size={16} className="text-indigo-600 dark:text-indigo-400" />
                  <span className="text-xs font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Thiết lập bài tập phát hành
                  </span>
                </div>

                <div>
                  <label
                    htmlFor="scan-assignment-title"
                    className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Tên bài tập <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="scan-assignment-title"
                    type="text"
                    maxLength={255}
                    value={assignmentTitle}
                    onChange={(event) => setAssignmentTitle(event.target.value)}
                    placeholder={
                      targetMode === "ESSAY"
                        ? "Ví dụ: Bài tự luận chương 2..."
                        : "Ví dụ: Kiểm tra 15 phút chương 2..."
                    }
                    className={fieldInputClass}
                  />
                </div>

                <div>
                  <label
                    htmlFor="scan-assignment-due"
                    className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                  >
                    Hạn nộp <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="scan-assignment-due"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                    className={fieldInputClass}
                  />
                </div>

                {targetMode === "MULTIPLE_CHOICE" ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                      <label
                        htmlFor="scan-mc-scale"
                        className="text-xs font-bold text-slate-700 dark:text-slate-300"
                      >
                        Thang điểm chia đều
                      </label>
                      <ScoreStepperInput
                        id="scan-mc-scale"
                        stepTargetLabel="thang điểm đề"
                        min={0.25}
                        max={1000}
                        value={targetScaleScore}
                        onChange={(val) => {
                          const safe = val >= 0.25 ? val : 0.25;
                          setTargetScaleScore(safe);
                          if (!customScoresEdited && questions.length > 0) {
                            setQuestions((prev) => rebalanceScannedQuestionScores(prev, safe));
                          }
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor="scan-exam-duration"
                          className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Thời lượng (phút)
                        </label>
                        <input
                          id="scan-exam-duration"
                          type="number"
                          min={1}
                          max={600}
                          value={durationMinutes}
                          onChange={(event) => setDurationMinutes(Number(event.target.value))}
                          className={fieldInputClass}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="scan-exam-attempts"
                          className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Số lượt làm
                        </label>
                        <input
                          id="scan-exam-attempts"
                          type="number"
                          min={1}
                          max={10}
                          value={maxAttempts}
                          onChange={(event) => setMaxAttempts(Number(event.target.value))}
                          className={fieldInputClass}
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={shuffleQuestions}
                        onChange={(event) => setShuffleQuestions(event.target.checked)}
                        className="size-4 accent-indigo-600"
                      />
                      <span>Đảo thứ tự câu hỏi khi học viên làm bài</span>
                    </label>

                    <label className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 p-2.5 text-xs text-slate-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiTutorEnabled}
                        onChange={(event) => setAiTutorEnabled(event.target.checked)}
                        className="mt-0.5 size-4 accent-indigo-600"
                      />
                      <Sparkles size={14} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span>Cho phép học sinh hỏi đáp AI dẫn dắt khi làm bài</span>
                    </label>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <label
                          htmlFor="scan-essay-score"
                          className="text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Thang điểm bài tự luận
                        </label>
                        <ScoreStepperInput
                          id="scan-essay-score"
                          stepTargetLabel="thang điểm tự luận"
                          min={0.25}
                          max={1000}
                          value={essayMaxScore}
                          onChange={(val) => {
                            const safe = val >= 0.25 ? val : 0.25;
                            setEssayMaxScore(safe);
                            setCustomScoresEdited(false);
                            if (questions.length > 0) {
                              setQuestions((prev) => rebalanceScannedQuestionScores(prev, safe));
                            }
                          }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="scan-essay-desc"
                          className="mb-1 block text-xs font-bold text-slate-700 dark:text-slate-300"
                        >
                          Ghi chú hướng dẫn (tùy chọn)
                        </label>
                        <textarea
                          id="scan-essay-desc"
                          rows={2}
                          value={assignmentDescription}
                          onChange={(event) => setAssignmentDescription(event.target.value)}
                          placeholder="Yêu cầu trình bày hoặc lưu ý nộp bài..."
                          className={`${fieldInputClass} resize-y`}
                        />
                      </div>
                    </div>

                    {images.length > 0 && (
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={attachFirstImage}
                          onChange={(event) => setAttachFirstImage(event.target.checked)}
                          className="size-4 accent-indigo-600"
                        />
                        <span>Đính kèm ảnh đề đầu tiên cho học viên đối chiếu</span>
                      </label>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Cột phải: Vùng 2 — Trình sửa / xóa / thêm câu hỏi trực quan */}
          <div className="flex min-h-0 flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Vùng 2: Kiểm tra & Chỉnh sửa câu hỏi ({questions.length} câu
                  {targetMode === "MULTIPLE_CHOICE"
                    ? ` · Tổng ${totalObjectiveScore} điểm`
                    : targetMode === "ESSAY"
                      ? ` · Tổng ${essayMaxScore} điểm`
                      : ""}
                  )
                </span>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {targetMode === "ESSAY"
                    ? "Chỉnh sửa trực tiếp đề bài tự luận hoặc bổ sung thêm câu hỏi trước khi giao bài."
                    : "Sửa trực tiếp đề bài, phương án, tích chọn đáp án đúng hoặc xóa câu bất kỳ trước khi lưu."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAssignmentMode && questions.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || scanning}
                    onClick={() => {
                      setCustomScoresEdited(false);
                      const target = targetMode === "ESSAY" ? essayMaxScore : targetScaleScore;
                      setQuestions((prev) => rebalanceScannedQuestionScores(prev, target));
                    }}
                    className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300 cursor-pointer"
                  >
                    Chia đều điểm
                  </button>
                )}
                {questions.length > 0 && (
                  <button
                    type="button"
                    disabled={saving || scanning}
                    onClick={() => {
                      setCustomScoresEdited(false);
                      setQuestions([]);
                    }}
                    className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                  >
                    Xóa tất cả
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setQuestions((prev) => {
                      const next = [...prev, createBlankEditableQuestion(targetMode)];
                      if (isAssignmentMode && !customScoresEdited) {
                        const target = targetMode === "ESSAY" ? essayMaxScore : targetScaleScore;
                        return rebalanceScannedQuestionScores(next, target);
                      }
                      if (targetMode === "ESSAY" && customScoresEdited) {
                        const sum = Math.round(next.reduce((acc, q) => acc + (Number(q.score) || 0), 0) * 100) / 100;
                        if (sum >= 0.25) setEssayMaxScore(sum);
                      }
                      return next;
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
                >
                  <Plus size={14} />
                  Thêm câu hỏi
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {questions.length === 0 ? (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 p-8 text-center dark:border-slate-800 dark:bg-slate-900/50">
                  <Scan size={32} className="mb-3 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    Chưa có câu hỏi nào trong danh sách
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Hãy bấm chọn 1–5 ảnh đề thi ở Vùng 1 rồi nhấn <strong>Bắt đầu quét AI</strong>, hoặc bấm <strong>Thêm câu hỏi</strong> để soạn trực tiếp.
                  </p>
                </div>
              ) : (
                questions.map((question, index) => (
                  <div
                    key={question.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-3.5 dark:border-slate-800 dark:bg-slate-900"
                  >
                    {/* Hàng đầu thẻ câu hỏi: Số thứ tự, Loại câu, Độ khó, Điểm, Nút xóa */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                          Câu {index + 1}
                        </span>
                        {targetMode === "ESSAY" ? (
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Tự luận
                          </span>
                        ) : (
                          <select
                            aria-label={`Loại câu ${index + 1}`}
                            value={question.type}
                            disabled={saving}
                            onChange={(event) =>
                              handleChangeQuestionType(
                                question,
                                event.target.value as Question["type"],
                              )
                            }
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                            <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
                            <option value="TRUE_FALSE">Đúng / Sai</option>
                            {targetMode === "BANK_ONLY" && (
                              <>
                                <option value="SHORT_ANSWER">Trả lời ngắn</option>
                                <option value="ESSAY">Tự luận</option>
                              </>
                            )}
                          </select>
                        )}
                        <select
                          aria-label={`Độ khó câu ${index + 1}`}
                          value={question.difficulty}
                          disabled={saving}
                          onChange={(event) =>
                            updateQuestion(question.id, {
                              difficulty: Number(event.target.value) as 1 | 2 | 3,
                            })
                          }
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <option value={1}>Cơ bản</option>
                          <option value={2}>Thông hiểu</option>
                          <option value={3}>Vận dụng</option>
                        </select>
                        {isAssignmentMode && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                            <span>Điểm:</span>
                            <ScoreStepperInput
                              ariaLabel={`Điểm câu ${index + 1}`}
                              stepTargetLabel={`câu ${index + 1}`}
                              min={0.25}
                              max={1000}
                              disabled={saving}
                              value={question.score}
                              onChange={(val) => {
                                setCustomScoresEdited(true);
                                setQuestions((prev) => {
                                  const next = prev.map((item) =>
                                    item.id === question.id ? { ...item, score: val } : item,
                                  );
                                  if (targetMode === "ESSAY") {
                                    const sum =
                                      Math.round(
                                        next.reduce((acc, q) => acc + (Number(q.score) || 0), 0) * 100,
                                      ) / 100;
                                    if (sum >= 0.25) setEssayMaxScore(sum);
                                  }
                                  return next;
                                });
                              }}
                            />
                          </span>
                        )}
                        <span className="text-[11px] font-medium text-slate-400">
                          Tin cậy {Math.round(question.confidence * 100)}%
                        </span>
                      </div>

                      <button
                        type="button"
                        aria-label={`Xóa câu hỏi ${index + 1}`}
                        disabled={saving}
                        onClick={() =>
                          setQuestions((prev) => {
                            const filtered = prev.filter((entry) => entry.id !== question.id);
                            if (isAssignmentMode && !customScoresEdited) {
                              const target = targetMode === "ESSAY" ? essayMaxScore : targetScaleScore;
                              return rebalanceScannedQuestionScores(filtered, target);
                            }
                            if (targetMode === "ESSAY" && customScoresEdited) {
                              const sum =
                                Math.round(
                                  filtered.reduce((acc, q) => acc + (Number(q.score) || 0), 0) * 100,
                                ) / 100;
                              if (sum >= 0.25) setEssayMaxScore(sum);
                            }
                            return filtered;
                          })
                        }
                        className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/30 cursor-pointer"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    {question.answerSource && (
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        Nguồn đáp án: {question.answerSource}
                      </p>
                    )}

                    {question.warnings.length > 0 && (
                      <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        {question.warnings.map((warning, wIdx) => (
                          <p key={`${warning}-${wIdx}`} className="flex items-start gap-2">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                            <span>{warning}</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {/* Ô sửa nội dung câu hỏi */}
                    <div className="space-y-1.5">
                      <textarea
                        aria-label={`Nội dung câu ${index + 1}`}
                        rows={targetMode === "ESSAY" ? 3 : 2}
                        maxLength={4000}
                        disabled={saving}
                        value={question.content}
                        onChange={(event) =>
                          updateQuestion(question.id, { content: event.target.value })
                        }
                        placeholder={
                          targetMode === "ESSAY"
                            ? "Nhập yêu cầu câu hỏi tự luận..."
                            : "Nhập nội dung câu hỏi..."
                        }
                        className={`${fieldInputClass} resize-y`}
                      />
                      {(question.content.includes("$") || question.content.includes("\\(")) && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                            Xem trước công thức:
                          </span>
                          <RichText>{question.content}</RichText>
                        </div>
                      )}
                    </div>

                    {/* Lưới phương án trắc nghiệm */}
                    {OBJECTIVE_TYPES.has(question.type) ? (
                      <div className="space-y-2.5">
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {question.options.map((optionText, optIdx) => {
                            const letter = String.fromCharCode(65 + optIdx);
                            const isChecked = question.correctIndices.includes(optIdx);
                            return (
                              <div
                                key={`${question.id}-opt-${optIdx}`}
                                className={`flex items-center gap-2 rounded-xl border p-2 transition ${
                                  isChecked
                                    ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/25"
                                    : "border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/40"
                                }`}
                              >
                                <input
                                  type={question.type === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                                  name={`scan-correct-${question.id}`}
                                  aria-label={`Đáp án đúng ${letter} câu ${index + 1}`}
                                  checked={isChecked}
                                  disabled={saving}
                                  onChange={() => toggleCorrectOption(question, optIdx)}
                                  className="size-4 shrink-0 accent-emerald-600 cursor-pointer"
                                />
                                <span className="w-4 shrink-0 text-xs font-extrabold text-slate-600 dark:text-slate-300">
                                  {letter}
                                </span>
                                <input
                                  type="text"
                                  aria-label={`Phương án ${letter} câu ${index + 1}`}
                                  value={optionText}
                                  disabled={saving || question.type === "TRUE_FALSE"}
                                  onChange={(event) =>
                                    updateQuestion(question.id, {
                                      options: question.options.map((val, idx) =>
                                        idx === optIdx ? event.target.value : val,
                                      ),
                                    })
                                  }
                                  placeholder={`Nội dung phương án ${letter}`}
                                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                                {question.type !== "TRUE_FALSE" && question.options.length > 2 && (
                                  <button
                                    type="button"
                                    aria-label={`Xóa phương án ${letter} câu ${index + 1}`}
                                    disabled={saving}
                                    onClick={() => {
                                      const nextOptions = question.options.filter((_, idx) => idx !== optIdx);
                                      const nextCorrect = question.correctIndices
                                        .filter((idx) => idx !== optIdx)
                                        .map((idx) => (idx > optIdx ? idx - 1 : idx));
                                      updateQuestion(question.id, {
                                        options: nextOptions,
                                        correctIndices: nextCorrect,
                                      });
                                    }}
                                    className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                                  >
                                    <X size={14} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {question.type !== "TRUE_FALSE" && question.options.length < 6 && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              updateQuestion(question.id, {
                                options: [...question.options, ""],
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 cursor-pointer"
                          >
                            <Plus size={13} />
                            Thêm phương án
                          </button>
                        )}
                      </div>
                    ) : targetMode === "BANK_ONLY" ? (
                      <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Đáp án đúng / Ý chấm tham khảo (mỗi dòng một ý):
                        </label>
                        <textarea
                          rows={2}
                          disabled={saving}
                          value={question.referenceAnswer}
                          onChange={(event) =>
                            updateQuestion(question.id, { referenceAnswer: event.target.value })
                          }
                          placeholder="Nhập đáp án hoặc gợi ý chấm điểm..."
                          className={fieldInputClass}
                        />
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Chân modal — Tách riêng hoàn toàn luồng Tạo bài tập và luồng Nhập Ngân hàng */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex flex-wrap items-center gap-3">
            {onBackToHub && (
              <button
                type="button"
                disabled={saving}
                onClick={() => requestExit("BACK_TO_HUB")}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>{isAssignmentMode ? "Quay lại chọn cách tạo khác" : "Quay lại"}</span>
              </button>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tổng cộng: <strong className="text-slate-900 dark:text-slate-100">{questions.length}</strong> câu hỏi sẵn sàng{" "}
              {isAssignmentMode
                ? `(${targetMode === "MULTIPLE_CHOICE" ? `${totalObjectiveScore} điểm` : `${essayMaxScore} điểm`})`
                : "kiểm duyệt"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={saving}
              onClick={() => requestExit("CLOSE")}
              className="rounded-xl border border-slate-300 px-4 py-2 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              {isAssignmentMode ? "Hủy" : "Đóng"}
            </button>
            {isAssignmentMode ? (
              <button
                type="button"
                disabled={saving || scanning || questions.length === 0}
                onClick={() => void handleCreateAssignmentFromScan()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {saving ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" />
                    <span>Đang lưu & tạo đề...</span>
                  </>
                ) : (
                  <span>
                    {targetMode === "ESSAY"
                      ? `Lưu & Tạo bài tự luận (${questions.length} câu)`
                      : `Lưu & Tạo đề trắc nghiệm (${questions.length} câu)`}
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || scanning || questions.length === 0}
                onClick={() => void handleImportQuestions()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs sm:text-sm font-bold text-white shadow-xs transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {saving ? (
                  <>
                    <LoaderCircle size={15} className="animate-spin" />
                    <span>Đang nhập...</span>
                  </>
                ) : (
                  <span>Nhập {questions.length} câu vào ngân hàng</span>
                )}
              </button>
            )}
          </div>
        </footer>

        {/* Hộp thoại xác nhận khi có ảnh hoặc câu hỏi đang quét dở */}
        {confirmDiscardAction && (
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="scan-discard-confirm-title"
            className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          >
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <AlertTriangle size={20} />
                </span>
                <div className="space-y-1">
                  <h4
                    id="scan-discard-confirm-title"
                    className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100"
                  >
                    {isAssignmentMode
                      ? "Bạn đang có đề quét dở chưa hoàn tất"
                      : "Bạn đang có câu hỏi quét dở chưa lưu"}
                  </h4>
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {scanning
                      ? "Hệ thống đang nhận diện đề từ ảnh. Bạn có chắc chắn muốn dừng và hủy không? Mọi ảnh và câu hỏi hiện tại sẽ bị xóa sạch để lần mở sau bắt đầu phiên mới hoàn toàn."
                      : isAssignmentMode
                        ? "Bạn đang có ảnh đề hoặc câu hỏi nháp để tạo đề. Bạn có chắc chắn muốn hủy tạo đề không? Nếu hủy, toàn bộ dữ liệu hiện tại sẽ được xóa sạch để lần sau bắt đầu lượt mới hoàn toàn."
                        : "Bạn đang có ảnh đề hoặc câu hỏi nháp chưa lưu vào ngân hàng. Bạn có chắc chắn muốn hủy phiên quét này không?"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDiscardAction(null)}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 cursor-pointer"
                >
                  {isAssignmentMode ? "Tiếp tục tạo đề" : "Tiếp tục chỉnh sửa"}
                </button>
                <button
                  type="button"
                  onClick={() => wipeSessionAndExit(confirmDiscardAction)}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 shadow-xs cursor-pointer"
                >
                  {isAssignmentMode ? "Dừng & Hủy tạo đề" : "Dừng & Hủy phiên quét"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
