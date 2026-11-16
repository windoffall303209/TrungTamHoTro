import { apiRequest } from "./api-client";
import type { RoleCode } from "./app-types";
import type { Exam } from "./learning-types";

/** Tải toàn bộ trang đề thi thuộc lớp đang chọn theo đúng quyền vai trò của người dùng. */
export async function loadClassExams(classId: string, roleCode: RoleCode, signal: AbortSignal): Promise<Exam[]> {
  const exams = new Map<string, Exam>();
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ classId, page: String(page), pageSize: "100" });
    const result = await apiRequest<{ items: Exam[]; total: number; pageSize: number; page: number }>(
      "/exams/page?" + query, { roleCode, signal },
    );
    for (const exam of result.items) if (exam.classId === classId) exams.set(exam.id, exam);
    if (!result.items.length || result.page * result.pageSize >= result.total) return [...exams.values()];
  }
}
