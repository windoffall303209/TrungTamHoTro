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
  headers.set("x-role-code", options.roleCode ?? "SYSTEM_ADMIN");
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, cache: "no-store" });
  const payload = await response.json() as ApiEnvelope<T> | { error?: { message?: string; details?: unknown } };
  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined;
    throw new ApiError(error?.message ?? "Không thể xử lý yêu cầu.", response.status, error?.details);
  }
  return (payload as ApiEnvelope<T>).data;
}

