"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export function Button({ children, variant = "primary", loading = false, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = { primary: "bg-[#102a43] text-[#fffdfa] hover:bg-[#c75b39]", secondary: "border border-[#a9bac1] bg-[#fffdfa] text-[#102a43] hover:border-[#102a43]", danger: "bg-[#a84343] text-white hover:bg-[#853333]", ghost: "text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" };
  return <button aria-busy={loading || undefined} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-[background-color,color,border-color,transform] duration-200 hover:-translate-y-px active:translate-y-px active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100 ${styles[variant]} ${className}`} disabled={loading || props.disabled} {...props}>{loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : null}{children}</button>;
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-[#102a43]"><span>{label}</span><div className="mt-2">{children}</div>{error ? <span className="mt-1 block text-xs font-medium text-[#a84343]">{error}</span> : null}</label>;
}

export const inputClass = "min-h-11 w-full rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-3.5 py-2.5 text-sm text-[#102a43] outline-none transition placeholder:text-[#657789] focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15 disabled:cursor-not-allowed disabled:bg-[#eee8dc] disabled:text-[#657789]";

export function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
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
  return <div className="fixed inset-0 z-[70] grid place-items-center p-4"><button aria-label="Đóng hộp thoại" className="absolute inset-0 bg-[#102a43]/55 backdrop-blur-sm" onClick={onClose} tabIndex={-1} type="button" /><section aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#d5dfe2] bg-[#fffdfa] p-5 shadow-[0_22px_65px_rgb(16_42_67/0.22)] md:p-7" ref={dialogRef} role="dialog"><button aria-label="Đóng" className="absolute right-3 top-3 grid size-11 place-items-center rounded-xl text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" onClick={onClose} type="button"><X size={19} /></button><h2 className="pr-12 font-heading text-2xl font-bold tracking-[-0.025em] text-[#102a43]" id={titleId}>{title}</h2>{description ? <p className="mt-2 text-sm leading-6 text-[#516274]" id={descriptionId}>{description}</p> : null}<div className="mt-6">{children}</div></section></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const style = ["ACTIVE", "PUBLISHED", "COMPLETED", "PRESENT", "STABLE", "RESOLVED"].includes(status)
    ? "border-[#27685f]/25 bg-[#27685f]/10 text-[#1f574f]"
    : ["LOCKED", "REJECTED", "FAILED", "CANCELLED", "ABSENT", "HIGH"].includes(status)
      ? "border-[#a84343]/25 bg-[#a84343]/10 text-[#873737]"
      : ["IN_REVIEW", "PROCESSING", "LATE", "MEDIUM", "SMALL_SAMPLE"].includes(status)
        ? "border-[#a26920]/25 bg-[#a26920]/10 text-[#76501d]"
        : "border-[#a9bac1] bg-[#eee8dc] text-[#516274]";
  const labels: Record<string, string> = { ACTIVE: "Đang hoạt động", PUBLISHED: "Đã phát hành", DRAFT: "Bản nháp", LOCKED: "Đã khóa", REJECTED: "Đã từ chối", COMPLETED: "Đã hoàn tất", SCHEDULED: "Đã lên lịch", CANCELLED: "Đã hủy", OPEN: "Đang mở", IN_REVIEW: "Đang xử lý", RESOLVED: "Đã xử lý", CLOSED: "Đã đóng", PRESENT: "Có mặt", LATE: "Đi muộn", ABSENT: "Vắng", EXCUSED: "Có phép", PROCESSING: "Đang xử lý", FAILED: "Thất bại", EXPIRED: "Đã hết hạn", NONE: "Chưa có", VISIBLE: "Đang hiển thị", HIDDEN: "Đã ẩn", STABLE: "Ổn định", SMALL_SAMPLE: "Mẫu nhỏ", HIGH: "Rủi ro cao", MEDIUM: "Rủi ro vừa", LOW: "Rủi ro thấp" };
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-extrabold tracking-[0.02em] ${style}`} title={labels[status] ? `Mã trạng thái: ${status}` : undefined}>{labels[status] ?? status}</span>;
}
