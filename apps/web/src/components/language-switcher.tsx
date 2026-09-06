"use client";

import { Languages } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

/** Cho phép đổi Việt–Anh bằng select native, có nhãn rõ cho bàn phím và trình đọc màn hình. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-2 text-[var(--ink-soft)] ${compact ? "max-w-28" : "max-w-40"}`}>
      <Languages aria-hidden="true" className="shrink-0" size={17} />
      <span className="sr-only">{t("Chuyển ngôn ngữ")}</span>
      <select
        aria-label={t("Ngôn ngữ")}
        className="min-w-0 flex-1 appearance-none bg-transparent py-2 text-sm font-bold text-[var(--ink)] outline-none"
        onChange={(event) => setLocale(event.target.value === "en-US" ? "en-US" : "vi-VN")}
        value={locale}
      >
        <option value="vi-VN">VI</option>
        <option value="en-US">EN</option>
      </select>
    </label>
  );
}
