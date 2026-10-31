import { BadRequestException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  NotificationTemplate,
  TemplateTestDelivery,
  templateVariables,
} from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Liệt kê phiên bản mẫu thông báo và trạng thái hiện hành. */
export async function listTemplates(
  serviceContext: SystemServiceContext,
): Promise<NotificationTemplate[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.notificationTemplate.findMany({
      orderBy: [{ eventCode: "asc" }, { locale: "asc" }, { version: "desc" }],
    });
    const latest = new Map<string, NotificationTemplate>();
    for (const row of rows) {
      const key = `${row.eventCode}:${row.locale}`;
      if (!latest.has(key)) latest.set(key, serviceContext.mapTemplate(row));
    }
    return [...latest.values()];
  }
  const latest = new Map<string, NotificationTemplate>();
  for (const item of [...serviceContext.templates].sort(
    (left, right) => right.version - left.version,
  )) {
    const key = `${item.eventCode}:${item.locale}`;
    if (!latest.has(key)) latest.set(key, item);
  }
  return structuredClone([...latest.values()]);
}

/** Validate biến mẫu, tạo version mới và ngừng dùng version trước cùng event/locale. */
export async function saveTemplate(
  serviceContext: SystemServiceContext,
  input: Omit<NotificationTemplate, "id" | "version" | "status" | "updatedAt">,
  actorId = "usr-admin",
): Promise<NotificationTemplate> {
  if (/<script|javascript:/i.test(`${input.subject} ${input.body}`))
    throw new BadRequestException("Mẫu thông báo chứa nội dung không an toàn.");
  const eventCode = input.eventCode.trim().toUpperCase();
  const allowedVariables = templateVariables[eventCode];
  if (!allowedVariables)
    throw new BadRequestException(
      "Mã sự kiện thông báo chưa được hệ thống hỗ trợ.",
    );
  const usedVariables = serviceContext.extractTemplateVariables(
    `${input.subject} ${input.body}`,
  );
  const invalidVariables = usedVariables.filter(
    (variable) => !allowedVariables.includes(variable),
  );
  if (invalidVariables.length)
    throw new BadRequestException(
      `Biến mẫu không được phép: ${invalidVariables.join(", ")}.`,
    );
  const normalized = { ...input, eventCode, locale: input.locale.trim() };
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.notificationTemplate.findFirst({
      where: { eventCode, locale: normalized.locale },
      orderBy: { version: "desc" },
    });
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.notificationTemplate.create({
        data: {
          id: `tpl-${randomUUID()}`,
          ...normalized,
          version: (current?.version ?? 0) + 1,
          status: "PUBLISHED",
        },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "TEMPLATE_PUBLISHED",
        row.eventCode,
        `${row.locale} · v${row.version}`,
      );
      return serviceContext.mapTemplate(row);
    });
  }
  const current = serviceContext.templates.find(
    (item) => item.eventCode === eventCode && item.locale === normalized.locale,
  );
  const item: NotificationTemplate = {
    ...normalized,
    id: `tpl-${randomUUID()}`,
    version: (current?.version ?? 0) + 1,
    status: "PUBLISHED",
    updatedAt: new Date().toISOString(),
  };
  serviceContext.templates.unshift(item);
  serviceContext.log(
    actorId,
    "TEMPLATE_PUBLISHED",
    item.eventCode,
    `${item.locale} · v${item.version}`,
  );
  return structuredClone(item);
}

