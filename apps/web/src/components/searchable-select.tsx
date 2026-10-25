"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
}

interface SearchableSelectProps {
  "aria-label": string;
  disabled?: boolean;
  emptyMessage?: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  value: string;
}

/** Chuẩn hóa chữ thường và bỏ dấu để tìm tiếng Việt không phụ thuộc cách gõ. */
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("vi-VN");

/** Combobox có lọc text, điều hướng bàn phím và ngữ nghĩa ARIA cho danh sách dài. */
export function SearchableSelect({
  "aria-label": ariaLabel,
  disabled,
  emptyMessage = "Không tìm thấy lựa chọn phù hợp.",
  onChange,
  options,
  placeholder = "Chọn hoặc gõ để tìm…",
  value,
}: SearchableSelectProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) return options;
    return options.filter((option) => normalize(`${option.label} ${option.description ?? ""} ${option.keywords ?? ""}`).includes(needle));
  }, [options, query]);

  /** Chốt lựa chọn, đóng listbox và đặt lại trạng thái tìm kiếm. */
  const choose = (option: SearchableSelectOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="relative min-w-0">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={15} />
        <input
          aria-activedescendant={open && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={ariaLabel}
          className="min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 py-2 pl-9 pr-16 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all duration-150 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50 shadow-2xs"
          disabled={disabled}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            if (value) onChange("");
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => filtered.length ? Math.min(current + 1, filtered.length - 1) : 0);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            } else if (event.key === "Enter" && open && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setQuery("");
            }
          }}
          placeholder={placeholder}
          role="combobox"
          value={open ? query : selected?.label ?? ""}
        />
        {value && !disabled ? (
          <button
            aria-label={`Bỏ chọn ${selected?.label ?? "lựa chọn"}`}
            className="absolute right-8 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500 transition-colors"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { onChange(""); setQuery(""); setOpen(true); }}
            type="button"
          >
            <X size={14} />
          </button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={15} />
      </div>
      {open ? (
        <div className="absolute z-50 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-lg dark:shadow-2xl" id={listboxId} role="listbox">
          {filtered.length ? filtered.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                index === activeIndex
                  ? "bg-sky-50 dark:bg-slate-800 text-sky-800 dark:text-sky-300"
                  : "text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
              id={`${listboxId}-${index}`}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              role="option"
              type="button"
            >
              <span className="min-w-0">
                <strong className="block truncate text-xs sm:text-sm font-semibold">{option.label}</strong>
                {option.description ? <small className="mt-0.5 block truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{option.description}</small> : null}
              </span>
              {option.value === value ? <Check className="shrink-0 text-sky-600 dark:text-sky-400" size={15} /> : null}
            </button>
          )) : <p className="px-3 py-3 text-xs sm:text-sm leading-5 text-slate-400 dark:text-slate-500">{emptyMessage}</p>}
        </div>
      ) : null}
    </div>
  );
}
