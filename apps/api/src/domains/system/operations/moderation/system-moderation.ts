import { randomUUID } from "node:crypto";
import { ModerationPolicy } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Đọc chính sách kiểm duyệt mới nhất hoặc cấu hình mặc định. */
export async function getModerationPolicy(
  serviceContext: SystemServiceContext,
): Promise<ModerationPolicy> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.moderationPolicy.findFirst({
      orderBy: { version: "desc" },
    });
    return row
      ? serviceContext.mapModeration(row)
      : {
          ...serviceContext.moderation,
          prohibitedTerms: [...serviceContext.moderation.prohibitedTerms],
        };
  }
  return structuredClone(serviceContext.moderation);
}

/** Chuẩn hóa từ cấm, kiểm tra rate limit và tạo version chính sách mới. */
export async function updateModerationPolicy(
  serviceContext: SystemServiceContext,
  input: Omit<ModerationPolicy, "version" | "updatedAt">,
  actorId = "usr-admin",
): Promise<ModerationPolicy> {
  const prohibitedTerms = [
    ...new Set(
      input.prohibitedTerms
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const prisma = serviceContext.database();
  if (prisma) {
    const current = await prisma.moderationPolicy.findFirst({
      orderBy: { version: "desc" },
    });
    return prisma.$transaction(async (transaction) => {
      const row = await transaction.moderationPolicy.create({
        data: {
          id: `policy-${randomUUID()}`,
          version: (current?.version ?? 0) + 1,
          prohibitedTerms,
          maxPostsPerMinute: input.maxPostsPerMinute,
          action: input.action,
          publishedBy: actorId,
        },
      });
      await serviceContext.logDatabase(
        transaction,
        actorId,
        "MODERATION_POLICY_PUBLISHED",
        `v${row.version}`,
        `${prohibitedTerms.length} từ khóa`,
      );
      return serviceContext.mapModeration(row);
    });
  }
  serviceContext.moderation = {
    ...input,
    prohibitedTerms,
    version: serviceContext.moderation.version + 1,
    updatedAt: new Date().toISOString(),
  };
  serviceContext.log(
    actorId,
    "MODERATION_POLICY_PUBLISHED",
    `v${serviceContext.moderation.version}`,
    `${serviceContext.moderation.prohibitedTerms.length} từ khóa`,
  );
  return structuredClone(serviceContext.moderation);
}
