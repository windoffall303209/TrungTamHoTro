"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const storageKey = "wind-edu-theme";
const themeEvent = "wind-edu-theme-change";

/** Đọc theme đã áp dụng trực tiếp trên document root. */
function activeTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" || document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

/** Đồng bộ theme giữa component và các tab trình duyệt qua custom/storage event. */
function subscribe(callback: () => void): () => void {
  /** Đồng bộ lựa chọn giao diện khi một tab khác thay đổi localStorage. */
  const syncStoredTheme = (event: StorageEvent) => {
    if (event.key !== storageKey || (event.newValue !== "light" && event.newValue !== "dark")) return;
    const next = event.newValue;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#080c14" : "#f8fafc");
    callback();
  };
  window.addEventListener(themeEvent, callback);
  window.addEventListener("storage", syncStoredTheme);
  return () => {
    window.removeEventListener(themeEvent, callback);
    window.removeEventListener("storage", syncStoredTheme);
  };
}

/** Nút chuyển sáng/tối tối giản, mượt mà, lưu trạng thái lâu dài. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, activeTheme, () => "light");

  /** Chuyển đổi theme mượt mà không chớp mắt, lưu cả cookie và localStorage. */
  function toggleTheme(): void {
    const root = document.documentElement;
    const current = activeTheme();
    const nextTheme: Theme = current === "dark" ? "light" : "dark";

    root.classList.add("theme-changing");
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    if (nextTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "dark" ? "#080c14" : "#f8fafc");

    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // Vẫn đổi theme trong tab hiện tại và lưu cookie nếu localStorage bị chặn.
    }
    document.cookie = `${storageKey}=${nextTheme}; path=/; max-age=31536000; SameSite=Lax`;
    window.dispatchEvent(new Event(themeEvent));
    window.setTimeout(() => root.classList.remove("theme-changing"), 200);
  }

  const isDark = theme === "dark";
  const label = isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";

  return (
    <button
      aria-label={label}
      aria-pressed={isDark}
      className="relative grid size-[42px] shrink-0 place-items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 hover:border-sky-500 hover:text-sky-600 dark:hover:text-sky-400 dark:hover:border-sky-500/50 shadow-2xs transition-all duration-150 active:scale-95"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      <Moon aria-hidden="true" className="theme-icon-moon" size={18} />
      <Sun aria-hidden="true" className="theme-icon-sun" size={19} />
    </button>
  );
}
