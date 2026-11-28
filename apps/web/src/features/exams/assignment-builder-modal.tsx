"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  FileCheck2,
  FileText,
  LoaderCircle,
  Plus,
  ScanLine,
  Shuffle,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { toLocalDateTimeInput } from "@/lib/date-time";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { ScoreStepperInput } from "@/shared/ui/score-stepper-input";

export interface ParsedQuestionItem {
  id: string;
  order: number;
  content: string;
  options: { key: string; text: string }[];
  correctAnswer: string;
  correctAnswers?: string[];
  questionType?: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE";
  type: "Trắc nghiệm một đáp án";
  score: number;
  answerSource?: string;
  warnings?: string[];
}

interface ScannedQuestion {
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string;
  options?: string[];
  correctAnswers?: string[];
  answerSource?: string;
  warnings?: string[];
}

export interface AssignmentBuilderModalProps {
  open: boolean;
  onClose: () => void;
  onBackToHub?: () => void;
  targetClassName?: string;
  targetClassEndAt?: string;
  initialType?: AssignmentType;
  initialMethod?: CreationMethod;
  onSaveAssignment: (data: {
    title: string;
    description: string;
    type: "MULTIPLE_CHOICE" | "ESSAY";
    questions: ParsedQuestionItem[];
    essayQuestions: string[];
    essayQuestionScores?: number[];
    hidden?: boolean;
    attachedFile?: File;
    scoreBreakdown?: {
      multipleChoicePoints: number;
      essayPoints: number;
    };
    settings: {
      durationMinutes: number;
      hasDuration: boolean;
      startAt: string;
      hasStartAt: boolean;
      dueAt: string;
      hasDueAt: boolean;
      maxAttempts: number;
      shuffleQuestions: boolean;
      aiTutorEnabled?: boolean;
    };
  }) => void | Promise<void>;
}

type AssignmentType = "MULTIPLE_CHOICE" | "ESSAY";
type CreationMethod = "MANUAL" | "AI";
type Step = "TYPE" | "METHOD" | "CONTENT" | "SETTINGS" | "REVIEW";
type UploadPolicy = { maxFileSizeMb: number; allowedMimeTypes: string[] };

const fieldClass = "w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const defaultUploadPolicy: UploadPolicy = {
  maxFileSizeMb: 50,
  allowedMimeTypes: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg"],
};
const essayFileFormats = [
  { mime: "application/pdf", extensions: ["pdf"] },
  { mime: "application/msword", extensions: ["doc"] },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extensions: ["docx"] },
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/webp", extensions: ["webp"] },
] as const;

// Chuyển thời điểm sang giá trị datetime-local theo giờ máy người dùng.
function formatLocalDateTime(date: Date): string {
  return toLocalDateTimeInput(date);
}

// Tạo giá trị datetime-local cách hiện tại một số ngày.
function localDateTime(daysAhead: number): string {
  return formatLocalDateTime(new Date(Date.now() + daysAhead * 86_400_000));
}

// Chọn hạn nộp mặc định không vượt ngày kết thúc lớp.
export function defaultDueAt(classEndAt?: string): string {
  const classEnd = classEndAt ? Date.parse(classEndAt) : NaN;
  const defaultEnd = Date.now() + 7 * 86_400_000;
  return formatLocalDateTime(new Date(Number.isFinite(classEnd) ? Math.min(defaultEnd, classEnd) : defaultEnd));
}

// Kiểm tra tệp đính kèm theo chính sách upload mà máy chủ công bố.
function isAllowedEssayFile(file: File, policy: UploadPolicy): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return file.size > 0 && file.size <= policy.maxFileSizeMb * 1_000_000 && essayFileFormats.some((format) =>
    format.mime === file.type && policy.allowedMimeTypes.includes(format.mime) && format.extensions.some((candidate) => candidate === extension));
}

// Chia đều tổng điểm (mặc định 10 điểm) cho danh sách câu hỏi với độ chính xác 2 chữ số thập phân.
export function distributeEqualQuestionScores(count: number, targetTotal = 10): number[] {
  if (count <= 0) return [];
  const totalCents = Math.round(targetTotal * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;
  return Array.from({ length: count }, (_, idx) => (baseCents + (idx < remainder ? 1 : 0)) / 100);
}

// Áp dụng lại điểm chia đều cho toàn bộ mảng câu hỏi trắc nghiệm.
function rebalanceChoiceQuestionScores(items: ParsedQuestionItem[], targetTotal = 10): ParsedQuestionItem[] {
  const scores = distributeEqualQuestionScores(items.length, targetTotal);
  return items.map((item, idx) => ({
    ...item,
    order: idx + 1,
    score: scores[idx] ?? 1,
  }));
}

// Khởi tạo câu trắc nghiệm đơn đáp án không gán sẵn đáp án đúng.
function newChoiceQuestion(order: number, score = 10): ParsedQuestionItem {
  return {
    id: crypto.randomUUID(),
    order,
    content: "",
    options: ["A", "B", "C", "D"].map((key) => ({ key, text: "" })),
    correctAnswer: "",
    type: "Trắc nghiệm một đáp án",
    score,
  };
}

// Chuẩn hóa chuỗi phương án và đáp án do OCR, Word hoặc AI trả về để so khớp chính xác.
function normalizeAnswer(value: string): string {
  return value
    .trim()
    .replace(/<\/?strong>/giu, "")
    .replace(/\*\*/g, "")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/^(?:đáp\s*án(?:\s+đúng)?|answer)(?:\s+là)?\s*[:.]?\s*/iu, "")
    .trim();
}

// Loại bỏ nhãn đầu dòng A., B), C: dư thừa trên nội dung phương án nếu có.
function stripLeadingOptionKey(value: string, expectedKey: string): string {
  const cleaned = normalizeAnswer(value);
  const match = cleaned.match(/^([A-F])[.:)]\s+(.+)$/iu);
  if (match && match[1]!.toUpperCase() === expectedKey.toUpperCase()) {
    return match[2]!.trim();
  }
  return cleaned;
}

