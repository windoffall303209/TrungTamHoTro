"use client";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { RequestError } from "@/components/request-error";
import {
  Button,
  Field,
  inputClass,
  Modal,
  Pagination,
  StatusBadge,
} from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import { downloadApiFile } from "@/lib/api-client";
import {
  BellRing,
  DatabaseZap,
  FileClock,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { operationalStatusText, Policy } from "./operations.shared";
import { useOperationsModel } from "./use-operations-model";
import { useState } from "react";
import {
  OperationsNavigation,
  type OperationsView,
} from "./operations-navigation";

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
    policy,
    setPolicy,
    query,
    setQuery,
    auditFilter,
    setAuditFilter,
    retentionPreview,
    retentionPolicies,
    retentionBusy,
    retentionJobs,
    legalHolds,
    retentionForm,
    setRetentionForm,
    alerts,
    cleanupFailures,
    outboxStats,
    auditPagination,
    templatePagination,
    alertPagination,
    templateOpen,
    setTemplateOpen,
    restoreOpen,
    setRestoreOpen,
    legalHoldOpen,
    setLegalHoldOpen,
    releaseHold,
    setReleaseHold,
    legalHoldForm,
    setLegalHoldForm,
    releaseReason,
    setReleaseReason,
    restoreForm,
    setRestoreForm,
    form,
    setForm,
    requestRestore,
    approveRestore,
    retryCleanup,
    exportData,
    exportAudit,
    previewRetention,
    saveRetention,
    runRetention,
    approveRetention,
    verifyRetention,
    runBackup,
    createLegalHold,
    releaseLegalHold,
    actOnAlert,
    saveTemplate,
    testTemplate,
    savePolicy,
  } = model;

  if (!canConfigure) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Governance & Compliance"
        title="Vận hành và tuân thủ"
        description="Truy vết thay đổi, phục hồi dữ liệu, xuất báo cáo, thông báo và kiểm duyệt tập trung."
      />
      <OperationsNavigation value={view} onChange={setView} />
      <RequestError
        message={model.loadError}
        retry={() => void model.reload()}
      />
      <div className="grid gap-7">
        <section
          hidden={view !== "monitoring"}
          className="order-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
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
        <section
          hidden={view !== "content"}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BellRing className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Mẫu thông báo
              </h2>
            </div>
            <Button onClick={() => setTemplateOpen(true)} variant="secondary">
              <Plus size={15} />
              Tạo mẫu
            </Button>
          </div>
          <div className="mt-5 space-y-3">
            {templatePagination.pageItems.map((item) => (
              <div
                className="rounded-xl border border-slate-100 p-4"
                key={item.id}
              >
                <div className="flex justify-between">
                  <p className="text-xs font-extrabold text-sky-700">
                    {item.eventCode} · {item.locale}
                  </p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-2 text-sm font-bold">{item.subject}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-soft)]">
                  {item.body}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs font-bold text-[var(--ink-soft)]">
                    Phiên bản {item.version}
                  </p>
                  <Button
                    onClick={() => void testTemplate(item)}
                    variant="ghost"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            itemLabel="mẫu thông báo"
            onPageChange={templatePagination.setPage}
            onPageSizeChange={templatePagination.setPageSize}
            page={templatePagination.page}
            pageSize={templatePagination.pageSize}
            totalItems={templatePagination.totalItems}
          />
        </section>
        <section
          hidden={view !== "content"}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Chính sách kiểm duyệt
            </h2>
          </div>
          {policy ? (
            <div className="mt-5 space-y-4">
              <Field label="Từ khóa cấm — ngăn cách bằng dấu phẩy">
                <textarea
                  className={inputClass}
                  rows={3}
                  value={policy.prohibitedTerms.join(", ")}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      prohibitedTerms: e.target.value
                        .split(",")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Số bài/phút">
                  <input
                    className={inputClass}
                    min={1}
                    max={100}
                    type="number"
                    value={policy.maxPostsPerMinute}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        maxPostsPerMinute: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Hành động">
                  <select
                    className={inputClass}
                    value={policy.action}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        action: e.target.value as Policy["action"],
                      })
                    }
                  >
                    <option value="FLAG">Gắn cờ</option>
                    <option value="HIDE_PENDING_REVIEW">Ẩn chờ duyệt</option>
                  </select>
                </Field>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--ink-soft)]">
                  Phiên bản {policy.version}
                </p>
                <Button onClick={() => void savePolicy()}>
                  Phát hành chính sách
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 h-52 animate-pulse rounded-xl bg-slate-100" />
          )}
        </section>
        <section
          hidden={view !== "data"}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <DatabaseZap className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Lưu giữ và bảo toàn dữ liệu
            </h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Loại dữ liệu">
              <select
                className={inputClass}
                value={retentionForm.category}
                onChange={(event) =>
                  setRetentionForm({
                    ...retentionForm,
                    category: event.target.value,
                  })
                }
              >
                <option value="LEARNING">Dữ liệu học tập</option>
                <option value="AI_RESULTS">Kết quả AI đã lưu</option>
                <option value="AUDIT">Audit log</option>
                <option value="SUPPORT">Hỗ trợ</option>
              </select>
            </Field>
            <Field label="Thời hạn (ngày)">
              <input
                className={inputClass}
                min={30}
                max={3650}
                type="number"
                value={retentionForm.retentionDays}
                onChange={(event) =>
                  setRetentionForm({
                    ...retentionForm,
                    retentionDays: Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Hành động">
              <select
                className={inputClass}
                value={retentionForm.action}
                onChange={(event) =>
                  setRetentionForm({
                    ...retentionForm,
                    action: event.target.value as "ARCHIVE" | "DELETE",
                  })
                }
              >
                <option value="ARCHIVE">Lưu trữ</option>
                <option value="DELETE">Xóa theo chính sách</option>
              </select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void previewRetention()} variant="secondary">
              Mô phỏng tác động
            </Button>
            <Button onClick={() => void saveRetention()}>
              Phát hành chính sách
            </Button>
          </div>
          {retentionForm.category === "AI_RESULTS" ? (
            <p className="mt-3 text-xs leading-5 text-[var(--ink-soft)]">
              Chỉ xử lý kết quả AI ở trạng thái đã lưu và quá hạn. Tác vụ đang
              xử lý, chưa rõ kết quả và bộ ôn tập đã phát hành luôn được giữ để
              đối soát hoặc tiếp tục sử dụng.
            </p>
          ) : null}
          {retentionPreview ? (
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs">
                <strong className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">{retentionPreview.estimatedRows}</strong>
                <p className="text-xs text-slate-500 dark:text-slate-400">Đủ điều kiện</p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs">
                <strong className="text-base sm:text-lg font-bold text-amber-600 dark:text-amber-400">{retentionPreview.legalHoldRows}</strong>
                <p className="text-xs text-slate-500 dark:text-slate-400">Legal hold</p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-3 shadow-xs">
                <strong className="text-base sm:text-lg font-bold text-sky-600 dark:text-sky-400">{retentionPreview.deletableRows}</strong>
                <p className="text-xs text-slate-500 dark:text-slate-400">Sẽ xử lý</p>
              </div>
            </div>
          ) : null}
          <div className="mt-6 border-t border-slate-200 dark:border-slate-800 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Legal hold đang theo dõi
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  Mỗi hold bảo vệ độc lập; giải tỏa một hold không tự xóa dữ
                  liệu hoặc chạy retention.
                </p>
              </div>
              <Button
                onClick={() => setLegalHoldOpen(true)}
                variant="secondary"
              >
                <ShieldAlert size={15} />
                Tạo legal hold
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {legalHolds.length ? (
                legalHolds.map((item) => (
                  <article
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs sm:flex-row sm:items-start sm:justify-between"
                    key={item.id}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.category}</strong>
                        <StatusBadge
                          status={item.active ? "ACTIVE" : "RELEASED"}
                        />
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {item.reason}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Tạo bởi {item.createdBy} ·{" "}
                        {new Date(item.createdAt).toLocaleString(
                          activeLocale(),
                        )}
                      </p>
                      {!item.active && item.releaseReason ? (
                        <p className="mt-1 text-xs text-slate-400">
                          Giải tỏa bởi {item.releasedBy}: {item.releaseReason}
                        </p>
                      ) : null}
                    </div>
                    {item.active ? (
                      <Button
                        onClick={() => {
                          setReleaseHold(item);
                          setReleaseReason("");
                        }}
                        variant="ghost"
                      >
                        Giải tỏa
                      </Button>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 py-6 text-center text-sm text-slate-500">
                  Chưa có legal hold.
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {retentionPolicies.slice(0, 4).map((item) => (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {item.category} · v{item.version} · {item.action}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {item.retentionDays} ngày · duyệt bởi {item.approvedBy}
                  </p>
                </div>
                <Button
                  disabled={Boolean(retentionBusy)}
                  loading={retentionBusy === item.id}
                  onClick={() => void runRetention(item)}
                  variant="ghost"
                >
                  Chạy tác vụ
                </Button>
              </div>
            ))}
            {retentionJobs.map((item) => (
              <div
                className="flex flex-col items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-xs sm:flex-row sm:flex-wrap sm:items-center"
                key={item.id}
              >
                <div className="min-w-0 flex-1 break-words">
                  <p className="font-bold text-slate-900 dark:text-slate-100">
                    {String(item.evidence.category ?? item.policyId)} ·{" "}
                    {String(item.evidence.action ?? "")}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {item.requestedBy} ·{" "}
                    {typeof item.evidence.cutoffAt === "string"
                      ? new Date(item.evidence.cutoffAt).toLocaleDateString(
                          activeLocale(),
                        )
                      : ""}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {item.status === "PENDING" && !item.approvedAt
                      ? "Chờ quản trị viên khác phê duyệt"
                      : operationalStatusText(item)}{" "}
                    · Xử lý {item.affectedRows}, giữ {item.skippedRows}
                  </p>
                </div>
                {item.status === "PENDING" && !item.approvedAt ? (
                  <Button
                    disabled={
                      Boolean(retentionBusy) ||
                      item.requestedBy === session.user.id
                    }
                    loading={retentionBusy === item.id}
                    onClick={() => void approveRetention(item)}
                    variant="secondary"
                  >
                    Phê duyệt tác vụ
                  </Button>
                ) : null}
                {typeof item.evidence.archiveObjectKey === "string" ? (
                  <Button
                    onClick={() => void verifyRetention(item)}
                    variant="ghost"
                  >
                    Kiểm tra phục hồi
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section
          hidden={view !== "monitoring"}
          className="order-first rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 sm:p-6 shadow-xs"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-rose-600" />
            <h2 className="font-heading text-xl font-extrabold">
              Cảnh báo hệ thống
            </h2>
          </div>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Nhận xử lý cảnh báo, tạm dừng thông báo hoặc đánh dấu đã khôi phục.
            Các cảnh báo trùng được tự động gộp.
          </p>
          <div className="mt-5 space-y-3">
            {alerts.length ? (
              alertPagination.pageItems.map((item) => (
                <article
                  className={`rounded-xl border p-4 ${item.severity === "CRITICAL" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"}`}
                  key={item.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-extrabold uppercase">
                        {item.serviceName} · {item.severity}
                      </p>
                      <p className="mt-1 text-sm font-bold">{item.summary}</p>
                      <p className="mt-1 text-xs text-[var(--ink-soft)]">
                        Phát hiện{" "}
                        {new Date(item.detectedAt).toLocaleString(
                          activeLocale(),
                        )}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                  {item.status !== "RESOLVED" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        onClick={() => void actOnAlert(item, "ACKNOWLEDGE")}
                        variant="ghost"
                      >
                        Nhận xử lý
                      </Button>
                      <Button
                        onClick={() => void actOnAlert(item, "MUTE")}
                        variant="ghost"
                      >
                        Im lặng 60 phút
                      </Button>
                      <Button
                        onClick={() => void actOnAlert(item, "RESOLVE")}
                        variant="secondary"
                      >
                        Đóng cảnh báo
                      </Button>
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                Không có cảnh báo đang ghi nhận.
              </p>
            )}
          </div>
          <Pagination
            itemLabel="cảnh báo"
            onPageChange={alertPagination.setPage}
            onPageSizeChange={alertPagination.setPageSize}
            page={alertPagination.page}
            pageSize={alertPagination.pageSize}
            totalItems={alertPagination.totalItems}
          />
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
          <Button type="submit">Gửi yêu cầu</Button>
        </form>
      </Modal>
      <Modal
        open={legalHoldOpen}
        onClose={() => setLegalHoldOpen(false)}
        title="Tạo legal hold"
        description="Hold có hiệu lực ngay cho toàn bộ danh mục và được ghi vào audit log."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void createLegalHold(event)}
        >
          <Field label="Loại dữ liệu">
            <select
              className={inputClass}
              value={legalHoldForm.category}
              onChange={(event) =>
                setLegalHoldForm({
                  ...legalHoldForm,
                  category: event.target.value,
                })
              }
            >
              <option value="LEARNING">Dữ liệu học tập</option>
              <option value="AI_RESULTS">Kết quả AI đã lưu</option>
              <option value="AUDIT">Audit log</option>
              <option value="SUPPORT">Hỗ trợ</option>
            </select>
          </Field>
          <Field label="Lý do bảo toàn">
            <textarea
              className={inputClass}
              minLength={5}
              maxLength={500}
              required
              rows={4}
              value={legalHoldForm.reason}
              onChange={(event) =>
                setLegalHoldForm({
                  ...legalHoldForm,
                  reason: event.target.value,
                })
              }
            />
          </Field>
          <Button
            disabled={legalHoldForm.reason.trim().length < 5}
            type="submit"
          >
            Kích hoạt hold
          </Button>
        </form>
      </Modal>
      <Modal
        open={Boolean(releaseHold)}
        onClose={() => setReleaseHold(null)}
        title="Giải tỏa legal hold"
        description={
          releaseHold
            ? `${releaseHold.category} · ${releaseHold.reason}`
            : undefined
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void releaseLegalHold(event)}
        >
          <Field label="Lý do giải tỏa">
            <textarea
              className={inputClass}
              minLength={5}
              maxLength={500}
              required
              rows={4}
              value={releaseReason}
              onChange={(event) => setReleaseReason(event.target.value)}
            />
          </Field>
          <p className="text-xs leading-5 text-[var(--ink-soft)]">
            Thao tác chỉ giải tỏa hold này. Dữ liệu không bị xử lý cho đến khi
            có một lệnh retention riêng được phê duyệt.
          </p>
          <Button
            disabled={releaseReason.trim().length < 5}
            type="submit"
            variant="danger"
          >
            Xác nhận giải tỏa
          </Button>
        </form>
      </Modal>
      <Modal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Phát hành mẫu thông báo"
      >
        <form className="space-y-4" onSubmit={(e) => void saveTemplate(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mã sự kiện">
              <input
                className={inputClass}
                required
                value={form.eventCode}
                onChange={(e) =>
                  setForm({ ...form, eventCode: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="Ngôn ngữ">
              <input
                className={inputClass}
                required
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Tiêu đề">
            <input
              className={inputClass}
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </Field>
          <Field label="Nội dung">
            <textarea
              className={inputClass}
              required
              rows={5}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </Field>
          <Button type="submit">Phát hành</Button>
        </form>
      </Modal>
    </div>
  );
}
