import { apiRequest } from "./api-client";
import type { RoleCode } from "./app-types";
import type { Exam } from "./learning-types";

export interface LoadClassExamsOptions {
  /** Gọi lại ngay sau trang đầu và sau mỗi đợt tải song song để hiển thị sớm sau 1 RTT. */
  onProgress?: (exams: Exam[]) => void;
  /** Số request trang tối đa chạy song song cho các trang còn lại (mặc định 4). */
  concurrency?: number;
}

interface ExamPageResponse {
  items: Exam[];
  total: number;
  pageSize: number;
  page: number;
}

/** Tải một trang đề thi của lớp từ API phân trang giới hạn. */
async function fetchExamPage(classId: string, page: number, roleCode: RoleCode, signal: AbortSignal): Promise<ExamPageResponse> {
  const query = new URLSearchParams({ classId, page: String(page), pageSize: "100" });
  return apiRequest<ExamPageResponse>("/exams/page?" + query, { roleCode, signal });
}

/** Gộp các đề thuộc đúng lớp vào map đích theo thứ tự ổn định. */
function appendClassExams(target: Map<string, Exam>, classId: string, items: Exam[]): void {
  for (const exam of items) {
    if (exam.classId === classId) target.set(exam.id, exam);
  }
}

/** Tải toàn bộ đề của lớp với phản hồi trang đầu sau 1 RTT và tải song song có giới hạn các trang còn lại. */
export async function loadClassExams(
  classId: string,
  roleCode: RoleCode,
  signal: AbortSignal,
  options?: LoadClassExamsOptions,
): Promise<Exam[]> {
  const exams = new Map<string, Exam>();
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 4));
  const firstPage = await fetchExamPage(classId, 1, roleCode, signal);
  if (signal.aborted) return [];

  appendClassExams(exams, classId, firstPage.items);
  if (options?.onProgress && !signal.aborted) {
    options.onProgress([...exams.values()]);
  }

  const effectivePageSize = Math.max(1, firstPage.pageSize || 100);
  const totalPages = Math.ceil(firstPage.total / effectivePageSize);
  if (!firstPage.items.length || firstPage.page * effectivePageSize >= firstPage.total || totalPages <= 1) {
    return [...exams.values()];
  }

  for (let startPage = 2; startPage <= totalPages; startPage += concurrency) {
    if (signal.aborted) break;
    const batchPages: number[] = [];
    for (let page = startPage; page < startPage + concurrency && page <= totalPages; page++) {
      batchPages.push(page);
    }
    const responses = await Promise.all(
      batchPages.map((page) => fetchExamPage(classId, page, roleCode, signal)),
    );
    if (signal.aborted) break;
    for (const response of responses) {
      appendClassExams(exams, classId, response.items);
    }
    if (options?.onProgress && !signal.aborted) {
      options.onProgress([...exams.values()]);
    }
  }

  return [...exams.values()];
}