/** Thay thế placeholder bằng dữ liệu thử và báo các biến còn thiếu. */
export async function previewTemplate(
  serviceContext: SystemServiceContext,
  templateId: string,
  variables: Record<string, string>,
): Promise<object> {
  const prisma = serviceContext.database();
  let template: NotificationTemplate | undefined;
  if (prisma) {
    const row = await prisma.notificationTemplate.findUnique({
      where: { id: templateId },
    });
    template = row ? serviceContext.mapTemplate(row) : undefined;
  } else
    template = serviceContext.templates.find((item) => item.id === templateId);
  if (!template) throw new NotFoundException("Không tìm thấy mẫu thông báo.");
  /** Thay biến trong mẫu thông báo, giữ dấu nhắc cho biến chưa được cung cấp. */
  const render = (text: string): string =>
    text.replace(
      /{{([a-zA-Z0-9_]+)}}/g,
      (_, key: string) => variables[key] ?? `[${key}]`,
    );
  const subject = render(template.subject);
  const body = render(template.body);
  return {
    subject,
    body,
    unresolvedVariables: [
      ...new Set(
        [
          ...subject.matchAll(/\[([^\]]+)\]/g),
          ...body.matchAll(/\[([^\]]+)\]/g),
        ].map((match) => match[1]),
      ),
    ],
  };
}

/** Render mẫu PUBLISHED mới nhất cho runtime; dùng tiêu đề fallback nếu thiếu mẫu hoặc biến. */
export async function renderPublishedNotification(
  serviceContext: SystemServiceContext,
  eventCode: string,
  variables: Record<string, string>,
  fallbackTitle: string,
): Promise<string> {
  const locale = (await serviceContext.getSettings()).locale;
  const prisma = serviceContext.database();
  let template: NotificationTemplate | undefined;
  if (prisma) {
    const row = await prisma.notificationTemplate.findFirst({
      where: { eventCode, locale, status: "PUBLISHED" },
      orderBy: { version: "desc" },
    });
    template = row ? serviceContext.mapTemplate(row) : undefined;
  } else {
    template = serviceContext.templates
      .filter(
        (item) =>
          item.eventCode === eventCode &&
          item.locale === locale &&
          item.status === "PUBLISHED",
      )
      .sort((left, right) => right.version - left.version)[0];
  }
  if (!template) return fallbackTitle;
  const rendered = template.subject.replace(
    /{{([a-zA-Z0-9_]+)}}/g,
    (_, key: string) => variables[key] ?? `[${key}]`,
  );
  return /\[[^\]]+\]/.test(rendered) ? fallbackTitle : rendered;
}

/** Render và gửi email thử, lưu kết quả giao hàng cùng actor nhưng không lưu nội dung nhạy cảm. */
export async function sendTemplateTest(
  serviceContext: SystemServiceContext,
  templateId: string,
  recipient: string,
  variables: Record<string, string>,
  actorId = "usr-admin",
): Promise<TemplateTestDelivery> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new BadRequestException("Email nhận bản thử không hợp lệ.");
  const preview = (await serviceContext.previewTemplate(
    templateId,
    variables,
  )) as { subject: string; body: string; unresolvedVariables: string[] };
  if (preview.unresolvedVariables.length)
    throw new BadRequestException(
      `Chưa cung cấp biến: ${preview.unresolvedVariables.join(", ")}.`,
    );
  if (!serviceContext.emailDelivery)
    throw new BadRequestException("Dịch vụ email Resend chưa được khởi tạo.");
  const accepted = await serviceContext.emailDelivery.send({
    to: recipient,
    subject: preview.subject,
    text: preview.body,
    idempotencyKey: `template-test/${templateId}/${randomUUID()}`,
  });
  const delivery: TemplateTestDelivery = {
    recipient,
    subject: preview.subject,
    body: preview.body,
    status: "SENT",
    provider: accepted.provider,
    providerMessageId: accepted.providerMessageId,
    sentAt: accepted.acceptedAt,
  };
  const prisma = serviceContext.database();
  if (prisma)
    await serviceContext.logDatabase(
      prisma,
      actorId,
      "TEMPLATE_TEST_SENT",
      templateId,
      `Resend ${accepted.providerMessageId} đã chấp nhận email tới ${recipient}.`,
    );
  else
    serviceContext.log(
      actorId,
      "TEMPLATE_TEST_SENT",
      templateId,
      `Gửi thử tới ${recipient}.`,
    );
  return delivery;
}
