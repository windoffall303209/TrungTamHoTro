import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { IntegrationConfig, SystemAlertView } from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Upsert cảnh báo theo fingerprint để cùng sự cố không sinh bản ghi trùng. */
export async function recordAlert(
  serviceContext: SystemServiceContext,
  fingerprint: string,
  serviceName: string,
  severity: SystemAlertView["severity"],
  summary: string,
  metricValue?: number,
  threshold?: number,
): Promise<void> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.systemAlert.findUnique({
      where: { fingerprint },
    });
    if (
      current?.status === "MUTED" &&
      current.mutedUntil &&
      current.mutedUntil > new Date()
    )
      return;
    await prisma.systemAlert.upsert({
      where: { fingerprint },
      update: {
        serviceName,
        severity,
        summary,
        metricValue,
        threshold,
        status: current?.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN",
        recoveredAt: null,
      },
      create: {
        id: `alert-${randomUUID()}`,
        fingerprint,
        serviceName,
        severity,
        summary,
        metricValue,
        threshold,
      },
    });
    return;
  }
  const current = serviceContext.alerts.find(
    (item) => item.fingerprint === fingerprint,
  );
  if (
    current?.status === "MUTED" &&
    current.mutedUntil &&
    new Date(current.mutedUntil) > new Date()
  )
    return;
  if (current)
    Object.assign(current, {
      serviceName,
      severity,
      summary,
      metricValue,
      threshold,
      status: current.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN",
      recoveredAt: undefined,
      updatedAt: new Date().toISOString(),
    });
  else {
    const timestamp = new Date().toISOString();
    serviceContext.alerts.unshift({
      id: `alert-${randomUUID()}`,
      fingerprint,
      serviceName,
      severity,
      status: "OPEN",
      summary,
      metricValue,
      threshold,
      detectedAt: timestamp,
      updatedAt: timestamp,
    });
  }
}

/** Tự động giải quyết cảnh báo đang mở khi metric trở lại bình thường. */
export async function recoverAlert(
  serviceContext: SystemServiceContext,
  fingerprint: string,
): Promise<void> {
  const prisma = serviceContext.database();
  if (prisma) {
    await prisma.systemAlert.updateMany({
      where: { fingerprint, status: { not: "RESOLVED" } },
      data: { status: "RESOLVED", recoveredAt: new Date() },
    });
    return;
  }
  const current = serviceContext.alerts.find(
    (item) => item.fingerprint === fingerprint && item.status !== "RESOLVED",
  );
  if (current)
    Object.assign(current, {
      status: "RESOLVED",
      recoveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
}

/** Đếm số bản ghi thuộc danh mục để ghi metadata export. */
export async function countExportRows(
  prisma: PrismaService,
  category: string,
): Promise<number> {
  if (category === "AUDIT") return prisma.auditLog.count();
  if (category === "LEARNING") {
    const [courses, classes, attempts] = await prisma.$transaction([
      prisma.course.count(),
      prisma.learningClass.count(),
      prisma.examAttempt.count(),
    ]);
    return courses + classes + attempts;
  }
  return prisma.user.count();
}

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

/** Thu hẹp Prisma JSON thành object để đọc cấu hình an toàn. */
export function asRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

/** Trích danh sách placeholder {{name}} duy nhất từ subject/body mẫu. */
export function extractTemplateVariables(value: string): string[] {
  return [
    ...new Set(
      [...value.matchAll(/{{([a-zA-Z0-9_]+)}}/g)]
        .map((match) => match[1] ?? "")
        .filter(Boolean),
    ),
  ];
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
