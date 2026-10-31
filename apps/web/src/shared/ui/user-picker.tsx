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
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ role, q: query, ...(classId ? { classId } : {}) });
      apiRequest<DirectoryUser[]>(`/manager/directory/users?${params.toString()}`, { roleCode: session.roleCode, signal: controller.signal })
        .then((users) => { if (active) setItems(users); })
        .catch((error: unknown) => {
          if (active && !(error instanceof DOMException && error.name === "AbortError")) setItems([]);
        })
        .finally(() => { if (active) setLoading(false); });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [classId, disabled, open, query, role, session.roleCode]);

  /** Chốt người dùng, đóng danh sách và báo userId về form cha. */
  function choose(user: DirectoryUser): void {
    setSelected(user); setQuery(""); setOpen(false); onChange(user.id);
  }

  return (
    <label className="relative block min-w-0 text-xs font-semibold text-slate-700 dark:text-slate-300">
      {label}
      {selected && value ? (
        <div className="mt-1.5 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 px-3 shadow-2xs">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400">
              <UserRound size={14} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100">{selected.displayName}</strong>
              <small className="block truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{selected.email}</small>
            </span>
          </div>
          <button
            aria-label={`Bỏ chọn ${selected.displayName}`}
            className="grid size-7 shrink-0 place-items-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500 transition-colors"
            disabled={disabled}
            onClick={() => { setSelected(null); onChange(""); }}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={15} />
          <input
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            className="min-h-10 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 pl-9 pr-4 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all duration-150 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/15 disabled:cursor-not-allowed disabled:bg-slate-100 dark:disabled:bg-slate-800/50 shadow-2xs"
            disabled={disabled}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={role === "INSTRUCTOR" ? "Tìm theo tên hoặc email giảng viên" : "Tìm theo tên hoặc email học viên"}
            role="combobox"
            value={query}
          />
          {open ? (
            <div className="absolute z-40 mt-1.5 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-lg dark:shadow-2xl" id={listboxId} role="listbox">
              {loading ? (
                <p className="px-3 py-3 text-xs sm:text-sm font-normal text-slate-400 dark:text-slate-500">Đang tìm người dùng…</p>
              ) : items.length ? (
                items.map((user) => (
                  <button
                    aria-selected={value === user.id}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-slate-800 dark:text-slate-200 hover:bg-sky-50/60 dark:hover:bg-slate-800 transition-colors"
                    key={user.id}
                    onClick={() => choose(user)}
                    role="option"
                    type="button"
                  >
                    <span className="min-w-0">
                      <strong className="block truncate text-xs sm:text-sm font-semibold">{user.displayName}</strong>
                      <small className="block truncate text-[11px] font-normal text-slate-400 dark:text-slate-500">{user.email}</small>
                    </span>
                    {value === user.id ? <Check className="shrink-0 text-sky-600 dark:text-sky-400" size={15} /> : null}
                  </button>
                ))
              ) : (
                <p className="px-3 py-3 text-xs sm:text-sm font-normal leading-5 text-slate-400 dark:text-slate-500">
                  Không tìm thấy người dùng phù hợp hoặc người dùng đã thuộc lớp.
                </p>
              )}
            </div>
          ) : null}
        </div>
      )}
    </label>
  );
}
