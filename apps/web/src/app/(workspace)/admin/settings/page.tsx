"use client";

import {
  Activity,
  CloudCog,
  DatabaseBackup,
  HardDrive,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { PageHeader } from "@/components/page-header";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";

interface Settings {
  centerName: string;
  timezone: string;
  locale: string;
  retentionDays: number;
  maxFileSizeMb: number;
  storageQuotaMb: number;
  allowedMimeTypes: string[];
  moderationEnabled: boolean;
  notificationSender: string;
  maintenanceMode: boolean;
  version: number;
  effectiveAt: string;
  updatedBy: string;
  updatedAt: string;
}
interface Integration {
  id: string;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  enabled: boolean;
  isDefault: boolean;
  healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR";
  maskedCredential: string;
  webhookConfigured: boolean;
  lastCheckedAt?: string;
  updatedAt: string;
}
interface Backup {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  checksum: string;
  sizeMb: number;
}
interface Health {
  status: string;
  database: string;
  apiLatencyMs: number;
  storageUsagePercent: number;
  queueDepth: number;
  checkedAt: string;
}
interface StorageOverview {
  quotaBytes: number;
  usedBytes: number;
  usagePercent: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[];
  byClass: Array<{
    classId: string;
    classCode: string;
    className: string;
    fileCount: number;
    usedBytes: number;
  }>;
}

export default function SettingsPage() {
  const { session, notify } = useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<Settings[]>([]);
  const [effectiveAt, setEffectiveAt] = useState("");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [saving, setSaving] = useState(false);
  const [configuring, setConfiguring] = useState<Integration | null>(null);
  const [integrationForm, setIntegrationForm] = useState({
    credentialReference: "",
    webhookUrl: "",
  });
  const load = useCallback(async () => {
    if (session.roleCode !== "SYSTEM_ADMIN") return;
    try {
      const [a, b, c, d, e, f] = await Promise.all([
        apiRequest<Settings>("/system/settings", {
          roleCode: session.roleCode,
        }),
        apiRequest<Integration[]>("/system/integrations", {
          roleCode: session.roleCode,
        }),
        apiRequest<Backup[]>("/system/backups", { roleCode: session.roleCode }),
        apiRequest<Health>("/system/health-overview", {
          roleCode: session.roleCode,
        }),
        apiRequest<StorageOverview>("/system/storage-overview", {
          roleCode: session.roleCode,
        }),
        apiRequest<Settings[]>("/system/settings/history", {
          roleCode: session.roleCode,
        }),
      ]);
      setSettings(a);
      setIntegrations(b);
      setBackups(c);
      setHealth(d);
      setStorage(e);
      setHistory(f);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tải được cấu hình.",
        "error",
      );
    }
  }, [notify, session.roleCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(
        await apiRequest<Settings>("/system/settings", {
          method: "PATCH",
          roleCode: session.roleCode,
          body: JSON.stringify({
            centerName: settings.centerName,
            timezone: settings.timezone,
            locale: settings.locale,
            retentionDays: settings.retentionDays,
            maxFileSizeMb: settings.maxFileSizeMb,
            storageQuotaMb: settings.storageQuotaMb,
            allowedMimeTypes: settings.allowedMimeTypes,
            moderationEnabled: settings.moderationEnabled,
            notificationSender: settings.notificationSender,
            maintenanceMode: settings.maintenanceMode,
            effectiveAt: effectiveAt
              ? new Date(effectiveAt).toISOString()
              : undefined,
          }),
        }),
      );
      notify(
        effectiveAt
          ? "Đã lên lịch phiên bản cấu hình mới."
          : "Đã phát hành phiên bản cấu hình mới.",
      );
      setEffectiveAt("");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được cấu hình.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (item: Integration) => {
    try {
      await apiRequest(`/system/integrations/${item.id}`, {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      notify("Đã cập nhật tích hợp.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không cập nhật được tích hợp.",
        "error",
      );
    }
  };
  const configure = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configuring) return;
    try {
      await apiRequest("/system/integrations/configure", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          provider: configuring.provider,
          ...integrationForm,
        }),
      });
      notify("Đã lưu tham chiếu credential; cần health check trước khi bật.");
      setConfiguring(null);
      setIntegrationForm({ credentialReference: "", webhookUrl: "" });
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không cấu hình được tích hợp.",
        "error",
      );
    }
  };
  const testIntegration = async (item: Integration) => {
    try {
      await apiRequest(`/system/integrations/${item.id}/test`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Health check tích hợp thành công.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Health check thất bại.",
        "error",
      );
      await load();
    }
  };
  const setDefault = async (item: Integration) => {
    try {
      await apiRequest(`/system/integrations/${item.id}/default`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify("Đã đặt provider mặc định.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không đặt được provider mặc định.",
        "error",
      );
    }
  };
  const testMeeting = async (item: Integration) => {
    try {
      const result = await apiRequest<{ attendeeUrl: string }>(
        `/system/integrations/${item.id}/test-meeting`,
        { method: "POST", roleCode: session.roleCode },
      );
      notify(`Phòng thử đã sẵn sàng: ${result.attendeeUrl}`, "info");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không tạo được phòng thử.",
        "error",
      );
    }
  };
  const backup = async () => {
    try {
      await apiRequest("/system/backups", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({ type: "FULL" }),
      });
      notify("Sao lưu toàn bộ đã hoàn tất và có checksum.");
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Sao lưu thất bại.",
        "error",
      );
    }
  };
  if (session.roleCode !== "SYSTEM_ADMIN") return <AccessDenied />;
  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8 md:py-10">
      <PageHeader
        eyebrow="Platform Governance"
        title="Cấu hình hệ thống"
        description="Chính sách dữ liệu, tích hợp, kiểm duyệt, sao lưu và tình trạng dịch vụ."
      />
      {health ? (
        <section className="metric-ledger mb-7">
          <div
            className={health.status === "healthy" ? "bg-emerald-50" : "bg-amber-50"}
          >
            <Activity
              className={
                health.status === "healthy"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
              size={19}
            />
            <p className="mt-3 font-extrabold">{health.status === "healthy" ? "Hoạt động ổn định" : "Cần kiểm tra"}</p>
            <p className="text-xs text-slate-600">
              Cơ sở dữ liệu: {health.database === "connected" ? "đã kết nối" : health.database}
            </p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">{health.apiLatencyMs} ms</p>
            <p className="text-xs text-slate-500">Độ trễ API</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">
              {health.storageUsagePercent}%
            </p>
            <p className="text-xs text-slate-500">Dung lượng lưu trữ</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">{health.queueDepth}</p>
            <p className="text-xs text-slate-500">Tác vụ đang chờ</p>
          </div>
        </section>
      ) : null}
      <div className="grid gap-7 xl:grid-cols-[1.1fr_.9fr]">
        <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-sky-700" />
            <h2 className="font-heading text-xl font-extrabold">
              Quy định vận hành
            </h2>
          </div>
          {settings ? (
            <form className="mt-6 space-y-4" onSubmit={(e) => void save(e)}>
              <Field label="Tên trung tâm">
                <input
                  className={inputClass}
                  value={settings.centerName}
                  onChange={(e) =>
                    setSettings({ ...settings, centerName: e.target.value })
                  }
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Múi giờ">
                  <input
                    className={inputClass}
                    value={settings.timezone}
                    onChange={(e) =>
                      setSettings({ ...settings, timezone: e.target.value })
                    }
                  />
                </Field>
                <Field label="Ngôn ngữ">
                  <input
                    className={inputClass}
                    value={settings.locale}
                    onChange={(e) =>
                      setSettings({ ...settings, locale: e.target.value })
                    }
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Lưu dữ liệu (ngày)">
                  <input
                    className={inputClass}
                    min={30}
                    max={3650}
                    type="number"
                    value={settings.retentionDays}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        retentionDays: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Tệp tối đa (MB)">
                  <input
                    className={inputClass}
                    min={1}
                    max={500}
                    type="number"
                    value={settings.maxFileSizeMb}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        maxFileSizeMb: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Quota tổng (MB)">
                  <input
                    className={inputClass}
                    min={100}
                    max={1000000}
                    type="number"
                    value={settings.storageQuotaMb}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        storageQuotaMb: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Loại MIME được phép — mỗi dòng một loại">
                <textarea
                  className={inputClass}
                  rows={4}
                  value={settings.allowedMimeTypes.join("\n")}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      allowedMimeTypes: e.target.value
                        .split("\n")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Tên người gửi thông báo">
                <input
                  className={inputClass}
                  value={settings.notificationSender}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      notificationSender: e.target.value,
                    })
                  }
                />
              </Field>
              <label className="flex min-h-11 items-center justify-between rounded-xl bg-slate-50 p-4 text-sm font-bold">
                <span>Bật kiểm duyệt nội dung</span>
                <input
                  checked={settings.moderationEnabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      moderationEnabled: e.target.checked,
                    })
                  }
                  className="size-5 accent-sky-600"
                  type="checkbox"
                />
              </label>
              <label className="flex min-h-11 items-center justify-between rounded-xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
                <span>Chế độ bảo trì</span>
                <input
                  checked={settings.maintenanceMode}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maintenanceMode: e.target.checked,
                    })
                  }
                  className="size-5 accent-sky-600"
                  type="checkbox"
                />
              </label>
              <Field label="Thời điểm hiệu lực — để trống nếu áp dụng ngay">
                <input
                  className={inputClass}
                  min={new Date().toISOString().slice(0, 16)}
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                />
              </Field>
              <div className="rounded-xl border border-sky-100 bg-sky-50 p-4 text-xs text-sky-900">
                <p className="font-extrabold">
                  Phiên bản đang xem: v{settings.version}
                </p>
                <p className="mt-1">
                  Hiệu lực{" "}
                  {new Date(settings.effectiveAt).toLocaleString("vi-VN")} · cập
                  nhật bởi {settings.updatedBy}
                </p>
              </div>
              <Button loading={saving} type="submit">
                <Save size={16} />
                Phát hành cấu hình
              </Button>
            </form>
          ) : (
            <div className="mt-6 h-80 animate-pulse rounded-xl bg-slate-100" />
          )}
        </section>
        <section className="order-3 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6 xl:col-span-2">
          <h2 className="font-heading text-xl font-extrabold">
            Lịch sử cấu hình
          </h2>
          <div className="mt-4 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">
            {history.length ? history.slice(0, 6).map((item) => (
              <article
                className="py-4"
                key={`${item.version}-${item.effectiveAt}`}
              >
                <div className="flex items-center justify-between">
                  <strong>Phiên bản {item.version}</strong>
                  <span className="text-xs text-sky-700">
                    {new Date(item.effectiveAt) > new Date()
                      ? "Đã lên lịch"
                      : "Đang/đã hiệu lực"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(item.effectiveAt).toLocaleString("vi-VN")} ·{" "}
                  {item.updatedBy}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.timezone} · lưu {item.retentionDays} ngày · quota{" "}
                  {item.storageQuotaMb} MB
                </p>
              </article>
            )) : <p className="empty-copy">Chưa có phiên bản cấu hình trước đó.</p>}
          </div>
        </section>
        <div className="order-2 space-y-7">
          <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
            <div className="flex items-center gap-3">
              <CloudCog className="text-sky-700" />
              <h2 className="font-heading text-xl font-extrabold">
                Tích hợp lớp học
              </h2>
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {integrations.map((item) => (
                <div className="py-4" key={item.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-extrabold">
                        {item.provider.replace("_", " ")}{" "}
                        {item.isDefault ? "· Mặc định" : ""}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.maskedCredential} · {item.healthStatus === "UNKNOWN" ? "Chưa kiểm tra" : item.healthStatus}
                      </p>
                    </div>
                    <button
                      aria-pressed={item.enabled}
                      aria-label={`Bật tắt ${item.provider}`}
                      className={`relative h-11 w-14 rounded-full transition ${item.enabled ? "bg-sky-600" : "bg-slate-200"}`}
                      onClick={() => void toggle(item)}
                    >
                      <span
                        className={`absolute top-3 size-5 rounded-full bg-white shadow transition ${item.enabled ? "left-8" : "left-1"}`}
                      />
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      onClick={() => setConfiguring(item)}
                      variant="ghost"
                    >
                      Cấu hình
                    </Button>
                    <Button
                      onClick={() => void testIntegration(item)}
                      variant="ghost"
                    >
                      Kiểm tra kết nối
                    </Button>
                    {item.enabled && !item.isDefault ? (
                      <Button
                        onClick={() => void setDefault(item)}
                        variant="ghost"
                      >
                        Đặt mặc định
                      </Button>
                    ) : null}
                    {item.isDefault ? (
                      <Button
                        onClick={() => void testMeeting(item)}
                        variant="secondary"
                      >
                        Tạo phòng thử
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DatabaseBackup className="text-sky-700" />
                <h2 className="font-heading text-xl font-extrabold">Sao lưu</h2>
              </div>
              <Button onClick={() => void backup()} variant="secondary">
                Chạy ngay
              </Button>
            </div>
            <div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">
              {backups.slice(0, 4).map((item) => (
                <div
                  className="flex items-center justify-between gap-3 py-4"
                  key={item.id}
                >
                  <div>
                    <p className="text-sm font-bold">
                      {item.type} · {item.sizeMb} MB
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(item.createdAt).toLocaleString("vi-VN")} ·{" "}
                      {item.checksum}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {storage ? (
        <section className="mt-7 border-y border-[#a9bac1] bg-[#fffdfa]/65 p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <HardDrive className="text-sky-700" />
              <div>
                <h2 className="font-heading text-xl font-extrabold">
                  Phân bổ lưu trữ
                </h2>
                <p className="text-xs text-slate-500">
                  {(storage.usedBytes / 1_000_000).toFixed(1)} /{" "}
                  {(storage.quotaBytes / 1_000_000).toFixed(0)} MB đã dùng
                </p>
              </div>
            </div>
            <p className="text-2xl font-extrabold text-sky-700">
              {storage.usagePercent}%
            </p>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${storage.usagePercent >= 90 ? "bg-rose-500" : storage.usagePercent >= 75 ? "bg-amber-500" : "bg-sky-600"}`}
              style={{ width: `${storage.usagePercent}%` }}
            />
          </div>
          <div className="mt-5 divide-y divide-[#d5dfe2] border-y border-[#d5dfe2]">
            {storage.byClass.length ? (
              storage.byClass.map((item) => (
                <div className="py-4" key={item.classId}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-extrabold">
                      {item.classCode} · {item.className}
                    </p>
                    <p className="text-xs font-bold text-sky-700">
                      {(item.usedBytes / 1_000_000).toFixed(1)} MB
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.fileCount} học liệu
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">
                Chưa có học liệu chiếm dung lượng.
              </p>
            )}
          </div>
        </section>
      ) : null}
      <Modal
        open={Boolean(configuring)}
        onClose={() => setConfiguring(null)}
        title={`Cấu hình ${configuring?.provider ?? "provider"}`}
        description="Chỉ lưu tham chiếu tới kho bí mật; credential gốc không được trả lại giao diện hoặc ghi audit."
      >
        <form className="space-y-4" onSubmit={(event) => void configure(event)}>
          {configuring?.provider !== "JITSI" ? (
            <Field label="Credential reference">
              <input
                className={inputClass}
                required
                value={integrationForm.credentialReference}
                onChange={(event) =>
                  setIntegrationForm({
                    ...integrationForm,
                    credentialReference: event.target.value,
                  })
                }
              />
            </Field>
          ) : null}
          <Field label="Webhook HTTPS">
            <input
              className={inputClass}
              placeholder="https://..."
              value={integrationForm.webhookUrl}
              onChange={(event) =>
                setIntegrationForm({
                  ...integrationForm,
                  webhookUrl: event.target.value,
                })
              }
            />
          </Field>
          <Button type="submit">Lưu cấu hình</Button>
        </form>
      </Modal>
    </div>
  );
}
