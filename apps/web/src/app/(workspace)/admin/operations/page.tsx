"use client";

import {
  BellRing,
  DatabaseZap,
  FileClock,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, Pagination, StatusBadge, usePagination } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { hasPermission } from "@/lib/access-control";
import { useApp } from "@/providers/app-provider";

interface Audit {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  createdAt: string;
}
interface Backup {
  id: string;
  type: string;
  checksum: string;
  createdAt: string;
  status: string;
}
interface ExportJob {
  id: string;
  category: string;
  format: string;
  rowCount: number;
  expiresAt: string;
  status: string;
}
interface Template {
  id: string;
  eventCode: string;
  locale: string;
  subject: string;
  body: string;
  version: number;
  status: string;
}
interface Policy {
  version: number;
  prohibitedTerms: string[];
  maxPostsPerMinute: number;
  action: "FLAG" | "HIDE_PENDING_REVIEW";
  updatedAt: string;
}
interface RetentionPreview {
  category: string;
  retentionDays: number;
  action: "ARCHIVE" | "DELETE";
  estimatedRows: number;
  legalHoldRows: number;
  deletableRows: number;
  cutoffAt: string;
}
interface RetentionPolicy {
  id: string;
  category: string;
  version: number;
  retentionDays: number;
  action: "ARCHIVE" | "DELETE";
  approvedBy: string;
  effectiveAt: string;
  createdAt: string;
}
interface RetentionJob {
  id: string;
  policyId: string;
  status: string;
  affectedRows: number;
  skippedRows: number;
  requestedBy: string;
  approvedBy: string;
  createdAt: string;
}
interface SystemAlert {
  id: string;
  serviceName: string;
  severity: "WARNING" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "MUTED" | "RESOLVED";
  summary: string;
  metricValue?: number;
  threshold?: number;
  detectedAt: string;
  mutedUntil?: string;
  recoveredAt?: string;
}

