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
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} />
        <input
          aria-activedescendant={open && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={ariaLabel}
          className="min-h-12 w-full rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] py-2 pl-10 pr-20 text-base font-normal text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15 disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)]"
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
          <button aria-label={`Bỏ chọn ${selected?.label ?? "lựa chọn"}`} className="absolute right-10 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(true); }} type="button"><X size={15} /></button>
        ) : null}
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} />
      </div>
      {open ? (
        <div className="absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--popover-shadow)]" id={listboxId} role="listbox">
          {filtered.length ? filtered.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left ${index === activeIndex ? "bg-[var(--surface-muted)]" : "hover:bg-[var(--canvas)]"}`}
              id={`${listboxId}-${index}`}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              role="option"
              type="button"
            >
              <span className="min-w-0"><strong className="block truncate text-sm">{option.label}</strong>{option.description ? <small className="mt-0.5 block truncate text-xs font-normal text-[var(--ink-muted)]">{option.description}</small> : null}</span>
              {option.value === value ? <Check className="shrink-0 text-[var(--success)]" size={17} /> : null}
            </button>
          )) : <p className="px-3 py-4 text-sm leading-5 text-[var(--ink-muted)]">{emptyMessage}</p>}
        </div>
      ) : null}
    </div>
  );
}
