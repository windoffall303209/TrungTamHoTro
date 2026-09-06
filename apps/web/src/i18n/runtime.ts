import { isSupportedLocale, LOCALE_STORAGE_KEY, type SupportedLocale } from "./catalog";

/** Trả locale hiện hành an toàn trong cả render phía server và trình duyệt. */
export function activeLocale(): SupportedLocale {
  if (typeof window === "undefined") return "vi-VN";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : document.documentElement.lang === "en-US" ? "en-US" : "vi-VN";
}
