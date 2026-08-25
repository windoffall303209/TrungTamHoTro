"use client";

import { LoaderCircle, X } from "lucide-react";

export function Button({ children, variant = "primary", loading = false, className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = { primary: "bg-slate-950 text-white hover:bg-sky-700", secondary: "border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700", danger: "bg-rose-600 text-white hover:bg-rose-700", ghost: "text-slate-600 hover:bg-slate-100" };
  return <button className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} disabled={loading || props.disabled} {...props}>{loading ? <LoaderCircle className="animate-spin" size={16} /> : null}{children}</button>;
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-bold text-slate-700"><span>{label}</span><div className="mt-2">{children}</div>{error ? <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span> : null}</label>;
}

export const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100";

export function Modal({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center p-4"><button aria-label="Đóng hộp thoại" className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm" onClick={onClose} type="button" /><section aria-modal="true" className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl md:p-7" role="dialog"><button aria-label="Đóng" className="absolute right-4 top-4 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} type="button"><X size={19} /></button><h2 className="pr-10 font-heading text-2xl font-extrabold tracking-tight">{title}</h2>{description ? <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p> : null}<div className="mt-6">{children}</div></section></div>;
}

export function StatusBadge({ status }: { status: string }) {
  const style = status === "ACTIVE" || status === "PUBLISHED" ? "bg-emerald-100 text-emerald-800" : status === "LOCKED" || status === "REJECTED" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${style}`}>{status}</span>;
}

