"use client";

import {
  AiModelGlyph,
  AiModelIdentityBadge,
  AiProviderGlyph,
  resolveAiModelVisual,
  resolveAiProviderVisual,
} from "@/features/settings/ai-model-icons";
import type {
  AiProvider,
  AiProviderType,
  ModelCatalog,
  Settings,
} from "@/features/settings/settings.shared";
import { activeLocale } from "@/i18n/runtime";
import { Button, Field, inputClass, StatusBadge, Tabs } from "@/shared/ui/ui";
import {
  CheckCircle2,
  KeyRound,
  Plus,
  Save,
  Settings2,
  Trash2,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { AiGradingOperations } from "./ai-grading-operations";
import { AiTaskSettings } from "./ai-task-settings";

type AiWorkspaceTab = "providers" | "routing" | "quota" | "operations";

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

/** Không gian quản trị tập trung cho kết nối AI, nhận diện model, quét đề OCR, hạn mức gia sư và đối soát. */
export function AiAdminWorkspace({
  settings,
  setSettings,
  aiProviders,
  modelCatalog,
  saving,
  saveAiTutorQuota,
  openAiEditor,
  testAiProvider,
  removeAiProvider,
}: {
  settings: Settings | null;
  setSettings: (next: Settings) => void;
  aiProviders: AiProvider[];
  modelCatalog: ModelCatalog;
  saving: boolean;
  saveAiTutorQuota: () => Promise<void>;
  openAiEditor: (item?: AiProvider, provider?: AiProviderType) => void;
  testAiProvider: (item: AiProvider) => Promise<void>;
  removeAiProvider: (item: AiProvider) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<AiWorkspaceTab>("providers");

  const enabledProviders = aiProviders.filter((item) => item.enabled);
  const defaultScanner =
    aiProviders.find((item) => item.isDefault && item.enabled) ??
    enabledProviders[0] ??
    null;
  const totalCatalogModels =
    modelCatalog.GEMINI.length +
    modelCatalog.NVIDIA_NIM.length +
    modelCatalog.OPENAI.length;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 md:px-6">
          <div className="max-w-2xl">
            <h2 className="font-heading text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              Trung tâm điều phối AI & Quét đề
            </h2>
            <p className="mt-1 text-xs sm:text-sm leading-6 text-slate-600 dark:text-slate-400">
              API key được mã hóa một chiều và không hiển thị lại trên giao diện. Thiết lập nhà cung cấp, chọn model theo biểu tượng nhận diện và phân luồng riêng cho quét ảnh đề thi, sinh đề, chấm bài cùng gia sư Socratic.
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={() => openAiEditor(undefined, "CUSTOM")}
          >
            <Plus aria-hidden="true" size={16} />
            Thêm custom
          </Button>
        </div>

        <div className="grid border-t border-slate-100 dark:border-slate-800 divide-y sm:divide-y-0 sm:grid-cols-2 lg:grid-cols-4 sm:divide-x divide-slate-100 dark:divide-slate-800">
          <div className="px-5 py-4 md:px-6 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Nhà cung cấp sẵn sàng
            </p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                {enabledProviders.length}/{aiProviders.length || 0} đang bật
              </p>
              <div className="flex items-center -space-x-1">
                {enabledProviders.slice(0, 4).map((item) => (
                  <AiProviderGlyph
                    key={item.id}
                    provider={item.provider}
                    size="xs"
                    className="ring-2 ring-white dark:ring-slate-900"
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="px-5 py-4 md:px-6 space-y-1.5 min-w-0">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Model quét đề mặc định
            </p>
            {defaultScanner ? (
              <div className="min-w-0">
                <AiModelIdentityBadge
                  model={defaultScanner.model}
                  provider={defaultScanner.provider}
                  showTier={false}
                />
              </div>
            ) : (
              <p className="text-sm font-semibold text-slate-400 dark:text-slate-500">
                Chưa đặt mặc định
              </p>
            )}
          </div>

          <div className="px-5 py-4 md:px-6 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Danh mục model nhận diện
            </p>
            <p className="text-base font-extrabold text-sky-700 dark:text-sky-300 tabular-nums">
              {totalCatalogModels} model tích hợp
            </p>
          </div>

          <div className="px-5 py-4 md:px-6 space-y-1.5">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Hạn mức Gia sư AI
            </p>
            <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
              {settings
                ? `${settings.aiTutorMaxPerQuestion} lượt/câu · ${settings.aiTutorMaxPerExam} lượt/đề`
                : "Đang tải…"}
            </p>
          </div>
        </div>
      </section>

      <Tabs<AiWorkspaceTab>
        label="Phân khu quản trị AI và quét đề"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          {
            value: "providers",
            label: "Nhà cung cấp & Model",
            count: aiProviders.length,
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
          {
            value: "operations",
            label: "Đối soát vận hành AI",
          },
        ]}
      />

      {activeTab === "providers" ? (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs">
          <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4 md:px-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-heading text-base font-bold text-slate-900 dark:text-slate-100">
                Danh sách nhà cung cấp & Model mặc định
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Bấm trực tiếp vào một model gợi ý bên dưới từng nhà cung cấp để mở hộp thoại chuyển nhanh model đó.
              </p>
            </div>
          </div>

          {aiProviders.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Chưa có nhà cung cấp AI nào được tải.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Thêm endpoint tùy chỉnh hoặc kiểm tra lại kết nối máy chủ cấu hình.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {aiProviders.map((item) => {
                const providerMeta = resolveAiProviderVisual(item.provider);
                const builtinModels =
                  item.provider === "CUSTOM"
                    ? []
                    : modelCatalog[item.provider] ?? [];

                return (
                  <article
                    key={item.id}
                    className="px-5 py-5 md:px-6 space-y-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/25"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <AiProviderGlyph provider={item.provider} size="lg" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-heading text-base font-bold text-slate-900 dark:text-slate-100">
                              {item.name}
                            </h4>
                            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                              {providerMeta.vendorLabel}
                            </span>
                            {item.isDefault ? (
                              <StatusBadge status="DEFAULT" />
                            ) : null}
                            <StatusBadge status={item.healthStatus} />
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                item.enabled
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                              }`}
                            >
                              <span
                                className={`size-1.5 rounded-full ${
                                  item.enabled ? "bg-emerald-500" : "bg-slate-400"
                                }`}
                              />
                              {item.enabled ? "Đang bật" : "Đang tắt"}
                            </span>
                          </div>

                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {providerMeta.protocolLabel}
                            {item.baseUrl ? ` · ${item.baseUrl}` : ""}
                          </p>

                          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                            <AiModelIdentityBadge
                              model={item.model}
                              provider={item.provider}
                            />
                            <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-mono text-slate-600 dark:text-slate-300">
                              <KeyRound
                                aria-hidden="true"
                                size={12}
                                className="text-slate-400"
                              />
                              <span translate="no">
                                {item.hasApiKey
                                  ? item.maskedApiKey
                                  : "Chưa lưu API key"}
                              </span>
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                              {item.lastCheckedAt
                                ? `Kiểm tra lúc ${new Date(
                                    item.lastCheckedAt,
                                  ).toLocaleString(activeLocale())}`
                                : "Chưa kiểm tra kết nối"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0 lg:justify-end">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => openAiEditor(item)}
                        >
                          <Settings2 aria-hidden="true" size={15} />
                          Cấu hình
                        </Button>
                        {item.hasApiKey ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void testAiProvider(item)}
                          >
                            <Zap aria-hidden="true" size={15} />
                            Kiểm tra
                          </Button>
                        ) : null}
                        {item.provider === "CUSTOM" && item.hasApiKey ? (
                          <Button
                            type="button"
                            aria-label={`Xóa ${item.name}`}
                            variant="ghost"
                            onClick={() => void removeAiProvider(item)}
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {builtinModels.length > 0 ? (
                      <div className="pl-0 lg:pl-14 space-y-2">
                        <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          Các dòng model tiêu biểu ({builtinModels.length} model trong danh mục):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {builtinModels.slice(0, 6).map((modelOption) => {
                            const active = item.model === modelOption.value;
                            const modelMeta = resolveAiModelVisual(
                              modelOption.value,
                              item.provider,
                            );
                            return (
                              <button
                                key={modelOption.value}
                                type="button"
                                onClick={() =>
                                  openAiEditor({
                                    ...item,
                                    model: modelOption.value,
                                  })
                                }
                                title={`${modelOption.label} — ${modelOption.description}`}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                                  active
                                    ? "border-sky-400 bg-sky-50/90 text-sky-900 dark:border-sky-600 dark:bg-sky-950/60 dark:text-sky-200 font-bold"
                                    : "border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-slate-100/80 dark:hover:bg-slate-800"
                                }`}
                              >
                                <AiModelGlyph
                                  model={modelOption.value}
                                  provider={item.provider}
                                  size="xs"
                                />
                                <span>{modelOption.label}</span>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                  · {modelMeta.tierBadge}
                                </span>
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
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
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
            <p className="mt-1 text-xs sm:text-sm leading-6 text-slate-600 dark:text-slate-400">
              Giới hạn số lần học viên được hỏi trợ lý AI dẫn dắt trên từng câu hỏi và tổng thể một đề (chỉ áp dụng cho các đề được giảng viên bật cho phép hỏi đáp AI). Các câu hỏi gợi ý mẫu dùng bộ nhớ đệm chung để tiết kiệm chi phí suy luận.
            </p>
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

      {activeTab === "operations" ? <AiGradingOperations /> : null}
    </div>
  );
}
