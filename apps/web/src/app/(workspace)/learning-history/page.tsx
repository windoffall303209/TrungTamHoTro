"use client";

import { activeLocale } from "@/i18n/runtime";

import { Clock3, ExternalLink, History, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import type { LiveSession } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface Summary {
  session: LiveSession;
  recordingAvailable: boolean;
  appeal?: { id: string; status: string; reason: string; resolution?: string };
  attendance: {
    attendedMinutes: number;
    status: string;
    adjustmentReason?: string;
  };
}
/** Hiển thị lịch sử tham dự, bản ghi buổi học và luồng khiếu nại của học viên. */
export default function LearningHistoryPage() {
  const { session, notify } = useApp();
  const [items, setItems] = useState<LiveSession[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [appealSession, setAppealSession] = useState<LiveSession | null>(null);
  const [appealReason, setAppealReason] = useState("");
  const pagination = usePagination(items);
  /** Nạp các lớp cùng lịch sử buổi học thuộc phạm vi người dùng hiện tại. */
  const load = useCallback(async () => {
    if (session.roleCode !== "LEARNER") return;
    try {
      setItems(
        await apiRequest<LiveSession[]>("/sessions", {
          roleCode: session.roleCode,
        }),
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được lịch sử học tập.",
        "error",
      );
    }
  }, [notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  /** Mở chi tiết tham dự của một buổi học và dữ liệu đối soát liên quan. */
  const view = async (item: LiveSession) => {
    try {
      const data = await apiRequest<Summary>(
        `/learner/sessions/${item.id}/summary`,
        { roleCode: session.roleCode },
      );
      setSummaries((current) => ({ ...current, [item.id]: data }));
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được chi tiết buổi học.",
        "error",
      );
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
  /** Gửi yêu cầu xem xét lại điểm danh của buổi đang chọn. */
  const requestAppeal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!appealSession) return;
    try {
      await apiRequest(
        `/learner/sessions/${appealSession.id}/attendance-appeals`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ reason: appealReason }),
        },
      );
      notify("Đã gửi yêu cầu điều chỉnh điểm danh.");
      setAppealSession(null);
      setAppealReason("");
      await view(appealSession);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không gửi được yêu cầu điều chỉnh.",
        "error",
      );
    }
  };
  if (session.roleCode !== "LEARNER") return <AccessDenied />;
  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <PageHeader
        title="Lịch sử học tập"
        description="Theo dõi thời lượng tham dự, trạng thái điểm danh và bản ghi được cấp quyền."
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
                  Xem điểm danh
                </Button>
              </div>
              {summary ? (
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center sm:text-left">
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100">
                      {summary.attendance.attendedMinutes}&apos;
                    </p>
                    <p className="text-xs text-slate-500">Thời lượng tham dự</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center sm:text-left">
                    <StatusBadge status={summary.attendance.status} />
                    <p className="mt-2 text-xs text-slate-500">
                      Trạng thái điểm danh
                    </p>
                  </div>
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
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 sm:col-span-3">
                    <div>
                      {summary.appeal ? (
                        <>
                          <StatusBadge status={summary.appeal.status} />
                          <span className="ml-2 text-xs text-slate-500">
                            {summary.appeal.reason}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">
                          Chưa có yêu cầu điều chỉnh
                        </span>
                      )}
                    </div>
                    {item.status === "COMPLETED" && !summary.appeal ? (
                      <Button
                        onClick={() => setAppealSession(item)}
                        variant="ghost"
                      >
                        Yêu cầu điều chỉnh
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          );
        }) : <p className="empty-copy">Chưa có buổi học nào trong lịch sử.</p>}
      </div>
      <Pagination itemLabel="buổi học" onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} page={pagination.page} pageSize={pagination.pageSize} totalItems={pagination.totalItems} />
      <Modal
        open={Boolean(appealSession)}
        onClose={() => setAppealSession(null)}
        title="Yêu cầu điều chỉnh điểm danh"
        description="Nêu rõ thời điểm tham gia hoặc bằng chứng cần đối soát; mỗi buổi chỉ có một yêu cầu đang xử lý."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void requestAppeal(event)}
        >
          <Field label="Lý do điều chỉnh">
            <textarea
              className={inputClass}
              minLength={10}
              required
              rows={5}
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
            />
          </Field>
          <Button type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
    </div>
  );
}
