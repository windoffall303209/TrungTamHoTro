"use client";

import { Bold, Braces, ChevronLeft, ChevronRight, Italic, LoaderCircle, Sigma, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function Button({ children, variant = "primary", loading = false, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = { primary: "bg-[#102a43] text-[#fffdfa] hover:bg-[#c75b39]", secondary: "border border-[#a9bac1] bg-[#fffdfa] text-[#102a43] hover:border-[#102a43]", danger: "bg-[#a84343] text-white hover:bg-[#853333]", ghost: "text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" };
  return <button aria-busy={loading || undefined} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-[background-color,color,border-color,transform] duration-200 hover:-translate-y-px active:translate-y-px active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100 ${styles[variant]} ${className}`} disabled={loading || props.disabled} {...props}>{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : null}{children}</button>;
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-[#102a43]"><span>{label}</span><div className="mt-2">{children}</div>{error ? <span className="mt-1 block text-xs font-medium text-[#a84343]">{error}</span> : null}</label>;
}

export const inputClass = "min-h-11 w-full rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-3.5 py-2.5 text-sm text-[#102a43] outline-none transition placeholder:text-[#657789] focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15 disabled:cursor-not-allowed disabled:bg-[#eee8dc] disabled:text-[#657789]";

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;

export function Tabs<T extends string>({ items, value, onChange, label, className = "" }: {
  items: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const baseId = useId();
  const moveFocus = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.value);
    window.requestAnimationFrame(() => document.getElementById(`${baseId}-${next.value}`)?.focus());
  };

  return (
    <div aria-label={label} className={`flex gap-1 overflow-x-auto border-b border-[#a9bac1] ${className}`} role="tablist">
      {items.map((item, index) => (
        <button
          aria-selected={item.value === value}
          className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 px-4 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#c75b39] ${item.value === value ? "text-[#102a43] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#c75b39]" : "text-[#657789] hover:bg-[#eee8dc]/70 hover:text-[#102a43]"}`}
          id={`${baseId}-${item.value}`}
          key={item.value}
          onClick={() => onChange(item.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(index, -1); }
            if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(index, 1); }
          }}
          role="tab"
          tabIndex={item.value === value ? 0 : -1}
          type="button"
        >
          {item.label}
          {typeof item.count === "number" ? <span className="min-w-6 rounded-full bg-[#eee8dc] px-2 py-0.5 text-center text-xs tabular-nums text-[#516274]">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function usePagination<T>(items: readonly T[], initialPageSize = 10) {
  const safeInitialSize = PAGE_SIZE_OPTIONS.includes(initialPageSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? initialPageSize : 10;
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(safeInitialSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const startIndex = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    pageItems: items.slice(startIndex, startIndex + pageSize),
    setPage: (nextPage: number) => setRequestedPage(Math.min(Math.max(1, nextPage), totalPages)),
    setPageSize: (nextSize: number) => {
      const safeSize = PAGE_SIZE_OPTIONS.includes(nextSize as (typeof PAGE_SIZE_OPTIONS)[number]) ? nextSize : 10;
      setPageSizeState(safeSize);
      setRequestedPage(1);
    },
    resetPage: () => setRequestedPage(1),
  };
}

function visiblePages(page: number, totalPages: number) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const ordered = [...pages].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  return ordered.flatMap<(number | string)>((item, index) => {
    const previous = ordered[index - 1];
    return previous && item - previous > 1 ? [`ellipsis-${previous}`, item] : [item];
  });
}

export function Pagination({ totalItems, page, pageSize, onPageChange, onPageSizeChange, itemLabel = "mục", className = "" }: {
  totalItems: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  itemLabel?: string;
  className?: string;
}) {
  if (totalItems === 0) return null;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(totalItems, currentPage * pageSize);

  return (
    <nav aria-label={`Phân trang ${itemLabel}`} className={`mt-5 flex flex-col gap-3 border-t border-[#d5dfe2] pt-4 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#516274]">
        <span aria-live="polite">Hiển thị <strong className="text-[#102a43]">{start}–{end}</strong> trong {totalItems} {itemLabel}</span>
        <label className="inline-flex items-center gap-2 font-bold text-[#102a43]">
          Số dòng
          <select aria-label={`Số ${itemLabel} mỗi trang`} className="min-h-11 rounded-lg border border-[#a9bac1] bg-[#fffdfa] px-3 text-sm outline-none focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15" onChange={(event) => onPageSizeChange(Number(event.target.value))} value={pageSize}>
            {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chọn trang">
        <button aria-label="Trang trước" className="grid size-11 place-items-center rounded-lg text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43] disabled:cursor-not-allowed disabled:opacity-35" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} type="button"><ChevronLeft aria-hidden="true" size={18} /></button>
        {visiblePages(currentPage, totalPages).map((item) => typeof item === "number" ? (
          <button aria-current={item === currentPage ? "page" : undefined} aria-label={`Trang ${item}`} className={`min-h-11 min-w-11 rounded-lg px-2 text-sm font-bold ${item === currentPage ? "bg-[#102a43] text-[#fffdfa]" : "text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]"}`} key={item} onClick={() => onPageChange(item)} type="button">{item}</button>
        ) : <span aria-hidden="true" className="grid min-h-11 min-w-7 place-items-center text-[#657789]" key={item}>…</span>)}
        <button aria-label="Trang sau" className="grid size-11 place-items-center rounded-lg text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43] disabled:cursor-not-allowed disabled:opacity-35" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} type="button"><ChevronRight aria-hidden="true" size={18} /></button>
      </div>
    </nav>
  );
}

export function Modal({ open, title, description, onClose, children, size = "md" }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode; size?: "md" | "xl" }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])");
    window.requestAnimationFrame(() => focusable?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center p-4"><button aria-label="Đóng hộp thoại" className="absolute inset-0 bg-[#102a43]/55 backdrop-blur-sm" onClick={onClose} tabIndex={-1} type="button" /><section aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className={`relative max-h-[92dvh] w-full overflow-y-auto rounded-2xl border border-[#d5dfe2] bg-[#fffdfa] p-5 shadow-[0_22px_65px_rgb(16_42_67/0.22)] md:p-7 ${size === "xl" ? "max-w-6xl" : "max-w-xl"}`} ref={dialogRef} role="dialog"><button aria-label="Đóng" className="absolute right-3 top-3 grid size-11 place-items-center rounded-xl text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" onClick={onClose} type="button"><X size={19} /></button><h2 className="pr-12 font-heading text-2xl font-bold tracking-[-0.025em] text-[#102a43]" id={titleId}>{title}</h2>{description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-[#516274]" id={descriptionId}>{description}</p> : null}<div className="mt-6">{children}</div></section></div>;
}

export function RichText({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`rich-content min-w-0 text-[#102a43] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

type FormatAction = "bold" | "italic" | "inline-math" | "block-math";

export function FormattedTextarea({ value, onChange, label, rows = 5, required = false, minLength, placeholder, error, disabled = false, compact = false }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rows?: number;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  const applyFormat = (action: FormatAction) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const formats: Record<FormatAction, { before: string; after: string; fallback: string }> = {
      bold: { before: "**", after: "**", fallback: "văn bản in đậm" },
      italic: { before: "*", after: "*", fallback: "văn bản in nghiêng" },
      "inline-math": { before: "$", after: "$", fallback: "x^2 + y^2" },
      "block-math": { before: "\n$$\n", after: "\n$$\n", fallback: "\\frac{a}{b}" },
    };
    const format = formats[action];
    const content = selected || format.fallback;
    const next = `${value.slice(0, start)}${format.before}${content}${format.after}${value.slice(end)}`;
    onChange(next);
    window.requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + format.before.length;
      textarea.setSelectionRange(selectionStart, selectionStart + content.length);
    });
  };

  const controls: Array<{ action: FormatAction; label: string; icon: React.ReactNode }> = [
    { action: "bold", label: "In đậm", icon: <Bold size={16} /> },
    { action: "italic", label: "In nghiêng", icon: <Italic size={16} /> },
    { action: "inline-math", label: "Công thức trong dòng", icon: <Sigma size={16} /> },
    { action: "block-math", label: "Khối công thức", icon: <Braces size={16} /> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-sm font-bold text-[#102a43]" htmlFor={errorId}>{label}</label>
        <div aria-label={`Định dạng ${label.toLowerCase()}`} className="flex flex-wrap gap-1" role="toolbar">
          {controls.map((control) => (
            <button aria-label={control.label} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43] disabled:cursor-not-allowed disabled:opacity-40" disabled={disabled} key={control.action} onClick={() => applyFormat(control.action)} title={control.label} type="button">
              {control.icon}<span className={compact ? "sr-only" : "hidden sm:inline"}>{control.label}</span>
            </button>
          ))}
        </div>
      </div>
      <textarea aria-describedby={error ? `${errorId}-error` : undefined} aria-invalid={Boolean(error)} className={`${inputClass} mt-2 resize-y font-sans leading-6`} disabled={disabled} id={errorId} minLength={minLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} ref={textareaRef} required={required} rows={rows} value={value} />
      {error ? <p className="mt-1 text-xs font-semibold text-[#a84343]" id={`${errorId}-error`}>{error}</p> : compact ? null : <p className="mt-1 text-xs leading-5 text-[#516274]">Chọn đoạn văn rồi dùng thanh định dạng. Công thức dùng LaTeX giữa <code>$...$</code> hoặc <code>$$...$$</code>.</p>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = ["ACTIVE", "PUBLISHED", "COMPLETED", "PRESENT", "STABLE", "RESOLVED"].includes(status)
    ? "border-[#27685f]/25 bg-[#27685f]/10 text-[#1f574f]"
    : ["LOCKED", "REJECTED", "FAILED", "CANCELLED", "ABSENT", "HIGH"].includes(status)
      ? "border-[#a84343]/25 bg-[#a84343]/10 text-[#873737]"
    : ["PENDING_VERIFICATION", "IN_REVIEW", "PROCESSING", "LATE", "MEDIUM", "SMALL_SAMPLE"].includes(status)
        ? "border-[#a26920]/25 bg-[#a26920]/10 text-[#76501d]"
        : "border-[#a9bac1] bg-[#eee8dc] text-[#516274]";
  const labels: Record<string, string> = { PENDING_VERIFICATION: "Chờ xác minh email", ACTIVE: "Đang hoạt động", PUBLISHED: "Đã phát hành", DRAFT: "Bản nháp", LOCKED: "Đã khóa", REJECTED: "Đã từ chối", COMPLETED: "Đã hoàn tất", SCHEDULED: "Đã lên lịch", CANCELLED: "Đã hủy", OPEN: "Đang mở", IN_REVIEW: "Đang xử lý", RESOLVED: "Đã xử lý", CLOSED: "Đã đóng", PRESENT: "Có mặt", LATE: "Đi muộn", ABSENT: "Vắng", EXCUSED: "Có phép", PROCESSING: "Đang xử lý", FAILED: "Thất bại", EXPIRED: "Đã hết hạn", NONE: "Chưa có", VISIBLE: "Đang hiển thị", HIDDEN: "Đã ẩn", STABLE: "Ổn định", SMALL_SAMPLE: "Mẫu nhỏ", HIGH: "Rủi ro cao", MEDIUM: "Rủi ro vừa", LOW: "Rủi ro thấp" };
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-extrabold tracking-[0.02em] ${style}`} title={labels[status] ? `Mã trạng thái: ${status}` : undefined}>{labels[status] ?? status}</span>;
}
