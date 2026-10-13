import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  defaultSettings,
  SystemSettingRevision,
  SystemSettings,
} from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Đọc cấu hình mới nhất và áp dụng schema/mặc định qua mapSettings. */
export async function getSettings(
  serviceContext: SystemServiceContext,
): Promise<SystemSettings> {
  const prisma = serviceContext.database();
  if (prisma) {
    const revision = await prisma.systemSettingRevision.findFirst({
      where: { key: "platform", effectiveAt: { lte: new Date() } },
      orderBy: { version: "desc" },
    });
    if (revision)
      return serviceContext.mapSettings(
        revision.value,
        revision.createdAt,
        revision.version,
        revision.effectiveAt,
        revision.updatedBy,
      );
    const row = await prisma.systemSetting.findUnique({
      where: { key: "platform" },
    });
    if (!row) return defaultSettings();
    return serviceContext.mapSettings(
      row.value,
      row.updatedAt,
      row.version,
      row.effectiveAt,
      row.updatedBy,
    );
  }
  const active = serviceContext.settingRevisions
    .filter((item) => new Date(item.effectiveAt) <= new Date())
    .sort((a, b) => b.version - a.version)[0];
  return structuredClone(active ?? serviceContext.settings);
}

/** Liệt kê lịch sử revision cấu hình theo version mới nhất trước. */
export async function listSettingRevisions(
  serviceContext: SystemServiceContext,
): Promise<SystemSettingRevision[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.systemSettingRevision.findMany({
      where: { key: "platform" },
      orderBy: { version: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      ...serviceContext.mapSettings(
        row.value,
        row.createdAt,
        row.version,
        row.effectiveAt,
        row.updatedBy,
      ),
    }));
  }
  return structuredClone(
    [...serviceContext.settingRevisions].sort((a, b) => b.version - a.version),
  );
}

/** Hợp nhất cấu hình, kiểm tra quota/MIME/thời điểm hiệu lực, tăng version và ghi audit. */
export async function updateSettings(
  serviceContext: SystemServiceContext,
  input: Partial<Omit<SystemSettings, "updatedAt" | "version" | "updatedBy">>,
  actorId = "usr-admin",
): Promise<SystemSettings> {
  if (
    input.retentionDays !== undefined &&
    (input.retentionDays < 30 || input.retentionDays > 3650)
  )
    throw new BadRequestException(
      "Thời gian lưu trữ phải từ 30 đến 3650 ngày.",
    );
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
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("vi-VN", { timeZone: input.timezone }).format();
    } catch {
      throw new BadRequestException("Múi giờ IANA không hợp lệ.");
    }
  }
  const effectiveAt = input.effectiveAt
    ? new Date(input.effectiveAt)
    : new Date();
  if (Number.isNaN(effectiveAt.getTime()))
    throw new BadRequestException("Thời điểm hiệu lực không hợp lệ.");
  const settingValues = { ...input };
  delete settingValues.effectiveAt;
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await serviceContext.getSettings();
    const next = { ...current, ...settingValues };
    return prisma.$transaction(async (transaction) => {
      const latest = await transaction.systemSettingRevision.findFirst({
        where: { key: "platform" },
        orderBy: { version: "desc" },
      });
      const version = (latest?.version ?? current.version) + 1;
      const revision = await transaction.systemSettingRevision.create({
        data: {
          id: `setting-revision-${randomUUID()}`,
          key: "platform",
          value: next,
          version,
          effectiveAt,
          updatedBy: actorId,
        },
      });
      if (effectiveAt <= new Date())
        await transaction.systemSetting.upsert({
          where: { key: "platform" },
          update: { value: next, version, effectiveAt, updatedBy: actorId },
          create: {
            key: "platform",
            value: next,
            version,
            effectiveAt,
            updatedBy: actorId,
          },
        });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "SETTINGS_VERSION_PUBLISHED",
        "system-settings",
        `Phiên bản ${version}; hiệu lực ${effectiveAt.toISOString()}.`,
      );
      return serviceContext.mapSettings(
        revision.value,
        revision.createdAt,
        revision.version,
        revision.effectiveAt,
        revision.updatedBy,
      );
    });
  }
  const latestVersion = Math.max(
    0,
    ...serviceContext.settingRevisions.map((item) => item.version),
  );
  const revision: SystemSettingRevision = {
    id: `setting-revision-${randomUUID()}`,
    key: "platform",
    ...serviceContext.settings,
    ...settingValues,
    version: latestVersion + 1,
    effectiveAt: effectiveAt.toISOString(),
    updatedBy: actorId,
    updatedAt: new Date().toISOString(),
  };
  serviceContext.settingRevisions.unshift(revision);
  if (effectiveAt <= new Date()) serviceContext.settings = { ...revision };
  serviceContext.log(
    actorId,
    "SETTINGS_VERSION_PUBLISHED",
    "system-settings",
    `Phiên bản ${revision.version}; hiệu lực ${revision.effectiveAt}.`,
  );
  return structuredClone(revision);
}
