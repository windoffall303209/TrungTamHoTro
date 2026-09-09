"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/providers/i18n-provider";

const localeOptions = [
  { value: "vi-VN", code: "VI", label: "Tiếng Việt" },
  { value: "en-US", code: "EN", label: "English" },
] as const;

/** Cho phép đổi Việt–Anh qua popover gọn, chỉ hiện ngôn ngữ đang dùng khi đóng. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const activeOption = localeOptions.find((option) => option.value === locale) ?? localeOptions[0];

  useEffect(() => {
    if (!open) return;

    /** Đóng danh sách khi người dùng tương tác ngoài bộ chuyển ngôn ngữ. */
    function closeOnOutsideInteraction(event: PointerEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    /** Đóng danh sách bằng phím Escape và trả focus về nút kích hoạt. */
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div
      className="relative inline-flex shrink-0"
      ref={rootRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`${t("Ngôn ngữ")}: ${activeOption.label}`}
        className={`inline-flex h-11 items-center justify-center rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] font-bold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] ${compact ? "min-w-[4.25rem] gap-1.5 px-2" : "min-w-36 gap-2 px-3"}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Languages aria-hidden="true" className="shrink-0 text-[var(--ink-soft)]" size={16} strokeWidth={1.8} />
        <span className={compact ? "text-xs tracking-[0.04em]" : "text-sm"}>
          {compact ? activeOption.code : activeOption.label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`shrink-0 text-[var(--ink-soft)] transition-transform ${open ? "rotate-180" : ""}`}
          size={14}
        />
      </button>

      {open ? (
        <div
          aria-label={t("Ngôn ngữ")}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-48 overflow-hidden rounded-xl border border-[var(--rule)] bg-[var(--surface)] p-1.5 shadow-[var(--popover-shadow)]"
          id={menuId}
          role="listbox"
        >
          {localeOptions.map((option) => {
            const selected = locale === option.value;
            return (
              <button
                aria-selected={selected}
                className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${selected ? "bg-[var(--surface-muted)] font-bold text-[var(--ink)]" : "text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"}`}
                key={option.value}
                onClick={() => {
                  setLocale(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span className="w-6 text-xs font-extrabold tracking-[0.04em]">{option.code}</span>
                <span className="flex-1 whitespace-nowrap">{option.label}</span>
                {selected ? <Check aria-hidden="true" className="text-[var(--accent)]" size={16} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