// Đọc từng câu tự luận từ TXT theo tiêu đề câu, giữ nguyên nội dung cho giáo viên sửa.
function parseTextEssayQuestions(text: string): string[] {
  const result: string[] = [];
  let current = "";
  for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const heading = line.match(/^(?:Câu\s*\d+|\d+|Bài\s*\d+)\s*[.:)]\s*(.*)$/iu);
    if (heading) {
      if (current.trim()) result.push(current.trim());
      current = heading[1] ?? "";
    } else {
      current += `${current ? " " : ""}${line}`;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// Chuyển kết quả quét thành dữ liệu có thể chỉnh sửa và cảnh báo các phần AI chưa chắc chắn.
function normalizeScannedQuestions(scanned: ScannedQuestion[], type: AssignmentType): { questions: ParsedQuestionItem[]; essayQuestions: string[]; warnings: string[] } {
  const warnings: string[] = [];
  if (type === "ESSAY") {
    const essayQuestions = scanned.filter((item) => item.type === "ESSAY" || item.type === "SHORT_ANSWER").map((item, index) => {
      if (item.warnings?.length) warnings.push(`Câu tự luận ${index + 1}: ${item.warnings.join(" ")}`);
      return item.content?.trim() ?? "";
    }).filter(Boolean);
    const skipped = scanned.filter((item) => item.type !== "ESSAY" && item.type !== "SHORT_ANSWER").length;
    if (skipped) warnings.push(`${skipped} câu không phải tự luận đã được bỏ qua.`);
    return { questions: [], essayQuestions, warnings };
  }

  const choiceItems = scanned.filter(
    (item) => item.type === "SINGLE_CHOICE" || (item.options && item.options.length >= 2 && item.type !== "MULTIPLE_CHOICE"),
  );
  const equalScores = distributeEqualQuestionScores(choiceItems.length, 10);
  const questions = choiceItems.map((item, index) => {
    const rawOptions = item.options ?? [];
    const options = (rawOptions.length >= 2 ? rawOptions : ["", "", "", ""]).map((text, position) => {
      const key = String.fromCharCode(65 + position);
      return { key, text: stripLeadingOptionKey(text ?? "", key) };
    });
    const answers = item.correctAnswers ?? [];
    let correctAnswer = "";
    if (answers.length === 1) {
      const normAns = normalizeAnswer(answers[0]!);
      const letterOnly = normAns.match(/^([A-F])(?:[.:)]\s*(.*))?$/iu);
      correctAnswer =
        options.find((option) => option.text.toLocaleLowerCase() === normAns.toLocaleLowerCase())?.key ??
        (letterOnly
          ? options.find((option) => option.key === letterOnly[1]!.toUpperCase())?.key ?? ""
          : "");
    }
    const itemWarnings = [...(item.warnings ?? [])];
    if (!correctAnswer) itemWarnings.push("AI chưa xác định được đáp án đúng. Hãy chọn đáp án trước khi lưu.");
    const question: ParsedQuestionItem = {
      id: crypto.randomUUID(),
      order: index + 1,
      content: item.content ?? "",
      options,
      correctAnswer,
      answerSource: item.answerSource,
      type: "Trắc nghiệm một đáp án",
      score: equalScores[index] ?? 1,
      warnings: itemWarnings.length ? itemWarnings : undefined,
    };
    if (itemWarnings.length) warnings.push(`Câu ${index + 1}: ${itemWarnings.join(" ")}`);
    return question;
  });
  const skipped = scanned.filter((item) => item.type !== "SINGLE_CHOICE").length;
  if (skipped) warnings.push(`${skipped} câu nhiều đáp án, đúng/sai hoặc trả lời ngắn chưa được đưa vào đề này.`);
  return { questions, essayQuestions: [], warnings };
}

