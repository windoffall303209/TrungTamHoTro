"use client";

import {
  AiModelGlyph,
  AiModelIdentityBadge,
  AiProviderGlyph,
  resolveAiModelVisual,
  resolveAiProviderVisual,
} from "@/features/settings/ai-model-icons";
import { apiRequest } from "@/lib/api-client";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { SearchableSelect } from "@/shared/ui/searchable-select";
import { Button, inputClass } from "@/shared/ui/ui";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  FileSearch,
  GraduationCap,
  Save,
  ScanLine,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

type Task =
  | "SCAN_IMAGE"
  | "GENERATE_EXAM"
  | "DOCUMENT_CONTEXT"
  | "DOCUMENT_QA"
  | "GRADING_ASSIST"
  | "TUTOR_ASSIST";

type Selection = { providerId: string; model: string; contextProviderId?: string };

type Provider = {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  hasApiKey: boolean;
  model: string;
};

type Model = { value: string; label: string; description: string };

interface TaskDefinition {
  task: Task;
  label: string;
  scopeBadge: string;
  description: string;
  icon: typeof ScanLine;
}

const EXAM_AND_TUTOR_TASKS: ReadonlyArray<TaskDefinition> = [
  {
    task: "SCAN_IMAGE",
    label: "Quét ảnh câu hỏi",
    scopeBadge: "OCR & Đối chiếu đề",
    description:
      "Đọc ảnh chụp đề thi đa tệp, bóc tách câu hỏi, phương án, công thức toán và nhận diện bảng đáp án cuối đề.",
    icon: ScanLine,
  },
  {
    task: "GENERATE_EXAM",
    label: "Sinh đề thi",
    scopeBadge: "Tạo đề tự động",
    description:
      "Khởi tạo bộ câu hỏi trắc nghiệm hoặc tự luận bám sát học liệu lớp học và cấu trúc mức độ khó.",
    icon: Sparkles,
  },
  {
    task: "TUTOR_ASSIST",
    label: "Gia sư dẫn dắt bài tập",
    scopeBadge: "Hỏi đáp Socratic",
    description:
      "Dẫn dắt tư duy từng bước theo câu hỏi trong đề được giảng viên bật hỏi đáp AI, không tiết lộ đáp án đúng. Nếu để trống sẽ kế thừa model Hỏi đáp tài liệu hoặc provider mặc định.",
    icon: GraduationCap,
  },
];

const DOCUMENT_AND_GRADING_TASKS: ReadonlyArray<TaskDefinition> = [
  {
    task: "DOCUMENT_CONTEXT",
    label: "Trích xuất tài liệu",
    scopeBadge: "Chỉ hỗ trợ Gemini",
    description:
      "Trích xuất văn bản, cấu trúc trang và hình minh họa từ tệp PDF hoặc ảnh chụp học liệu của lớp.",
    icon: FileSearch,
  },
  {
    task: "DOCUMENT_QA",
    label: "Hỏi đáp tài liệu",
    scopeBadge: "Trợ lý học liệu",
    description:
      "Trả lời câu hỏi chuyên môn của giảng viên và học viên dựa trên ngữ cảnh trích dẫn từ kho học liệu.",
    icon: BookOpen,
  },
  {
    task: "GRADING_ASSIST",
    label: "Gợi ý chấm bài",
    scopeBadge: "Chấm theo Rubric",
    description:
      "AI đề xuất điểm và phản hồi theo rubric từ văn bản, TXT, DOCX, PDF và ảnh. DOCX được đọc cục bộ; PDF/ảnh dùng model Trích xuất tài liệu. Giảng viên phải kiểm tra bản trích xuất và gợi ý trước khi lưu điểm. Word DOC cũ chưa được hỗ trợ.",
    icon: ClipboardCheck,
  },
];

const ALL_TASKS: ReadonlyArray<TaskDefinition> = [
  ...EXAM_AND_TUTOR_TASKS,
  ...DOCUMENT_AND_GRADING_TASKS,
];

