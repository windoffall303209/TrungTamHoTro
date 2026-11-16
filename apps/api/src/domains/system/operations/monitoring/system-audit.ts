import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../../database/prisma.service.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import { IntegrationConfig } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Ghi audit vào DB và che dữ liệu nhạy cảm trước khi lưu. */
export async function logDatabase(
  database: PrismaService | Prisma.TransactionClient,
  actorId: string,
  action: string,
  target: string,
  detail: string,
): Promise<void> {
  await database.auditLog.create({
    data: {
      actorId,
      action,
      entityType: "system",
      entityId: target,
      context: { detail },
    },
  });
}

/** Đọc chuỗi từ JSON hoặc dùng fallback. */
export function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Đọc số hữu hạn từ JSON hoặc dùng fallback. */
export function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Đọc boolean từ JSON hoặc dùng fallback. */
export function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Đọc mảng chuỗi từ JSON và sao chép fallback để tránh mutation. */
export function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [...fallback];
}

/** Che giá trị password/token/secret/credential trong chuỗi audit. */
export function redactSensitive(value: string): string {
  return value.replace(
    /(password|token|secret|credential|authorization)\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED]",
  );
}

/** Type guard cho danh mục provider phòng học được hỗ trợ. */
export function isProvider(
  value: string,
): value is IntegrationConfig["provider"] {
  return value === "GOOGLE_MEET" || value === "ZOOM" || value === "JITSI";
}

/** Ghi audit vào đầu state in-memory cho chế độ không kết nối DB. */
export function log(
  serviceContext: SystemServiceContext,
  actorId: string,
  action: string,
  target: string,
  detail: string,
): void {
  serviceContext.audit.unshift({
    id: `audit-${randomUUID()}`,
    actor: actorId,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });
}
