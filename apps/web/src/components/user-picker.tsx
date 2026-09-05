"use client";

import { Check, Search, UserRound, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import type { DirectoryUser } from "@/lib/learning-types";
import { useApp } from "@/providers/app-provider";

interface UserPickerProps {
  classId?: string;
  disabled?: boolean;
  label: string;
  onChange: (userId: string) => void;
  role: "INSTRUCTOR" | "LEARNER";
  value: string;
}

/** Tìm người dùng theo vai trò với debounce/abort và trả userId cho form phân công hoặc ghi danh. */
export function UserPicker({ classId, disabled, label, onChange, role, value }: UserPickerProps) {
  const { session } = useApp();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Hủy request cũ khi từ khóa đổi để kết quả chậm không ghi đè danh sách mới.
  useEffect(() => {
    if (!open || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ role, q: query, ...(classId ? { classId } : {}) });
      apiRequest<DirectoryUser[]>(`/manager/directory/users?${params.toString()}`, { roleCode: session.roleCode, signal: controller.signal })
        .then(setItems).catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setItems([]); })
        .finally(() => setLoading(false));
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [classId, disabled, open, query, role, session.roleCode]);

  /** Chốt người dùng, đóng danh sách và báo userId về form cha. */
  function choose(user: DirectoryUser): void {
    setSelected(user); setQuery(""); setOpen(false); onChange(user.id);
  }

  return <label className="relative block min-w-0 text-sm font-bold">
    {label}
    {selected && value ? <div className="mt-2 flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] px-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--ink-soft)]"><UserRound size={16} /></span><span className="min-w-0"><strong className="block truncate text-sm">{selected.displayName}</strong><small className="block truncate font-normal text-[var(--ink-muted)]">{selected.email}</small></span></div><button aria-label={`Bỏ chọn ${selected.displayName}`} className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--ink-soft)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" disabled={disabled} onClick={() => { setSelected(null); onChange(""); }} type="button"><X size={16} /></button></div> : <div className="relative mt-2"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={17} /><input aria-autocomplete="list" aria-controls={listboxId} aria-expanded={open} className="min-h-12 w-full rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] pl-10 pr-4 text-base font-normal text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-subtle)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent)]/15" disabled={disabled} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={role === "INSTRUCTOR" ? "Tìm theo tên hoặc email giảng viên" : "Tìm theo tên hoặc email học viên"} role="combobox" value={query} />
      {open ? <div className="absolute z-40 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-[var(--rule-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--popover-shadow)]" id={listboxId} role="listbox">{loading ? <p className="px-3 py-3 text-sm font-normal text-[var(--ink-muted)]">Đang tìm người dùng…</p> : items.length ? items.map((user) => <button aria-selected={value === user.id} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--surface-muted)] focus-visible:bg-[var(--surface-muted)] focus-visible:outline-none" key={user.id} onClick={() => choose(user)} role="option" type="button"><span className="min-w-0"><strong className="block truncate text-sm">{user.displayName}</strong><small className="block truncate font-normal text-[var(--ink-muted)]">{user.email}</small></span>{value === user.id ? <Check className="shrink-0 text-[var(--success)]" size={17} /> : null}</button>) : <p className="px-3 py-4 text-sm font-normal leading-5 text-[var(--ink-muted)]">Không tìm thấy người dùng phù hợp hoặc người dùng đã thuộc lớp.</p>}</div> : null}
    </div>}
  </label>;
}
