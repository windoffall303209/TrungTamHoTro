import type { RoleCode } from "./app-types";

interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string; timestamp: string };
}

type ApiPayload<T> = ApiEnvelope<T> | { error?: { message?: string; details?: unknown } };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
let csrfToken = "";

export function publicApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { roleCode?: RoleCode } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
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
      throw new ApiError("Phản hồi từ hệ thống không đúng định dạng.", response.status);
    }
  }
  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("wind-edu:unauthorized"));
    }
    throw new ApiError(error?.message ?? "Không thể xử lý yêu cầu.", response.status, error?.details);
  }
  if (!payload) return undefined as T;
  const data = (payload as ApiEnvelope<T>).data;
  if (data && typeof data === "object" && "csrfToken" in data && typeof data.csrfToken === "string") csrfToken = data.csrfToken;
  return data;
}

export function apiFileName(disposition: string, fallback = "hoc-lieu"): string {
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encodedName) {
    try { return decodeURIComponent(encodedName); } catch { return fallback; }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

export async function downloadApiFile(path: string, roleCode: RoleCode): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { accept: "application/octet-stream", "x-role-code": roleCode },
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
    throw new ApiError(payload.error?.message ?? "Không thể tải học liệu.", response.status, payload.error?.details);
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

export async function previewApiFile(path: string, roleCode: RoleCode, fallbackFileName = "Học liệu"): Promise<void> {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) throw new ApiError("Trình duyệt đang chặn cửa sổ xem trước. Hãy cho phép pop-up cho trang này rồi thử lại.", 0);
  previewWindow.document.title = "Đang tải bản xem trước…";
  previewWindow.document.body.textContent = "Đang tải bản xem trước…";
  previewWindow.document.body.style.cssText = "margin:0;display:grid;min-height:100vh;place-items:center;background:#f7f4ed;color:#102a43;font:600 15px system-ui,sans-serif";
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: "application/pdf,image/*,video/mp4,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x-role-code": roleCode },
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
      throw new ApiError(payload.error?.message ?? "Không thể mở bản xem trước.", response.status, payload.error?.details);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const mimeType = (response.headers.get("content-type") ?? blob.type).split(";", 1)[0]?.toLowerCase() ?? "application/octet-stream";
    const fileName = apiFileName(response.headers.get("content-disposition") ?? "", fallbackFileName);
    renderPreviewWindow(previewWindow, { blobUrl, fileName, mimeType });
    previewWindow.addEventListener("pagehide", () => URL.revokeObjectURL(blobUrl), { once: true });
    previewWindow.focus();
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}

function renderPreviewWindow(previewWindow: Window, file: { blobUrl: string; fileName: string; mimeType: string }): void {
  const doc = previewWindow.document;
  doc.title = `${file.fileName} · Wind EDU`;
  try { previewWindow.history.replaceState(null, "", "/xem-tep"); } catch { /* about:blank may reject history changes in hardened browsers */ }
  doc.documentElement.lang = "vi";
  doc.head.replaceChildren();
  doc.body.replaceChildren();

  const style = doc.createElement("style");
  style.textContent = `
    *{box-sizing:border-box}html,body{height:100%;margin:0}body{overflow:hidden;background:#e9eef0;color:#102a43;font-family:Arial,sans-serif}
    header{height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 20px;border-bottom:1px solid #a9bac1;background:#fffdfa}
    strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.actions{display:flex;flex:none;gap:8px}
    a,button{min-height:42px;border:1px solid #a9bac1;border-radius:10px;padding:0 14px;background:#fffdfa;color:#102a43;font:700 14px Arial,sans-serif;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center}
    button{background:#102a43;color:#fff;border-color:#102a43}main{height:calc(100% - 64px);display:grid;place-items:center;padding:16px}
    iframe,img,video{width:100%;height:100%;border:0;background:#fff;object-fit:contain}.unsupported{max-width:560px;padding:28px;text-align:center;background:#fffdfa;border:1px solid #a9bac1;border-radius:14px}
    .unsupported h1{margin:0 0 10px;font-size:22px}.unsupported p{margin:0;color:#516274;line-height:1.6}
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
  download.textContent = "Tải xuống";
  const close = doc.createElement("button");
  close.type = "button";
  close.textContent = "Đóng";
  close.addEventListener("click", () => previewWindow.close());
  actions.append(download, close);
  header.append(title, actions);

  const main = doc.createElement("main");
  if (file.mimeType === "application/pdf") {
    const frame = doc.createElement("iframe");
    frame.src = file.blobUrl;
    frame.title = `Bản xem trước ${file.fileName}`;
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
    heading.textContent = "Định dạng này không xem trực tiếp được";
    const detail = doc.createElement("p");
    detail.textContent = "Tệp Word đã được lưu an toàn. Hãy chọn “Tải xuống” để mở bằng Microsoft Word hoặc ứng dụng tương thích.";
    message.append(heading, detail);
    main.appendChild(message);
  }
  doc.body.append(header, main);
}
