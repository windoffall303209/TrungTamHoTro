"use client";

import { LoaderCircle, X } from "lucide-react";

export function Button({ children, variant = "primary", loading = false, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = { primary: "bg-[#102a43] text-[#fffdfa] hover:bg-[#c75b39]", secondary: "border border-[#a9bac1] bg-[#fffdfa] text-[#102a43] hover:border-[#102a43]", danger: "bg-[#a84343] text-white hover:bg-[#853333]", ghost: "text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" };
  return <button className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition-[background-color,color,border-color,transform] duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} disabled={loading || props.disabled} {...props}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : null}{children}</button>;
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-[#102a43]"><span>{label}</span><div className="mt-2">{children}</div>{error ? <span className="mt-1 block text-xs font-medium text-[#a84343]">{error}</span> : null}</label>;
}

export const inputClass = "w-full rounded-xl border border-[#a9bac1] bg-[#fffdfa] px-3.5 py-2.5 text-sm text-[#102a43] outline-none transition placeholder:text-[#80909b] focus:border-[#c75b39] focus:ring-3 focus:ring-[#c75b39]/15";

export function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center p-4"><button aria-label="Đóng hộp thoại" className="absolute inset-0 bg-[#102a43]/55 backdrop-blur-sm" onClick={onClose} type="button" /><section aria-modal="true" className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#d5dfe2] bg-[#fffdfa] p-6 shadow-[0_22px_65px_rgb(16_42_67/0.22)] md:p-7" role="dialog"><button aria-label="Đóng" className="absolute right-4 top-4 rounded-lg p-2 text-[#516274] hover:bg-[#eee8dc] hover:text-[#102a43]" onClick={onClose} type="button"><X size={19} /></button><h2 className="pr-10 font-heading text-2xl font-bold tracking-[-0.025em] text-[#102a43]">{title}</h2>{description ? <p className="mt-2 text-sm leading-6 text-[#516274]">{description}</p> : null}<div className="mt-6">{children}</div></section></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const style = status === "ACTIVE" || status === "PUBLISHED" ? "border-[#27685f]/25 bg-[#27685f]/10 text-[#1f574f]" : status === "LOCKED" || status === "REJECTED" ? "border-[#a84343]/25 bg-[#a84343]/10 text-[#873737]" : "border-[#a9bac1] bg-[#eee8dc] text-[#516274]";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${style}`}>{status}</span>;
}