export default function OperationsPage() {
  const { session, notify } = useApp();
  const canConfigure = session.roleCode === "SYSTEM_ADMIN" && hasPermission(session, "system:configure");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [query, setQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState({
    actor: "",
    action: "",
    target: "",
    from: "",
    to: "",
  });
  const [retentionPreview, setRetentionPreview] =
    useState<RetentionPreview | null>(null);
  const [retentionPolicies, setRetentionPolicies] = useState<RetentionPolicy[]>(
    [],
  );
  const [retentionJobs, setRetentionJobs] = useState<RetentionJob[]>([]);
  const [retentionForm, setRetentionForm] = useState({
    category: "LEARNING",
    retentionDays: 365,
    action: "ARCHIVE" as "ARCHIVE" | "DELETE",
    approvedBy: "Trưởng quản trị",
  });
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const auditPagination = usePagination(audit);
  const templatePagination = usePagination(templates);
  const alertPagination = usePagination(alerts);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [form, setForm] = useState({
    eventCode: "EXAM_PUBLISHED",
    locale: "vi-VN",
    subject: "",
    body: "",
  });
  const load = useCallback(async () => {
    if (!canConfigure) return;
    try {
      const params = new URLSearchParams({ query, ...auditFilter });
      if (auditFilter.from)
        params.set("from", `${auditFilter.from}T00:00:00.000Z`);
      if (auditFilter.to) params.set("to", `${auditFilter.to}T23:59:59.999Z`);
      for (const [key, value] of [...params.entries()])
        if (!value) params.delete(key);
      const [
        auditData,
        backupData,
        exportData,
        templateData,
        policyData,
        retentionPolicyData,
        retentionJobData,
        alertData,
      ] = await Promise.all([
        apiRequest<Audit[]>(`/system/audit?${params.toString()}`, {
          roleCode: session.roleCode,
        }),
        apiRequest<Backup[]>("/system/backups", {
          roleCode: session.roleCode,
        }),
        apiRequest<ExportJob[]>("/system/exports", {
          roleCode: session.roleCode,
        }),
        apiRequest<Template[]>("/system/notification-templates", {
          roleCode: session.roleCode,
        }),
        apiRequest<Policy>("/system/moderation-policy", {
          roleCode: session.roleCode,
        }),
        apiRequest<RetentionPolicy[]>("/system/retention-policies", {
          roleCode: session.roleCode,
        }),
        apiRequest<RetentionJob[]>("/system/retention-jobs", {
          roleCode: session.roleCode,
        }),
        apiRequest<SystemAlert[]>("/system/alerts", {
          roleCode: session.roleCode,
        }),
      ]);
      setAudit(auditData);
      setBackups(backupData);
      setExports(exportData);
      setTemplates(templateData);
      setPolicy(policyData);
      setRetentionPolicies(retentionPolicyData);
      setRetentionJobs(retentionJobData);
      setAlerts(alertData);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu vận hành.",
        "error",
      );
    }
  }, [auditFilter, canConfigure, notify, query, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);
  const restore = async () => {
    const backup = backups[0];
    if (!backup) return;
    try {
      await apiRequest("/system/restores", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          backupId: backup.id,
          approvedBy: session.user.name,
        }),
      });
      notify("Đã kiểm tra checksum và phục hồi thử nghiệm thành công.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không khôi phục được.",
        "error",
      );
    }
  };
  const exportData = async () => {
    try {
      await apiRequest("/system/exports", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ category: "LEARNING", format: "CSV" }),
      });
      notify("Đã xuất dữ liệu; liên kết có hiệu lực 24 giờ.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất được dữ liệu.",
        "error",
      );
    }
  };
  const exportAudit = async () => {
    try {
      await apiRequest("/system/exports", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ category: "AUDIT", format: "CSV" }),
      });
      notify("Đã tạo bản xuất audit có hạn 24 giờ.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất được audit.",
        "error",
      );
    }
  };
  const previewRetention = async () => {
    try {
      setRetentionPreview(
        await apiRequest<RetentionPreview>(
          `/system/retention-preview?category=${retentionForm.category}`,
          { roleCode: session.roleCode },
        ),
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không mô phỏng được retention.",
        "error",
      );
    }
  };
  const saveRetention = async () => {
    try {
      await apiRequest("/system/retention-policies", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(retentionForm),
      });
      notify("Đã phát hành phiên bản retention mới.");
      await Promise.all([load(), previewRetention()]);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được retention.",
        "error",
      );
    }
  };
  const runRetention = async (item: RetentionPolicy) => {
    const approvedBy = window.prompt(
      "Người phê duyệt thực thi (phải khác người yêu cầu)",
      "Trưởng tuân thủ",
    );
    if (!approvedBy) return;
    try {
      await apiRequest("/system/retention-jobs", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          policyId: item.id,
          requestedBy: session.user.name,
          approvedBy,
        }),
      });
      notify("Job retention đã hoàn tất và lưu bằng chứng.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không chạy được retention.",
        "error",
      );
    }
  };
  const actOnAlert = async (
    item: SystemAlert,
    action: "ACKNOWLEDGE" | "MUTE" | "RESOLVE",
  ) => {
    try {
      await apiRequest(`/system/alerts/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          action,
          muteMinutes: action === "MUTE" ? 60 : undefined,
        }),
      });
      notify("Đã cập nhật vòng đời cảnh báo.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không cập nhật được cảnh báo.",
        "error",
      );
    }
  };
  const saveTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest("/system/notification-templates", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(form),
      });
      notify("Đã phát hành phiên bản mẫu mới.");
      setTemplateOpen(false);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được mẫu.",
        "error",
      );
    }
  };
  const testTemplate = async (item: Template) => {
    try {
      const variables = Object.fromEntries(
        [
          ...`${item.subject} ${item.body}`.matchAll(/{{([a-zA-Z0-9_]+)}}/g),
        ].map((match) => [match[1], `demo-${match[1]}`]),
      );
      const result = await apiRequest<{ status: string; subject: string }>(
        `/system/notification-templates/${item.id}/test-send`,
        {
          method: "POST",
          roleCode: session.roleCode,
          body: JSON.stringify({ recipient: session.user.email, variables }),
        },
      );
      notify(`Resend đã nhận email thử: ${result.subject}`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không gửi thử được mẫu.",
        "error",
      );
    }
  };
  const savePolicy = async () => {
    if (!policy) return;
    try {
      await apiRequest("/system/moderation-policy", {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({
          prohibitedTerms: policy.prohibitedTerms,
          maxPostsPerMinute: policy.maxPostsPerMinute,
          action: policy.action,
        }),
      });
      notify("Đã phát hành chính sách kiểm duyệt mới.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được chính sách.",
        "error",
      );
    }
  };
  if (!canConfigure) return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Governance & Compliance"
        title="Vận hành và tuân thủ"
        description="Truy vết thay đổi, phục hồi dữ liệu, xuất báo cáo, thông báo và kiểm duyệt tập trung."
      />
      <div className="grid gap-7 xl:grid-cols-2">
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileClock className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">Audit log</h2>
            </div>
            <div className="relative w-48">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={15}
              />
              <input
                aria-label="Tìm audit log"
                className={`${inputClass} pl-9`}
                placeholder="Tìm sự kiện…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <input
              aria-label="Lọc actor"
              className={inputClass}
              placeholder="Actor"
              value={auditFilter.actor}
              onChange={(event) =>
                setAuditFilter({ ...auditFilter, actor: event.target.value })
              }
            />
            <input
              aria-label="Lọc action"
              className={inputClass}
              placeholder="Action"
              value={auditFilter.action}
              onChange={(event) =>
                setAuditFilter({ ...auditFilter, action: event.target.value })
              }
            />
            <input
              aria-label="Lọc target"
              className={inputClass}
              placeholder="Target"
              value={auditFilter.target}
              onChange={(event) =>
                setAuditFilter({ ...auditFilter, target: event.target.value })
              }
            />
            <input
              aria-label="Audit từ ngày"
              className={inputClass}
              type="date"
              value={auditFilter.from}
              onChange={(event) =>
                setAuditFilter({ ...auditFilter, from: event.target.value })
              }
            />
            <input
              aria-label="Audit đến ngày"
              className={inputClass}
              type="date"
              value={auditFilter.to}
              onChange={(event) =>
                setAuditFilter({ ...auditFilter, to: event.target.value })
              }
            />
            <Button onClick={() => void exportAudit()} variant="secondary">
              Xuất audit
            </Button>
          </div>
          <div className="mt-5 max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {auditPagination.pageItems.map((item) => (
              <div className="py-3" key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-extrabold text-sky-700">
                    {item.action}
                  </p>
                  <time className="text-[10px] text-slate-400">
                    {new Date(item.createdAt).toLocaleString("vi-VN")}
                  </time>
                </div>
                <p className="mt-1 text-sm font-semibold">{item.target}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.actor} · {item.detail}
                </p>
              </div>
            ))}
          </div>
          <Pagination itemLabel="bản ghi audit" onPageChange={auditPagination.setPage} onPageSizeChange={auditPagination.setPageSize} page={auditPagination.page} pageSize={auditPagination.pageSize} totalItems={auditPagination.totalItems} />
        </section>
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <div className="flex items-center gap-3">
            <DatabaseZap className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Khôi phục & xuất dữ liệu
            </h2>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button onClick={() => void restore()} variant="secondary">
              Phục hồi thử bản mới nhất
            </Button>
            <Button onClick={() => void exportData()}>Xuất dữ liệu CSV</Button>
          </div>
          <div className="mt-5 space-y-3">
            {backups.slice(0, 2).map((item) => (
              <div className="rounded-xl bg-slate-50 p-3" key={item.id}>
                <p className="text-sm font-bold">
                  {item.type} · {item.checksum}
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(item.createdAt).toLocaleString("vi-VN")}
                </p>
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
                    Hết hạn {new Date(item.expiresAt).toLocaleString("vi-VN")}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </div>
            ))}
          </div>
        </section>
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
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
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {item.body}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-400">
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
          <Pagination itemLabel="mẫu thông báo" onPageChange={templatePagination.setPage} onPageSizeChange={templatePagination.setPageSize} page={templatePagination.page} pageSize={templatePagination.pageSize} totalItems={templatePagination.totalItems} />
        </section>
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
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
                <p className="text-xs text-slate-400">
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
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <div className="flex items-center gap-3">
            <DatabaseZap className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Retention & legal hold
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
            <Field label="Người phê duyệt">
              <input
                className={inputClass}
                value={retentionForm.approvedBy}
                onChange={(event) =>
                  setRetentionForm({
                    ...retentionForm,
                    approvedBy: event.target.value,
                  })
                }
              />
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
          {retentionPreview ? (
            <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--rule)] border-y border-[var(--rule)] py-4 text-center">
              <div>
                <strong>{retentionPreview.estimatedRows}</strong>
                <p className="text-xs text-slate-500">Đủ điều kiện</p>
              </div>
              <div>
                <strong>{retentionPreview.legalHoldRows}</strong>
                <p className="text-xs text-slate-500">Legal hold</p>
              </div>
              <div>
                <strong>{retentionPreview.deletableRows}</strong>
                <p className="text-xs text-slate-500">Sẽ xử lý</p>
              </div>
            </div>
          ) : null}
          <div className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {retentionPolicies.slice(0, 4).map((item) => (
              <div
                className="flex items-center justify-between gap-3 py-4"
                key={item.id}
              >
                <div>
                  <p className="text-sm font-bold">
                    {item.category} · v{item.version} · {item.action}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.retentionDays} ngày · duyệt bởi {item.approvedBy}
                  </p>
                </div>
                <Button onClick={() => void runRetention(item)} variant="ghost">
                  Chạy job
                </Button>
              </div>
            ))}
            {retentionJobs.slice(0, 2).map((item) => (
              <p
                className="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800"
                key={item.id}
              >
                Job {item.status}: xử lý {item.affectedRows}, giữ{" "}
                {item.skippedRows}
              </p>
            ))}
          </div>
        </section>
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-rose-600" />
            <h2 className="font-heading text-xl font-extrabold">
              Cảnh báo hệ thống
            </h2>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Chống trùng theo fingerprint, hỗ trợ nhận việc, im lặng tạm thời và
            ghi thời điểm phục hồi.
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
                      <p className="mt-1 text-xs text-slate-500">
                        Phát hiện{" "}
                        {new Date(item.detectedAt).toLocaleString("vi-VN")}
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
          <Pagination itemLabel="cảnh báo" onPageChange={alertPagination.setPage} onPageSizeChange={alertPagination.setPageSize} page={alertPagination.page} pageSize={alertPagination.pageSize} totalItems={alertPagination.totalItems} />
        </section>
      </div>
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
