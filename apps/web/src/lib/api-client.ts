import type { RoleCode } from "./app-types";

interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string; timestamp: string };
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

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

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, cache: "no-store", credentials: "include" });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string; details?: unknown } };
  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined;
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("wind-edu:unauthorized"));
    }
    throw new ApiError(error?.message ?? "Không thể xử lý yêu cầu.", response.status, error?.details);
  }
  return (payload as ApiEnvelope<T>).data;
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
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = encodedName ? decodeURIComponent(encodedName) : "hoc-lieu";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export async function previewApiFile(path: string, roleCode: RoleCode): Promise<void> {
  const previewWindow = window.open("about:blank", "_blank", "noopener,noreferrer");
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: "application/pdf,image/*", "x-role-code": roleCode },
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string; details?: unknown } };
      throw new ApiError(payload.error?.message ?? "Không thể mở bản xem trước.", response.status, payload.error?.details);
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    if (previewWindow) previewWindow.location.href = blobUrl;
    else window.location.href = blobUrl;
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (error) {
    previewWindow?.close();
    throw error;
  }
}
