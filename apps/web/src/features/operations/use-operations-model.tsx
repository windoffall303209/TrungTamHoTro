"use client";
import { usePagination } from "@/components/ui";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Audit,
  Backup,
  ExportJob,
  LegalHold,
  Policy,
  RestoreJob,
  RetentionJob,
  RetentionPolicy,
  RetentionPreview,
  StorageCleanupFailure,
  SystemAlert,
  Template,
} from "./operations.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình vận hành; giữ nguyên thứ tự hook. */
export function useOperationsModel() {
  const { session, notify } = useApp();

  const canConfigure =
    session.roleCode === "SYSTEM_ADMIN" &&
    hasPermission(session, "system:configure");

  const [audit, setAudit] = useState<Audit[]>([]);

  const [backups, setBackups] = useState<Backup[]>([]);

  const [exports, setExports] = useState<ExportJob[]>([]);

  const [restores, setRestores] = useState<RestoreJob[]>([]);

  const [templates, setTemplates] = useState<Template[]>([]);

  const [policy, setPolicy] = useState<Policy | null>(null);

  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState("");
  const [auditError, setAuditError] = useState("");
  const auditSequence = useRef(0);

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

  const [retentionBusy, setRetentionBusy] = useState<string | null>(null);

  const [retentionJobs, setRetentionJobs] = useState<RetentionJob[]>([]);

  const [legalHolds, setLegalHolds] = useState<LegalHold[]>([]);

  const [retentionForm, setRetentionForm] = useState({
    category: "LEARNING",
    retentionDays: 365,
    action: "ARCHIVE" as "ARCHIVE" | "DELETE",
  });

  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  const [cleanupFailures, setCleanupFailures] = useState<
    StorageCleanupFailure[]
  >([]);

  const [outboxStats, setOutboxStats] = useState<Record<string, number>>({});

  const auditPagination = usePagination(audit);

  const templatePagination = usePagination(templates);

  const alertPagination = usePagination(alerts);

  const [templateOpen, setTemplateOpen] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);

  const [legalHoldOpen, setLegalHoldOpen] = useState(false);

  const [releaseHold, setReleaseHold] = useState<LegalHold | null>(null);

  const [legalHoldForm, setLegalHoldForm] = useState({
    category: "LEARNING",
    reason: "",
  });

  const [releaseReason, setReleaseReason] = useState("");

  const [restoreForm, setRestoreForm] = useState({
    mode: "DRILL" as "DRILL" | "OPERATIONAL",
    reason: "Kiểm tra định kỳ khả năng phục hồi bản sao lưu",
    targetDatabase: "",
  });

  const [form, setForm] = useState({
    eventCode: "EXAM_PUBLISHED",
    locale: "vi-VN",
    subject: "",
    body: "",
  });

  /** Tìm nhật ký độc lập để không tải lại mọi phân hệ hoặc ghi đè form khi gõ bộ lọc. */
  const loadAudit = useCallback(async () => {
    if (!canConfigure) return;
    const sequence = ++auditSequence.current;
    setAuditError("");
    try {
      const params = new URLSearchParams({ query, ...auditFilter });
      if (auditFilter.from)
        params.set("from", `${auditFilter.from}T00:00:00.000Z`);
      if (auditFilter.to) params.set("to", `${auditFilter.to}T23:59:59.999Z`);
      for (const [key, value] of [...params.entries()])
        if (!value) params.delete(key);
      const data = await apiRequest<Audit[]>(
        `/system/audit?${params.toString()}`,
        { roleCode: session.roleCode },
      );
      if (sequence === auditSequence.current) setAudit(data);
    } catch (error) {
      if (sequence === auditSequence.current)
        setAuditError(
          error instanceof Error
            ? error.message
            : "Không tải được nhật ký hoạt động.",
        );
    }
  }, [auditFilter, canConfigure, query, session.roleCode]);

  /** Nạp dữ liệu vận hành; bộ lọc nhật ký không kích hoạt lại các request này. */
  const load = useCallback(async (refreshPolicy = true) => {
    if (!canConfigure) return;
    setLoadError("");
    try {
      const [
        backupData,
        exportData,
        restoreData,
        templateData,
        policyData,
        retentionPolicyData,
        retentionJobData,
        legalHoldData,
        alertData,
        cleanupData,
        outboxData,
      ] = await Promise.allSettled([
        apiRequest<Backup[]>("/system/backups", {
          roleCode: session.roleCode,
        }),
        apiRequest<ExportJob[]>("/system/exports", {
          roleCode: session.roleCode,
        }),
        apiRequest<RestoreJob[]>("/system/restores", {
          roleCode: session.roleCode,
        }),
        apiRequest<Template[]>("/system/notification-templates", {
          roleCode: session.roleCode,
        }),
        refreshPolicy ? apiRequest<Policy>("/system/moderation-policy", {
          roleCode: session.roleCode,
        }) : Promise.resolve(null),
        apiRequest<RetentionPolicy[]>("/system/retention-policies", {
          roleCode: session.roleCode,
        }),
        apiRequest<RetentionJob[]>("/system/retention-jobs", {
          roleCode: session.roleCode,
        }),
        apiRequest<LegalHold[]>("/system/legal-holds", {
          roleCode: session.roleCode,
        }),
        apiRequest<SystemAlert[]>("/system/alerts", {
          roleCode: session.roleCode,
        }),
        apiRequest<StorageCleanupFailure[]>(
          "/system/storage-cleanup-failures",
          { roleCode: session.roleCode },
        ),
        apiRequest<Record<string, number>>("/system/outbox/stats", {
          roleCode: session.roleCode,
        }),
      ]);
      // Giữ dữ liệu cũ của nguồn lỗi nhưng vẫn cập nhật mọi nguồn đã tải thành công.
      if (backupData.status === "fulfilled") setBackups(backupData.value);
      if (exportData.status === "fulfilled") setExports(exportData.value);
      if (restoreData.status === "fulfilled") setRestores(restoreData.value);
      if (templateData.status === "fulfilled") setTemplates(templateData.value);
      if (policyData.status === "fulfilled" && policyData.value) setPolicy(policyData.value);
      if (retentionPolicyData.status === "fulfilled") setRetentionPolicies(retentionPolicyData.value);
      if (retentionJobData.status === "fulfilled") setRetentionJobs(retentionJobData.value);
      if (legalHoldData.status === "fulfilled") setLegalHolds(legalHoldData.value);
      if (alertData.status === "fulfilled") setAlerts(alertData.value);
      if (cleanupData.status === "fulfilled") setCleanupFailures(cleanupData.value);
      if (outboxData.status === "fulfilled") setOutboxStats(outboxData.value);
      const failures = [backupData, exportData, restoreData, templateData, policyData,
        retentionPolicyData, retentionJobData, legalHoldData, alertData, cleanupData, outboxData]
        .filter((item) => item.status === "rejected");
      setLoadError([...new Set(failures.map((item) =>
        item.reason instanceof Error ? item.reason.message : "Không tải được dữ liệu vận hành.",
      ))].join(" · "));
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu vận hành.",
      );
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu vận hành.",
        "error",
      );
    }
  }, [canConfigure, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAudit(), 250);
    return () => {
      window.clearTimeout(timer);
      auditSequence.current += 1;
    };
  }, [loadAudit]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const hasActiveJobs = [...backups, ...exports, ...retentionJobs].some(
      (item) => item.status === "PENDING" || item.status === "RUNNING",
    );
    if (!hasActiveJobs) return;
    const timer = window.setInterval(() => void load(false), 5_000);
    return () => window.clearInterval(timer);
  }, [backups, exports, load, retentionJobs]);

  /** Tạo yêu cầu drill để một quản trị viên khác phê duyệt bằng phiên đăng nhập của họ. */
  const requestRestore = async (event: React.FormEvent) => {
    event.preventDefault();
    const backup = backups[0];
    if (!backup) return;
    try {
      await apiRequest("/system/restores", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          backupId: backup.id,
          mode: restoreForm.mode,
          reason: restoreForm.reason,
          targetDatabase:
            restoreForm.mode === "OPERATIONAL"
              ? restoreForm.targetDatabase
              : undefined,
        }),
      });
      notify("Đã tạo yêu cầu khôi phục; cần quản trị viên khác phê duyệt.");
      setRestoreOpen(false);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không khôi phục được.",
        "error",
      );
    }
  };

  /** Phê duyệt yêu cầu của người khác và thực thi đúng chế độ đã yêu cầu. */
  const approveRestore = async (item: RestoreJob) => {
    try {
      await apiRequest(`/system/restores/${item.id}/approve`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify(
        item.mode === "DRILL"
          ? "Phục hồi thử đã vượt qua kiểm chứng."
          : "Đã khôi phục vào database staging; cần cutover theo runbook.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không phê duyệt được yêu cầu khôi phục.",
        "error",
      );
    }
  };

  /** Thử lại đúng một object cleanup và làm mới danh sách lỗi vận hành. */
  const retryCleanup = async (item: StorageCleanupFailure) => {
    try {
      await apiRequest(`/system/storage-cleanup-failures/${item.id}/retry`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã dọn object tồn đọng và đóng lỗi cleanup.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Retry cleanup thất bại.",
        "error",
      );
    }
  };

  /** Tạo gói xuất dữ liệu theo phạm vi và định dạng quản trị viên lựa chọn. */
  const exportData = async () => {
    try {
      await apiRequest("/system/exports", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ category: "LEARNING", format: "CSV" }),
      });
      notify(
        "Đã xếp yêu cầu xuất dữ liệu vào hàng đợi; trang sẽ tự cập nhật tiến độ.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất được dữ liệu.",
        "error",
      );
    }
  };

  /** Xuất nhật ký kiểm toán theo bộ lọc hiện tại để phục vụ đối soát ngoại tuyến. */
  const exportAudit = async () => {
    try {
      await apiRequest("/system/exports", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ category: "AUDIT", format: "CSV" }),
      });
      notify(
        "Đã xếp bản xuất audit vào hàng đợi; liên kết tải xuất hiện khi hoàn tất.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xuất được audit.",
        "error",
      );
    }
  };

  /** Chạy thử chính sách lưu trữ và hiển thị số bản ghi sẽ bị tác động mà chưa xóa dữ liệu. */
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

  /** Lưu cấu hình vòng đời dữ liệu sau khi kiểm tra các ngưỡng trên biểu mẫu. */
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

  /** Thực thi chính sách lưu trữ cụ thể và làm mới lịch sử chạy. */
  const runRetention = async (item: RetentionPolicy) => {
    if (retentionBusy) return;
    setRetentionBusy(item.id);
    try {
      await apiRequest("/system/retention-jobs", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          policyId: item.id,
        }),
      });
      notify(
        "Đã gửi yêu cầu. Một quản trị viên khác cần đăng nhập để phê duyệt.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không chạy được retention.",
        "error",
      );
    } finally {
      setRetentionBusy(null);
    }
  };

  /** Xác nhận thao tác xóa/lưu trữ bằng phiên hiện tại và khóa nút trong khi gửi. */
  const approveRetention = async (item: RetentionJob) => {
    if (
      retentionBusy ||
      !window.confirm(
        "Phê duyệt xử lý dữ liệu theo chính sách này? Hành động có thể xóa dữ liệu đã hết hạn.",
      )
    )
      return;
    setRetentionBusy(item.id);
    try {
      await apiRequest(`/system/retention-jobs/${item.id}/approve`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã phê duyệt bằng tài khoản hiện tại.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không phê duyệt được tác vụ.",
        "error",
      );
    } finally {
      setRetentionBusy(null);
    }
  };

  /** Xác minh archive và từng asset nhúng trước khi dùng làm bằng chứng phục hồi. */
  const verifyRetention = async (item: RetentionJob) => {
    try {
      const result = await apiRequest<{
        recordCount: number;
        assetCount: number;
      }>(`/system/retention-jobs/${item.id}/verify`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify(
        `Archive hợp lệ: ${result.recordCount} bản ghi, ${result.assetCount} tệp phục hồi được.`,
      );
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Archive không vượt qua kiểm tra phục hồi.",
        "error",
      );
    }
  };

  /** Xếp một bản backup FULL vào hàng đợi bền vững và theo dõi tiến độ tại chỗ. */
  const runBackup = async () => {
    try {
      await apiRequest("/system/backups", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ type: "FULL" }),
      });
      notify("Đã xếp backup FULL vào hàng đợi; trang sẽ tự cập nhật tiến độ.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tạo được yêu cầu backup.",
        "error",
      );
    }
  };

  /** Tạo legal hold theo danh mục để chặn mọi retention job liên quan ngay lập tức. */
  const createLegalHold = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await apiRequest("/system/legal-holds", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify(legalHoldForm),
      });
      setLegalHoldForm({ ...legalHoldForm, reason: "" });
      setLegalHoldOpen(false);
      notify("Đã kích hoạt legal hold; dữ liệu trong danh mục được bảo vệ.");
      await Promise.all([load(), previewRetention()]);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được legal hold.",
        "error",
      );
    }
  };

  /** Giải tỏa đúng một legal hold với lý do truy vết, không tự chạy retention sau đó. */
  const releaseLegalHold = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!releaseHold) return;
    try {
      await apiRequest(`/system/legal-holds/${releaseHold.id}/release`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ reason: releaseReason }),
      });
      setReleaseHold(null);
      setReleaseReason("");
      notify(
        "Đã giải tỏa legal hold; retention vẫn cần một lệnh thực thi riêng.",
      );
      await Promise.all([load(), previewRetention()]);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không giải tỏa được legal hold.",
        "error",
      );
    }
  };

  /** Ghi nhận hành động xác nhận/đóng cảnh báo cùng ghi chú của người vận hành. */
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

  /** Tạo hoặc cập nhật mẫu email mà không làm mất phiên bản đang chỉnh sửa. */
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

  /** Gửi thử mẫu email bằng dữ liệu mẫu để kiểm tra nội dung và cấu hình gửi. */
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

  /** Lưu các ngưỡng cảnh báo vận hành dùng bởi dịch vụ giám sát. */
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
  return {
    loadError,
    auditError,
    reload: load,
    reloadAudit: loadAudit,
    session,
    canConfigure,
    audit,
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
  };
}
