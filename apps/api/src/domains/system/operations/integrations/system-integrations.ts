import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { IntegrationConfig } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Liệt kê provider phòng học đã cấu hình và trạng thái health. */
export async function listIntegrations(
  serviceContext: SystemServiceContext,
): Promise<IntegrationConfig[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.integrationProvider.findMany({
      orderBy: { provider: "asc" },
    });
    return rows.map((row) => serviceContext.mapIntegration(row));
  }
  return structuredClone(serviceContext.integrations);
}

/** Bật/tắt tích hợp, không cho bật provider thiếu credential cần thiết và ghi audit. */
export async function updateIntegration(
  serviceContext: SystemServiceContext,
  integrationId: string,
  enabled: boolean,
  actorId = "usr-admin",
): Promise<IntegrationConfig> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.integrationProvider.findUnique({
      where: { id: integrationId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
    if (enabled && current.healthStatus !== "HEALTHY")
      throw new BadRequestException(
        "Cần health check thành công trước khi bật tích hợp.",
      );
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.integrationProvider.update({
        where: { id: integrationId },
        data: { enabled, isDefault: enabled ? current.isDefault : false },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "INTEGRATION_UPDATED",
        row.provider,
        enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.",
      );
      return serviceContext.mapIntegration(row);
    });
  }
  const item = serviceContext.integrations.find(
    (entry) => entry.id === integrationId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
  if (enabled && item.healthStatus !== "HEALTHY")
    throw new BadRequestException(
      "Cần health check thành công trước khi bật tích hợp.",
    );
  item.enabled = enabled;
  if (!enabled) item.isDefault = false;
  item.updatedAt = new Date().toISOString();
  serviceContext.log(
    actorId,
    "INTEGRATION_UPDATED",
    item.provider,
    enabled ? "Đã bật tích hợp." : "Đã tắt tích hợp.",
  );
  return structuredClone(item);
}

/** Tạo/cập nhật cấu hình provider bằng tham chiếu credential, không lưu secret thô. */
export async function configureIntegration(
  serviceContext: SystemServiceContext,
  input: {
    provider: IntegrationConfig["provider"];
    credentialReference?: string;
    webhookUrl?: string;
  },
  actorId = "usr-admin",
): Promise<IntegrationConfig> {
  const credentialReference = input.credentialReference?.trim();
  if (input.provider !== "JITSI" && !credentialReference)
    throw new BadRequestException(
      "Provider này cần tham chiếu credential trong kho bí mật.",
    );
  if (input.webhookUrl && !/^https:\/\//i.test(input.webhookUrl))
    throw new BadRequestException("Webhook phải sử dụng HTTPS.");
  const prisma = serviceContext.database();
  if (prisma) {
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.integrationProvider.upsert({
        where: { provider: input.provider },
        update: {
          credentialRef: credentialReference,
          webhookUrl: input.webhookUrl?.trim() || null,
          isDefault: false,
          healthStatus: "UNKNOWN",
          enabled: false,
        },
        create: {
          id: `integration-${randomUUID()}`,
          provider: input.provider,
          credentialRef: credentialReference,
          webhookUrl: input.webhookUrl?.trim() || null,
        },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "INTEGRATION_CONFIGURED",
        input.provider,
        "Đã lưu tham chiếu credential; secret không được ghi log.",
      );
      return serviceContext.mapIntegration(row);
    });
  }
  let item = serviceContext.integrations.find(
    (entry) => entry.provider === input.provider,
  );
  if (!item) {
    item = {
      id: `integration-${randomUUID()}`,
      provider: input.provider,
      enabled: false,
      isDefault: false,
      healthStatus: "UNKNOWN",
      maskedCredential:
        input.provider === "JITSI" ? "Không yêu cầu" : "••••••••",
      webhookConfigured: Boolean(input.webhookUrl),
      updatedAt: new Date().toISOString(),
    };
    serviceContext.integrations.push(item);
  }
  Object.assign(item, {
    enabled: false,
    isDefault: false,
    healthStatus: "UNKNOWN",
    maskedCredential: input.provider === "JITSI" ? "Không yêu cầu" : "••••••••",
    webhookConfigured: Boolean(input.webhookUrl),
    lastCheckedAt: undefined,
    updatedAt: new Date().toISOString(),
  });
  serviceContext.log(
    actorId,
    "INTEGRATION_CONFIGURED",
    input.provider,
    "Đã lưu tham chiếu credential; secret không được ghi log.",
  );
  return structuredClone(item);
}

/** Kiểm tra điều kiện kết nối và cập nhật trạng thái/lần kiểm tra của tích hợp. */
export async function testIntegration(
  serviceContext: SystemServiceContext,
  integrationId: string,
  actorId = "usr-admin",
): Promise<IntegrationConfig> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.integrationProvider.findUnique({
      where: { id: integrationId },
    });
    if (!current) throw new NotFoundException("Không tìm thấy tích hợp.");
    const healthy = current.provider === "JITSI";
    const row = await prisma.integrationProvider.update({
      where: { id: integrationId },
      data: {
        healthStatus: healthy ? "HEALTHY" : "ERROR",
        lastCheckedAt: new Date(),
      },
    });
    await serviceContext.logDatabase(
      prisma,
      actorId,
      "INTEGRATION_HEALTH_CHECKED",
      current.provider,
      healthy ? "HEALTHY" : "ERROR",
    );
    if (!healthy)
      throw new BadRequestException(
        "Health check production của Google Meet/Zoom cần OAuth và webhook thật; tham chiếu credential không được xem là kết nối thành công.",
      );
    return serviceContext.mapIntegration(row);
  }
  const item = serviceContext.integrations.find(
    (entry) => entry.id === integrationId,
  );
  if (!item) throw new NotFoundException("Không tìm thấy tích hợp.");
  const healthy = item.provider === "JITSI";
  item.healthStatus = healthy ? "HEALTHY" : "ERROR";
  item.lastCheckedAt = new Date().toISOString();
  item.updatedAt = item.lastCheckedAt;
  serviceContext.log(
    actorId,
    "INTEGRATION_HEALTH_CHECKED",
    item.provider,
    healthy ? "HEALTHY" : "ERROR",
  );
  if (!healthy)
    throw new BadRequestException(
      "Health check production của Google Meet/Zoom cần OAuth và webhook thật; tham chiếu credential không được xem là kết nối thành công.",
    );
  return structuredClone(item);
}

