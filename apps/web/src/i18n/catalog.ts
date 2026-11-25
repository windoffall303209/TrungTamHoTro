export type SupportedLocale = "vi-VN" | "en-US";

export const DEFAULT_LOCALE: SupportedLocale = "vi-VN";
export const LOCALE_STORAGE_KEY = "wind-edu-locale";

type EnglishTranslator = (value: string) => string;

let englishTranslator: EnglishTranslator | null = null;
let englishLoadPromise: Promise<EnglishTranslator> | null = null;

/** Kiểm tra giá trị locale lưu trữ trước khi dùng trong UI. */
export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "vi-VN" || value === "en-US";
}

/** Kiểm tra từ điển tiếng Anh đã được nạp vào bộ nhớ hiện tại hay chưa. */
export function isEnglishCatalogLoaded(): boolean {
  return englishTranslator !== null;
}

/** Đặt lại bộ nhớ đệm từ điển tiếng Anh cho các ca unit test tách biệt trạng thái lạnh. */
export function resetEnglishCatalogForTests(): void {
  englishTranslator = null;
  englishLoadPromise = null;
}

/** Nạp bất đồng bộ từ điển tiếng Anh thành chunk riêng, chỉ tải một lần khi chuyển sang en-US. */
export async function loadEnglishCatalog(): Promise<EnglishTranslator> {
  if (englishTranslator) return englishTranslator;
  if (!englishLoadPromise) {
    englishLoadPromise = import("./en-catalog")
      .then((module) => {
        englishTranslator = module.translateToEnglish;
        return module.translateToEnglish;
      })
      .catch((error: unknown) => {
        englishLoadPromise = null;
        throw error;
      });
  }
  return englishLoadPromise;
}

/** Dịch đồng bộ chuỗi giao diện khi từ điển tiếng Anh đã sẵn sàng; vi-VN luôn trả nguyên bản không nạp chunk. */
export function translateText(value: string, locale: SupportedLocale): string {
  if (locale === "vi-VN" || !value.trim()) return value;
  if (!englishTranslator) return value;
  return englishTranslator(value);
}

/** Dịch bất đồng bộ chuỗi giao diện hoặc lỗi API, tự nạp từ điển tiếng Anh nếu locale là en-US. */
export async function translateTextAsync(value: string, locale: SupportedLocale): Promise<string> {
  if (locale === "vi-VN" || !value.trim()) return value;
  const translator = await loadEnglishCatalog();
  return translator(value);
}