/** Lọc danh sách nhà cung cấp hợp lệ được phép gán cho từng tác vụ nghiệp vụ. */
function filterEligibleProviders(providers: Provider[], task: Task): Provider[] {
  return providers.filter(
    (item) =>
      item.enabled &&
      item.hasApiKey &&
      (task === "DOCUMENT_CONTEXT"
        ? item.provider === "GEMINI"
        : task === "SCAN_IMAGE" ||
          task === "DOCUMENT_QA" ||
          task === "GRADING_ASSIST" ||
          task === "TUTOR_ASSIST" ||
          ["GEMINI", "OPENAI", "CUSTOM"].includes(item.provider)),
  );
}

/** Hiển thị ma trận phân công model AI độc lập cho từng chức năng toàn hệ thống. */
export function AiTaskSettings({
  providers,
  catalog,
}: {
  providers: Provider[];
  catalog: Record<string, Model[]>;
}) {
  const { session, notify } = useApp();
  const [saved, setSaved] = useState<Partial<Record<Task, Selection>> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void apiRequest<Partial<Record<Task, Selection>>>("/system/ai-tasks", {
      roleCode: session.roleCode,
    })
      .then((value) => {
        if (!cancelled) setSaved(value);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Không tải được cấu hình AI.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.roleCode]);

  const configuredCount = saved
    ? ALL_TASKS.filter(
        (item) =>
          Boolean(saved[item.task]?.providerId) &&
          Boolean(saved[item.task]?.model?.trim()),
      ).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 md:p-6 shadow-2xs">
        <div className="max-w-2xl">
          <h3 className="font-heading text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
            AI theo chức năng
          </h3>
          <p className="mt-1 text-xs sm:text-sm leading-6 text-slate-600 dark:text-slate-400">
            Áp dụng cho toàn hệ thống. Giảng viên không chọn hoặc thay đổi model. Mỗi nghiệp vụ được ghim độc lập tới một nhà cung cấp và model chuyên biệt.
          </p>
        </div>
        {saved ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 dark:border-sky-800/70 bg-sky-50/80 dark:bg-sky-950/50 px-3.5 py-1.5 text-xs font-bold text-sky-800 dark:text-sky-300">
            <span className="size-2 rounded-full bg-sky-600 dark:bg-sky-400" />
            <span className="tabular-nums">
              Đã định tuyến {configuredCount}/{ALL_TASKS.length} tác vụ
            </span>
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-medium text-rose-800 dark:text-rose-300"
        >
          {error}
        </div>
      ) : !saved ? (
        <div
          role="status"
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-6 text-sm text-slate-500 dark:text-slate-400"
        >
          Đang tải cấu hình…
        </div>
      ) : (
        <div className="space-y-6">
          <TaskGroupSection
            title="Khảo thí, Quét đề & Gia sư dẫn dắt"
            subtitle="Các luồng xử lý trực tiếp đề kiểm tra, nhận diện ảnh đề thi và trợ giảng Socratic trong phòng thi."
            tasks={EXAM_AND_TUTOR_TASKS}
            saved={saved}
            onSaved={(task, nextSelection) =>
              setSaved((current) => ({ ...(current ?? {}), [task]: nextSelection }))
            }
            providers={providers}
            catalog={catalog}
            roleCode={session.roleCode}
            notify={notify}
          />
          <TaskGroupSection
            title="Học liệu số & Hỗ trợ chấm bài"
            subtitle="Các luồng đọc hiểu tài liệu PDF/ảnh, trả lời trích dẫn học liệu và chấm nhận xét theo rubric."
            tasks={DOCUMENT_AND_GRADING_TASKS}
            saved={saved}
            onSaved={(task, nextSelection) =>
              setSaved((current) => ({ ...(current ?? {}), [task]: nextSelection }))
            }
            providers={providers}
            catalog={catalog}
            roleCode={session.roleCode}
            notify={notify}
          />
        </div>
      )}
    </div>
  );
}