/** Đặt một provider enabled làm mặc định và gỡ cờ mặc định của các provider khác nguyên tử. */
export async function setDefaultIntegration(
  serviceContext: SystemServiceContext,
  integrationId: string,
  actorId = "usr-admin",
): Promise<IntegrationConfig> {
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.integrationProvider.findUnique({
      where: { id: integrationId },
    });
    if (!current || !current.enabled || current.healthStatus !== "HEALTHY")
      throw new BadRequestException(
        "Chỉ provider đang bật và khỏe mạnh mới được đặt mặc định.",
      );
    return prisma.$transaction(async (transaction) => {
      await transaction.integrationProvider.updateMany({
        data: { isDefault: false },
      });
      const updated = await transaction.integrationProvider.update({
        where: { id: integrationId },
        data: { isDefault: true },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "INTEGRATION_DEFAULT_CHANGED",
        updated.provider,
        "Đặt làm nhà cung cấp mặc định.",
      );
      return serviceContext.mapIntegration(updated);
    });
  }
  const item = serviceContext.integrations.find(
    (entry) => entry.id === integrationId,
  );
  if (!item || !item.enabled || item.healthStatus !== "HEALTHY")
    throw new BadRequestException(
      "Chỉ provider đang bật và khỏe mạnh mới được đặt mặc định.",
    );
  for (const integration of serviceContext.integrations)
    integration.isDefault = integration.id === integrationId;
  serviceContext.log(
    actorId,
    "INTEGRATION_DEFAULT_CHANGED",
    item.provider,
    "Đặt làm nhà cung cấp mặc định.",
  );
  return structuredClone(item);
}

/** Tạo URL phòng thử ngắn hạn sau khi integration vượt kiểm tra readiness. */
export async function createTestMeeting(
  serviceContext: SystemServiceContext,
  integrationId: string,
  actorId = "usr-admin",
): Promise<{ provider: string; attendeeUrl: string; expiresAt: string }> {
  const integrations = await serviceContext.listIntegrations();
  const item = integrations.find((entry) => entry.id === integrationId);
  if (
    !item ||
    !item.enabled ||
    !item.isDefault ||
    item.healthStatus !== "HEALTHY"
  )
    throw new BadRequestException(
      "Provider mặc định chưa sẵn sàng để tạo phòng thử.",
    );
  if (item.provider !== "JITSI")
    throw new ServiceUnavailableException(
      "Google Meet/Zoom chưa có adapter OAuth production; hệ thống không tạo URL mô phỏng.",
    );
  const roomId = `wind-test-${randomUUID()}`;
  const prisma = serviceContext.database();
  if (prisma)
    await serviceContext.logDatabase(
      prisma,
      actorId,
      "INTEGRATION_TEST_MEETING_CREATED",
      item.provider,
      `Phòng thử ${roomId}.`,
    );
  else
    serviceContext.log(
      actorId,
      "INTEGRATION_TEST_MEETING_CREATED",
      item.provider,
      `Phòng thử ${roomId}.`,
    );
  return {
    provider: item.provider,
    attendeeUrl: `https://meet.jit.si/${roomId}`,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  };
}
