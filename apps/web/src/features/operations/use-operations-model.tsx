"use client";
import { useServerPagination, type PaginatedResponse } from "@/shared/hooks/use-server-pagination";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import { realtimeClient } from "@/lib/realtime-client";
import { useApp } from "@/providers/app-provider";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { OperationsView } from "@/roles/manager/operations-navigation";
import {
  Audit,
  Backup,
  ExportJob,
  RestoreJob,
  StorageCleanupFailure,
} from "./operations.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình vận hành; giữ nguyên thứ tự hook. */
export function useOperationsModel(view: OperationsView = "monitoring") {
  const { session, notify } = useApp();

  const canConfigure =
    session.roleCode === "SYSTEM_ADMIN" &&
    hasPermission(session, "system:configure");

  const [audit, setAudit] = useState<Audit[]>([]);

  const [backups, setBackups] = useState<Backup[]>([]);

  const [exports, setExports] = useState<ExportJob[]>([]);

  const [restores, setRestores] = useState<RestoreJob[]>([]);

  const [query, setQueryState] = useState("");
  const [loadError, setLoadError] = useState("");
  const [auditError, setAuditError] = useState("");
  const auditSequence = useRef(0);
  const auditControllerRef = useRef<AbortController | null>(null);
  const loadSequence = useRef(0);

  const [auditFilter, setAuditFilterState] = useState({
    actor: "",
    action: "",
    target: "",
    from: "",
    to: "",
  });

  const [cleanupFailures, setCleanupFailures] = useState<
    StorageCleanupFailure[]
  >([]);

  const [outboxStats, setOutboxStats] = useState<Record<string, number>>({});

  const serverAuditPagination = useServerPagination(20);
  const {
    page: auditPage,
    displayPage: auditDisplayPage,
    pageSize: auditPageSize,
    totalItems: auditTotalItems,
    totalPages: auditTotalPages,
    setPage: setAuditPage,
    setPageSize: setAuditPageSize,
    resetPage: resetAuditPage,
    syncResponse: syncAuditPage,
  } = serverAuditPagination;

  // Cập nhật từ khóa tìm kiếm nhật ký thao tác và đưa phân trang về trang 1.
  const setQuery: Dispatch<SetStateAction<string>> = useCallback(
    (next) => {
      setQueryState(next);
      resetAuditPage();
    },
    [resetAuditPage],
  );

  // Cập nhật bộ lọc chi tiết nhật ký thao tác và đưa phân trang về trang 1.
  const setAuditFilter: Dispatch<
    SetStateAction<{
      actor: string;
      action: string;
      target: string;
      from: string;
      to: string;
    }>
  > = useCallback(
    (next) => {
      setAuditFilterState(next);
      resetAuditPage();
    },
    [resetAuditPage],
  );

  const [restoreOpen, setRestoreOpen] = useState(false);

  const [restoreForm, setRestoreForm] = useState({
    backupId: "",
    mode: "DRILL" as "DRILL" | "OPERATIONAL",
    targetDatabase: "",
  });

  /** Tìm nhật ký độc lập theo trang từ DB để không tải lại mọi phân hệ hoặc ghi đè form khi gõ bộ lọc. */
  const loadAudit = useCallback(async () => {
    if (!canConfigure || view !== "monitoring") return;
    const sequence = ++auditSequence.current;
    auditControllerRef.current?.abort();
    const controller = new AbortController();
    auditControllerRef.current = controller;
    setAuditError("");
    try {
      const params = new URLSearchParams({
        query,
        ...auditFilter,
        page: String(auditPage),
        pageSize: String(auditPageSize),
      });
      if (auditFilter.from)
        params.set("from", `${auditFilter.from}T00:00:00.000Z`);
      if (auditFilter.to) params.set("to", `${auditFilter.to}T23:59:59.999Z`);
      for (const [key, value] of [...params.entries()])
        if (!value) params.delete(key);
      const data = await apiRequest<PaginatedResponse<Audit> | Audit[]>(
        `/system/audit/page?${params.toString()}`,
        { roleCode: session.roleCode, signal: controller.signal },
      );
      if (controller.signal.aborted || sequence !== auditSequence.current) return;
      if (Array.isArray(data)) {
        setAudit(data);
        syncAuditPage({ total: data.length, page: 1, totalPages: 1 });
      } else {
        setAudit(Array.isArray(data.items) ? data.items : []);
        syncAuditPage(data);
      }
    } catch (error) {
      if (!controller.signal.aborted && sequence === auditSequence.current)
        setAuditError(
          error instanceof Error
            ? error.message
            : "Không tải được nhật ký hoạt động.",
        );
    }
  }, [auditFilter, auditPage, auditPageSize, canConfigure, query, session.roleCode, syncAuditPage, view]);

  /** Nạp dữ liệu sao lưu, khôi phục, xuất dữ liệu và hàng đợi email khi tab Dữ liệu đang mở. */
  const load = useCallback(async () => {
    if (!canConfigure) return;
    const sequence = ++loadSequence.current;
    setLoadError("");
    if (view !== "data") return;
    try {
      const [backupData, exportData, restoreData, cleanupData, outboxData] =
        await Promise.allSettled([
          apiRequest<Backup[]>("/system/backups", {
            roleCode: session.roleCode,
          }),
          apiRequest<ExportJob[]>("/system/exports", {
            roleCode: session.roleCode,
          }),
          apiRequest<RestoreJob[]>("/system/restores", {
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
      if (sequence !== loadSequence.current) return;
      if (backupData.status === "fulfilled") setBackups(backupData.value);
      if (exportData.status === "fulfilled") setExports(exportData.value);
      if (restoreData.status === "fulfilled") setRestores(restoreData.value);
      if (cleanupData.status === "fulfilled")
        setCleanupFailures(cleanupData.value);
      if (outboxData.status === "fulfilled") setOutboxStats(outboxData.value);
      const failures = [
        backupData,
        exportData,
        restoreData,
        cleanupData,
        outboxData,
      ].filter((item) => item.status === "rejected");
      setLoadError(
        [
          ...new Set(
            failures.map((item) =>
              item.reason instanceof Error
                ? item.reason.message
                : "Không tải được dữ liệu vận hành.",
            ),
          ),
        ].join(" · "),
      );
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const message =
        error instanceof Error
          ? error.message
          : "Không tải được dữ liệu vận hành.";
      setLoadError(message);
      notify(message, "error");
    }
  }, [canConfigure, notify, session.roleCode, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAudit(), 250);
    return () => {
      window.clearTimeout(timer);
      auditSequence.current += 1;
      auditControllerRef.current?.abort();
    };
  }, [loadAudit]);

  useEffect(() => {
    if (!canConfigure || view !== "data") return;
    let pending: number | undefined;
    // Gộp các tín hiệu trạng thái gần nhau thành một lần tải, không polling khi job đang chạy.
    const refresh = (): void => {
      if (pending !== undefined) return;
      pending = window.setTimeout(() => { pending = undefined; void load(); }, 180);
    };
    // Kết nối chậm hoặc môi trường không có SSE vẫn tải trang lần đầu, không tạo timer lặp.
    const initial = window.setTimeout(refresh, typeof EventSource === "undefined" ? 0 : 750);
    const unsubscribe = realtimeClient.subscribe(
      { sessionId: session.sessionId, userId: session.user.id, roleCode: session.roleCode },
      { channel: "operations" }, {
        next: () => { window.clearTimeout(initial); refresh(); },
        error: () => { setLoadError("Kết nối cập nhật đang gián đoạn. Bạn có thể tải lại dữ liệu."); },
      });
    return () => {
      unsubscribe();
      window.clearTimeout(initial);
      if (pending !== undefined) window.clearTimeout(pending);
      loadSequence.current += 1;
    };
  }, [canConfigure, load, session.roleCode, session.sessionId, session.user.id, view]);

  /** Tạo yêu cầu drill để một quản trị viên khác phê duyệt bằng phiên đăng nhập của họ. */
  const requestRestore = async (event: React.FormEvent) => {
    event.preventDefault();
    const backup = backups.find(
      (item) => item.id === restoreForm.backupId && item.canRestore,
    );
    if (!backup) {
      notify("Hãy chọn một bản sao lưu đã hoàn tất.", "error");
      return;
    }
    try {
      await apiRequest("/system/restores", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          backupId: backup.id,
          mode: restoreForm.mode,
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

  /** Xuất nhật ký kiểm toán để phục vụ đối soát ngoại tuyến. */
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

  const auditPagination = {
    page: auditDisplayPage,
    displayPage: auditDisplayPage,
    pageSize: auditPageSize,
    totalItems: auditTotalItems,
    totalPages: auditTotalPages,
    setPage: setAuditPage,
    setPageSize: setAuditPageSize,
    resetPage: resetAuditPage,
    pageItems: audit,
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
  };
}
