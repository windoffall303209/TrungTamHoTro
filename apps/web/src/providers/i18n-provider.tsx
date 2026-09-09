"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, isSupportedLocale, LOCALE_STORAGE_KEY, translateText, type SupportedLocale } from "@/i18n/catalog";

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (value: string) => string;
  formatDateTime: (value: string | number | Date) => string;
  formatNumber: (value: number) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const sourceText = new WeakMap<Text, string>();
const localizedText = new WeakMap<Text, string>();
const sourceAttributes = new WeakMap<Element, Map<string, string>>();
const localizedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ["aria-label", "placeholder", "title", "alt"] as const;

/** Bỏ qua nội dung do người dùng tạo hoặc vùng mã, nơi dịch tự động sẽ làm sai dữ liệu. */
function shouldSkip(node: Node): boolean {
  const parent = node instanceof Element ? node : node.parentElement;
  return Boolean(parent?.closest("[data-i18n-skip],script,style,code,pre,textarea"));
}

/** Dịch một text node và giữ nguồn tiếng Việt để chuyển ngược không mất dữ liệu. */
function localizeTextNode(node: Text, locale: SupportedLocale): void {
  if (shouldSkip(node)) return;
  const remembered = sourceText.get(node);
  if (!remembered) sourceText.set(node, node.data);
  else if (localizedText.has(node) && node.data !== localizedText.get(node)) sourceText.set(node, node.data);
  const source = sourceText.get(node) ?? node.data;
  const translated = translateText(source, locale);
  if (node.data !== translated) node.data = translated;
  localizedText.set(node, translated);
}

/** Dịch các thuộc tính hỗ trợ và placeholder, đồng thời bảo toàn giá trị nguồn. */
function localizeElement(element: Element, locale: SupportedLocale): void {
  if (shouldSkip(element)) return;
  const remembered = sourceAttributes.get(element) ?? new Map<string, string>();
  const previousTranslations = localizedAttributes.get(element) ?? new Map<string, string>();
  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    const source = remembered.get(attribute);
    if (!source || (previousTranslations.has(attribute) && current !== previousTranslations.get(attribute))) remembered.set(attribute, current);
    const translated = translateText(remembered.get(attribute) ?? current, locale);
    if (current !== translated) element.setAttribute(attribute, translated);
    previousTranslations.set(attribute, translated);
  }
  sourceAttributes.set(element, remembered);
  localizedAttributes.set(element, previousTranslations);
}

/** Áp locale lên toàn bộ cây DOM hiện hữu trong một lượt duyệt. */
function localizeTree(root: Node, locale: SupportedLocale): void {
  if (root instanceof Text) localizeTextNode(root, locale);
  if (root instanceof Element) localizeElement(root, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) localizeTextNode(current, locale);
    else if (current instanceof Element) localizeElement(current, locale);
    current = walker.nextNode();
  }
}

/** Cung cấp locale toàn ứng dụng và đồng bộ nội dung động phát sinh sau render. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!isSupportedLocale(stored)) return;

    const frame = window.requestAnimationFrame(() => setLocaleState(stored));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = locale === "en-US" ? "Wind EDU | Bilingual Teaching Center" : "Wind EDU | Trung tâm hỗ trợ giảng dạy";
    localizeTree(document.body, locale);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTextNode(mutation.target as Text, locale);
        else if (mutation.type === "attributes" && mutation.target instanceof Element) localizeElement(mutation.target, locale);
        else for (const node of mutation.addedNodes) localizeTree(node, locale);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [locale]);

  /** Lưu locale hợp lệ và cập nhật UI ngay trong cùng phiên. */
  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    document.cookie = `wind-edu-locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocaleState(nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (text) => translateText(text, locale),
    formatDateTime: (input) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(input)),
    formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Truy cập i18n context và báo lỗi cấu hình rõ ràng khi provider bị thiếu. */
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
