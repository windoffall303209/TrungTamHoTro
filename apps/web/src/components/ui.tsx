"use client";

import { Bold, Braces, ChevronLeft, ChevronRight, Italic, LoaderCircle, Sigma, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** Nút tương tác chính với các biến thể màu tinh gọn Sky Blue, trạng thái loading và disabled. */
export function Button({
  children,
  variant = "primary",
  loading = false,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}) {
  const styles = {
    primary:
      "bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white shadow-xs focus-visible:ring-2 focus-visible:ring-sky-500/40",
    secondary:
      "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-800 dark:text-slate-200 hover:bg-sky-50/60 dark:hover:bg-slate-800 hover:border-sky-300 dark:hover:border-slate-700 hover:text-sky-700 dark:hover:text-sky-300 shadow-2xs focus-visible:ring-2 focus-visible:ring-sky-400/20",
    danger:
      "bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-xs focus-visible:ring-2 focus-visible:ring-rose-500/40",
    ghost:
      "text-slate-600 dark:text-slate-400 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-50/70 dark:hover:bg-slate-800/60",
  };

  return (
    <button
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 shrink-0 whitespace-nowrap items-center justify-center gap-2 rounded-lg px-3.5 text-xs sm:text-sm font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:pointer-events-none focus:outline-none ${styles[variant]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin shrink-0" size={15} /> : null}
      {children}
    </button>
  );
}

/** Khối form gom nhãn, phần tử điều khiển và thông báo lỗi với cỡ chữ đồng bộ. */
export function Field({
  label,
  error,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
      <span>{label}</span>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <span className="mt-1 block text-xs font-medium text-rose-600 dark:text-rose-400">{error}</span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all duration-150 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50 disabled:text-slate-400 shadow-2xs";

export const PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;

/** Thanh tab tối giản với số lượng, nhãn accessible và hỗ trợ bàn phím mũi tên. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className = "",
}: {
  items: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const baseId = useId();

  /** Chuyển tab vòng tròn và đưa focus tới tab vừa chọn. */
  const moveFocus = (currentIndex: number, direction: -1 | 1) => {
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    const next = items[nextIndex];
    if (!next) return;
    onChange(next.value);
    window.requestAnimationFrame(() => document.getElementById(`${baseId}-${next.value}`)?.focus());
  };

  return (
    <div
      aria-label={label}
      className={`flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 ${className}`}
      role="tablist"
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        return (
          <button
            aria-selected={selected}
            className={`relative inline-flex min-h-10 shrink-0 items-center gap-2 px-3.5 text-xs sm:text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/30 ${
              selected
                ? "text-sky-600 dark:text-sky-400 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-sky-600 dark:after:bg-sky-400 font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/40"
            }`}
            id={`${baseId}-${item.value}`}
            key={item.value}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(index, -1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(index, 1);
              }
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={`min-w-5 rounded-full px-1.5 py-0.2 text-center text-[10px] font-bold tabular-nums ${
                  selected
                    ? "bg-sky-100 dark:bg-sky-950/80 text-sky-800 dark:text-sky-300"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Quản lý phân trang phía client và ép cỡ trang hợp lệ. */
export function usePagination<T>(items: readonly T[], initialPageSize = 10) {
  const safeInitialSize = PAGE_SIZE_OPTIONS.includes(initialPageSize as (typeof PAGE_SIZE_OPTIONS)[number])
    ? initialPageSize
    : 10;
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

/** Rút gọn danh sách nút trang quanh trang hiện tại và chèn ellipsis khi có khoảng cách. */
function visiblePages(page: number, totalPages: number) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const ordered = [...pages].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  return ordered.flatMap<(number | string)>((item, index) => {
    const previous = ordered[index - 1];
    return previous && item - previous > 1 ? [`ellipsis-${previous}`, item] : [item];
  });
}

/** Điều khiển phân trang accessible, hiển thị phạm vi hiện tại và selector số dòng. */
export function Pagination({
  totalItems,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = "mục",
  className = "",
}: {
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
    <nav
      aria-label={`Phân trang ${itemLabel}`}
      className={`mt-5 flex flex-col gap-3 border-t border-slate-200 dark:border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
        <span aria-live="polite">
          Hiển thị <strong className="font-semibold text-slate-900 dark:text-slate-100">{start}–{end}</strong> trong {totalItems} {itemLabel}
        </span>
        <label className="inline-flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-300">
          Số dòng
          <select
            aria-label={`Số ${itemLabel} mỗi trang`}
            className="min-h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2.5 text-xs sm:text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chọn trang">
        <button
          aria-label="Trang trước"
          className="grid size-8.5 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors shadow-2xs"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={15} />
        </button>
        {visiblePages(currentPage, totalPages).map((item) =>
          typeof item === "number" ? (
            <button
              aria-current={item === currentPage ? "page" : undefined}
              aria-label={`Trang ${item}`}
              className={`min-h-8.5 min-w-8.5 rounded-lg px-2 text-xs sm:text-sm font-semibold transition-colors ${
                item === currentPage
                  ? "bg-sky-600 text-white font-bold shadow-xs"
                  : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-2xs"
              }`}
              key={item}
              onClick={() => onPageChange(item)}
              type="button"
            >
              {item}
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="grid min-h-8.5 min-w-5 place-items-center text-xs text-slate-400 dark:text-slate-600"
              key={item}
            >
              …
            </span>
          ),
        )}
        <button
          aria-label="Trang sau"
          className="grid size-8.5 place-items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40 transition-colors shadow-2xs"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={15} />
        </button>
      </div>
    </nav>
  );
}

/** Lấy control có thể Tab tới, kể cả summary; bỏ phần tử bị ẩn trong details hoặc tổ tiên. */
function modalControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], summary, [tabindex]"),
  ).filter((element) => {
    if (element.tabIndex < 0 || element.matches(":disabled")) return false;
    for (let node: HTMLElement | null = element; node && node !== dialog; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.hasAttribute("inert") || style.display === "none" || style.visibility === "hidden")
        return false;
      if (node instanceof HTMLDetailsElement && !node.open) {
        const summary = node.querySelector(":scope > summary");
        if (!summary?.contains(element)) return false;
      }
    }
    return true;
  });
}

const modalInertLocks = new WeakMap<Element, { count: number; original: boolean }>();

/** Cô lập các nhánh ngoài hộp thoại và khôi phục đúng trạng thái khi hộp thoại lồng nhau đóng. */
function isolateModal(wrapper: HTMLElement) {
  const locked: Element[] = [];
  let branch: Element = wrapper;
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch) continue;
      const lock = modalInertLocks.get(sibling) ?? { count: 0, original: sibling.hasAttribute("inert") };
      lock.count += 1;
      modalInertLocks.set(sibling, lock);
      sibling.setAttribute("inert", "");
      locked.push(sibling);
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
  return () => {
    for (const element of locked) {
      const lock = modalInertLocks.get(element)!;
      lock.count -= 1;
      if (lock.count === 0) {
        if (!lock.original) element.removeAttribute("inert");
        modalInertLocks.delete(element);
      }
    }
  };
}