// Hiển thị quy trình tạo bài tập với lựa chọn thủ công, AI và bước xác nhận cuối.
export function AssignmentBuilderModal({ open, onClose, onBackToHub, targetClassName, targetClassEndAt, initialType, initialMethod, onSaveAssignment }: AssignmentBuilderModalProps) {
  const { notify } = useApp();
  const { t, locale } = useI18n();
  const openedRef = useRef(false);
  const [step, setStep] = useState<Step>("TYPE");
  const [type, setType] = useState<AssignmentType | null>(null);
  const [method, setMethod] = useState<CreationMethod | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<ParsedQuestionItem[]>([]);
  const [customScoresEdited, setCustomScoresEdited] = useState(false);
  const [targetChoiceScale, setTargetChoiceScale] = useState(10);
  const [essayQuestions, setEssayQuestions] = useState<string[]>([""]);
  const [essayQuestionScores, setEssayQuestionScores] = useState<number[]>([10]);
  const [customEssayScoresEdited, setCustomEssayScoresEdited] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [fileForImport, setFileForImport] = useState<string | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [dueAt, setDueAt] = useState(() => defaultDueAt(targetClassEndAt));
  const [uploadPolicy, setUploadPolicy] = useState<UploadPolicy>(defaultUploadPolicy);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyUnavailable, setPolicyUnavailable] = useState(false);
  const [hasStartAt, setHasStartAt] = useState(false);
  const [startAt, setStartAt] = useState(() => localDateTime(0));
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [shuffleQuestions, setShuffleQuestions] = useState(false);
  const [aiTutorEnabled, setAiTutorEnabled] = useState(false);
  const [essayMcPointsInput, setEssayMcPointsInput] = useState("0");
  const [essayWrittenPointsInput, setEssayWrittenPointsInput] = useState("10");
  const parsedEssayMcPoints = Number((essayMcPointsInput || "0").trim().replace(",", "."));
  const parsedEssayWrittenPoints = Number((essayWrittenPointsInput || "0").trim().replace(",", "."));
  const essayTotalScore = Math.round(((Number.isFinite(parsedEssayMcPoints) ? parsedEssayMcPoints : 0) + (Number.isFinite(parsedEssayWrittenPoints) ? parsedEssayWrittenPoints : 0)) * 100) / 100;
  const totalScore = useMemo(() => Math.round(questions.reduce((sum, question) => sum + (Number(question.score) || 0), 0) * 100) / 100, [questions]);
  const allowedEssayFormats = essayFileFormats.filter((format) => uploadPolicy.allowedMimeTypes.includes(format.mime));
  const essayAccept = allowedEssayFormats.flatMap((format) => format.extensions.map((extension) => `.${extension}`)).join(",");
  const steps: Step[] = ["TYPE", "METHOD", "CONTENT", "SETTINGS", "REVIEW"];
  const stepIndex = steps.indexOf(step);

  // Xóa dữ liệu cũ khi mở lại modal để không trộn hai lần tạo bài.
  const resetForm = useCallback(() => {
    const startDirectContent = Boolean(initialType && initialMethod);
    setStep(startDirectContent ? "CONTENT" : initialType ? "METHOD" : "TYPE");
    setType(initialType ?? null);
    setMethod(initialMethod ?? null);
    setTitle("");
    setDescription("");
    setCustomScoresEdited(false);
    setTargetChoiceScale(10);
    setQuestions(startDirectContent && initialType === "MULTIPLE_CHOICE" && initialMethod === "MANUAL" ? [newChoiceQuestion(1, 10)] : []);
    setEssayQuestions([""]);
    setEssayQuestionScores([10]);
    setCustomEssayScoresEdited(false);
    setAttachedFile(null); setFileForImport(null); setScanWarnings([]); setScanning(false); setSaving(false); setReviewConfirmed(false);
    setDueAt(defaultDueAt(targetClassEndAt)); setHasStartAt(false); setStartAt(localDateTime(0)); setDurationMinutes(45); setMaxAttempts(1); setShuffleQuestions(false); setAiTutorEnabled(false);
    setEssayMcPointsInput("0"); setEssayWrittenPointsInput("10");
  }, [initialMethod, initialType, targetClassEndAt]);

  // Nạp chính sách tệp của máy chủ mỗi lần mở trình tạo.
  useEffect(() => {
    if (!open) { openedRef.current = false; return; }
    if (!openedRef.current) { openedRef.current = true; resetForm(); }
    let active = true;
    setPolicyLoading(true); setPolicyUnavailable(false);
    void apiRequest<UploadPolicy>("/instructor/material-upload-policy", { roleCode: "INSTRUCTOR" })
      .then((policy) => {
        if (!active) return;
        if (Number.isFinite(policy?.maxFileSizeMb) && policy.maxFileSizeMb > 0 && Array.isArray(policy.allowedMimeTypes)) {
          setUploadPolicy(policy); setAttachedFile((current) => current && !isAllowedEssayFile(current, policy) ? null : current);
        } else setPolicyUnavailable(true);
      })
      .catch(() => { if (active) setPolicyUnavailable(true); })
      .finally(() => { if (active) setPolicyLoading(false); });
    return () => { active = false; };
  }, [open, resetForm]);

  // Chọn loại bài và xóa dữ liệu của loại trước để bước sau luôn nhất quán.
  const selectType = (nextType: AssignmentType) => {
    setType(nextType); setMethod(null); setCustomScoresEdited(false); setTargetChoiceScale(10); setQuestions([]); setEssayQuestions([""]); setEssayQuestionScores([10]); setCustomEssayScoresEdited(false); setAttachedFile(null); setFileForImport(null); setScanWarnings([]); setReviewConfirmed(false);
  };

  // Kiểm tra nội dung câu hỏi theo loại bài trước khi chuyển bước.
  const validateContent = (): boolean => {
    if (type === "ESSAY") {
      const filled = essayQuestions.filter((question) => question.trim());
      if (!filled.length && !attachedFile) { notify("Nhập ít nhất một câu tự luận hoặc chọn một tệp đề.", "error"); return false; }
      if (filled.some((question) => question.trim().length < 5)) { notify("Mỗi câu tự luận cần ít nhất 5 ký tự.", "error"); return false; }
      for (let idx = 0; idx < essayQuestions.length; idx += 1) {
        if (!essayQuestions[idx]?.trim()) continue;
        const sc = essayQuestionScores[idx] ?? 0;
        if (!Number.isFinite(sc) || sc < 0.01 || Math.abs(Math.round(sc * 100) - sc * 100) > 1e-6) {
          notify(`Câu tự luận ${idx + 1}: điểm câu hỏi phải từ 0,01 và tối đa 2 chữ số thập phân.`, "error");
          return false;
        }
      }
      return true;
    }
    if (type !== "MULTIPLE_CHOICE" || questions.length === 0) { notify("Đề trắc nghiệm cần ít nhất một câu hỏi.", "error"); return false; }
    for (const [index, question] of questions.entries()) {
      const options = question.options.filter((option) => option.text.trim());
      const values = options.map((option) => option.text.trim().toLocaleLowerCase());
      if (question.content.trim().length < 5 || options.length < 2 || new Set(values).size !== values.length || !options.some((option) => option.key === question.correctAnswer) || !Number.isFinite(question.score) || question.score < 0.01 || Math.abs(Math.round(question.score * 100) - question.score * 100) > 0.000001) { notify(`Câu ${index + 1}: kiểm tra nội dung, phương án, đáp án đúng và điểm số.`, "error"); return false; }
    }
    if (totalScore < 0.25) { notify("Tổng điểm trắc nghiệm phải đạt ít nhất 0,25 điểm.", "error"); return false; }
    return true;
  };

  // Kiểm tra thông tin chung và thời hạn trước khi hiển thị bản xác nhận.
  const validateSettings = (): boolean => {
    if (title.trim().length < 3 || title.trim().length > 255) { notify("Tên bài tập cần từ 3 đến 255 ký tự.", "error"); return false; }
    const deadline = new Date(dueAt).getTime(); const opening = hasStartAt ? new Date(startAt).getTime() : Date.now(); const classEnd = targetClassEndAt ? Date.parse(targetClassEndAt) : NaN;
    if (!Number.isFinite(deadline) || deadline <= Date.now() || !Number.isFinite(opening) || opening >= deadline || (Number.isFinite(classEnd) && deadline > classEnd)) { notify("Hạn nộp phải ở tương lai, sau thời điểm bắt đầu và không vượt ngày kết thúc lớp.", "error"); return false; }
    if (type === "MULTIPLE_CHOICE" && (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)) { notify("Thời lượng cần từ 1–600 phút; số lượt làm bài từ 1–10.", "error"); return false; }
    if (type === "ESSAY") {
      if (!Number.isFinite(parsedEssayMcPoints) || !Number.isFinite(parsedEssayWrittenPoints) || parsedEssayMcPoints < 0 || parsedEssayWrittenPoints < 0 || Math.abs(Math.round(parsedEssayMcPoints * 100) - parsedEssayMcPoints * 100) > 1e-6 || Math.abs(Math.round(parsedEssayWrittenPoints * 100) - parsedEssayWrittenPoints * 100) > 1e-6) { notify("Điểm các phần phải không âm và có tối đa 2 chữ số thập phân.", "error"); return false; }
      if ((parsedEssayMcPoints > 0 && parsedEssayMcPoints < 0.25) || (parsedEssayWrittenPoints > 0 && parsedEssayWrittenPoints < 0.25)) { notify("Mỗi phần có tính điểm cần đạt từ 0,25 điểm trở lên (hoặc để 0 nếu không có).", "error"); return false; }
      if (essayTotalScore < 0.25 || essayTotalScore > 1000) { notify("Điểm tối đa phải nằm trong khoảng 0,25–1000.", "error"); return false; }
    }
    return true;
  };

  // Quét tệp bằng AI, giữ lại câu hỏi thật và cảnh báo để giáo viên duyệt trước khi lưu.
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !type) return;
    if (file.size === 0 || file.size > 12 * 1024 * 1024) { notify("Tệp quét phải có dung lượng từ 1 byte đến 12 MB.", "error"); return; }
    setScanning(true); setScanWarnings([]);
    try {
      let result: { questions: ParsedQuestionItem[]; essayQuestions: string[]; warnings: string[] };
      if (type === "ESSAY" && /\.txt$/iu.test(file.name)) result = { questions: [], essayQuestions: parseTextEssayQuestions(await file.text()), warnings: [] };
      else { const form = new FormData(); form.append("file", file); const response = await apiRequest<{ questions: ScannedQuestion[]; warnings?: string[] }>("/instructor/question-bank/scan-image", { method: "POST", body: form }); const normalized = normalizeScannedQuestions(response.questions ?? [], type); result = { ...normalized, warnings: [...(response.warnings ?? []), ...normalized.warnings] }; }
      if (type === "MULTIPLE_CHOICE") {
        if (!result.questions.length) throw new Error("AI chưa nhận diện được câu trắc nghiệm một đáp án. Hãy chọn tệp rõ hơn hoặc chuyển sang nhập thủ công.");
        setCustomScoresEdited(false);
        setQuestions(rebalanceChoiceQuestionScores(result.questions, targetChoiceScale));
      } else {
        if (!result.essayQuestions.length) throw new Error("AI chưa nhận diện được câu tự luận. Hãy chọn tệp rõ hơn hoặc nhập thủ công.");
        const targetEssayPoints = Number.isFinite(parsedEssayWrittenPoints) && parsedEssayWrittenPoints >= 0.25 ? parsedEssayWrittenPoints : 10;
        setCustomEssayScoresEdited(false);
        setEssayQuestions(result.essayQuestions);
        setEssayQuestionScores(distributeEqualQuestionScores(result.essayQuestions.length, targetEssayPoints));
        if (!policyLoading && isAllowedEssayFile(file, uploadPolicy)) setAttachedFile(file);
      }
      setFileForImport(file.name); setScanWarnings(result.warnings); setTitle((current) => current || file.name.replace(/\.[^.]+$/u, ""));
      notify(`Đã đọc ${type === "MULTIPLE_CHOICE" ? result.questions.length : result.essayQuestions.length} câu từ ${file.name}. Hãy kiểm tra trước khi lưu.`, "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể đọc tệp bằng AI.", "error"); }
    finally { setScanning(false); }
  };

  // Lưu tệp đề tự luận để học viên có thể xem hoặc tải về khi làm bài.
  const handleEssayFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (policyLoading) { notify("Đang kiểm tra chính sách tải tệp. Vui lòng thử lại sau.", "info"); return; }
    if (!isAllowedEssayFile(file, uploadPolicy)) { notify(`Chọn tệp PDF, Word hoặc ảnh hợp lệ, tối đa ${uploadPolicy.maxFileSizeMb} MB.`, "error"); return; }
    setAttachedFile(file); setTitle((current) => current || file.name.replace(/\.[^.]+$/u, ""));
  };

  // Cập nhật nội dung, phương án hoặc điểm của một câu trắc nghiệm.
  const updateQuestion = (id: string, update: Partial<ParsedQuestionItem>) => setQuestions((current) => current.map((question) => question.id === id ? { ...question, ...update } : question));

  // Chuyển sang bước tiếp theo sau khi kiểm tra điều kiện của bước hiện tại.
  const goNext = () => {
    if (step === "TYPE" && type) setStep("METHOD");
    else if (step === "METHOD" && method) setStep("CONTENT");
    else if (step === "CONTENT" && validateContent()) setStep("SETTINGS");
    else if (step === "SETTINGS" && validateSettings()) { setReviewConfirmed(false); setStep("REVIEW"); }
  };

  // Lưu và phát hành bài sau khi giáo viên đã xác nhận toàn bộ thông tin hiển thị.
  const handleSave = async () => {
    if (saving || scanning || !type || !reviewConfirmed || !validateContent() || !validateSettings()) return;
    if (type === "ESSAY" && attachedFile && (policyLoading || !isAllowedEssayFile(attachedFile, uploadPolicy))) { notify("Tệp đề không còn đáp ứng chính sách lưu trữ. Hãy chọn tệp khác.", "error"); return; }
    setSaving(true);
    try {
      const nonEmptyEssayEntries = essayQuestions
        .map((question, idx) => ({ text: question.trim(), score: essayQuestionScores[idx] ?? 1 }))
        .filter((entry) => Boolean(entry.text));
      await onSaveAssignment({ hidden: type === "ESSAY" && hidden, title: title.trim(), description: description.trim(), type, questions: type === "MULTIPLE_CHOICE" ? questions : [], essayQuestions: type === "ESSAY" ? nonEmptyEssayEntries.map((entry) => entry.text) : [], ...(type === "ESSAY" && nonEmptyEssayEntries.length > 0 ? { essayQuestionScores: nonEmptyEssayEntries.map((entry) => Math.round(entry.score * 100) / 100) } : {}), attachedFile: type === "ESSAY" ? attachedFile ?? undefined : undefined, ...(type === "ESSAY" ? { scoreBreakdown: { multipleChoicePoints: Math.round(parsedEssayMcPoints * 100) / 100, essayPoints: Math.round(parsedEssayWrittenPoints * 100) / 100 } } : {}), settings: { durationMinutes, hasDuration: type === "MULTIPLE_CHOICE", startAt, hasStartAt, dueAt, hasDueAt: true, maxAttempts, shuffleQuestions: type === "MULTIPLE_CHOICE" && shuffleQuestions, aiTutorEnabled: type === "MULTIPLE_CHOICE" && aiTutorEnabled } });
      onClose();
    } catch (error) { notify(error instanceof Error ? error.message : "Không thể lưu bài tập.", "error"); }
    finally { setSaving(false); }
  };

  // Chọn màn hình quay lại dựa trên bước hiện tại hoặc quay về Hub chọn cách tạo khác.
  const goBack = () => {
    if (step === "CONTENT" && initialMethod && onBackToHub) {
      onBackToHub();
      return;
    }
    const previous: Record<Exclude<Step, "TYPE">, Step> = { METHOD: "TYPE", CONTENT: "METHOD", SETTINGS: "CONTENT", REVIEW: "SETTINGS" };
    setStep(previous[step as Exclude<Step, "TYPE">]);
  };

  if (!open) return null;
  const typeLabel = type === "ESSAY" ? "Tự luận" : "Trắc nghiệm";
  const methodLabel = method === "AI" ? "Tạo bằng AI" : "Thủ công";
  const questionEditor = type === "MULTIPLE_CHOICE" ? <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-950/30"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Câu hỏi trắc nghiệm một đáp án</h3><p className="text-xs text-slate-600 dark:text-slate-400">{t(`${questions.length} câu · Tổng ${totalScore.toLocaleString(locale)} điểm`)}</p></div><div className="flex flex-wrap items-center gap-2">{questions.length > 0 && <><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Thang chia đều:</span><ScoreStepperInput ariaLabel="Thang điểm chia đều trắc nghiệm" stepTargetLabel="thang điểm trắc nghiệm" min={0.25} max={1000} value={targetChoiceScale} onChange={(val) => { const safe = val >= 0.25 ? val : 0.25; setTargetChoiceScale(safe); if (!customScoresEdited) setQuestions((current) => rebalanceChoiceQuestionScores(current, safe)); }} /><button type="button" onClick={() => { setCustomScoresEdited(false); setQuestions((current) => rebalanceChoiceQuestionScores(current, targetChoiceScale)); }} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300">Chia đều điểm</button></>}{method === "MANUAL" && <CircleHelp size={20} className="text-blue-600" />}</div></div>{questions.map((question, index) => <div key={question.id} className="rounded-2xl border border-slate-200 p-4 sm:p-5 dark:border-slate-700"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-bold text-slate-900 dark:text-white">Câu {index + 1}</h3><button type="button" aria-label={`Xóa câu trắc nghiệm ${index + 1}`} onClick={() => setQuestions((current) => { const filtered = current.filter((entry) => entry.id !== question.id).map((entry, position) => ({ ...entry, order: position + 1 })); return customScoresEdited ? filtered : rebalanceChoiceQuestionScores(filtered, targetChoiceScale); })} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"><Trash2 size={17} /></button></div>{question.answerSource && <p className="mb-2 text-xs text-slate-600">{question.answerSource}</p>}{question.warnings?.length ? <div className="mb-3 space-y-1 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{question.warnings.map((warning, warningIndex) => <p key={`${warning}-${warningIndex}`} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{warning}</p>)}</div> : null}<textarea aria-label={`Nội dung câu ${index + 1}`} value={question.content} maxLength={3000} rows={2} onChange={(event) => updateQuestion(question.id, { content: event.target.value })} placeholder="Nhập nội dung câu hỏi…" className={`${fieldClass} resize-y`} /><div className="mt-4 grid gap-3 sm:grid-cols-2">{question.options.map((option) => <label key={option.key} className="flex min-w-0 items-center gap-2"><input aria-label={`Đáp án đúng ${option.key} câu ${index + 1}`} type="radio" name={`answer-${question.id}`} checked={question.correctAnswer === option.key} onChange={() => updateQuestion(question.id, { correctAnswer: option.key, answerSource: "Giảng viên đã chọn đáp án", warnings: question.warnings?.filter((warning) => !/đáp án|phương án/iu.test(warning)) })} className="h-4 w-4 accent-blue-600" /><span className="w-4 shrink-0 text-xs font-bold text-slate-500">{option.key}</span><input aria-label={`Phương án ${option.key} câu ${index + 1}`} value={option.text} onChange={(event) => updateQuestion(question.id, { options: question.options.map((entry) => entry.key === option.key ? { ...entry, text: event.target.value } : entry) })} placeholder="Nội dung phương án" className={fieldClass} /></label>)}</div><div className="mt-4 flex flex-wrap items-center gap-3"><label htmlFor={`score-${question.id}`} className="text-xs font-semibold text-slate-600 dark:text-slate-300">Điểm câu hỏi</label><ScoreStepperInput id={`score-${question.id}`} stepTargetLabel={`câu ${index + 1}`} min={0.25} max={1000} value={question.score} onChange={(val) => { setCustomScoresEdited(true); updateQuestion(question.id, { score: val }); }} /></div></div>)}<button type="button" onClick={() => setQuestions((current) => { const appended = [...current, newChoiceQuestion(current.length + 1, 2)]; return customScoresEdited ? appended : rebalanceChoiceQuestionScores(appended, targetChoiceScale); })} className={secondaryButton}><Plus size={17} /> Thêm câu hỏi</button></div> : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="assignment-builder-heading" className="my-auto flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800 sm:px-7"><div className="min-w-0"><p className="mb-1 text-xs font-semibold text-blue-600 dark:text-blue-400">{targetClassName || t("Lớp học")} · {t(`Bước ${stepIndex + 1}/5`)}</p><h2 id="assignment-builder-heading" className="text-lg font-bold text-slate-900 dark:text-white sm:text-xl">{step === "TYPE" ? "Bạn muốn tạo bài tập dạng nào?" : step === "METHOD" ? `Cách tạo bài ${typeLabel.toLocaleLowerCase()}` : step === "CONTENT" ? `Nội dung bài ${typeLabel.toLocaleLowerCase()}` : step === "SETTINGS" ? "Thông tin và thời hạn" : "Xác nhận trước khi lưu"}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{step === "TYPE" ? "Chọn loại trước để hiển thị đúng công cụ tạo bài." : step === "METHOD" ? "Mỗi loại đều có thể soạn thủ công hoặc nhờ AI đọc tệp." : step === "CONTENT" ? "AI chỉ đề xuất; giáo viên vẫn duyệt và sửa toàn bộ nội dung trước khi lưu." : step === "SETTINGS" ? "Điền các thông tin học viên sẽ nhìn thấy." : "Rà soát lại nội dung, thời hạn và cách tạo rồi xác nhận."}</p></div><div className="flex shrink-0 items-center gap-2">{initialMethod && onBackToHub && <button type="button" disabled={saving || scanning} onClick={onBackToHub} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><ArrowLeft size={14} /><span>Chọn cách tạo khác</span></button>}<button type="button" aria-label="Đóng trình tạo bài tập" disabled={saving} onClick={onClose} className="shrink-0 rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><X size={20} /></button></div></header>
        <div className="flex gap-1.5 px-5 pt-4 sm:px-7" aria-label="Tiến trình tạo bài tập">{steps.map((name, index) => <div key={name} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-700"}`} />)}</div>
        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7">
          {step === "TYPE" && <div className="grid gap-4 sm:grid-cols-2">{[{ value: "MULTIPLE_CHOICE" as const, heading: "Trắc nghiệm", text: "Nhiều phương án, chọn đáp án đúng, chấm tự động và có thể đảo thứ tự câu.", icon: <FileCheck2 size={26} /> }, { value: "ESSAY" as const, heading: "Tự luận", text: "Một hoặc nhiều câu hỏi, học viên nhập bài hoặc nộp tệp để giáo viên chấm.", icon: <FileText size={26} /> }].map((choice) => <button key={choice.value} type="button" aria-pressed={type === choice.value} onClick={() => selectType(choice.value)} className={`rounded-2xl border-2 p-6 text-left transition hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 ${type === choice.value ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/30" : "border-slate-200 dark:border-slate-700"}`}><span className={`mb-5 inline-flex rounded-xl p-3 ${type === choice.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{choice.icon}</span><span className="mb-2 flex items-center justify-between text-base font-bold text-slate-900 dark:text-white">{choice.heading}{type === choice.value && <Check size={20} className="text-blue-600" />}</span><span className="block text-sm leading-6 text-slate-600 dark:text-slate-400">{choice.text}</span></button>)}</div>}
          {step === "METHOD" && type && <div className="grid gap-4 sm:grid-cols-2">{[{ value: "MANUAL" as const, heading: "Tạo thủ công", text: type === "ESSAY" ? "Tự nhập từng câu hỏi và tệp đề tùy chọn." : "Tự nhập câu hỏi, phương án và chọn đáp án đúng.", icon: <FileText size={25} /> }, { value: "AI" as const, heading: "Tạo bằng AI", text: type === "ESSAY" ? "Tải tệp đề để AI nhận diện câu tự luận, sau đó kiểm tra lại." : "Tải tệp đề để AI tách câu, phương án và đáp án nếu có trong tệp.", icon: <Sparkles size={25} /> }].map((choice) => <button key={choice.value} type="button" aria-pressed={method === choice.value} onClick={() => setMethod(choice.value)} className={`rounded-2xl border-2 p-6 text-left transition hover:border-blue-400 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 ${method === choice.value ? "border-blue-600 bg-blue-50/60 dark:bg-blue-950/30" : "border-slate-200 dark:border-slate-700"}`}><span className={`mb-5 inline-flex rounded-xl p-3 ${method === choice.value ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{choice.icon}</span><span className="mb-2 flex items-center justify-between text-base font-bold text-slate-900 dark:text-white">{choice.heading}{method === choice.value && <Check size={20} className="text-blue-600" />}</span><span className="block text-sm leading-6 text-slate-600 dark:text-slate-400">{choice.text}</span></button>)}</div>}
          {step === "CONTENT" && type && method && <div className="space-y-5">{method === "AI" && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/25"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><ScanLine className="mt-0.5 shrink-0 text-blue-600" size={22} /><div><h3 className="font-bold text-slate-900 dark:text-white">AI đọc tệp đề</h3><p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">Chọn PDF, Word, ảnh hoặc TXT. AI không tự bịa đáp án; câu chưa chắc chắn sẽ được đánh dấu để giáo viên chọn lại.</p></div></div><label className={`${primaryButton} cursor-pointer`}><UploadCloud size={16} />{scanning ? "Đang đọc…" : "Chọn tệp để AI đọc"}<input type="file" accept=".txt,.pdf,.png,.jpg,.jpeg,.webp,.docx" className="sr-only" disabled={scanning} onChange={(event) => void handleImport(event)} /></label></div>{fileForImport && <p className="mt-3 text-xs font-semibold text-blue-700 dark:text-blue-300">Đã đọc: {fileForImport}</p>}{scanWarnings.length > 0 && <div className="mt-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{scanWarnings.map((warning, index) => <p key={`${warning}-${index}`} className="flex gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{warning}</p>)}</div>}</div>}{type === "ESSAY" ? <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-950/30"><div><h3 className="text-sm font-bold text-slate-900 dark:text-white">Câu hỏi tự luận</h3><p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{essayQuestions.length} câu · Tổng {essayTotalScore} điểm</p></div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Thang chia đều:</span><ScoreStepperInput ariaLabel="Thang điểm chia đều tự luận" stepTargetLabel="thang điểm tự luận" min={0.25} max={1000} value={Number.isFinite(parsedEssayWrittenPoints) && parsedEssayWrittenPoints >= 0.25 ? parsedEssayWrittenPoints : 10} onChange={(val) => { const safe = val >= 0.25 ? val : 0.25; setEssayWrittenPointsInput(String(safe)); setCustomEssayScoresEdited(false); setEssayQuestionScores(distributeEqualQuestionScores(essayQuestions.length, safe)); }} /><button type="button" onClick={() => { const safe = Number.isFinite(parsedEssayWrittenPoints) && parsedEssayWrittenPoints >= 0.25 ? parsedEssayWrittenPoints : 10; setCustomEssayScoresEdited(false); setEssayQuestionScores(distributeEqualQuestionScores(essayQuestions.length, safe)); }} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:border-blue-800 dark:bg-slate-900 dark:text-blue-300">Chia đều điểm</button></div></div>{essayQuestions.map((question, index) => <div key={index} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><label htmlFor={`essay-question-${index}`} className="text-sm font-semibold text-slate-800 dark:text-slate-200">Câu {index + 1}</label><div className="flex items-center gap-2.5"><label htmlFor={`essay-score-${index}`} className="text-xs font-semibold text-slate-600 dark:text-slate-300">Điểm câu hỏi</label><ScoreStepperInput id={`essay-score-${index}`} stepTargetLabel={`câu tự luận ${index + 1}`} min={0.25} max={1000} value={essayQuestionScores[index] ?? 1} onChange={(val) => { setCustomEssayScoresEdited(true); setEssayQuestionScores((current) => { const next = Array.from({ length: essayQuestions.length }, (_, idx) => (idx === index ? val : (current[idx] ?? 1))); const sum = Math.round(next.reduce((acc, item) => acc + (Number(item) || 0), 0) * 100) / 100; if (sum >= 0.25) setEssayWrittenPointsInput(String(sum)); return next; }); }} /><button type="button" aria-label={`Xóa câu ${index + 1}`} disabled={essayQuestions.length === 1} onClick={() => { const nextQuestions = essayQuestions.filter((_, position) => position !== index); setEssayQuestions(nextQuestions); setEssayQuestionScores((current) => { const filteredScores = current.filter((_, position) => position !== index); if (!customEssayScoresEdited) { const target = Number.isFinite(parsedEssayWrittenPoints) && parsedEssayWrittenPoints >= 0.25 ? parsedEssayWrittenPoints : 10; return distributeEqualQuestionScores(nextQuestions.length, target); } const sum = Math.round(filteredScores.reduce((acc, item) => acc + (Number(item) || 0), 0) * 100) / 100; if (sum >= 0.25) setEssayWrittenPointsInput(String(sum)); return filteredScores; }); }} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-950/30"><Trash2 size={16} /></button></div></div><textarea id={`essay-question-${index}`} value={question} maxLength={2000} onChange={(event) => setEssayQuestions((current) => current.map((value, position) => position === index ? event.target.value : value))} rows={4} placeholder="Nhập yêu cầu của câu hỏi tự luận…" className={`${fieldClass} resize-y`} /></div>)}<button type="button" onClick={() => { const nextQuestions = [...essayQuestions, ""]; setEssayQuestions(nextQuestions); setEssayQuestionScores((current) => { if (!customEssayScoresEdited) { const target = Number.isFinite(parsedEssayWrittenPoints) && parsedEssayWrittenPoints >= 0.25 ? parsedEssayWrittenPoints : 10; return distributeEqualQuestionScores(nextQuestions.length, target); } const next = [...current, 1]; const sum = Math.round(next.reduce((acc, item) => acc + (Number(item) || 0), 0) * 100) / 100; if (sum >= 0.25) setEssayWrittenPointsInput(String(sum)); return next; }); }} disabled={essayQuestions.length >= 20} className={secondaryButton}><Plus size={16} /> Thêm câu tự luận</button></div><aside className="self-start rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/40"><UploadCloud size={25} className="mb-3 text-blue-600" /><h3 className="text-sm font-bold text-slate-900 dark:text-white">Tệp đề đính kèm</h3><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Tùy chọn với cách tạo thủ công. Với AI, tệp đã quét sẽ được giữ lại nếu đúng chính sách lưu trữ.</p><div className="mt-4 flex flex-wrap items-center gap-2"><label className={`inline-flex items-center gap-1.5 rounded-lg bg-blue-100 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-200 dark:bg-blue-950/60 dark:text-blue-200 ${policyLoading || !allowedEssayFormats.length || method === "AI" ? "pointer-events-none opacity-50" : "cursor-pointer"}`}><span>Chọn tệp</span><input aria-label="Chọn tệp đề tự luận" type="file" accept={essayAccept} disabled={policyLoading || !allowedEssayFormats.length || method === "AI"} onChange={handleEssayFile} className="sr-only" /></label>{!attachedFile && <span className="text-xs text-slate-500 dark:text-slate-400">Chưa có tệp nào được chọn</span>}</div>{policyUnavailable && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Chưa đọc được chính sách máy chủ; máy chủ sẽ kiểm tra lại khi lưu.</p>}{attachedFile && <div className="mt-4 flex items-start gap-2 rounded-xl bg-white p-3 dark:bg-slate-900"><FileText size={17} className="shrink-0 text-blue-600" /><div className="min-w-0 flex-1"><p className="break-all text-xs font-semibold text-slate-800 dark:text-white">{attachedFile.name}</p><p className="text-xs text-slate-500">{(attachedFile.size / 1048576).toFixed(1)} MB</p></div><button type="button" aria-label="Bỏ tệp đề" onClick={() => setAttachedFile(null)} className="text-rose-600"><X size={16} /></button></div>}</aside></div> : questionEditor}</div>}
          {step === "SETTINGS" && type && <div className="mx-auto max-w-2xl space-y-6"><div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><label htmlFor="assignment-title" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">Tên bài tập <span className="text-rose-600">*</span></label><input id="assignment-title" maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Ôn tập chương 2" className={fieldClass} /></div><div className="sm:col-span-2"><label htmlFor="assignment-description" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">Mô tả (tùy chọn)</label><textarea id="assignment-description" maxLength={4000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Giới thiệu ngắn về bài tập cho học viên" className={`${fieldClass} resize-y`} /></div><div className="sm:col-span-2"><label htmlFor="assignment-deadline" className="mb-1.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">Hạn nộp <span className="text-rose-600">*</span></label><input id="assignment-deadline" type="datetime-local" value={dueAt} min={localDateTime(0)} max={targetClassEndAt && Number.isFinite(Date.parse(targetClassEndAt)) ? formatLocalDateTime(new Date(targetClassEndAt)) : undefined} onChange={(event) => setDueAt(event.target.value)} className={fieldClass} /></div></div>{type === "ESSAY" && <div className="space-y-4 rounded-2xl border border-slate-200 p-5 dark:border-slate-700"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-slate-900 dark:text-white">Thang điểm bài tự luận</h3><span className="text-xs font-bold text-blue-600 dark:text-blue-400">Tổng điểm: {essayTotalScore} điểm</span></div><div className="flex flex-wrap items-center justify-between gap-3"><label htmlFor="essay-written-points" className="text-sm font-semibold text-slate-700 dark:text-slate-300">Điểm tối đa bài tự luận</label><ScoreStepperInput id="essay-written-points" size="md" stepTargetLabel="điểm tối đa tự luận" min={0.25} max={1000} value={essayWrittenPointsInput} onChange={(val, raw) => { setEssayWrittenPointsInput(raw); if (val >= 0.25) { setCustomEssayScoresEdited(false); setEssayQuestionScores(distributeEqualQuestionScores(essayQuestions.length, val)); } }} /></div></div>}{type === "MULTIPLE_CHOICE" && <div className="space-y-4 rounded-2xl border border-slate-200 p-5 dark:border-slate-700"><h3 className="font-semibold text-slate-900 dark:text-white">Thiết lập trắc nghiệm</h3><div className="grid gap-4 sm:grid-cols-2"><div><label htmlFor="exam-duration" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Thời gian làm bài (phút)</label><input id="exam-duration" type="number" min={1} max={600} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className={fieldClass} /></div><div><label htmlFor="exam-attempts" className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Số lượt làm bài</label><input id="exam-attempts" type="number" min={1} max={10} value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} className={fieldClass} /></div></div><label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={hasStartAt} onChange={(event) => setHasStartAt(event.target.checked)} className="h-4 w-4 accent-blue-600" /> Hẹn giờ mở đề</label>{hasStartAt && <input aria-label="Thời điểm mở đề" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} className={fieldClass} />}<label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300"><input type="checkbox" checked={shuffleQuestions} onChange={(event) => setShuffleQuestions(event.target.checked)} className="h-4 w-4 accent-blue-600" /><Shuffle size={17} className="text-blue-600" /><span>Đảo thứ tự câu hỏi khi học viên làm bài</span></label><label className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-sm text-slate-800 dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-slate-200 cursor-pointer"><input type="checkbox" checked={aiTutorEnabled} onChange={(event) => setAiTutorEnabled(event.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" /><Sparkles size={17} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" /><span><span className="block font-semibold">Cho phép hỏi đáp AI dẫn dắt theo từng câu</span><span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">Học viên được hỏi gợi ý cách làm theo hạn mức hệ thống; AI chỉ dẫn dắt tư duy, không tiết lộ đáp án.</span></span></label></div>}</div>}
          {step === "REVIEW" && type && method && <div className="mx-auto max-w-2xl space-y-4">{type === "ESSAY" && <label className="flex items-center gap-2"><input type="checkbox" checked={hidden} onChange={event => setHidden(event.target.checked)} />Ẩn bài tập với học sinh</label>}<div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/40"><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-slate-500">Loại bài</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{typeLabel}</dd></div><div><dt className="text-xs text-slate-500">Cách tạo</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{methodLabel}</dd></div><div><dt className="text-xs text-slate-500">Tên bài</dt><dd className="mt-1 break-words font-semibold text-slate-900 dark:text-white">{title}</dd></div><div><dt className="text-xs text-slate-500">Hạn nộp</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{new Date(dueAt).toLocaleString(locale)}</dd></div>{type === "MULTIPLE_CHOICE" && <div><dt className="text-xs text-slate-500">Hỏi đáp AI dẫn dắt</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{aiTutorEnabled ? "Đang bật" : "Đang tắt"}</dd></div>}<div className="sm:col-span-2"><dt className="text-xs text-slate-500">Nội dung</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{t(type === "ESSAY" ? `${essayQuestions.filter((question) => question.trim()).length} câu tự luận${attachedFile ? " và 1 tệp đề" : ""}` : `${questions.length} câu trắc nghiệm · ${totalScore.toLocaleString(locale)} điểm`)}</dd></div></dl></div>{scanWarnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-semibold">Còn cảnh báo từ AI</p><p className="mt-1">Các cảnh báo vẫn được giữ để giáo viên kiểm tra trong nội dung bài.</p></div>}<label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" /><span>Tôi đã kiểm tra tên bài, thời hạn, nội dung câu hỏi và đáp án. Bài tập có thể được phát hành ngay.</span></label></div>}
        </main>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900 sm:px-7"><div>{step !== "TYPE" && <button type="button" disabled={saving || scanning} onClick={goBack} className={secondaryButton}><ArrowLeft size={16} /> {step === "CONTENT" && initialMethod && onBackToHub ? "Chọn cách tạo khác" : "Quay lại"}</button>}</div>{step === "REVIEW" ? <button type="button" disabled={saving || scanning || !reviewConfirmed} onClick={() => void handleSave()} className={primaryButton}>{saving ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}{saving ? "Đang lưu…" : "Xác nhận và phát hành"}</button> : <button type="button" disabled={scanning || (step === "TYPE" && !type) || (step === "METHOD" && !method)} onClick={goNext} className={primaryButton}>Tiếp tục <ArrowRight size={16} /></button>}</footer>
      </section>
    </div>
  );
}
