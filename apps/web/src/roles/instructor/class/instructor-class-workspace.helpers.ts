import type { Assignment, GradebookRow, Material, Question } from "@/lib/learning-types";

export interface LectureItem {
  id: string;
  title: string;
  tags?: string[];
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

type LectureLinkPlatform = "YOUTUBE" | "FACEBOOK" | "DRIVE" | "INVALID";

export interface MaterialDisplayItem {
  id: string;
  title: string;
  fileType: string;
  size: string;
  uploadedAt: string;
  folder: string;
  description?: string;
  url?: string;
}

export type ClassQuestion = {
  id: string;
  familyId?: string;
  status: Question["status"];
  content: string;
  type: string;
  difficulty: string;
  source: string;
  options?: string[];
  correctAnswers?: number[];
  solution?: string;
  createdAt: string;
};

// Chuyển câu hỏi từ API sang dạng hiển thị và chỉ giữ đáp án có trong danh sách lựa chọn.
export function toClassQuestion(question: Question & { solution?: string; createdAt?: string }): ClassQuestion {
  return {
    id: question.id,
    familyId: question.familyId || question.id,
    status: question.status,
    content: question.content,
    type: question.type === "SINGLE_CHOICE" ? "Trắc nghiệm một đáp án" : question.type === "MULTIPLE_CHOICE" ? "Nhiều đáp án" : question.type === "TRUE_FALSE" ? "Đúng / Sai" : question.type === "SHORT_ANSWER" ? "Điền khuyết" : question.type === "ESSAY" ? "Tự luận" : "Trắc nghiệm",
    difficulty: question.difficulty === 1 ? "Cơ bản" : question.difficulty === 2 ? "Thông hiểu" : question.difficulty === 3 ? "Vận dụng" : "Vận dụng cao",
    source: question.tags?.join(", ") || "Ngân hàng câu hỏi CSDL",
    options: Array.isArray(question.options) ? question.options : [],
    correctAnswers: Array.isArray(question.correctAnswers) ? question.correctAnswers.map((answer: string) => (Array.isArray(question.options) ? question.options : []).indexOf(answer)).filter((index: number) => index >= 0) : [],
    solution: question.solution || "",
    createdAt: question.createdAt ? new Date(question.createdAt).toLocaleDateString("vi-VN") : "Hôm nay",
  };
}

type ClassResource = {
  title: string;
  folder: string;
  description?: string;
  fileType?: string;
  uploadedAt: string;
};

export { getFolderNames as getClassFolderNames } from "@/features/class-detail/folder-names";

// Lọc, sắp xếp học liệu như giao diện hiện tại; bài giảng giữ nguyên thứ tự khi chọn mới nhất.
export function filterClassResources<T extends ClassResource>(
  items: T[], folder: string, search: string, sort: "alpha" | "newest" | "type", newestByDate: boolean,
): T[] {
  let result = [...items];
  if (folder !== "__ALL__") {
    result = result.filter((item) => item.folder === folder);
  }
  if (search.trim()) {
    const query = search.toLowerCase();
    result = result.filter((item) =>
      item.title.toLowerCase().includes(query) || (item.description && item.description.toLowerCase().includes(query))
    );
  }
  if (sort === "alpha") {
    result.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "type") {
    result.sort((a, b) => (a.fileType || "").localeCompare(b.fileType || ""));
  } else if (newestByDate) {
    result.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }
  return result;
}

// Thống kê loại câu hỏi theo đúng quy ước 'Tự luận' của ngân hàng câu hỏi.
export function getClassQuestionStats(questions: ReadonlyArray<{ type: string }>) {
  return {
    total: questions.length,
    multipleChoice: questions.filter((question) => question.type !== "Tự luận").length,
    essay: questions.filter((question) => question.type === "Tự luận").length,
  };
}

// Dùng cùng quy tắc phân loại câu hỏi cho ngân hàng, chọn đề thủ công, AI và chọn ngẫu nhiên.
export function filterClassQuestions(
  questions: ReadonlyArray<ClassQuestion>,
  scope: "ALL" | "MULTIPLE_CHOICE" | "ESSAY",
  difficulty = "ALL",
  search = "",
): ClassQuestion[] {
  const query = search.toLowerCase().trim();
  return questions.filter((question) => {
    if (scope === "MULTIPLE_CHOICE" && question.type === "Tự luận") return false;
    if (scope === "ESSAY" && question.type !== "Tự luận") return false;
    if (difficulty !== "ALL" && question.difficulty !== difficulty) return false;
    return !query || question.content.toLowerCase().includes(query) || question.source?.toLowerCase().includes(query);
  });
}

// Nhận diện nền tảng liên kết theo cùng quy tắc dùng khi tạo và sửa bài giảng.
export function detectLectureLinkPlatform(value: string): LectureLinkPlatform {
  const trimmed = value.trim();
  if (trimmed.includes("youtube.com") || trimmed.includes("youtu.be")) return "YOUTUBE";
  if (trimmed.includes("facebook.com") || trimmed.includes("fb.watch")) return "FACEBOOK";
  if (trimmed.includes("drive.google.com")) return "DRIVE";
  return "INVALID";
}

// Trích xuất ID YouTube theo cùng quy tắc dùng để xem trước và cập nhật bài giảng.
export function getLectureYoutubeId(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match && match[1] ? match[1] : null;
}

/** Chuyển metadata thực tế từ API thành dữ liệu hiển thị, không tự tạo số liệu thống kê. */
export function toMaterialDisplayItem(material: Material): MaterialDisplayItem {
  const extension = material.name.split(".").pop()?.toLowerCase();
  const format = extension && extension !== material.name.toLowerCase()
    ? extension
    : material.mimeType.split("/").pop()?.toLowerCase() || "file";
  const date = new Date(material.createdAt);
  return {
    id: material.id,
    title: material.name,
    fileType: format,
    size: material.sizeBytes > 0 ? `${(material.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : "—",
    uploadedAt: Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("vi-VN"),
    folder: material.folder || "Tài liệu chung",
    description: material.tags?.join(", ") || "",
  };
}

/** Nhận diện bài giảng bằng cùng quy tắc metadata mà màn hình học viên sử dụng. */
export function isLectureMaterial(material: Material): boolean {
  return material.mimeType.startsWith("video/") || material.mimeType.startsWith("audio/") ||
    material.tags.some((tag) => /lecture|video|bài giảng/i.test(tag));
}

/** Chuyển học liệu thật thành bài giảng mà không tự tạo lượt xem hay thời lượng. */
export function toLectureItem(material: Material, authorName: string): LectureItem {
  // Đọc metadata bài giảng đã được lưu trong tags từ API.
  const metadata = (prefix: string) => material.tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
  const youtubeId = metadata("youtube:");
  const extension = material.name.split(".").pop()?.toLowerCase();
  const fileType: LectureItem["fileType"] = extension === "pptx" || extension === "ppt" ? "pptx"
    : material.mimeType.startsWith("audio/") ? "mp3"
      : material.mimeType.startsWith("video/") ? "mp4" : undefined;
  return {
    id: material.id,
    title: material.name,
    tags: material.tags,
    description: metadata("Mô tả: "),
    sourceType: youtubeId ? "LINK" : "FILE",
    sourceUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : undefined,
    youtubeId,
    platform: youtubeId ? "YOUTUBE" : "DIRECT",
    fileType,
    fileName: material.name,
    folder: material.folder,
    uploadedAt: material.createdAt,
    authorName,
    attachedExamId: metadata("attachedExamId:"),
    attachedExamTitle: metadata("attachedExamTitle:"),
  };
}

/** Trả về màu sắc giao diện theo thang điểm K-12: < 5 đỏ cảnh báo, 8.5-10 xanh lá, còn lại xanh lam. */
export function getScoreColorClass(score: number, maxScore = 10): string {
  const normalized = (score / (maxScore || 10)) * 10;
  if (normalized < 5) {
    return "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200/80 dark:border-rose-800/80";
  }
  if (normalized >= 8.5) {
    return "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/80";
  }
  return "bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/80";
}

/** Xuất dữ liệu CSV an toàn, vô hiệu hóa công thức từ các ô chuỗi. */
function exportCsv(columns: string[], values: Array<Array<string | number>>, filename: string): void {
  // Escape ô CSV và vô hiệu hóa công thức trong giá trị văn bản.
  const escapeCell = (value: string | number): string => {
    const raw = String(value);
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) && typeof value === "string"
      ? `'${raw}`
      : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = "\uFEFF" + [columns, ...values].map((line) => line.map(escapeCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Xuất bảng điểm từ dữ liệu API đang hiển thị. */
export function exportGradebookCsv(rows: GradebookRow[], className: string): void {
  exportCsv(
    ["Học sinh", "Email", "Điểm thi", "Tổng điểm thi", "Điểm bài tập", "Tổng điểm bài tập", "Tổng (%)", "Chờ chấm", "Chưa nộp"],
    rows.map((row) => [row.learnerName, row.learnerEmail, row.examEarned, row.examPossible,
      row.assignmentEarned, row.assignmentPossible, row.totalPercent, row.awaitingGrade, row.notSubmitted]),
    `bang-diem-${className.replace(/[^a-zA-Z0-9_-]/g, "-")}.csv`,
  );
}

/** Xuất danh sách bài tập thực tế thay vì thông báo giả về tệp Excel. */
export function exportAssignmentsCsv(rows: Assignment[], className: string): void {
  exportCsv(
    ["Mã bài tập", "Tiêu đề", "Trạng thái", "Hạn nộp", "Điểm tối đa", "Mô tả", "Hướng dẫn", "Phiên bản"],
    rows.map((row) => [row.id, row.title, row.status, row.dueAt, row.maxScore, row.description, row.instructions, row.version]),
    `bai-tap-${className.replace(/[^a-zA-Z0-9_-]/g, "-")}.csv`,
  );
}
