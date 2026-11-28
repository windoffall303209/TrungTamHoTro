"use client";

import {
  AiModelGlyph,
  AiModelIdentityBadge,
  AiOfficialProviderLogo,
  resolveAiModelVisual,
  resolveAiProviderVisual,
} from "@/features/settings/ai-model-icons";
import type {
  AiProvider,
  AiProviderType,
  ModelCatalog,
  ModelOption,
  Settings,
} from "@/features/settings/settings.shared";
import { activeLocale } from "@/i18n/runtime";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import { Button, Field, inputClass, StatusBadge, Tabs } from "@/shared/ui/ui";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AiTaskSettings } from "./ai-task-settings";

type AiWorkspaceTab = "providers" | "routing" | "quota";

interface ApiKeyDraftRow {
  rowKey: string;
  slotId?: string;
  label: string;
  maskedKey?: string;
  apiKey: string;
}

const TOP_ROW_PROVIDERS: ReadonlyArray<{
  type: Exclude<AiProviderType, "CUSTOM">;
  title: string;
}> = [
  { type: "GEMINI", title: "Google Gemini" },
  { type: "NVIDIA_NIM", title: "NVIDIA" },
  { type: "OPENAI", title: "OpenAI" },
];

const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderType, string> = {
  GEMINI: "gemini-2.5-flash",
  NVIDIA_NIM: "meta/llama-3.2-11b-vision-instruct",
  OPENAI: "gpt-4o-mini",
  CUSTOM: "",
};

const QUOTA_PRESETS = [
  {
    id: "compact",
    label: "Tiết kiệm",
    perQuestion: 2,
    perExam: 10,
    note: "Phù hợp bài kiểm tra nhanh 10–15 phút.",
  },
  {
    id: "balanced",
    label: "Tiêu chuẩn",
    perQuestion: 3,
    perExam: 15,
    note: "Cân bằng giữa gợi mở tư duy và chi phí token.",
  },
  {
    id: "deep",
    label: "Ôn luyện sâu",
    perQuestion: 5,
    perExam: 30,
    note: "Phù hợp đề tự luận hoặc bài tập rèn luyện ở nhà.",
  },
] as const;

/** Khởi tạo danh sách dòng nhập API key từ cấu hình nhà cung cấp hiện tại. */
function buildInitialKeyDrafts(target: AiProvider | null): ApiKeyDraftRow[] {
  if (target?.apiKeySlots && target.apiKeySlots.length > 0) {
    return target.apiKeySlots.map((slot, index) => ({
      rowKey: `saved-${slot.id}-${index}`,
      slotId: slot.id,
      label: slot.label || `Key ${index + 1}`,
      maskedKey: slot.maskedKey,
      apiKey: "",
    }));
  }
  if (target?.hasApiKey) {
    return [
      {
        rowKey: "saved-legacy-0",
        slotId: "key-1",
        label: "Key 1",
        maskedKey: target.maskedApiKey,
        apiKey: "",
      },
    ];
  }
  return [
    {
      rowKey: "new-0",
      label: "Key 1",
      apiKey: "",
    },
  ];
}