/** Hộp thoại chuẩn tối giản Sky Blue, khóa cuộn, giữ focus và hỗ trợ phím Escape. */
export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  size = "md",
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  size?: "md" | "xl";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = dialog ? modalControls(dialog)[0] : undefined;
    const releaseIsolation = dialog?.parentElement ? isolateModal(dialog.parentElement) : () => {};
    const frame = window.requestAnimationFrame(() => focusable?.focus());

    const containFocus = (event: FocusEvent) => {
      if (!dialog || dialog.closest("[inert]") || dialog.contains(event.target as Node)) return;
      modalControls(dialog)[0]?.focus();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialog?.closest("[inert]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = modalControls(dialog);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", containFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", handleKeyDown);
      releaseIsolation();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4 overflow-y-auto">
      <button
        aria-label="Đóng hộp thoại"
        className="fixed inset-0 bg-slate-900/50 dark:bg-black/75 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`relative my-auto max-h-[90dvh] w-full overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xl dark:shadow-2xl ${
          size === "xl" ? "max-w-5xl" : "max-w-xl"
        }`}
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="Đóng"
          className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
        <h2 className="pr-10 text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100" id={titleId}>
          {title}
        </h2>
        {description ? (
          <p className="mt-1.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed" id={descriptionId}>
            {description}
          </p>
        ) : null}
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}

/** Render Markdown/GFM và công thức LaTeX qua KaTeX cho nội dung học tập. */
export function RichText({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`rich-content min-w-0 text-slate-800 dark:text-slate-200 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

type FormatAction = "bold" | "italic" | "inline-math" | "block-math";

/** Textarea có toolbar chèn Markdown in đậm/nghiêng và LaTeX vào vùng đang chọn. */
export function FormattedTextarea({
  value,
  onChange,
  label,
  rows = 5,
  required = false,
  minLength,
  placeholder,
  error,
  disabled = false,
  compact = false,
}: {
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
    { action: "bold", label: "In đậm", icon: <Bold size={14} /> },
    { action: "italic", label: "In nghiêng", icon: <Italic size={14} /> },
    { action: "inline-math", label: "Công thức trong dòng", icon: <Sigma size={14} /> },
    { action: "block-math", label: "Khối công thức", icon: <Braces size={14} /> },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200" htmlFor={errorId}>
          {label}
        </label>
        <div aria-label={`Định dạng ${label.toLowerCase()}`} className="flex flex-wrap gap-1" role="toolbar">
          {controls.map((control) => (
            <button
              aria-label={control.label}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-700 dark:hover:text-sky-300 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              disabled={disabled}
              key={control.action}
              onClick={() => applyFormat(control.action)}
              title={control.label}
              type="button"
            >
              {control.icon}
              <span className={compact ? "sr-only" : "hidden sm:inline"}>{control.label}</span>
            </button>
          ))}
        </div>
      </div>
      <textarea
        aria-describedby={error ? `${errorId}-error` : undefined}
        aria-invalid={Boolean(error)}
        className={`${inputClass} mt-1.5 resize-y font-sans leading-relaxed`}
        disabled={disabled}
        id={errorId}
        minLength={minLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={textareaRef}
        required={required}
        rows={rows}
        value={value}
      />
      {error ? (
        <p className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-400" id={`${errorId}-error`}>
          {error}
        </p>
      ) : compact ? null : (
        <p className="mt-1 text-xs leading-5 text-slate-400 dark:text-slate-500">
          Chọn đoạn văn rồi dùng thanh định dạng. Công thức dùng LaTeX giữa <code>$...$</code> hoặc <code>$$...$$</code>.
        </p>
      )}
    </div>
  );
}

/** Ánh xạ mã trạng thái nghiệp vụ sang nhãn tiếng Việt và màu sắc rõ ràng. */
export function StatusBadge({ status }: { status: string }) {
  const isPositive = ["ACTIVE", "PUBLISHED", "COMPLETED", "PRESENT", "STABLE", "RESOLVED", "GRADED"].includes(status);
  const isNegative = ["LOCKED", "REJECTED", "FAILED", "CANCELLED", "ABSENT", "HIGH"].includes(status);
  const isPending = [
    "PENDING",
    "PENDING_VERIFICATION",
    "PENDING_REVIEW",
    "IN_REVIEW",
    "IN_PROGRESS",
    "SUBMITTED",
    "PROCESSING",
    "LATE",
    "MEDIUM",
    "SMALL_SAMPLE",
  ].includes(status);

  const style = isPositive
    ? "border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
    : isNegative
      ? "border-rose-200/80 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400"
      : isPending
        ? "border-sky-200/80 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400"
        : "border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300";

  const dot = isPositive
    ? "bg-emerald-500"
    : isNegative
      ? "bg-rose-500"
      : isPending
        ? "bg-sky-500"
        : "bg-slate-400";

  const labels: Record<string, string> = {
    PENDING: "Chưa xác thực",
    PENDING_VERIFICATION: "Chờ xác minh email",
    PENDING_REVIEW: "Chờ phê duyệt",
    ACTIVE: "Đang hoạt động",
    PUBLISHED: "Đã phát hành",
    DRAFT: "Bản nháp",
    LOCKED: "Đã khóa",
    REJECTED: "Đã từ chối",
    COMPLETED: "Đã hoàn tất",
    SCHEDULED: "Đã lên lịch",
    CANCELLED: "Đã hủy",
    OPEN: "Đang mở",
    IN_REVIEW: "Đang xử lý",
    IN_PROGRESS: "Đang làm bài",
    SUBMITTED: "Chờ chấm",
    GRADED: "Đã chấm",
    RESOLVED: "Đã xử lý",
    CLOSED: "Đã đóng",
    PRESENT: "Có mặt",
    LATE: "Đi muộn",
    ABSENT: "Vắng",
    EXCUSED: "Có phép",
    PROCESSING: "Đang xử lý",
    FAILED: "Thất bại",
    EXPIRED: "Đã hết hạn",
    NONE: "Chưa có",
    VISIBLE: "Đang hiển thị",
    HIDDEN: "Đã ẩn",
    STABLE: "Ổn định",
    SMALL_SAMPLE: "Mẫu nhỏ",
    HIGH: "Rủi ro cao",
    MEDIUM: "Rủi ro vừa",
    LOW: "Rủi ro thấp",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold shadow-2xs ${style}`}
      title={labels[status] ? `Mã trạng thái: ${status}` : undefined}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {labels[status] ?? status}
    </span>
  );
}
