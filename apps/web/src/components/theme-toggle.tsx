"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const storageKey = "wind-edu-theme";
const themeEvent = "wind-edu-theme-change";

/** Đọc theme đã áp dụng trực tiếp trên document root. */
function activeTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Đồng bộ theme giữa component và các tab trình duyệt qua custom/storage event. */
function subscribe(callback: () => void): () => void {
  /** Đồng bộ lựa chọn giao diện khi một tab khác thay đổi localStorage. */
  const syncStoredTheme = (event: StorageEvent) => {
    if (event.key !== storageKey || (event.newValue !== "light" && event.newValue !== "dark")) return;
    document.documentElement.dataset.theme = event.newValue;
    document.documentElement.style.colorScheme = event.newValue;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", event.newValue === "dark" ? "#0b1322" : "#f8fafc");
    callback();
  };
  window.addEventListener(themeEvent, callback);
  window.addEventListener("storage", syncStoredTheme);
  return () => {
    window.removeEventListener(themeEvent, callback);
    window.removeEventListener("storage", syncStoredTheme);
  };
}

/** Nút chuyển sáng/tối, lưu lựa chọn và cập nhật màu chrome trình duyệt. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, activeTheme, () => "light");

  /** Áp dụng theme mới tức thời và bật lớp chuyển màu ngắn để giao diện không giật. */
  function toggleTheme(): void {
    const root = document.documentElement;
    const nextTheme: Theme = activeTheme() === "dark" ? "light" : "dark";
    root.classList.add("theme-changing");
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "dark" ? "#0b1322" : "#f8fafc");
    window.localStorage.setItem(storageKey, nextTheme);
    window.dispatchEvent(new Event(themeEvent));
    window.setTimeout(() => root.classList.remove("theme-changing"), 220);
  }

  const label = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--surface)] text-[var(--ink-soft)] hover:border-emerald-500 hover:text-emerald-600 dark:hover:text-emerald-400 shadow-2xs transition-colors"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      <Moon aria-hidden="true" className="theme-icon-moon" size={17} />
      <Sun aria-hidden="true" className="theme-icon-sun" size={18} />
    </button>
  );
}
