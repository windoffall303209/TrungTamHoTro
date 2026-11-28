import { BadRequestException, ConflictException } from "@nestjs/common";
import { assertNoActiveContentMimeTypes } from "../../../../infrastructure/file-signature.js";
import { defaultSettings, SystemSettings } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Trích các trường cấu hình thuần để lưu JSON trong system_settings mà không nhân bản metadata cột. */
function serializeSettingPayload(settings: SystemSettings): Record<string, unknown> {
  return {
    centerName: settings.centerName,
    timezone: settings.timezone,
    locale: settings.locale,
    maxFileSizeMb: settings.maxFileSizeMb,
    storageQuotaMb: settings.storageQuotaMb,
    allowedMimeTypes: settings.allowedMimeTypes,
    notificationSender: settings.notificationSender,
    maintenanceMode: settings.maintenanceMode,
    learnerEmailNotificationsEnabled: settings.learnerEmailNotificationsEnabled,
    aiTutorMaxPerQuestion: settings.aiTutorMaxPerQuestion,
    aiTutorMaxPerExam: settings.aiTutorMaxPerExam,
  };
}

/** Đọc cấu hình hiện hành từ system_settings và áp dụng giá trị mặc định an toàn. */
export async function getSettings(
  serviceContext: SystemServiceContext,
): Promise<SystemSettings> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.systemSetting.findUnique({
      where: { key: "platform" },
    });
    if (!row) return defaultSettings();
    return serviceContext.mapSettings(
      row.value,
      row.updatedAt,
      row.version,
      row.updatedBy,
    );
  }
  return structuredClone(serviceContext.settings);
}

/** Kiểm tra giới hạn/múi giờ, cập nhật trực tiếp bản ghi platform hiện hành và ghi audit_logs. */
export async function updateSettings(
  serviceContext: SystemServiceContext,
  input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>,
  actorId: string,
): Promise<SystemSettings> {
  if (
    input.maxFileSizeMb !== undefined &&
    (input.maxFileSizeMb < 1 || input.maxFileSizeMb > 500)
  )
    throw new BadRequestException("Giới hạn tệp phải từ 1 đến 500 MB.");
  if (
    input.storageQuotaMb !== undefined &&
    (input.storageQuotaMb < 100 || input.storageQuotaMb > 1_000_000)
  )
    throw new BadRequestException(
      "Quota lưu trữ phải từ 100 đến 1.000.000 MB.",
    );
  if (
    input.aiTutorMaxPerQuestion !== undefined &&
    (!Number.isInteger(input.aiTutorMaxPerQuestion) ||
      input.aiTutorMaxPerQuestion < 1 ||
      input.aiTutorMaxPerQuestion > 20)
  )
    throw new BadRequestException(
      "Giới hạn hỏi AI mỗi câu phải từ 1 đến 20 lượt.",
    );
  if (
    input.aiTutorMaxPerExam !== undefined &&
    (!Number.isInteger(input.aiTutorMaxPerExam) ||
      input.aiTutorMaxPerExam < 1 ||
      input.aiTutorMaxPerExam > 200)
  )
    throw new BadRequestException(
      "Giới hạn hỏi AI mỗi đề phải từ 1 đến 200 lượt.",
    );
  if (input.allowedMimeTypes) assertNoActiveContentMimeTypes(input.allowedMimeTypes);
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("vi-VN", { timeZone: input.timezone }).format();
    } catch {
      throw new BadRequestException("Múi giờ IANA không hợp lệ.");
    }
  }
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      // Serialize platform updates, including the first update when no row exists to lock.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('system_settings.platform', 0))`;
      // Cùng khóa advisory với bước duyệt restore: không ai tắt được bảo trì khi khôi phục vận hành đang ghi dữ liệu.
      if (input.maintenanceMode === false && await transaction.operationalJob.count({ where: { kind: "RESTORE", status: "RUNNING" } }))
        throw new ConflictException("Đang có tiến trình khôi phục chạy; chưa thể tắt chế độ bảo trì.");
      const existing = await transaction.systemSetting.findUnique({
        where: { key: "platform" },
      });
      const current = existing
        ? serviceContext.mapSettings(
            existing.value,
            existing.updatedAt,
            existing.version,
            existing.updatedBy,
          )
        : defaultSettings();
      const merged = { ...current, ...input };
      if (merged.aiTutorMaxPerExam < merged.aiTutorMaxPerQuestion)
        throw new BadRequestException(
          "Giới hạn hỏi AI mỗi đề không được nhỏ hơn giới hạn của một câu hỏi.",
        );
      const next = serializeSettingPayload(merged) as Record<
        string,
        string | number | boolean | string[]
      >;
      const saved = await transaction.systemSetting.upsert({
        where: { key: "platform" },
        update: {
          value: next,
          version: { increment: 1 },
          effectiveAt: new Date(),
          updatedBy: actorId,
        },
        create: {
          key: "platform",
          value: next,
          version: 1,
          effectiveAt: new Date(),
          updatedBy: actorId,
        },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "SETTINGS_UPDATED",
        "system-settings",
        `Phiên bản ${saved.version} được áp dụng trực tiếp.`,
      );
      return serviceContext.mapSettings(
        saved.value,
        saved.updatedAt,
        saved.version,
        saved.updatedBy,
      );
    });
  }
  const next: SystemSettings = {
    ...serviceContext.settings,
    ...input,
    version: serviceContext.settings.version + 1,
    updatedBy: actorId,
    updatedAt: new Date().toISOString(),
  };
  if (next.aiTutorMaxPerExam < next.aiTutorMaxPerQuestion)
    throw new BadRequestException(
      "Giới hạn hỏi AI mỗi đề không được nhỏ hơn giới hạn của một câu hỏi.",
    );
  serviceContext.settings = next;
  serviceContext.log(
    actorId,
    "SETTINGS_UPDATED",
    "system-settings",
    `Phiên bản ${next.version} được áp dụng trực tiếp.`,
  );
  return structuredClone(next);
}
