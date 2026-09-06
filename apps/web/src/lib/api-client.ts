import type { RoleCode } from "./app-types";
import { isSupportedLocale, LOCALE_STORAGE_KEY, translateText, type SupportedLocale } from "@/i18n/catalog";

interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string; timestamp: string };
}

type ApiPayload<T> = ApiEnvelope<T> | { error?: { message?: string; details?: unknown } };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
let csrfToken = "";

/** Đọc locale hiện hành cho request, lỗi cục bộ và cửa sổ xem trước độc lập. */
function requestLocale(): SupportedLocale {
  if (typeof window === "undefined") return "vi-VN";
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : document.documentElement.lang === "en-US" ? "en-US" : "vi-VN";
}

/** Ghép đường dẫn tương đối với API origin dùng cho ảnh/tài nguyên công khai. */
export function publicApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Lỗi API chuẩn hóa gồm HTTP status và details để màn hình xử lý thống nhất. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

/** Gửi request JSON kèm cookie, role và CSRF; bóc envelope và phát sự kiện khi phiên hết hạn. */
export async function apiRequest<T>(
  path: string,
  options: RequestInit & { roleCode?: RoleCode } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("accept-language", requestLocale());
  if (options.roleCode) headers.set("x-role-code", options.roleCode);
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase()) && csrfToken) headers.set("x-csrf-token", csrfToken);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, cache: "no-store", credentials: "include" });
  const rawBody = await response.text();
  let payload: ApiPayload<T> | undefined;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as ApiPayload<T>;
    } catch {
      throw new ApiError(translateText("Phản hồi từ hệ thống không đúng định dạng.", requestLocale()), response.status);
    }
  }
  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("wind-edu:unauthorized"));
    }
    throw new ApiError(translateText(error?.message ?? "Không thể xử lý yêu cầu.", requestLocale()), response.status, error?.details);
  }
  if (!payload) return undefined as T;
  const data = (payload as ApiEnvelope<T>).data;
  if (data && typeof data === "object" && "csrfToken" in data && typeof data.csrfToken === "string") csrfToken = data.csrfToken;
  return data;
}

/** Đọc tên tệp Unicode theo RFC 5987 hoặc filename thường từ Content-Disposition. */
export function apiFileName(disposition: string, fallback = "hoc-lieu"): string {
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encodedName) {
    try { return decodeURIComponent(encodedName); } catch { return fallback; }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** Tải blob có xác thực, tạo anchor tạm và thu hồi object URL sau khi bắt đầu download. */
export async function downloadApiFile(path: string, roleCode: RoleCode): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { accept: "application/octet-stream", "accept-language": requestLocale(), "x-role-code": roleCode },
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
    throw new ApiError(translateText(payload.error?.message ?? "Không thể tải học liệu.", requestLocale()), response.status, payload.error?.details);
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = apiFileName(response.headers.get("content-disposition") ?? "");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

/** Mở cửa sổ trước thao tác async để tránh popup blocker, sau đó tải và render bản xem trước có nút đóng. */
export async function previewApiFile(path: string, roleCode: RoleCode, fallbackFileName = "Học liệu"): Promise<void> {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) throw new ApiError("Trình duyệt đang chặn cửa sổ xem trước. Hãy cho phép pop-up cho trang này rồi thử lại.", 0);
  const palette = previewPalette();
  const locale = requestLocale();
  previewWindow.document.title = translateText("Đang tải bản xem trước…", locale);
  previewWindow.document.body.textContent = translateText("Đang tải bản xem trước…", locale);
  previewWindow.document.body.style.cssText = `margin:0;display:grid;min-height:100vh;place-items:center;background:${palette.canvas};color:${palette.ink};font-weight:600;font-size:15px;font-family:${palette.fontFamily}`;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: "application/pdf,image/*,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", "accept-language": locale, "x-role-code": roleCode },
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
      throw new ApiError(translateText(payload.error?.message ?? "Không thể mở bản xem trước.", locale), response.status, payload.error?.details);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const mimeType = (response.headers.get("content-type") ?? blob.type).split(";", 1)[0]?.toLowerCase() ?? "application/octet-stream";
    const fileName = apiFileName(response.headers.get("content-disposition") ?? "", fallbackFileName);
    renderPreviewWindow(previewWindow, { blobUrl, fileName, mimeType }, palette, locale);
    previewWindow.addEventListener("pagehide", () => URL.revokeObjectURL(blobUrl), { once: true });
    previewWindow.focus();
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}

interface PreviewPalette {
  action: string;
  actionInk: string;
  canvas: string;
  colorScheme: "light" | "dark";
  fontFamily: string;
  ink: string;
  inkSoft: string;
  rule: string;
  surface: string;
  surfaceMuted: string;
}