/** Giao diện quản trị AI & Quét đề hiển thị 4 biểu tượng hãng và trang chi tiết đa API key khi bấm chọn. */
export function AiAdminWorkspace({
  settings,
  setSettings,
  aiProviders,
  modelCatalog,
  saving,
  saveAiTutorQuota,
  testAiProvider,
  removeAiProvider,
  reload,
}: {
  settings: Settings | null;
  setSettings: (next: Settings) => void;
  aiProviders: AiProvider[];
  modelCatalog: ModelCatalog;
  saving: boolean;
  saveAiTutorQuota: () => Promise<void>;
  testAiProvider: (item: AiProvider) => Promise<void>;
  removeAiProvider: (item: AiProvider) => Promise<void>;
  reload?: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<AiWorkspaceTab>("providers");
  const [selectedProvider, setSelectedProvider] =
    useState<AiProviderType | null>(null);
  const [selectedCustomId, setSelectedCustomId] = useState<string | "NEW">(
    "NEW",
  );

  const customProviders = useMemo(
    () => aiProviders.filter((item) => item.provider === "CUSTOM"),
    [aiProviders],
  );

  const activeTargetProvider = useMemo<AiProvider | null>(() => {
    if (!selectedProvider) return null;
    if (selectedProvider === "CUSTOM") {
      if (selectedCustomId === "NEW") return null;
      return (
        customProviders.find((item) => item.id === selectedCustomId) ??
        customProviders[0] ??
        null
      );
    }
    return (
      aiProviders.find((item) => item.provider === selectedProvider) ?? null
    );
  }, [aiProviders, customProviders, selectedCustomId, selectedProvider]);

  /** Chọn một trong 4 loại nhà cung cấp để mở giao diện cấu hình chi tiết của hãng đó. */
  const handleSelectProviderTile = (type: AiProviderType) => {
    setSelectedProvider(type);
    if (type === "CUSTOM") {
      setSelectedCustomId(customProviders[0]?.id ?? "NEW");
    }
  };

  return (
    <div className="space-y-5">
      <Tabs<AiWorkspaceTab>
        label="Phân khu quản trị AI và quét đề"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          {
            value: "providers",
            label: "Nhà cung cấp & Model",
          },
          {
            value: "routing",
            label: "Phân công tác vụ & Quét đề",
            count: 6,
          },
          {
            value: "quota",
            label: "Hạn mức hỏi đáp AI",
          },
        ]}
      />

      {activeTab === "providers" ? (
        selectedProvider === null ? (
          <div className="py-4 space-y-5 max-w-3xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {TOP_ROW_PROVIDERS.map(({ type, title }) => {
                const record = aiProviders.find(
                  (item) => item.provider === type,
                );
                const keyCount =
                  record?.apiKeyCount ?? (record?.hasApiKey ? 1 : 0);
                const isReady = Boolean(record?.enabled && record?.hasApiKey);

                return (
                  <button
                    key={type}
                    type="button"
                    aria-label={title}
                    onClick={() => handleSelectProviderTile(type)}
                    className="group relative flex flex-col items-center justify-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-6 py-8 shadow-2xs transition-all duration-150 hover:border-sky-400 dark:hover:border-sky-600 hover:-translate-y-0.5 cursor-pointer"
                  >
                    <span
                      className={`absolute right-3.5 top-3.5 size-2.5 rounded-full ${
                        isReady
                          ? "bg-emerald-500"
                          : record?.hasApiKey
                            ? "bg-amber-400"
                            : "bg-slate-200 dark:bg-slate-700"
                      }`}
                    />
                    <div className="transition-transform duration-150 group-hover:scale-105">
                      <AiOfficialProviderLogo provider={type} pixelSize={68} />
                    </div>
                    <div className="text-center space-y-1">
                      <span className="block font-heading text-base font-bold text-slate-900 dark:text-slate-100">
                        {title}
                      </span>
                      {keyCount > 0 ? (
                        <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                          {keyCount} API key
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-center">
              {(() => {
                const activeCustomCount = customProviders.filter(
                  (item) => item.enabled && item.hasApiKey,
                ).length;
                return (
                  <button
                    type="button"
                    aria-label="Custom"
                    onClick={() => handleSelectProviderTile("CUSTOM")}
                    className="group relative w-full sm:w-[calc((100%-2.5rem)/3)] flex flex-col items-center justify-center gap-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-6 py-8 shadow-2xs transition-all duration-150 hover:border-sky-400 dark:hover:border-sky-600 hover:-translate-y-0.5 cursor-pointer"
                  >
                    <span
                      className={`absolute right-3.5 top-3.5 size-2.5 rounded-full ${
                        activeCustomCount > 0
                          ? "bg-emerald-500"
                          : customProviders.length > 0
                            ? "bg-amber-400"
                            : "bg-slate-200 dark:bg-slate-700"
                      }`}
                    />
                    <div className="transition-transform duration-150 group-hover:scale-105">
                      <AiOfficialProviderLogo
                        provider="CUSTOM"
                        pixelSize={68}
                      />
                    </div>
                    <div className="text-center space-y-1">
                      <span className="block font-heading text-base font-bold text-slate-900 dark:text-slate-100">
                        Custom
                      </span>
                      {customProviders.length > 0 ? (
                        <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
                          {customProviders.length} cấu hình
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })()}
            </div>
          </div>
        ) : (
          <ProviderDetailStudio
            key={`${selectedProvider}:${activeTargetProvider?.id ?? "new"}:${activeTargetProvider?.updatedAt ?? "0"}`}
            providerType={selectedProvider}
            target={activeTargetProvider}
            customProviders={customProviders}
            selectedCustomId={selectedCustomId}
            onSelectCustomId={setSelectedCustomId}
            catalogModels={
              selectedProvider === "CUSTOM"
                ? []
                : modelCatalog[selectedProvider] ?? []
            }
            onBack={() => setSelectedProvider(null)}
            onTest={testAiProvider}
            onRemove={async (item) => {
              await removeAiProvider(item);
              const remaining = customProviders.filter(
                (entry) => entry.id !== item.id,
              );
              setSelectedCustomId(remaining[0]?.id ?? "NEW");
            }}
            onSaved={async (savedId) => {
              await reload?.();
              if (selectedProvider === "CUSTOM" && savedId) {
                setSelectedCustomId(savedId);
              }
            }}
          />
        )
      ) : null}

      {activeTab === "routing" ? (
        <AiTaskSettings providers={aiProviders} catalog={modelCatalog} />
      ) : null}

      {activeTab === "quota" ? (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 md:p-6 shadow-2xs space-y-6">
          <div className="max-w-2xl">
            <h3 className="font-heading text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
              Hạn mức hỏi đáp AI khi làm bài
            </h3>
          </div>

          {settings ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Mức thiết lập nhanh
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {QUOTA_PRESETS.map((preset) => {
                    const selected =
                      settings.aiTutorMaxPerQuestion === preset.perQuestion &&
                      settings.aiTutorMaxPerExam === preset.perExam;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setSettings({
                            ...settings,
                            aiTutorMaxPerQuestion: preset.perQuestion,
                            aiTutorMaxPerExam: preset.perExam,
                          })
                        }
                        className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer ${
                          selected
                            ? "border-sky-500 bg-sky-50/80 dark:bg-sky-950/40 ring-2 ring-sky-500/15"
                            : "border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 hover:border-sky-300 dark:hover:border-sky-700"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {preset.label}
                          </span>
                          <span className="rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300 tabular-nums">
                            {preset.perQuestion} / {preset.perExam} lượt
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {preset.note}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 max-w-2xl">
                <Field label="Số lượt hỏi tối đa / 1 câu (1–20)">
                  <input
                    aria-label="Số lượt hỏi tối đa mỗi câu"
                    className={inputClass}
                    min={1}
                    max={20}
                    type="number"
                    value={settings.aiTutorMaxPerQuestion}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        aiTutorMaxPerQuestion: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <Field label="Số lượt hỏi tối đa / 1 đề (1–200)">
                  <input
                    aria-label="Số lượt hỏi tối đa mỗi đề"
                    className={inputClass}
                    min={1}
                    max={200}
                    type="number"
                    value={settings.aiTutorMaxPerExam}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        aiTutorMaxPerExam: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Tỷ lệ phân bổ hiện tại: tối đa{" "}
                  <strong className="text-slate-800 dark:text-slate-200">
                    {Math.max(
                      1,
                      Math.floor(
                        (settings.aiTutorMaxPerExam || 1) /
                          Math.max(1, settings.aiTutorMaxPerQuestion || 1),
                      ),
                    )}{" "}
                    câu hỏi
                  </strong>{" "}
                  trong đề có thể dùng kịch trần hạn mức riêng.
                </p>
                <Button
                  disabled={saving}
                  loading={saving}
                  onClick={() => void saveAiTutorQuota()}
                  type="button"
                >
                  <Save aria-hidden="true" size={15} />
                  Lưu hạn mức hỏi đáp
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-36 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
          )}
        </section>
      ) : null}
    </div>
  );
}

/** Màn hình chi tiết của từng nhà cung cấp: quản lý nhiều API key, chọn model có icon và kiểm tra kết nối. */
function ProviderDetailStudio({
  providerType,
  target,
  customProviders,
  selectedCustomId,
  onSelectCustomId,
  catalogModels,
  onBack,
  onTest,
  onRemove,
  onSaved,
}: {
  providerType: AiProviderType;
  target: AiProvider | null;
  customProviders: AiProvider[];
  selectedCustomId: string | "NEW";
  onSelectCustomId: (id: string | "NEW") => void;
  catalogModels: ModelOption[];
  onBack: () => void;
  onTest: (item: AiProvider) => Promise<void>;
  onRemove: (item: AiProvider) => Promise<void>;
  onSaved: (savedId?: string) => Promise<void>;
}) {
  const { session, notify } = useApp();
  const providerMeta = resolveAiProviderVisual(providerType);

  const [name, setName] = useState(
    providerType === "CUSTOM" ? target?.name ?? "" : providerMeta.shortLabel,
  );
  const [baseUrl, setBaseUrl] = useState(target?.baseUrl ?? "");
  const [model, setModel] = useState(
    target?.model ?? DEFAULT_MODEL_BY_PROVIDER[providerType],
  );
  const [enabled, setEnabled] = useState(target?.enabled ?? true);
  const [isDefault, setIsDefault] = useState(target?.isDefault ?? false);
  const [keyDrafts, setKeyDrafts] = useState<ApiKeyDraftRow[]>(() =>
    buildInitialKeyDrafts(target),
  );
  const [discoveredModels, setDiscoveredModels] = useState<ModelOption[]>([]);
  const [modelMode, setModelMode] = useState<"catalog" | "manual">(
    providerType === "CUSTOM" ? "manual" : "catalog",
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  const availableModels = useMemo(() => {
    const base = discoveredModels.length ? discoveredModels : catalogModels;
    if (!model || base.some((entry) => entry.value === model)) return base;
    return [
      {
        value: model,
        label: model,
        description: "Model đang được cấu hình.",
      },
      ...base,
    ];
  }, [catalogModels, discoveredModels, model]);

  /** Thêm một dòng nhập API key mới vào danh sách khóa của nhà cung cấp hiện tại. */
  const addKeyRow = () => {
    if (keyDrafts.length >= 20) {
      notify("Mỗi nhà cung cấp hỗ trợ tối đa 20 API key.", "info");
      return;
    }
    setKeyDrafts((prev) => [
      ...prev,
      {
        rowKey: `new-${Date.now()}-${prev.length}`,
        label: `Key ${prev.length + 1}`,
        apiKey: "",
      },
    ]);
  };

  /** Xóa một dòng API key khỏi danh sách hoặc làm trắng nếu chỉ còn một dòng duy nhất. */
  const removeKeyRow = (rowKey: string) => {
    setKeyDrafts((prev) => {
      if (prev.length <= 1) {
        return [{ rowKey: `new-${Date.now()}`, label: "Key 1", apiKey: "" }];
      }
      return prev.filter((item) => item.rowKey !== rowKey);
    });
  };

  /** Tải danh sách model khả dụng trực tiếp từ tài khoản nhà cung cấp bằng API key đã lưu. */
  const handleDiscoverModels = async () => {
    if (!target?.id || !target.hasApiKey) {
      notify("Hãy lưu ít nhất một API key trước khi tải danh sách model.", "info");
      return;
    }
    setLoadingModels(true);
    try {
      const list = await apiRequest<ModelOption[]>(
        `/system/ai-providers/${target.id}/models`,
        { roleCode: session.roleCode },
      );
      setDiscoveredModels(list);
      setModelMode("catalog");
      notify(`Đã tải ${list.length} model từ ${target.name}.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Không tải được danh sách model từ nhà cung cấp.",
        "error",
      );
    } finally {
      setLoadingModels(false);
    }
  };

  /** Kiểm tra hợp lệ và gửi danh sách nhiều API key cùng model lên máy chủ để mã hóa lưu trữ. */
  const handleSaveProvider = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!model.trim()) {
      notify("Vui lòng chọn hoặc nhập tên model mặc định.", "error");
      return;
    }
    const preparedKeys = keyDrafts
      .map((row, idx) => ({
        id: row.slotId,
        label: row.label.trim() || `Key ${idx + 1}`,
        apiKey: row.apiKey.trim() || undefined,
        hasStored: Boolean(row.slotId && row.maskedKey),
      }))
      .filter((row) => Boolean(row.apiKey) || row.hasStored);

    if (preparedKeys.length === 0) {
      notify("Cần nhập ít nhất một API key cho nhà cung cấp này.", "error");
      return;
    }
    const invalidNewKey = preparedKeys.find(
      (row) => row.apiKey !== undefined && row.apiKey.length < 8,
    );
    if (invalidNewKey) {
      notify("Mỗi API key mới phải có tối thiểu 8 ký tự.", "error");
      return;
    }

    setSaving(true);
    try {
      const saved = await apiRequest<AiProvider>("/system/ai-providers", {
        method: "POST",
        roleCode: session.roleCode,
        body: JSON.stringify({
          id: target?.id && target.hasApiKey ? target.id : undefined,
          provider: providerType,
          name: providerType === "CUSTOM" ? name.trim() : undefined,
          baseUrl: providerType === "CUSTOM" ? baseUrl.trim() : undefined,
          model: model.trim(),
          enabled,
          isDefault,
          apiKeys: preparedKeys.map(({ id, label, apiKey }) => ({
            id,
            label,
            apiKey,
          })),
        }),
      });
      notify(
        `Đã lưu ${saved.name} (${saved.apiKeyCount ?? preparedKeys.length} API key đã mã hóa).`,
      );
      setKeyDrafts(buildInitialKeyDrafts(saved));
      await onSaved(saved.id);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Không lưu được cấu hình AI.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            aria-label="Quay lại danh sách nhà cung cấp"
            onClick={onBack}
            className="inline-grid size-9 shrink-0 place-items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 transition-colors hover:border-sky-300 dark:hover:border-sky-700 hover:bg-slate-100/80 dark:hover:bg-slate-800 hover:text-sky-700 dark:hover:text-sky-300 cursor-pointer"
          >
            <ArrowLeft aria-hidden="true" size={18} />
          </button>
          <AiOfficialProviderLogo provider={providerType} pixelSize={38} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                {providerType === "CUSTOM"
                  ? target?.name || "Custom Endpoint"
                  : providerMeta.shortLabel}
              </h3>
              {target?.isDefault ? <StatusBadge status="DEFAULT" /> : null}
              {target?.hasApiKey ? (
                <StatusBadge status={target.healthStatus} />
              ) : null}
            </div>
            {target?.lastCheckedAt ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                Kiểm tra lúc{" "}
                {new Date(target.lastCheckedAt).toLocaleString(activeLocale())}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {target?.hasApiKey ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onTest(target)}
            >
              <Zap aria-hidden="true" size={15} />
              Kiểm tra kết nối
            </Button>
          ) : null}
          {providerType === "CUSTOM" && target?.hasApiKey ? (
            <Button
              type="button"
              variant="ghost"
              aria-label={`Xóa ${target.name}`}
              onClick={() => void onRemove(target)}
            >
              <Trash2 aria-hidden="true" size={16} />
            </Button>
          ) : null}
        </div>
      </div>

      {providerType === "CUSTOM" ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 px-5 py-3 md:px-6">
          {customProviders.map((entry) => {
            const active = target?.id === entry.id && selectedCustomId !== "NEW";
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectCustomId(entry.id)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? "border-sky-500 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/60 dark:text-sky-200"
                    : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-300"
                }`}
              >
                <span>{entry.name}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  ({entry.apiKeyCount ?? (entry.hasApiKey ? 1 : 0)} key)
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onSelectCustomId("NEW")}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
              selectedCustomId === "NEW"
                ? "border-sky-500 bg-sky-50 text-sky-800 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-300"
                : "border-slate-300 dark:border-slate-700 text-sky-700 dark:text-sky-400 hover:border-sky-400"
            }`}
          >
            <Plus aria-hidden="true" size={14} />
            Thêm endpoint Custom
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(event) => void handleSaveProvider(event)}
        className="p-5 md:p-6 space-y-6"
      >
        {providerType === "CUSTOM" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tên hiển thị">
              <input
                className={inputClass}
                maxLength={100}
                placeholder="VD: vLLM Nội bộ / OpenRouter"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Endpoint Chat Completions">
              <input
                className={inputClass}
                type="url"
                placeholder="https://ai.example.com/v1/chat/completions"
                required
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Model mặc định
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {availableModels.length > 0 || modelMode === "manual" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2.5 text-xs"
                  onClick={() =>
                    setModelMode((prev) =>
                      prev === "catalog" ? "manual" : "catalog",
                    )
                  }
                >
                  {modelMode === "catalog"
                    ? "Nhập thủ công"
                    : "Chọn từ danh sách"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="min-h-8 px-3 text-xs"
                disabled={!target?.hasApiKey}
                loading={loadingModels}
                onClick={() => void handleDiscoverModels()}
              >
                <RefreshCw aria-hidden="true" size={13} />
                {discoveredModels.length
                  ? "Tải lại model"
                  : "Tải model từ tài khoản"}
              </Button>
            </div>
          </div>

          {modelMode === "catalog" && availableModels.length > 0 ? (
            <SearchableSelect
              aria-label={`Tìm model ${providerType}`}
              value={model}
              onChange={setModel}
              placeholder="Gõ tên model để tìm…"
              options={availableModels.map((entry) => {
                const modelMeta = resolveAiModelVisual(
                  entry.value,
                  providerType,
                );
                return {
                  value: entry.value,
                  label: entry.label,
                  badge: modelMeta.tierBadge,
                  description: entry.description || modelMeta.capabilityLabel,
                  keywords: `${entry.value} ${entry.label} ${modelMeta.familyLabel}`,
                  icon: (
                    <AiModelGlyph
                      model={entry.value}
                      provider={providerType}
                      size="xs"
                    />
                  ),
                };
              })}
            />
          ) : (
            <div className="space-y-2">
              <input
                aria-label={`Nhập model ${providerType}`}
                className={inputClass}
                maxLength={200}
                placeholder="org/model-name"
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
              {model.trim() ? (
                <AiModelIdentityBadge model={model} provider={providerType} />
              ) : null}
            </div>
          )}

          {catalogModels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {catalogModels.slice(0, 6).map((item) => {
                const active = model === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setModel(item.value)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                      active
                        ? "border-sky-400 bg-sky-50/90 text-sky-900 dark:border-sky-600 dark:bg-sky-950/60 dark:text-sky-200 font-bold"
                        : "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-slate-100/80 dark:hover:bg-slate-800"
                    }`}
                  >
                    <AiModelGlyph
                      model={item.value}
                      provider={providerType}
                      size="xs"
                    />
                    <span>{item.label}</span>
                    {active ? (
                      <CheckCircle2
                        aria-hidden="true"
                        size={13}
                        className="text-sky-600 dark:text-sky-400"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Danh sách API key ({keyDrafts.length})
              </span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                Điền nhiều API key để tự động xoay vòng phân tải và chuyển dự phòng khi một key hết hạn mức (429).
              </span>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="min-h-9 px-3 text-xs"
              onClick={addKeyRow}
            >
              <Plus aria-hidden="true" size={14} />
              Thêm API key
            </Button>
          </div>

          <div className="space-y-2.5">
            {keyDrafts.map((row, index) => (
              <div
                key={row.rowKey}
                className="grid gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30 p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-center"
              >
                <input
                  type="text"
                  aria-label={`Nhãn API key ${index + 1}`}
                  maxLength={80}
                  value={row.label}
                  onChange={(event) =>
                    setKeyDrafts((prev) =>
                      prev.map((entry) =>
                        entry.rowKey === row.rowKey
                          ? { ...entry, label: event.target.value }
                          : entry,
                      ),
                    )
                  }
                  placeholder={`Key ${index + 1}`}
                  className={inputClass}
                />

                <div className="relative min-w-0">
                  <KeyRound
                    aria-hidden="true"
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    aria-label={`Giá trị API key ${index + 1}`}
                    value={row.apiKey}
                    onChange={(event) =>
                      setKeyDrafts((prev) =>
                        prev.map((entry) =>
                          entry.rowKey === row.rowKey
                            ? { ...entry, apiKey: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    placeholder={
                      row.maskedKey
                        ? `Đang lưu ${row.maskedKey} (để trống nếu giữ nguyên)`
                        : "Nhập khóa bí mật (tối thiểu 8 ký tự)"
                    }
                    className={`${inputClass} pl-9`}
                  />
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Xóa dòng API key ${index + 1}`}
                  onClick={() => removeKeyRow(row.rowKey)}
                  className="justify-self-end"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 border-t border-slate-100 dark:border-slate-800 pt-5">
          <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 accent-sky-600"
            />
            <span>Bật cấu hình này</span>
          </label>
          <label className="flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-3.5 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(event) => setIsDefault(event.target.checked)}
              className="size-4 accent-sky-600"
            />
            <span>Dùng mặc định khi quét</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <Button type="button" variant="secondary" onClick={onBack}>
            Đóng chi tiết
          </Button>
          <Button type="submit" loading={saving}>
            <Save aria-hidden="true" size={16} />
            Lưu cấu hình
          </Button>
        </div>
      </form>
    </section>
  );
}