/** Hiển thị một nhóm tác vụ AI liên quan trong một khung phân cách mạch lạc, không cắt che dropdown. */
function TaskGroupSection({
  title,
  subtitle,
  tasks,
  saved,
  onSaved,
  providers,
  catalog,
  roleCode,
  notify,
}: {
  title: string;
  subtitle: string;
  tasks: ReadonlyArray<TaskDefinition>;
  saved: Partial<Record<Task, Selection>>;
  onSaved: (task: Task, next: Selection) => void;
  providers: Provider[];
  catalog: Record<string, Model[]>;
  roleCode: NonNullable<Parameters<typeof apiRequest>[1]>["roleCode"];
  notify: ReturnType<typeof useApp>["notify"];
}) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-2xs">
      <div className="border-b border-slate-100 dark:border-slate-800 px-5 py-4 md:px-6">
        <h4 className="font-heading text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
          {title}
        </h4>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {tasks.map((definition) => (
          <TaskEditor
            key={definition.task}
            definition={definition}
            initial={saved[definition.task]}
            onSaved={(next) => onSaved(definition.task, next)}
            providers={providers}
            catalog={catalog}
            roleCode={roleCode}
            notify={notify}
          />
        ))}
      </div>
    </section>
  );
}

/** Chỉnh và lưu một tác vụ AI độc lập, xóa lựa chọn model khi đổi nhà cung cấp. */
function TaskEditor({
  definition,
  initial,
  onSaved,
  providers,
  catalog,
  roleCode,
  notify,
}: {
  definition: TaskDefinition;
  initial?: Selection;
  onSaved: (next: Selection) => void;
  providers: Provider[];
  catalog: Record<string, Model[]>;
  roleCode: NonNullable<Parameters<typeof apiRequest>[1]>["roleCode"];
  notify: ReturnType<typeof useApp>["notify"];
}) {
  const { task, label, scopeBadge, description, icon: TaskIcon } = definition;
  const { t } = useI18n();
  const [value, setValue] = useState<Selection>(
    initial ?? { providerId: "", model: "" },
  );
  const [committed, setCommitted] = useState<Selection | undefined>(initial);
  const [saving, setSaving] = useState(false);

  const provider = providers.find((item) => item.id === value.providerId);
  const committedProvider = providers.find(
    (item) => item.id === committed?.providerId,
  );
  const eligibleProviders = filterEligibleProviders(providers, task);

  const rawCatalogModels = catalog[provider?.provider ?? ""] ?? [];
  const modelOptions =
    value.model &&
    !rawCatalogModels.some((entry) => entry.value === value.model)
      ? [
          {
            value: value.model,
            label: value.model,
            description: "Model đang được gán cho tác vụ này.",
          },
          ...rawCatalogModels,
        ]
      : rawCatalogModels;

  const isDirty =
    (committed?.providerId ?? "") !== value.providerId ||
    (committed?.model ?? "") !== value.model ||
    (committed?.contextProviderId ?? "") !== (value.contextProviderId ?? "");

  /** Lưu cấu hình định tuyến tác vụ lên máy chủ và giữ nguyên dữ liệu nhập nếu có lỗi. */
  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("/system/ai-tasks", {
        method: "POST",
        roleCode,
        body: JSON.stringify({ task, ...value }),
      });
      setCommitted(value);
      onSaved(value);
      notify("Đã lưu cấu hình AI cho tác vụ.");
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
    <fieldset
      disabled={saving}
      className="min-w-0 px-5 py-5 md:px-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-start"
    >
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-sky-200/80 dark:border-sky-800/70 bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300"
          >
            <TaskIcon size={18} />
          </span>
          <legend className="font-heading text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
            {label}
          </legend>
          <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {scopeBadge}
          </span>
        </div>

        <p className="text-xs sm:text-sm leading-6 text-slate-600 dark:text-slate-400">
          {description}
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {committed?.providerId && committed.model ? (
            <div className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 px-2.5 py-1.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
                {committedProvider ? (
                  <AiProviderGlyph
                    provider={committedProvider.provider}
                    size="xs"
                  />
                ) : null}
                <span>{committedProvider?.name ?? committed.providerId}</span>
              </span>
              <ArrowRight
                aria-hidden="true"
                size={12}
                className="text-slate-400 shrink-0"
              />
              <AiModelIdentityBadge
                model={committed.model}
                provider={committedProvider?.provider}
                showTier={false}
              />
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <span className="size-1.5 rounded-full bg-slate-400" />
              Chưa gán model riêng
            </span>
          )}
          {isDirty && value.providerId && value.model.trim() ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-500" />
              Chưa lưu thay đổi
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 space-y-3.5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="mb-1.5 block">Nhà cung cấp</span>
            <SearchableSelect
              aria-label={`${t("Nhà cung cấp")} ${t(label)}`}
              value={value.providerId}
              onChange={(providerId) => setValue({ providerId, model: "" })}
              options={eligibleProviders.map((item) => {
                const providerMeta = resolveAiProviderVisual(item.provider);
                return {
                  value: item.id,
                  label: item.name,
                  badge: providerMeta.shortLabel,
                  description: item.model ? `Mặc định: ${item.model}` : undefined,
                  keywords: `${item.name} ${item.provider} ${item.model}`,
                  icon: <AiProviderGlyph provider={item.provider} size="xs" />,
                };
              })}
              placeholder="Chọn nhà cung cấp đang bật"
            />
          </label>

          <label className="min-w-0 block text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="mb-1.5 block">Model</span>
            {provider?.provider === "CUSTOM" ? (
              <div className="space-y-2">
                <input
                  className={inputClass}
                  aria-label={`${t("Model")} ${t(label)}`}
                  maxLength={200}
                  value={value.model}
                  onChange={(event) =>
                    setValue({ ...value, model: event.target.value })
                  }
                  placeholder={
                    task === "SCAN_IMAGE"
                      ? "Nhập model hỗ trợ ảnh"
                      : "Nhập tên model Custom"
                  }
                />
                {value.model.trim() ? (
                  <AiModelIdentityBadge
                    model={value.model}
                    provider={provider.provider}
                  />
                ) : null}
              </div>
            ) : (
              <SearchableSelect
                aria-label={`${t("Model")} ${t(label)}`}
                disabled={!provider}
                value={value.model}
                onChange={(model) => setValue({ ...value, model })}
                options={modelOptions.map((entry) => {
                  const modelMeta = resolveAiModelVisual(
                    entry.value,
                    provider?.provider,
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
                        provider={provider?.provider}
                        size="xs"
                      />
                    ),
                  };
                })}
                placeholder="Chọn model"
              />
            )}
          </label>
        </div>

        {task === "GENERATE_EXAM" && provider?.provider === "CUSTOM" ? (
          <div className="rounded-xl border border-sky-200/80 dark:border-sky-800/60 bg-sky-50/50 dark:bg-sky-950/30 p-3.5 space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="mb-1.5 block">Gemini hỗ trợ ngữ cảnh</span>
              <SearchableSelect
                aria-label="Gemini hỗ trợ ngữ cảnh"
                value={value.contextProviderId ?? ""}
                onChange={(contextProviderId) =>
                  setValue({ ...value, contextProviderId })
                }
                options={providers
                  .filter(
                    (item) =>
                      item.provider === "GEMINI" &&
                      item.enabled &&
                      item.hasApiKey,
                  )
                  .map((item) => ({
                    value: item.id,
                    label: item.name,
                    badge: "Gemini OCR",
                    description: item.model,
                    icon: <AiProviderGlyph provider="GEMINI" size="xs" />,
                  }))}
                placeholder="Chọn Gemini để đọc tài liệu và tìm web"
              />
            </label>
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">
              Gemini lấy ngữ cảnh; Custom sinh câu hỏi từ văn bản. Cả hai provider đều có thể phát sinh phí. Tài liệu hỗ trợ PDF và ảnh.
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-end pt-1">
          <Button
            type="button"
            variant={isDirty ? "primary" : "secondary"}
            loading={saving}
            disabled={saving || !value.providerId || !value.model.trim()}
            onClick={() => void save()}
          >
            <Save aria-hidden="true" size={15} />
            {saving ? t("Đang lưu…") : t(`Lưu ${label.toLowerCase()}`)}
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
