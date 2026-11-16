"use client";

import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  GraduationCap,
  Headphones,
  HelpCircle,
  Lightbulb,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  filterRoleGuide,
  ROLE_GUIDE_CATALOG,
  resolveDefaultGuideRole,
  type GuideRoleKey,
} from "@/features/guide/guide-data";
import { useApp } from "@/providers/app-provider";
import { useI18n } from "@/providers/i18n-provider";
import { PageHeader } from "@/shared/ui/page-header";

const ROLE_ICON: Record<GuideRoleKey, typeof GraduationCap> = {
  LEARNER: GraduationCap,
  INSTRUCTOR: BookOpen,
  CENTER_MANAGER: Users,
  SYSTEM_ADMIN: ShieldCheck,
};

/** Màn hình Hướng dẫn sử dụng theo vai trò, hỗ trợ tìm kiếm nhanh, bước thao tác và FAQ. */
export function GuideScreen() {
  const { session } = useApp();
  const { t } = useI18n();
  const [selectedRole, setSelectedRole] = useState<GuideRoleKey>(() =>
    resolveDefaultGuideRole(session.roleCode),
  );
  const [query, setQuery] = useState("");
  const [openFaqIds, setOpenFaqIds] = useState<Record<string, boolean>>({});

  // Tự động đồng bộ tab hướng dẫn khi người dùng đổi vai trò ở thanh điều hướng trên cùng.
  useEffect(() => {
    setSelectedRole(resolveDefaultGuideRole(session.roleCode));
  }, [session.roleCode]);

  const activeGuide = useMemo(
    () => ROLE_GUIDE_CATALOG.find((item) => item.role === selectedRole) ?? ROLE_GUIDE_CATALOG[0],
    [selectedRole],
  );

  const filtered = useMemo(
    () => filterRoleGuide(activeGuide, query, t),
    [activeGuide, query, t],
  );

  const hasQuery = query.trim().length > 0;
  const totalMatches = filtered.sections.length + filtered.faqs.length;

  // Bật hoặc tắt một câu hỏi thường gặp trong mục FAQ.
  const toggleFaq = (faqId: string) => {
    setOpenFaqIds((current) => ({ ...current, [faqId]: !current[faqId] }));
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <PageHeader
        eyebrow="Tài liệu hệ thống"
        title="Hướng dẫn sử dụng"
        description="Hướng dẫn thao tác theo từng vai trò trong Wind EDU, liên kết nhanh tới màn hình chức năng và xử lý sự cố thường gặp."
        actions={
          <Link
            href="/support"
            className="inline-flex min-h-9.5 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 hover:border-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition shadow-2xs"
          >
            <Headphones size={16} />
            <span>{t("Gửi yêu cầu hỗ trợ")}</span>
          </Link>
        }
      />

      {/* Bộ chọn vai trò & thanh tìm kiếm từ khóa */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div
            aria-label={t("Chọn hướng dẫn theo vai trò")}
            className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80"
            role="tablist"
          >
            {ROLE_GUIDE_CATALOG.map((guide) => {
              const Icon = ROLE_ICON[guide.role];
              const active = guide.role === selectedRole;
              return (
                <button
                  key={guide.role}
                  aria-selected={active}
                  onClick={() => setSelectedRole(guide.role)}
                  role="tab"
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs sm:text-[13px] font-bold transition cursor-pointer ${
                    active
                      ? "bg-white dark:bg-slate-700 text-sky-700 dark:text-sky-300 shadow-2xs"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                  }`}
                >
                  <Icon size={15} />
                  <span>{t(guide.label)}</span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-80">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <input
              aria-label={t("Tìm kiếm hướng dẫn")}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-9 pr-9 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Tìm theo tính năng, LaTeX, thư mục, Google Meet…")}
              type="text"
              value={query}
            />
            {hasQuery ? (
              <button
                aria-label={t("Xóa từ khóa tìm kiếm")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                onClick={() => setQuery("")}
                type="button"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          <div className="space-y-0.5">
            <span className="inline-flex items-center rounded-full bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-800/60 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 dark:text-sky-300">
              {t(activeGuide.badge)}
            </span>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 pt-1">
              {t(activeGuide.intro)}
            </p>
          </div>
          {hasQuery ? (
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {totalMatches} {t("kết quả phù hợp")}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {activeGuide.sections.map((section) => (
                <a
                  key={section.id}
                  href={`#guide-${section.id}`}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:border-sky-400 hover:text-sky-700 dark:hover:text-sky-300 transition"
                >
                  {t(section.title)}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Kết quả hướng dẫn theo từng bước */}
      {totalMatches === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/70 p-8 text-center space-y-3">
          <HelpCircle className="mx-auto text-slate-400" size={32} />
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
            {t("Không tìm thấy hướng dẫn phù hợp với từ khóa hiện tại.")}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("Hãy thử từ khóa ngắn hơn hoặc chuyển sang tab vai trò khác ở phía trên.")}
          </p>
          <button
            className="inline-flex items-center gap-1.5 rounded-xl bg-sky-700 hover:bg-sky-600 px-4 py-2 text-xs font-bold text-white transition cursor-pointer"
            onClick={() => setQuery("")}
            type="button"
          >
            {t("Xem toàn bộ hướng dẫn")}
          </button>
        </section>
      ) : (
        <div className="space-y-6">
          {filtered.sections.length > 0 && (
            <section className="grid gap-4 md:grid-cols-2">
              {filtered.sections.map((section) => (
                <article
                  key={section.id}
                  id={`guide-${section.id}`}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs flex flex-col justify-between gap-4"
                >
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                        {t(section.title)}
                      </h2>
                      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {t(section.summary)}
                      </p>
                    </div>

                    <ol className="space-y-3">
                      {section.steps.map((step, index) => (
                        <li key={step.title} className="flex items-start gap-3">
                          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-[11px] font-extrabold text-sky-700 dark:text-sky-300">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <strong className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                              {t(step.title)}
                            </strong>
                            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                              {t(step.detail)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>

                    {section.tip ? (
                      <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
                        <Lightbulb className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={15} />
                        <p className="leading-relaxed">{t(section.tip)}</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
                    <Link
                      href={section.actionHref}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/60 px-3 py-1.5 text-xs font-bold text-sky-700 dark:text-sky-300 transition"
                    >
                      <span>{t(section.actionLabel)}</span>
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </article>
              ))}
            </section>
          )}

          {/* Câu hỏi thường gặp (FAQ) */}
          {filtered.faqs.length > 0 && (
            <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <Settings className="text-sky-600 dark:text-sky-400" size={18} />
                <h2 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                  {t("Câu hỏi thường gặp")}
                </h2>
              </div>

              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.faqs.map((faq) => {
                  const isOpen = hasQuery ? true : Boolean(openFaqIds[faq.id]);
                  return (
                    <div key={faq.id} className="py-2.5 first:pt-0 last:pb-0">
                      <button
                        aria-expanded={isOpen}
                        className="w-full flex items-center justify-between gap-3 py-1.5 text-left text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 hover:text-sky-700 dark:hover:text-sky-300 transition cursor-pointer"
                        onClick={() => toggleFaq(faq.id)}
                        type="button"
                      >
                        <span>{t(faq.question)}</span>
                        <ChevronDown
                          className={`shrink-0 text-slate-400 transition-transform ${
                            isOpen ? "rotate-180" : ""
                          }`}
                          size={16}
                        />
                      </button>
                      {isOpen ? (
                        <p className="mt-1.5 pl-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {t(faq.answer)}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Khối liên hệ hỗ trợ trực tiếp */}
      <section className="rounded-2xl border border-sky-200/80 dark:border-sky-900/60 bg-sky-50/60 dark:bg-sky-950/20 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
            {t("Cần hỗ trợ thêm từ đội ngũ vận hành?")}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t("Tạo phiếu hỗ trợ kèm mô tả hoặc ảnh chụp màn hình để quản lý trung tâm và quản trị viên kiểm tra trực tiếp.")}
          </p>
        </div>
        <Link
          href="/support"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-700 hover:bg-sky-600 px-4 py-2 text-xs font-bold text-white transition shadow-xs"
        >
          <Headphones size={15} />
          <span>{t("Mở trang Hỗ trợ")}</span>
        </Link>
      </section>
    </div>
  );
}
