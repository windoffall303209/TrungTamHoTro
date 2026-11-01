"use client";
import { hasPermission } from "@/lib/access-control";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AiProvider,
  AiProviderType,
  Backup,
  Health,
  Integration,
  ModelCatalog,
  ModelOption,
  Settings,
  StorageOverview,
} from "./settings.shared";

/** Quản lý trạng thái, tải dữ liệu và hành động của màn hình cấu hình hệ thống; giữ nguyên thứ tự hook. */
export function useSettingsModel() {
  const { session, notify } = useApp();

  const router = useRouter();

  const searchParams = useSearchParams();

  const canConfigure =
    session.roleCode === "SYSTEM_ADMIN" &&
    hasPermission(session, "system:configure");

  const [settings, setSettings] = useState<Settings | null>(null);

  const [history, setHistory] = useState<Settings[]>([]);

  const [effectiveAt, setEffectiveAt] = useState("");

  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const [backups, setBackups] = useState<Backup[]>([]);

  const [health, setHealth] = useState<Health | null>(null);

  const [storage, setStorage] = useState<StorageOverview | null>(null);

  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);

  const [modelCatalog, setModelCatalog] = useState<ModelCatalog>({
    GEMINI: [],
    NVIDIA_NIM: [],
    OPENAI: [],
  });

  const [editingAi, setEditingAi] = useState<AiProvider | null>(null);

  const [aiEditorOpen, setAiEditorOpen] = useState(false);

  const [aiForm, setAiForm] = useState({
    provider: "GEMINI" as AiProviderType,
    name: "",
    model: "gemini-3.8-flash",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    isDefault: false,
  });

  const [discoveredModels, setDiscoveredModels] = useState<ModelOption[]>([]);

  const [modelMode, setModelMode] = useState<"catalog" | "manual">("catalog");

  const [loadingModels, setLoadingModels] = useState(false);

  const [saving, setSaving] = useState(false);

  const [configuring, setConfiguring] = useState<Integration | null>(null);

  const [integrationForm, setIntegrationForm] = useState({
    credentialReference: "",
    webhookUrl: "",
  });
  const loadRequestId = useRef(0);
  const modelRequestId = useRef(0);

  useEffect(() => () => {
    modelRequestId.current += 1;
  }, [aiEditorOpen, editingAi?.id]);

  /** Nạp cấu hình hệ thống, tích hợp và nhà cung cấp AI theo quyền quản trị. */
  const load = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    if (!canConfigure) return;
    try {
      const [a, b, c, d, e, f, g, h] = await Promise.all([
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
        apiRequest<AiProvider[]>("/system/ai-providers", {
          roleCode: session.roleCode,
        }),
        apiRequest<ModelCatalog>("/system/ai-providers/catalog", {
          roleCode: session.roleCode,
        }),
      ]);
      if (requestId !== loadRequestId.current) return;
      setSettings(a);
      setIntegrations(b);
      setBackups(c);
      setHealth(d);
      setStorage(e);
      setHistory(f);
      setAiProviders(g);
      setModelCatalog(h);
    } catch (error) {
      if (requestId === loadRequestId.current) {
        notify(
          error instanceof Error ? error.message : "Không tải được cấu hình.",
          "error",
        );
      }
    }
  }, [canConfigure, notify, session.roleCode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadRequestId.current += 1;
    };
  }, [load]);

  /** Lưu quy định vận hành chung sau khi chuẩn hóa các trường danh sách và giới hạn. */
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
            notificationSender: settings.notificationSender,
            maintenanceMode: settings.maintenanceMode,
            learnerEmailNotificationsEnabled:
              settings.learnerEmailNotificationsEnabled,
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

  /** Bật/tắt một tích hợp hiện có và tải lại trạng thái thực từ API. */
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

  /** Lưu thông tin kết nối; bí mật chỉ được gửi khi người dùng nhập giá trị mới. */
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

  /** Yêu cầu máy chủ kiểm tra kết nối tích hợp mà không thay đổi cấu hình. */
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

  /** Đặt tích hợp làm lựa chọn mặc định duy nhất cho loại dịch vụ tương ứng. */
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

  /** Tạo cuộc họp thử để xác minh cả xác thực và quyền của nhà cung cấp. */
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

  /** Khởi chạy sao lưu thủ công và hiển thị kết quả cho quản trị viên. */
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

  /** Bật hoặc tắt việc gửi thông báo qua email tới học viên qua Resend. */
  const saveLearnerEmailNotifications = async (enabled: boolean) => {
    if (!settings || settings.learnerEmailNotificationsEnabled === enabled) return;
    setSaving(true);
    try {
      const updated = await apiRequest<Settings>("/system/settings", {
        method: "PATCH",
        roleCode: session.roleCode,
        body: JSON.stringify({ learnerEmailNotificationsEnabled: enabled }),
      });
      setSettings(updated);
      notify(
        enabled
          ? "Đã bật gửi thông báo qua email cho học viên."
          : "Đã tắt gửi thông báo qua email cho học viên.",
      );
      await load();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không đổi được cài đặt thông báo email.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Mở editor với cấu hình đã che bí mật hoặc mẫu mặc định của nhà cung cấp mới. */
  const openAiEditor = (
    item?: AiProvider,
    provider: AiProviderType = "CUSTOM",
  ) => {
    modelRequestId.current += 1;
    setLoadingModels(false);
    const target = item ?? null;
    setEditingAi(target);
    setAiEditorOpen(true);
    setDiscoveredModels([]);
    setModelMode(
      (target?.provider ?? provider) === "CUSTOM" ? "manual" : "catalog",
    );
    setAiForm({
      provider: target?.provider ?? provider,
      name: target?.provider === "CUSTOM" ? target.name : "",
      model:
        target?.model ??
        (provider === "GEMINI"
          ? "gemini-3.8-flash"
          : provider === "NVIDIA_NIM"
            ? "meta/muse-glimmer-30b"
            : provider === "OPENAI"
              ? "gpt-5.6-terra"
              : ""),
      baseUrl: target?.baseUrl ?? "",
      apiKey: "",
      enabled: target?.enabled ?? true,
      isDefault: target?.isDefault ?? false,
    });
  };

  /** Tải danh sách model mà API key hiện tại nhìn thấy và không tự thay lựa chọn của quản trị viên. */
  const loadProviderModels = async () => {
    const requestId = ++modelRequestId.current;
    if (!editingAi?.id) {
      notify(
        "Hãy lưu cấu hình và API key trước khi tải danh sách model.",
        "info",
      );
      return;
    }
    setLoadingModels(true);
    try {
      const models = await apiRequest<ModelOption[]>(
        `/system/ai-providers/${editingAi.id}/models`,
        { roleCode: session.roleCode },
      );
      if (requestId !== modelRequestId.current) return;
      setDiscoveredModels(models);
      setModelMode("catalog");
      notify(`Đã tải ${models.length} model từ ${editingAi.name}.`);
    } catch (error) {
      if (requestId === modelRequestId.current) {
        notify(
          error instanceof Error
            ? error.message
            : "Không tải được danh sách model từ nhà cung cấp.",
          "error",
        );
      }
    } finally {
      if (requestId === modelRequestId.current) setLoadingModels(false);
    }
  };

  /** Kết hợp kết quả live hoặc gợi ý tích hợp và giữ model hiện tại để tránh thay đổi cấu hình âm thầm. */
  const availableModelOptions = useMemo(() => {
    const source = discoveredModels.length
      ? discoveredModels
      : aiForm.provider === "CUSTOM"
        ? []
        : modelCatalog[aiForm.provider];
    if (!aiForm.model || source.some((model) => model.value === aiForm.model))
      return source;
    return [
      {
        value: aiForm.model,
        label: aiForm.model,
        description: "Model đang được cấu hình; hãy kiểm tra lại khả dụng.",
      },
      ...source,
    ];
  }, [aiForm.model, aiForm.provider, discoveredModels, modelCatalog]);

  /** Lưu nhà cung cấp AI và chỉ thay API key khi quản trị viên nhập khóa mới. */
  const saveAiProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/system/ai-providers", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          id: editingAi?.id,
          ...aiForm,
          apiKey: aiForm.apiKey || undefined,
        }),
      });
      notify("Đã lưu cấu hình AI. Khóa bí mật đã được mã hóa.");
      setAiEditorOpen(false);
      setEditingAi(null);
      setAiForm((current) => ({ ...current, apiKey: "" }));
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được cấu hình AI.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  /** Gọi phép thử ngắn để xác nhận endpoint, model và khóa AI hoạt động. */
  const testAiProvider = async (item: AiProvider) => {
    try {
      await apiRequest(`/system/ai-providers/${item.id}/test`, {
        method: "POST",
        roleCode: session.roleCode,
      });
      notify(`Kết nối ${item.name} hoạt động.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Kiểm tra kết nối AI thất bại.",
        "error",
      );
    } finally {
      await load();
    }
  };

  /** Xóa cấu hình nhà cung cấp AI sau xác nhận và làm mới danh sách. */
  const removeAiProvider = async (item: AiProvider) => {
    try {
      await apiRequest(`/system/ai-providers/${item.id}`, {
        method: "DELETE",
        roleCode: session.roleCode,
      });
      notify(`Đã xóa cấu hình ${item.name}.`);
      await load();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không xóa được cấu hình AI.",
        "error",
      );
    }
  };
  return {
    router,
    searchParams,
    canConfigure,
    settings,
    setSettings,
    history,
    effectiveAt,
    setEffectiveAt,
    integrations,
    backups,
    health,
    storage,
    aiProviders,
    modelCatalog,
    editingAi,
    setEditingAi,
    aiEditorOpen,
    setAiEditorOpen,
    aiForm,
    setAiForm,
    discoveredModels,
    modelMode,
    setModelMode,
    loadingModels,
    saving,
    configuring,
    setConfiguring,
    integrationForm,
    setIntegrationForm,
    save,
    toggle,
    configure,
    testIntegration,
    setDefault,
    testMeeting,
    backup,
    saveLearnerEmailNotifications,
    openAiEditor,
    loadProviderModels,
    availableModelOptions,
    saveAiProvider,
    testAiProvider,
    removeAiProvider,
  };
}
