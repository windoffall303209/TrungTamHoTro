"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_LOCALE,
  isEnglishCatalogLoaded,
  isSupportedLocale,
  loadEnglishCatalog,
  LOCALE_STORAGE_KEY,
  translateText,
  type SupportedLocale,
} from "@/i18n/catalog";

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

/** Bỏ qua nội dung văn bản do người dùng tạo hoặc vùng mã, nơi dịch tự động sẽ làm sai dữ liệu. */
function shouldSkipTextNode(node: Node): boolean {
  const parent = node instanceof Element ? node : node.parentElement;
  return Boolean(parent?.closest('[data-i18n-skip],[translate="no"],script,style,code,pre,textarea'));
}

/** Bỏ qua vùng mã hoặc đánh dấu không dịch khi dịch các thuộc tính giao diện (placeholder, aria-label, title). */
function shouldSkipElement(element: Element): boolean {
  return Boolean(element.closest('[data-i18n-skip],[translate="no"],script,style,code,pre'));
}

/** Dịch một text node và giữ nguồn tiếng Việt để chuyển ngược không mất dữ liệu. */
function localizeTextNode(node: Text, locale: SupportedLocale): void {
  if (shouldSkipTextNode(node)) return;
  const remembered = sourceText.get(node);
  if (!remembered) sourceText.set(node, node.data);
  else if (localizedText.has(node) && node.data !== localizedText.get(node)) sourceText.set(node, node.data);
  const source = sourceText.get(node) ?? node.data;
  const translated = translateText(source, locale);
  if (node.data !== translated) node.data = translated;
  localizedText.set(node, translated);
}

/** Dịch các thuộc tính hỗ trợ và placeholder (kể cả trên textarea), đồng thời bảo toàn giá trị nguồn. */
function localizeElement(element: Element, locale: SupportedLocale): void {
  if (shouldSkipElement(element)) return;
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
  if (root instanceof Text) {
    localizeTextNode(root, locale);
    return;
  }
  if (root instanceof Element) {
    if (shouldSkipElement(root)) return;
    localizeElement(root, locale);
    if (shouldSkipTextNode(root)) return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) localizeTextNode(current, locale);
    else if (current instanceof Element) localizeElement(current, locale);
    current = walker.nextNode();
  }
}

/** Cung cấp locale toàn ứng dụng, chỉ nạp từ điển EN khi cần và đồng bộ DOM khi đổi ngôn ngữ. */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);
  const [englishReady, setEnglishReady] = useState<boolean>(() => isEnglishCatalogLoaded());
  const localizedDomToNonDefaultRef = useRef(false);

  useEffect(() => {
    let stored: string | null;
    try {
      stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      return;
    }
    if (!isSupportedLocale(stored) || stored === DEFAULT_LOCALE) return;

    const frame = window.requestAnimationFrame(() => setLocaleState(stored));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = locale === "en-US" ? "Wind EDU | Bilingual Teaching Center" : "Wind EDU | Trung tâm hỗ trợ giảng dạy";

    // Văn bản gốc của giao diện là tiếng Việt: ở vi-VN không tải từ điển EN và chỉ duyệt DOM khi cần khôi phục từ EN.
    if (locale === "vi-VN") {
      if (localizedDomToNonDefaultRef.current) {
        localizeTree(document.body, "vi-VN");
        localizedDomToNonDefaultRef.current = false;
      }
      return;
    }

    let cancelled = false;
    let observer: MutationObserver | null = null;

    // Áp bản dịch tiếng Anh lên toàn bộ DOM và bật theo dõi nút phát sinh sau render.
    const applyEnglishDom = (): void => {
      if (cancelled) return;
      localizedDomToNonDefaultRef.current = true;
      localizeTree(document.body, "en-US");
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") localizeTextNode(mutation.target as Text, "en-US");
          else if (mutation.type === "attributes" && mutation.target instanceof Element) localizeElement(mutation.target, "en-US");
          else for (const node of mutation.addedNodes) localizeTree(node, "en-US");
        }
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...translatedAttributes],
      });
    };

    if (isEnglishCatalogLoaded()) {
      applyEnglishDom();
    } else {
      void loadEnglishCatalog()
        .then(() => {
          if (cancelled) return;
          setEnglishReady(true);
          applyEnglishDom();
        })
        .catch(() => {
          // Nếu nạp chunk ngôn ngữ lỗi mạng, giữ nguyên văn bản gốc để giao diện không gãy.
        });
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [locale]);

  /** Lưu locale hợp lệ và cập nhật UI ngay trong cùng phiên. */
  const setLocale = useCallback((nextLocale: SupportedLocale) => {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Keep the language switch usable when persistent browser storage is disabled.
    }
    document.cookie = `wind-edu-locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocaleState(nextLocale);
  }, []);

  /** Dịch chuỗi giao diện đồng bộ theo locale và trạng thái nạp từ điển tiếng Anh hiện tại. */
  const translate = useCallback(
    (text: string) => (locale === "en-US" && !englishReady ? text : translateText(text, locale)),
    [locale, englishReady],
  );

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: translate,
    formatDateTime: (input) => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(input)),
    formatNumber: (input) => new Intl.NumberFormat(locale).format(input),
  }), [locale, setLocale, translate]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const defaultI18nValue: I18nContextValue = {
  locale: "vi-VN",
  setLocale: () => {},
  t: (text: string) => text,
  formatDateTime: (input) =>
    new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(input),
    ),
  formatNumber: (input) => new Intl.NumberFormat("vi-VN").format(input),
};

// Truy cập i18n context và trả fallback an toàn khi render ngoài provider.
export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  return value ?? defaultI18nValue;
}
