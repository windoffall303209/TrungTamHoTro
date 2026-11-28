import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api-client";
import type { RoleCode } from "./app-types";
import type { Exam } from "./learning-types";

interface ExamPage {
  items: Exam[];
  total: number;
  pageSize: number;
  page: number;
}

/** Lấy đúng một trang đề theo lớp, từ khóa và thứ tự của người dùng. */
function fetchClassExamPage(classId: string, roleCode: RoleCode, signal: AbortSignal, page: number, pageSize: number, search: string, sort: "newest" | "oldest", focusId?: string) {
  const query = new URLSearchParams({ classId, page: String(page), pageSize: String(pageSize) });
  if (search) query.set("search", search);
  if (sort === "oldest") query.set("sort", sort);
  if (focusId) query.set("focusId", focusId);
  return apiRequest<ExamPage>("/exams/page?" + query, { roleCode, signal });
}

/** Điều khiển phân trang theo tab, hủy kết quả cũ và trì hoãn truy vấn khi đang nhập từ khóa. */
export function useClassExamPage(classId: string, role: RoleCode, active: boolean, search: string, sort: "newest" | "oldest", onError: () => void) {
  const [rows, setRows] = useState<Exam[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const term = search.trim();
  const scope = JSON.stringify([classId, role, term, sort, pageSize]);
  const [cursor, setCursor] = useState({ scope, page: 1 });
  const focusRef = useRef<string | undefined>(undefined);
  const page = cursor.scope === scope ? cursor.page : 1;
  const errorRef = useRef(onError);
  useEffect(() => { errorRef.current = onError; }, [onError]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    // Tải trang yêu cầu và bỏ kết quả nếu người dùng đã đổi lớp hoặc bộ lọc.
    const loadPage = () => {
      fetchClassExamPage(classId, role, controller.signal, page, pageSize, term, sort, focusRef.current)
        .then(result => {
          if (controller.signal.aborted) return;
          focusRef.current = undefined;
          setRows(result.items.filter(exam => exam.classId === classId));
          setTotal(result.total);
          setCursor(current => current.scope === scope && current.page === result.page ? current : { scope, page: result.page });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (!focusRef.current) setRows([]);
          setTotal(0);
          errorRef.current();
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    };
    const timer = term ? setTimeout(loadPage, 200) : undefined;
    if (!term) loadPage();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, classId, role, page, pageSize, term, sort, revision, scope]);

  return { rows, setRows, total, page, pageSize, loading, setPageSize,
    setPage: (value: number) => setCursor({ scope, page: value }),
    refresh: (focusId?: string) => { focusRef.current = focusId; setRevision(value => value + 1); } };
}
