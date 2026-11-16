"use client";
import { AccessDenied } from "@/shared/auth/access-denied";
import { PageHeader } from "@/shared/ui/page-header";
import { RequestError } from "@/shared/ui/request-error";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
} from "@/shared/ui/ui";
import { activeLocale } from "@/i18n/runtime";
import { downloadApiFile } from "@/lib/api-client";
import { DatabaseZap, FileClock, Search } from "lucide-react";
import { operationalStatusText } from "./operations.shared";
import { useOperationsModel } from "./use-operations-model";
import { useState } from "react";
import {
  OperationsNavigation,
  type OperationsView,
} from "@/roles/manager/operations-navigation";

/** Lắp ghép màn hình vận hành từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function OperationsScreen() {
  const [view, setView] = useState<OperationsView>("monitoring");
  const model = useOperationsModel(view);
  const {
    session,
    canConfigure,
    backups,
    exports,
    restores,
    query,
    setQuery,
    auditFilter,
    setAuditFilter,
    cleanupFailures,
    outboxStats,
    auditPagination,
    restoreOpen,
    setRestoreOpen,
    restoreForm,
    setRestoreForm,
    requestRestore,
    approveRestore,
    retryCleanup,
    exportData,
    exportAudit,
    runBackup,
  } = model;

  if (!canConfigure) return <AccessDenied />;
  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Vận hành và tuân thủ"
        description="Xem nhật ký hoạt động, sao lưu, khôi phục và xuất dữ liệu."
      />
      <OperationsNavigation value={view} onChange={setView} />
      <RequestError
        message={model.loadError}
        retry={() => void model.reload()}
      />
      <div className="grid gap-7">
        <section
          hidden={view !== "monitoring"}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileClock className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Nhật ký hoạt động
              </h2>
            </div>
            <div className="relative w-48">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]"
                size={15}
              />
              <input
                aria-label="Tìm nhật ký hoạt động"
                className={`${inputClass} pl-9`}
                placeholder="Tìm sự kiện…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <details className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-slate-800 dark:text-slate-200">
              Bộ lọc chi tiết
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Người thực hiện">
                <input
                  aria-label="Lọc người thực hiện"
                  className={inputClass}
                  placeholder="Tên hoặc mã người dùng"
                  value={auditFilter.actor}
                  onChange={(event) =>
                    setAuditFilter({
                      ...auditFilter,
                      actor: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Hành động">
                <input
                  aria-label="Lọc hành động"
                  className={inputClass}
                  placeholder="Mã hành động"
                  value={auditFilter.action}
                  onChange={(event) =>
                    setAuditFilter({
                      ...auditFilter,
                      action: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Đối tượng">
                <input
                  aria-label="Lọc đối tượng"
                  className={inputClass}
                  placeholder="Tên hoặc mã đối tượng"
                  value={auditFilter.target}
                  onChange={(event) =>
                    setAuditFilter({
                      ...auditFilter,
                      target: event.target.value,
                    })
                  }
                />
              </Field>
              <Field label="Từ ngày">
                <input
                  aria-label="Audit từ ngày"
                  className={inputClass}
                  type="date"
                  value={auditFilter.from}
                  onChange={(event) =>
                    setAuditFilter({ ...auditFilter, from: event.target.value })
                  }
                />
              </Field>
              <Field label="Đến ngày">
                <input
                  aria-label="Audit đến ngày"
                  className={inputClass}
                  type="date"
                  value={auditFilter.to}
                  onChange={(event) =>
                    setAuditFilter({ ...auditFilter, to: event.target.value })
                  }
                />
              </Field>
              <Button
                onClick={() =>
                  setAuditFilter({
                    actor: "",
                    action: "",
                    target: "",
                    from: "",
                    to: "",
                  })
                }
                variant="ghost"
              >
                Xóa bộ lọc
              </Button>
            </div>
          </details>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => void exportAudit()} variant="secondary">
              Xuất nhật ký
            </Button>
          </div>
          <RequestError
            message={model.auditError}
            retry={() => void model.reloadAudit()}
          />
          {!model.auditError && !auditPagination.totalItems ? (
            <p className="mt-5 text-sm text-[var(--ink-soft)]">
              Không có hoạt động phù hợp với bộ lọc hiện tại.
            </p>
          ) : null}
          <div className="mt-5 max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {auditPagination.pageItems.map((item) => (
              <div className="py-3" key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-extrabold text-sky-700">
                    {item.action}
                  </p>
                  <time className="text-xs text-[var(--ink-soft)]">
                    {new Date(item.createdAt).toLocaleString(activeLocale())}
                  </time>
                </div>
                <p className="mt-1 text-sm font-semibold">{item.target}</p>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  {item.actor} · {item.detail}
                </p>
              </div>
            ))}
          </div>
          <Pagination
            itemLabel="bản ghi audit"
            onPageChange={auditPagination.setPage}
            onPageSizeChange={auditPagination.setPageSize}
            page={auditPagination.page}
            pageSize={auditPagination.pageSize}
            totalItems={auditPagination.totalItems}
          />
        </section>
        <section
          hidden={view !== "data"}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <DatabaseZap className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Khôi phục & xuất dữ liệu
            </h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Button onClick={() => setRestoreOpen(true)} variant="secondary">
              Yêu cầu khôi phục
            </Button>
            <Button onClick={() => void runBackup()} variant="secondary">
              Sao lưu toàn bộ
            </Button>
            <Button onClick={() => void exportData()}>Xuất dữ liệu CSV</Button>
          </div>
          <div className="mt-5 space-y-3">
            {backups.slice(0, 2).map((item) => (
              <div
                className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold">
                    {item.type} · {item.checksum || operationalStatusText(item)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    {operationalStatusText(item)} ·{" "}
                    {new Date(item.createdAt).toLocaleString(activeLocale())}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
            {exports.slice(0, 2).map((item) => (
              <div
                className="flex items-center justify-between rounded-xl bg-emerald-50 p-3"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold">
                    {item.category}.{item.format.toLowerCase()} ·{" "}
                    {item.rowCount} dòng
                  </p>
                  <p className="text-xs text-emerald-700">
                    {item.status === "COMPLETED"
                      ? `Hết hạn ${new Date(item.expiresAt).toLocaleString(activeLocale())}`
                      : operationalStatusText(item)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  {item.downloadAvailable ? (
                    <Button
                      onClick={() =>
                        void downloadApiFile(
                          `/system/exports/${item.id}/download`,
                          session.roleCode,
                        )
                      }
                      variant="secondary"
                    >
                      Tải tệp
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {restores.slice(0, 3).map((item) => (
              <div
                className="flex items-start justify-between gap-3 rounded-xl bg-sky-50 p-3"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold">
                    {item.mode === "DRILL"
                      ? "Phục hồi thử"
                      : "Khôi phục vận hành"}{" "}
                    · {item.status}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-soft)]">
                    Yêu cầu bởi {item.requestedBy}
                    {item.approvedBy
                      ? ` · duyệt bởi ${item.approvedBy}`
                      : " · đang chờ người duyệt độc lập"}
                  </p>
                  {item.verification ? (
                    <p className="mt-1 text-xs text-sky-800">
                      {item.verification}
                    </p>
                  ) : null}
                </div>
                {item.status === "PENDING" &&
                item.requestedBy !== session.user.id ? (
                  <Button onClick={() => void approveRestore(item)}>
                    Phê duyệt
                  </Button>
                ) : (
                  <StatusBadge status={item.status} />
                )}
              </div>
            ))}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Hàng đợi email</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Chờ {outboxStats.PENDING ?? 0} · lỗi chờ retry{" "}
                {outboxStats.FAILED ?? 0} · đã gửi {outboxStats.DELIVERED ?? 0}
              </p>
            </div>
            {cleanupFailures.map((failure) => (
              <div
                className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 p-3"
                key={failure.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-rose-900">
                    Object cleanup chưa hoàn tất
                  </p>
                  <p className="mt-1 truncate text-xs text-rose-700">
                    {failure.objectKey} · {failure.error}
                  </p>
                </div>
                <Button
                  onClick={() => void retryCleanup(failure)}
                  variant="secondary"
                >
                  Thử lại
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <Modal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Yêu cầu khôi phục dữ liệu"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void requestRestore(event)}
        >
          <Field label="Bản sao lưu nguồn">
            <select
              className={inputClass}
              required
              value={restoreForm.backupId}
              onChange={(event) =>
                setRestoreForm({ ...restoreForm, backupId: event.target.value })
              }
            >
              <option value="">
                {backups.some((item) => item.canRestore)
                  ? "Chọn bản sao lưu đã hoàn tất"
                  : "Chưa có bản sao lưu có thể khôi phục"}
              </option>
              {backups
                .filter((item) => item.canRestore)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {new Date(item.createdAt).toLocaleString(activeLocale())}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Chế độ">
            <select
              className={inputClass}
              value={restoreForm.mode}
              onChange={(event) =>
                setRestoreForm({
                  ...restoreForm,
                  mode: event.target.value as "DRILL" | "OPERATIONAL",
                })
              }
            >
              <option value="DRILL">Phục hồi thử rồi dọn database tạm</option>
              <option value="OPERATIONAL">
                Khôi phục vào database staging để cutover
              </option>
            </select>
          </Field>
          {restoreForm.mode === "OPERATIONAL" ? (
            <Field label="Database staging mới">
              <input
                className={inputClass}
                pattern="[A-Za-z0-9_]+"
                required
                value={restoreForm.targetDatabase}
                onChange={(event) =>
                  setRestoreForm({
                    ...restoreForm,
                    targetDatabase: event.target.value,
                  })
                }
              />
            </Field>
          ) : null}
          <Field label="Lý do">
            <textarea
              className={inputClass}
              minLength={10}
              required
              rows={3}
              value={restoreForm.reason}
              onChange={(event) =>
                setRestoreForm({ ...restoreForm, reason: event.target.value })
              }
            />
          </Field>
          <p className="text-xs leading-5 text-[var(--ink-soft)]">
            Người tạo yêu cầu không thể tự phê duyệt. Chế độ vận hành chỉ chạy
            khi hệ thống đang bảo trì và không ghi đè database hiện tại.
          </p>
          <Button
            disabled={
              !backups.some(
                (item) => item.canRestore && item.id === restoreForm.backupId,
              )
            }
            type="submit"
          >
            Gửi yêu cầu
          </Button>
        </form>
      </Modal>
    </div>
  );
}
