"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { RoleCode } from "@/lib/app-types";
import type { Material } from "@/lib/learning-types";
import { inputClass, Pagination } from "@/shared/ui/ui";

/** Tải một trang học liệu có giới hạn và hỗ trợ hủy yêu cầu cho bộ chọn và hàng đợi duyệt. */
export function useMaterialSearch(roleCode: RoleCode, filters: Record<string, string>, enabled: boolean, actorId: string) {
  const scope = JSON.stringify(filters);
  const [query, setQuery] = useState("");
  const [requested, setRequested] = useState({ scope: "", page: 1 });
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState<{ key: string; items: Material[]; total: number }>({ key: "", items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pageScope = `${actorId}:${roleCode}:${scope}:${query}:${pageSize}`;
  const page = requested.scope === pageScope ? requested.page : 1;
  const key = `${pageScope}:${page}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ ...JSON.parse(scope) as Record<string, string>, query, page: String(page), pageSize: String(pageSize) });
        const response = await apiRequest<{ items: Material[]; total: number; totalPages: number }>(`/materials/search?${params}`, { roleCode, signal: controller.signal });
        if (controller.signal.aborted) return;
        if (page > response.totalPages) setRequested({ scope: pageScope, page: response.totalPages });
        else setResult({ key, items: response.items, total: response.total });
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Không tải được học liệu.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, key, page, pageScope, pageSize, query, roleCode, scope]);
  return {
    items: enabled && result.key === key ? result.items : [], total: enabled && result.key === key ? result.total : 0,
    page, pageSize, query, setQuery, setPageSize, setPage: (value: number) => setRequested({ scope: pageScope, page: value }),
    loading, error,
  };
}

/** Dùng lại điều khiển tìm kiếm và phân trang, giữ nguyên cách lựa chọn học liệu. */
export function MaterialSearchControls({ search }: { search: ReturnType<typeof useMaterialSearch> }) {
  return <div className="my-3 space-y-2" aria-busy={search.loading}>
    <input aria-label="Tìm học liệu" className={inputClass} maxLength={255} onChange={(event) => search.setQuery(event.target.value)} placeholder="Tìm học liệu" value={search.query} />
    {search.error ? <p role="alert" className="text-sm text-[var(--danger)]">{search.error}</p> : null}
    {search.loading ? <p role="status" className="text-sm text-[var(--ink-muted)]">Đang tải dữ liệu…</p> : null}
    <Pagination itemLabel="học liệu" onPageChange={search.setPage} onPageSizeChange={search.setPageSize} page={search.page} pageSize={search.pageSize} totalItems={search.total} />
  </div>;
}
