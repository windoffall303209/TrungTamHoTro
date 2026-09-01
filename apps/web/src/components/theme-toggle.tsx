"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const storageKey = "wind-edu-theme";
const themeEvent = "wind-edu-theme-change";

function activeTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(callback: () => void): () => void {
  const syncStoredTheme = (event: StorageEvent) => {
    if (event.key !== storageKey || (event.newValue !== "light" && event.newValue !== "dark")) return;
    document.documentElement.dataset.theme = event.newValue;
    document.documentElement.style.colorScheme = event.newValue;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", event.newValue === "dark" ? "#0b1620" : "#f7f4ed");
    callback();
  };
  window.addEventListener(themeEvent, callback);
  window.addEventListener("storage", syncStoredTheme);
  return () => {
    window.removeEventListener(themeEvent, callback);
    window.removeEventListener("storage", syncStoredTheme);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, activeTheme, () => "light");

  function toggleTheme(): void {
    const root = document.documentElement;
    const nextTheme: Theme = activeTheme() === "dark" ? "light" : "dark";
    root.classList.add("theme-changing");
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "dark" ? "#0b1620" : "#f7f4ed");
    window.localStorage.setItem(storageKey, nextTheme);
    window.dispatchEvent(new Event(themeEvent));
    window.setTimeout(() => root.classList.remove("theme-changing"), 220);
  }

  const label = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";

  return (
    <button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="grid size-11 shrink-0 place-items-center rounded-full border border-[var(--rule-strong)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] hover:text-[var(--accent-deep)]"
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      <Moon aria-hidden="true" className="theme-icon-moon" size={17} />
      <Sun aria-hidden="true" className="theme-icon-sun" size={18} />
    </button>
  );
}
