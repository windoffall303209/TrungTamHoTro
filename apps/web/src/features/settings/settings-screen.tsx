"use client";
import { AccessDenied } from "@/components/access-denied";
import { AiGradingOperations } from "@/components/ai-grading-operations";
import { AiTaskSettings } from "@/components/ai-task-settings";
import { PageHeader } from "@/components/page-header";
import { SearchableSelect } from "@/components/searchable-select";
import { Button, Field, inputClass, Modal, StatusBadge } from "@/components/ui";
import { activeLocale } from "@/i18n/runtime";
import {
  Activity,
  ArrowLeft,
  Bot,
  ChevronRight,
  CloudCog,
  DatabaseBackup,
  HardDrive,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { SettingsSection, settingsSections } from "./settings.shared";
import { useSettingsModel } from "./use-settings-model";

/** Lắp ghép màn hình cấu hình hệ thống từ trạng thái, hành động và các thành phần nghiệp vụ. */
export default function SettingsScreen() {
  const model = useSettingsModel();
  const {
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
    saveExamApprovalMode,
    saveQuestionApprovalMode,
    saveLearnerEmailNotifications,
    openAiEditor,
    loadProviderModels,
    availableModelOptions,
    saveAiProvider,
    testAiProvider,
    removeAiProvider,
  } = model;

  if (!canConfigure) return <AccessDenied />;
  const requestedSection = searchParams.get("section");
  const activeSection = settingsSections.some(
    (item) => item.id === requestedSection,
  )
    ? (requestedSection as SettingsSection)
    : null;
  const activeMeta = settingsSections.find((item) => item.id === activeSection);
  return (
    <div
      className={`mx-auto px-5 py-8 md:px-8 md:py-10 ${activeSection ? "max-w-5xl" : "max-w-7xl"}`}
    >
      {activeSection ? (
        <button
          className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-extrabold text-[var(--ink-soft)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          onClick={() => router.push("/admin/settings")}
          type="button"
        >
          <ArrowLeft size={18} />
          Quay lại Cấu hình
        </button>
      ) : null}
      <PageHeader
        eyebrow="Platform Governance"
        title={activeMeta?.title ?? "Cấu hình hệ thống"}
        description={
          activeMeta?.description ??
          "Chọn chức năng cần quản trị. Mỗi nhóm cấu hình được tách thành một màn hình để thao tác tập trung hơn."
        }
      />
      {!activeSection ? (
        <nav
          aria-label="Danh sách chức năng cấu hình"
          className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65"
        >
          {settingsSections.map((item) => {
            const Icon = item.icon;
            const summary =
              item.id === "notifications"
                ? settings?.learnerEmailNotificationsEnabled
                  ? "Đang bật"
                  : "Đang tắt"
                : item.id === "exam-approval"
                  ? settings?.examApprovalMode === "MANUAL"
                  ? "Duyệt thủ công"
                  : "Tự động duyệt"
                : item.id === "question-approval"
                  ? settings?.questionApprovalMode === "MANUAL"
                    ? "Duyệt thủ công"
                    : "Tự động duyệt"
                  : item.id === "ai-providers"
                    ? `${aiProviders.filter((entry) => entry.enabled).length} đang bật`
                    : item.id === "health"
                      ? health?.status === "healthy"
                        ? "Ổn định"
                        : "Cần kiểm tra"
                      : item.id === "storage"
                        ? `${storage?.usagePercent ?? 0}% đã dùng`
                        : item.id === "integrations"
                          ? `${integrations.filter((entry) => entry.enabled).length}/${integrations.length} đang bật`
                          : item.id === "backups"
                            ? `${backups.length} bản sao`
                            : item.id === "history"
                              ? `${history.length} phiên bản`
                              : settings
                                ? `Phiên bản ${settings.version}`
                                : "Đang tải";
            return (
              <button
                className="group grid min-h-24 w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--rule)] px-4 py-4 text-left last:border-b-0 transition hover:bg-[var(--surface-muted)] md:px-6"
                key={item.id}
                onClick={() =>
                  router.push(`/admin/settings?section=${item.id}`)
                }
                type="button"
              >
                <span className="grid size-12 place-items-center rounded-xl border border-[var(--rule)] bg-[var(--surface)] text-[var(--accent-ink)]">
                  <Icon size={21} />
                </span>
                <span className="min-w-0">
                  <span className="block font-heading text-lg font-extrabold text-[var(--ink)]">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-[var(--ink-soft)]">
                    {item.description}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="hidden text-xs font-bold text-[var(--ink-muted)] sm:inline">
                    {summary}
                  </span>
                  <ChevronRight
                    className="text-[var(--ink-muted)] transition group-hover:translate-x-1 group-hover:text-[var(--accent-ink)]"
                    size={20}
                  />
                </span>
              </button>
            );
          })}
        </nav>
      ) : null}
      {activeSection === "notifications" && settings ? (
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5 md:p-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm leading-6 text-[var(--ink-soft)]">
              Cấu hình việc chuyển tiếp thông báo hệ thống (nhắc lịch học, bài tập mới, kết quả chấm thi, thông báo lớp...) tới hòm thư cá nhân của học viên thông qua dịch vụ Resend.
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {[
                {
                  enabled: false,
                  title: "Tắt gửi email (Mặc định)",
                  badge: "Không gửi email",
                  description:
                    "Thông báo chỉ hiển thị nội bộ trên nền tảng web. Không gửi email qua Resend để tiết kiệm hạn ngạch và tránh gây phiền tới hòm thư cá nhân.",
                },
                {
                  enabled: true,
                  title: "Bật gửi thông báo qua email",
                  badge: "Gửi email tự động",
                  description:
                    "Tự động gửi email tới học viên cho các thông báo lớp học, lịch học trực tuyến và bài tập mới.",
                },
              ].map((option) => {
                const selected =
                  settings.learnerEmailNotificationsEnabled === option.enabled;
                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-40 rounded-2xl border p-5 text-left transition ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-sm" : "border-[var(--rule-strong)] bg-[var(--surface)] hover:border-[var(--accent)]"}`}
                    disabled={saving}
                    key={String(option.enabled)}
                    onClick={() =>
                      void saveLearnerEmailNotifications(option.enabled)
                    }
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-heading text-lg font-extrabold">
                        {option.title}
                      </span>
                      <span
                        className={`grid size-6 place-items-center rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--rule-strong)]"}`}
                      >
                        {selected ? (
                          <span className="size-2 rounded-full bg-white" />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-2 block">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          option.enabled
                            ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                            : "bg-[var(--surface-muted)] text-[var(--ink-soft)]"
                        }`}
                      >
                        {option.badge}
                      </span>
                    </span>
                    <span className="mt-3 block text-sm leading-6 text-[var(--ink-soft)]">
                      {option.description}
                    </span>
                    <span className="mt-4 block text-xs font-extrabold uppercase tracking-wider text-[var(--accent-ink)]">
                      {selected ? "Đang áp dụng" : "Chọn cấu hình này"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
      {activeSection === "exam-approval" && settings ? (
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5 md:p-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm leading-6 text-[var(--ink-soft)]">
              Thiết lập này áp dụng cho các đề được giảng viên gửi từ thời điểm
              thay đổi. Đề đã nằm trong hàng chờ vẫn có thể được quản trị viên
              phê duyệt hoặc trả lại.
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {[
                {
                  mode: "AUTO" as const,
                  title: "Tự động phê duyệt",
                  description:
                    "Đề hợp lệ được phát hành ngay khi giảng viên gửi. Phù hợp với quy trình vận hành hiện tại.",
                },
                {
                  mode: "MANUAL" as const,
                  title: "Phê duyệt thủ công",
                  description:
                    "Đề chuyển sang trạng thái chờ; quản trị viên cần phê duyệt hoặc trả lại kèm lý do.",
                },
              ].map((option) => {
                const selected = settings.examApprovalMode === option.mode;
                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-40 rounded-2xl border p-5 text-left transition ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-sm" : "border-[var(--rule-strong)] bg-[var(--surface)] hover:border-[var(--accent)]"}`}
                    disabled={saving}
                    key={option.mode}
                    onClick={() => void saveExamApprovalMode(option.mode)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-heading text-lg font-extrabold">
                        {option.title}
                      </span>
                      <span
                        className={`grid size-6 place-items-center rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--rule-strong)]"}`}
                      >
                        {selected ? (
                          <span className="size-2 rounded-full bg-white" />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-3 block text-sm leading-6 text-[var(--ink-soft)]">
                      {option.description}
                    </span>
                    <span className="mt-4 block text-xs font-extrabold uppercase tracking-wider text-[var(--accent-ink)]">
                      {selected ? "Đang áp dụng" : "Chọn chế độ này"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
      {activeSection === "question-approval" && settings ? (
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-5 md:p-6">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm leading-6 text-[var(--ink-soft)]">
              Giảng viên vẫn chủ động lưu bản nháp. Chế độ này chỉ được áp dụng
              khi họ chọn Xuất bản; câu hỏi đang chờ duyệt không tự thay đổi khi
              cấu hình được cập nhật.
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {[
                {
                  mode: "AUTO" as const,
                  title: "Tự động phê duyệt",
                  description:
                    "Câu hỏi hợp lệ được xuất bản ngay và có thể chọn khi tạo đề.",
                },
                {
                  mode: "MANUAL" as const,
                  title: "Phê duyệt thủ công",
                  description:
                    "Câu hỏi chuyển sang chờ duyệt; quản trị viên phê duyệt hoặc trả lại kèm lý do.",
                },
              ].map((option) => {
                const selected = settings.questionApprovalMode === option.mode;
                return (
                  <button
                    aria-pressed={selected}
                    className={`min-h-40 rounded-2xl border p-5 text-left transition ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-sm" : "border-[var(--rule-strong)] bg-[var(--surface)] hover:border-[var(--accent)]"}`}
                    disabled={saving}
                    key={option.mode}
                    onClick={() => void saveQuestionApprovalMode(option.mode)}
                    type="button"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-heading text-lg font-extrabold">
                        {option.title}
                      </span>
                      <span
                        className={`grid size-6 place-items-center rounded-full border ${selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--rule-strong)]"}`}
                      >
                        {selected ? (
                          <span className="size-2 rounded-full bg-white" />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-3 block text-sm leading-6 text-[var(--ink-soft)]">
                      {option.description}
                    </span>
                    <span className="mt-4 block text-xs font-extrabold uppercase tracking-wider text-[var(--accent-ink)]">
                      {selected ? "Đang áp dụng" : "Chọn chế độ này"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
      {activeSection === "ai-providers" ? (
        <section className="border-y border-[var(--rule-strong)] bg-[var(--surface)]/65">
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-6">
            <div>
              <h2 className="font-heading text-xl font-extrabold">
                Nhà cung cấp AI
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">
                API key được mã hóa và không hiển thị lại. Lưu nhà cung cấp, sau
                đó phân công model riêng cho từng chức năng bên dưới.
              </p>
            </div>
            <Button
              onClick={() => openAiEditor(undefined, "CUSTOM")}
              variant="secondary"
            >
              <Bot size={17} />
              Thêm custom
            </Button>
          </div>
          <div className="divide-y divide-[var(--rule)] border-t border-[var(--rule)]">
            <AiTaskSettings providers={aiProviders} catalog={modelCatalog} />
            <AiGradingOperations />
            {aiProviders.map((item) => (
              <article
                className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:px-6"
                key={item.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-[var(--ink)]">{item.name}</h3>
                    {item.isDefault ? <StatusBadge status="DEFAULT" /> : null}
                    <StatusBadge status={item.healthStatus} />
                  </div>
                  <p className="mt-1 truncate text-sm text-[var(--ink-soft)]">
                    {item.model} · {item.maskedApiKey}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {item.enabled ? "Đang bật" : "Đang tắt"}
                    {item.lastCheckedAt
                      ? ` · kiểm tra ${new Date(item.lastCheckedAt).toLocaleString(activeLocale())}`
                      : " · chưa kiểm tra kết nối"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button onClick={() => openAiEditor(item)} variant="ghost">
                    Cấu hình
                  </Button>
                  {item.hasApiKey ? (
                    <Button
                      onClick={() => void testAiProvider(item)}
                      variant="secondary"
                    >
                      Kiểm tra
                    </Button>
                  ) : null}
                  {item.provider === "CUSTOM" && item.hasApiKey ? (
                    <Button
                      aria-label={`Xóa ${item.name}`}
                      onClick={() => void removeAiProvider(item)}
                      variant="ghost"
                    >
                      <Trash2 size={16} />
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {activeSection === "health" && health ? (
        <section className="metric-ledger mb-7">
          <div
            className={
              health.status === "healthy" ? "bg-emerald-50" : "bg-amber-50"
            }
          >
            <Activity
              className={
                health.status === "healthy"
                  ? "text-emerald-700"
                  : "text-amber-700"
              }
              size={19}
            />
            <p className="mt-3 font-extrabold">
              {health.status === "healthy"
                ? "Hoạt động ổn định"
                : "Cần kiểm tra"}
            </p>
            <p className="text-xs text-slate-600">
              Cơ sở dữ liệu:{" "}
              {health.database === "connected" ? "đã kết nối" : health.database}
            </p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">
              {health.apiLatencyMs} ms
            </p>
            <p className="text-xs text-slate-500">Độ trễ API</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">
              {health.storageUsagePercent}%
            </p>
            <p className="text-xs text-slate-500">Dung lượng lưu trữ</p>
          </div>
          <div>
            <p className="tabular text-2xl font-extrabold">
              {health.queueDepth}
            </p>
            <p className="text-xs text-slate-500">Tác vụ đang chờ</p>
          </div>
        </section>
      ) : null}
      <div
        className={`${["general", "history", "integrations", "backups"].includes(activeSection ?? "") ? "grid" : "hidden"} gap-7`}
      >
        <section
          className={`${activeSection === "general" ? "block" : "hidden"} border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6`}
        >
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
                  {new Date(settings.effectiveAt).toLocaleString(
                    activeLocale(),
                  )}{" "}
                  · cập nhật bởi {settings.updatedBy}
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
        <section
          className={`${activeSection === "history" ? "block" : "hidden"} order-3 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6 xl:col-span-2`}
        >
          <h2 className="font-heading text-xl font-extrabold">
            Lịch sử cấu hình
          </h2>
          <div className="mt-4 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {history.length ? (
              history.slice(0, 6).map((item) => (
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
                    {new Date(item.effectiveAt).toLocaleString(activeLocale())}{" "}
                    · {item.updatedBy}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.timezone} · lưu {item.retentionDays} ngày · quota{" "}
                    {item.storageQuotaMb} MB ·{" "}
                    {item.examApprovalMode === "MANUAL"
                      ? "duyệt đề thủ công"
                      : "tự động duyệt đề"}{" "}
                    ·{" "}
                    {item.questionApprovalMode === "MANUAL"
                      ? "duyệt câu hỏi thủ công"
                      : "tự động duyệt câu hỏi"}
                  </p>
                </article>
              ))
            ) : (
              <p className="empty-copy">Chưa có phiên bản cấu hình trước đó.</p>
            )}
          </div>
        </section>
        <div
          className={`${["integrations", "backups"].includes(activeSection ?? "") ? "block" : "hidden"} order-2 space-y-7`}
        >
          <section
            className={`${activeSection === "integrations" ? "block" : "hidden"} border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6`}
          >
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
                        {item.maskedCredential} ·{" "}
                        {item.healthStatus === "UNKNOWN"
                          ? "Chưa kiểm tra"
                          : item.healthStatus}
                      </p>
                    </div>
                    <button
                      aria-pressed={item.enabled}
                      aria-label={`Bật tắt ${item.provider}`}
                      className={`relative h-11 w-14 rounded-full transition ${item.enabled ? "bg-sky-600" : "bg-slate-200"}`}
                      onClick={() => void toggle(item)}
                    >
                      <span
                        className={`absolute top-3 size-5 rounded-full bg-[var(--surface)] shadow transition ${item.enabled ? "left-8" : "left-1"}`}
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
          <section
            className={`${activeSection === "backups" ? "block" : "hidden"} border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DatabaseBackup className="text-sky-700" />
                <h2 className="font-heading text-xl font-extrabold">Sao lưu</h2>
              </div>
              <Button onClick={() => void backup()} variant="secondary">
                Chạy ngay
              </Button>
            </div>
            <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
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
                      {new Date(item.createdAt).toLocaleString(activeLocale())}{" "}
                      · {item.checksum}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {activeSection === "storage" && storage ? (
        <section className="mt-7 border-y border-[var(--rule-strong)] bg-[var(--surface)]/65 p-6">
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
          <div className="mt-5 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
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
      <Modal
        open={aiEditorOpen}
        onClose={() => {
          if (!saving) {
            setAiEditorOpen(false);
            setEditingAi(null);
          }
        }}
        title={
          editingAi
            ? `Cấu hình ${editingAi.name}`
            : "Thêm nhà cung cấp tùy chỉnh"
        }
        description="Tải danh sách từ tài khoản provider để biết API key hiện tại nhìn thấy model nào. Bạn vẫn có thể nhập model thủ công."
      >
        <form
          className="space-y-4"
          onSubmit={(event) => void saveAiProvider(event)}
        >
          {aiForm.provider === "CUSTOM" ? (
            <Field label="Tên hiển thị">
              <input
                className={inputClass}
                maxLength={100}
                onChange={(event) =>
                  setAiForm({ ...aiForm, name: event.target.value })
                }
                required
                value={aiForm.name}
              />
            </Field>
          ) : null}
          <Field label="Model">
            <div className="space-y-2">
              {modelMode === "catalog" && availableModelOptions.length ? (
                <SearchableSelect
                  aria-label={`Tìm model ${aiForm.provider}`}
                  emptyMessage="Không tìm thấy model phù hợp. Chuyển sang nhập thủ công để dùng model khác."
                  onChange={(model) => setAiForm({ ...aiForm, model })}
                  options={availableModelOptions.map((model) => ({
                    ...model,
                    keywords: `${model.value} ${model.label}`,
                  }))}
                  placeholder="Gõ tên model để tìm trong danh sách…"
                  value={aiForm.model}
                />
              ) : (
                <input
                  aria-label={`Nhập model ${aiForm.provider}`}
                  className={inputClass}
                  maxLength={200}
                  onChange={(event) =>
                    setAiForm({ ...aiForm, model: event.target.value })
                  }
                  placeholder="org/model-name"
                  required
                  value={aiForm.model}
                />
              )}
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="max-w-xl text-xs leading-5 text-[var(--ink-muted)]">
                  {discoveredModels.length
                    ? `${discoveredModels.length} model từ tài khoản provider. Danh sách phản ánh quyền của API key hiện tại, không bảo đảm mọi model hỗ trợ tác vụ này.`
                    : aiForm.provider === "CUSTOM"
                      ? "Nhập thủ công hoặc lưu provider rồi tải danh sách từ endpoint /models."
                      : "Đây là danh sách gợi ý tích hợp, chưa xác nhận model khả dụng cho API key hiện tại."}
                </span>
                <div className="flex flex-wrap gap-2">
                  {availableModelOptions.length || modelMode === "manual" ? (
                    <Button
                      onClick={() =>
                        setModelMode((mode) =>
                          mode === "catalog" ? "manual" : "catalog",
                        )
                      }
                      type="button"
                      variant="ghost"
                    >
                      {modelMode === "catalog"
                        ? "Nhập thủ công"
                        : "Chọn từ danh sách"}
                    </Button>
                  ) : null}
                  <Button
                    disabled={!editingAi?.hasApiKey}
                    loading={loadingModels}
                    onClick={() => void loadProviderModels()}
                    type="button"
                    variant="secondary"
                  >
                    <RefreshCw size={15} />
                    {discoveredModels.length
                      ? "Tải lại model"
                      : "Tải model từ tài khoản"}
                  </Button>
                </div>
              </div>
              {!editingAi?.hasApiKey ? (
                <p className="text-xs leading-5 text-[var(--ink-muted)]">
                  Lưu cấu hình cùng API key trước để tải danh sách model thực
                  tế.
                </p>
              ) : null}
            </div>
          </Field>
          {aiForm.provider === "CUSTOM" ? (
            <Field label="Endpoint Chat Completions">
              <input
                className={inputClass}
                onChange={(event) =>
                  setAiForm({ ...aiForm, baseUrl: event.target.value })
                }
                placeholder="https://ai.example.com/v1/chat/completions"
                required
                type="url"
                value={aiForm.baseUrl}
              />
            </Field>
          ) : null}
          <Field
            label={
              editingAi?.hasApiKey
                ? "API key mới (để trống nếu giữ nguyên)"
                : "API key"
            }
          >
            <input
              autoComplete="new-password"
              className={inputClass}
              minLength={8}
              onChange={(event) =>
                setAiForm({ ...aiForm, apiKey: event.target.value })
              }
              placeholder={
                editingAi?.hasApiKey
                  ? editingAi.maskedApiKey
                  : "Nhập khóa bí mật"
              }
              required={!editingAi?.hasApiKey}
              type="password"
              value={aiForm.apiKey}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--rule)] px-3 text-sm font-bold">
              <input
                checked={aiForm.enabled}
                className="size-5 accent-[var(--accent)]"
                onChange={(event) =>
                  setAiForm({ ...aiForm, enabled: event.target.checked })
                }
                type="checkbox"
              />
              Bật cấu hình này
            </label>
            <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--rule)] px-3 text-sm font-bold">
              <input
                checked={aiForm.isDefault}
                className="size-5 accent-[var(--accent)]"
                onChange={(event) =>
                  setAiForm({ ...aiForm, isDefault: event.target.checked })
                }
                type="checkbox"
              />
              Dùng mặc định khi quét
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setAiEditorOpen(false)}
              type="button"
              variant="secondary"
            >
              Hủy
            </Button>
            <Button loading={saving} type="submit">
              <Save size={16} />
              Lưu cấu hình
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
