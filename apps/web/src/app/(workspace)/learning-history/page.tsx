"use client";

import { activeLocale } from "@/i18n/runtime";

import { Clock3, ExternalLink, History, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { Button, Pagination, StatusBadge, usePagination } from "@/shared/ui/ui";
import { apiRequest } from "@/lib/api-client";
import type { LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface Summary {
  session: LiveSession;
  recordingAvailable: boolean;
}
/** Hiển thị lịch sử tham dự, bản ghi buổi học và luồng khiếu nại của học viên. */
export default function LearningHistoryPage() {
  const { session, notify } = useApp();
  const [items, setItems] = useState<LiveSession[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const mounted = useRef(true);
  const summaryRequestVersions = useRef(new Map<string, number>());
  const pagination = usePagination(items);

  // Ngăn yêu cầu tải chi tiết cập nhật giao diện sau khi người dùng rời trang.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Nạp lịch sử các buổi học thuộc phạm vi học viên hiện tại. */
  const load = useCallback(async (signal?: AbortSignal) => {
    if (session.roleCode !== "LEARNER") return;
    try {
      const data = await apiRequest<LiveSession[]>("/sessions", {
        roleCode: session.roleCode,
        signal,
      });
      if (!signal?.aborted && mounted.current) setItems(data);
    } catch (error) {
      if (!signal?.aborted && mounted.current) {
        notify(error instanceof Error ? error.message : "Không tải được lịch sử học tập.", "error");
      }
    }
  }, [notify, session.roleCode]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);
  /** Mở chi tiết tham dự của một buổi học và dữ liệu đối soát liên quan. */
  const view = async (item: LiveSession) => {
    const requestVersion = (summaryRequestVersions.current.get(item.id) ?? 0) + 1;
    summaryRequestVersions.current.set(item.id, requestVersion);
    try {
      const data = await apiRequest<Summary>(
        `/learner/sessions/${item.id}/summary`,
        { roleCode: session.roleCode },
      );
      if (mounted.current && summaryRequestVersions.current.get(item.id) === requestVersion) {
        setSummaries((current) => ({ ...current, [item.id]: data }));
      }
    } catch (error) {
      if (mounted.current && summaryRequestVersions.current.get(item.id) === requestVersion) {
        notify(error instanceof Error ? error.message : "Không tải được chi tiết buổi học.", "error");
      }
    }
  };
  /** Xin URL bản ghi có thời hạn rồi mở bằng trình xem an toàn của ứng dụng. */
  const openRecording = async (item: LiveSession) => {
    try {
      const access = await apiRequest<{ url: string; expiresAt: string }>(
        `/learner/sessions/${item.id}/recording-access`,
        { roleCode: session.roleCode },
      );
      const resolved = await apiRequest<{ recordingUrl: string }>(access.url, {
        roleCode: session.roleCode,
      });
      window.open(resolved.recordingUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không mở được bản ghi.",
        "error",
      );
    }
  };
  if (session.roleCode !== "LEARNER") return <AccessDenied />;
  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <PageHeader
        title="Lịch sử học tập"
        description="Xem lại các buổi học và bản ghi được cấp quyền."
      />
      <div className="space-y-3 mt-3.5">
        {items.length ? pagination.pageItems.map((item) => {
          const summary = summaries[item.id];
          return (
            <article
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs hover:border-sky-300 dark:hover:border-sky-700 transition-all"
              key={item.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <History className="text-sky-600 dark:text-sky-400" size={18} />
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h2>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <Clock3 size={13} />
                    {new Date(item.startsAt).toLocaleString(activeLocale())}
                  </p>
                </div>
                <Button onClick={() => void view(item)} variant="secondary">
                  Xem bản ghi buổi học
                </Button>
              </div>
              {summary ? (
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center sm:text-left">
                    {summary.recordingAvailable ? (
                      <button
                        className="action-link px-0 text-sm"
                        onClick={() => void openRecording(item)}
                        type="button"
                      >
                        <Video size={16} />
                        Xem bản ghi
                        <ExternalLink size={13} />
                      </button>
                    ) : (
                      <div>
                        <StatusBadge status={summary.session.recordingStatus ?? "NONE"} />
                        <p className="mt-2 text-xs text-slate-500">
                          {summary.session.recordingStatus === "PROCESSING" ? "Bản ghi đang được xử lý." : summary.session.recordingStatus === "FAILED" ? "Xử lý bản ghi thất bại, giảng viên sẽ thử lại." : summary.session.recordingStatus === "EXPIRED" ? "Bản ghi đã hết thời hạn lưu giữ." : "Bản ghi chưa sẵn sàng."}
                        </p>
                      </div>
                    )}
                  </div>

                </div>
              ) : null}
            </article>
          );
        }) : <p className="empty-copy">Chưa có buổi học nào trong lịch sử.</p>}
      </div>
      <Pagination itemLabel="buổi học" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />

    </div>
  );
}