/** Chụp token màu/font hiện tại để cửa sổ xem trước đồng bộ sáng/tối với ứng dụng. */
function previewPalette(): PreviewPalette {
  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const bodyStyles = window.getComputedStyle(document.body);
  const read = (token: string, fallback: string) => styles.getPropertyValue(token).trim() || fallback;
  return {
    action: read("--action", "#102a43"),
    actionInk: read("--action-ink", "#fffdfa"),
    canvas: read("--canvas", "#f7f4ed"),
    colorScheme: root.dataset.theme === "dark" ? "dark" : "light",
    fontFamily: bodyStyles.fontFamily || '"Be Vietnam Pro", Arial, sans-serif',
    ink: read("--ink", "#102a43"),
    inkSoft: read("--ink-soft", "#516274"),
    rule: read("--rule-strong", "#a9bac1"),
    surface: read("--surface", "#fffdfa"),
    surfaceMuted: read("--surface-muted", "#e9eef0"),
  };
}

/** Dựng UI xem trước PDF/ảnh/video; định dạng Word hiển thị hướng dẫn tải xuống. */
function renderPreviewWindow(previewWindow: Window, file: { blobUrl: string; fileName: string; mimeType: string }, palette: PreviewPalette, locale: SupportedLocale): void {
  const doc = previewWindow.document;
  doc.title = `${file.fileName} · Wind EDU`;
  try { previewWindow.history.replaceState(null, "", "/xem-tep"); } catch { /* about:blank may reject history changes in hardened browsers */ }
  doc.documentElement.lang = locale;
  doc.head.replaceChildren();
  doc.body.replaceChildren();

  const style = doc.createElement("style");
  style.textContent = `
    :root{color-scheme:${palette.colorScheme}}*{box-sizing:border-box}html,body{height:100%;margin:0}body{overflow:hidden;background:${palette.surfaceMuted};color:${palette.ink};font-family:${palette.fontFamily}}
    header{height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;border-bottom:1px solid ${palette.rule};background:${palette.surface}}
    strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.actions{display:flex;flex:none;gap:8px}
    a,button{min-height:42px;border:1px solid ${palette.rule};border-radius:12px;padding:0 14px;background:${palette.surface};color:${palette.ink};font:700 14px ${palette.fontFamily};text-decoration:none;cursor:pointer;display:inline-flex;align-items:center}
    button{background:${palette.action};color:${palette.actionInk};border-color:${palette.action}}main{height:calc(100% - 64px);display:grid;place-items:center;padding:16px}
    iframe,img,video{width:100%;height:100%;border:0;background:${palette.surface};object-fit:contain}.unsupported{max-width:560px;padding:28px;text-align:center;background:${palette.surface};border:1px solid ${palette.rule};border-radius:12px}
    .unsupported h1{margin:0 0 10px;font-size:22px}.unsupported p{margin:0;color:${palette.inkSoft};line-height:1.6}
  `;
  doc.head.appendChild(style);

  const header = doc.createElement("header");
  const title = doc.createElement("strong");
  title.textContent = file.fileName;
  const actions = doc.createElement("div");
  actions.className = "actions";
  const download = doc.createElement("a");
  download.href = file.blobUrl;
  download.download = file.fileName;
  download.textContent = translateText("Tải xuống", locale);
  const close = doc.createElement("button");
  close.type = "button";
  close.textContent = translateText("Đóng", locale);
  close.addEventListener("click", () => previewWindow.close());
  actions.append(download, close);
  header.append(title, actions);

  const main = doc.createElement("main");
  if (file.mimeType === "application/pdf") {
    const frame = doc.createElement("iframe");
    frame.src = file.blobUrl;
    frame.title = `${translateText("Bản xem trước", locale)} ${file.fileName}`;
    main.appendChild(frame);
  } else if (file.mimeType.startsWith("image/")) {
    const image = doc.createElement("img");
    image.src = file.blobUrl;
    image.alt = file.fileName;
    main.appendChild(image);
  } else if (file.mimeType === "video/mp4") {
    const video = doc.createElement("video");
    video.src = file.blobUrl;
    video.controls = true;
    main.appendChild(video);
  } else {
    const message = doc.createElement("section");
    message.className = "unsupported";
    const heading = doc.createElement("h1");
    heading.textContent = translateText("Định dạng này không xem trực tiếp được", locale);
    const detail = doc.createElement("p");
    detail.textContent = translateText("Tệp Word đã được lưu an toàn. Hãy chọn “Tải xuống” để mở bằng Microsoft Word hoặc ứng dụng tương thích.", locale);
    message.append(heading, detail);
    main.appendChild(message);
  }
  doc.body.append(header, main);
}
