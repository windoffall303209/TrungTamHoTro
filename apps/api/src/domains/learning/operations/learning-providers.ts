import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { id } from "../learning.shared.js";
import type { LearningExam, LiveSession } from "../learning.types.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Dựng URL chủ phòng/người học cho provider demo bằng token phòng ngẫu nhiên. */
export function buildProviderUrls(
  provider: LiveSession["provider"],
  token: string,
): { hostUrl: string; attendeeUrl: string } {
  const base =
    provider === "ZOOM"
      ? "https://zoom.us/wc/join"
      : provider === "GOOGLE_MEET"
        ? "https://meet.google.com"
        : "https://meet.jit.si";
  return {
    hostUrl: `${base}/${token}?role=host`,
    attendeeUrl: `${base}/${token}`,
  };
}

/** Xáo trộn xác định theo seed để một học viên nhận thứ tự ổn định trong lượt thi. */
export function seededOrder(values: string[], seed: string): string[] {
  return [...values].sort(
    (left, right) =>
      createHash("sha256")
        .update(`${seed}:${left}`)
        .digest("hex")
        .localeCompare(
          createHash("sha256").update(`${seed}:${right}`).digest("hex"),
        ) || left.localeCompare(right),
  );
}

/** Chuẩn hóa phân bổ điểm từng câu, đối chiếu đủ câu và tổng điểm với sai số hai chữ số thập phân. */
export function resolveExamScoreAllocations(
  questionIds: string[],
  totalScore: number,
  allocations?: Array<{ questionId: string; score: number }>,
): Record<string, number> {
  if (!allocations?.length) {
    const base = Math.floor((totalScore / questionIds.length) * 100) / 100;
    const scores = Object.fromEntries(
      questionIds.map((questionId) => [questionId, base]),
    );
    scores[questionIds[questionIds.length - 1]!] =
      Math.round((totalScore - base * (questionIds.length - 1)) * 100) / 100;
    return scores;
  }
  if (
    allocations.length !== questionIds.length ||
    new Set(allocations.map((item) => item.questionId)).size !==
      questionIds.length
  )
    throw new BadRequestException(
      "Cần phân bổ đúng một mức điểm cho từng câu hỏi.",
    );
  const expectedIds = new Set(questionIds);
  if (
    allocations.some(
      (item) =>
        !expectedIds.has(item.questionId) ||
        !Number.isFinite(item.score) ||
        item.score <= 0,
    )
  )
    throw new BadRequestException(
      "Phân bổ điểm chứa câu hỏi hoặc mức điểm không hợp lệ.",
    );
  const allocatedTotal =
    Math.round(allocations.reduce((sum, item) => sum + item.score, 0) * 100) /
    100;
  if (Math.abs(allocatedTotal - totalScore) > 0.05)
    throw new BadRequestException(
      `Tổng điểm từng câu phải bằng ${totalScore}.`,
    );
  const diff = Math.round((totalScore - allocatedTotal) * 100) / 100;
  const result: Record<string, number> = Object.fromEntries(
    allocations.map((item) => [
      item.questionId,
      Math.round(item.score * 100) / 100,
    ]),
  );
  if (diff !== 0 && questionIds.length > 0) {
    const lastId = questionIds[questionIds.length - 1]!;
    const currentScore = result[lastId] ?? 0;
    result[lastId] = Math.round((currentScore + diff) * 100) / 100;
  }
  return result;
}

/** Lấy thang điểm một câu trong fallback in-memory, hỗ trợ dữ liệu cũ chia đều. */
export function examQuestionScore(
  exam: LearningExam,
  questionId: string,
): number {
  return (
    exam.questionScores?.[questionId] ??
    (exam.questionIds.length ? exam.totalScore / exam.questionIds.length : 0)
  );
}

/** Thử cấp phòng provider yêu cầu và chuyển sang fallback khi provider không khả dụng. */
export async function provisionProviderMeeting(
  serviceContext: LearningServiceContext,
  requested: LiveSession["provider"],
): Promise<{
  provider: LiveSession["provider"];
  hostUrl: string;
  attendeeUrl: string;
  fallbackUsed: boolean;
  attempts: number;
}> {
  const retryLimit =
    serviceContext.config?.get("LIVE_PROVIDER_RETRY_LIMIT", { infer: true }) ??
    2;
  const rawOrder =
    serviceContext.config?.get("LIVE_PROVIDER_FALLBACK_ORDER", {
      infer: true,
    }) ?? "GOOGLE_MEET,ZOOM,JITSI";
  const rawFailures =
    serviceContext.config?.get("LIVE_PROVIDER_SIMULATED_FAILURES", {
      infer: true,
    }) ?? "";
  const configuredOrder = rawOrder
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is LiveSession["provider"] =>
      serviceContext.isLiveProvider(value),
    );
  const failures = new Set(
    rawFailures
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const integrations = serviceContext.system
    ? await serviceContext.system.listIntegrations()
    : undefined;
  const readyProviders = integrations
    ? new Set(
        integrations
          .filter((item) => item.enabled && item.healthStatus === "HEALTHY")
          .map((item) => item.provider),
      )
    : undefined;
  const defaultProvider = integrations?.find(
    (item) => item.enabled && item.isDefault && item.healthStatus === "HEALTHY",
  )?.provider;
  const candidates = [
    ...new Set(
      [requested, defaultProvider, ...configuredOrder].filter(
        (value): value is LiveSession["provider"] => Boolean(value),
      ),
    ),
  ];
  let attempts = 0;
  for (const provider of candidates) {
    if (readyProviders && !readyProviders.has(provider)) continue;
    if (serviceContext.system && provider !== "JITSI") continue;
    for (let retry = 0; retry < retryLimit; retry += 1) {
      attempts += 1;
      if (failures.has(provider)) continue;
      return {
        provider,
        ...serviceContext.buildProviderUrls(provider, randomUUID()),
        fallbackUsed: provider !== requested,
        attempts,
      };
    }
  }
  throw new ServiceUnavailableException(
    `Không thể tạo phòng học sau ${attempts} lần thử. Vui lòng kiểm tra cấu hình provider hoặc thử lại sau.`,
  );
}

/** Truy vấn danh sách userId đang có một vai trò cụ thể để phát thông báo. */
export async function userIdsForRole(
  database: PrismaService | Prisma.TransactionClient,
  roleCode: string,
): Promise<string[]> {
  const rows = await database.user.findMany({
    where: {
      status: "ACTIVE",
      roles: { some: { role: { code: roleCode } } },
    },
    select: { id: true },
  });
  return rows.map(({ id: userId }) => userId);
}

/** Tạo notification hàng loạt cho giảng viên và học viên hoạt động của lớp. */
export async function notifyClassMembers(
  serviceContext: LearningServiceContext,
  database: PrismaService | Prisma.TransactionClient,
  classId: string,
  type: string,
  title: string,
  entityId: string,
  templateEventCode?: string,
  templateVariables: Record<string, string> = {},
): Promise<void> {
  const item = await database.learningClass.findUnique({
    where: { id: classId },
    include: {
      instructors: { select: { instructorId: true } },
      enrollments: {
        where: { status: "ACTIVE" },
        select: { learnerId: true },
      },
    },
  });
  if (!item) return;
  const resolvedTitle =
    serviceContext.system && templateEventCode
      ? await serviceContext.system.renderPublishedNotification(
          templateEventCode,
          templateVariables,
          title,
        )
      : title;
  const recipients = new Set([
    ...item.instructors.map((row) => row.instructorId),
    ...item.enrollments.map((row) => row.learnerId),
  ]);
  for (const recipientId of recipients)
    await database.notification.upsert({
      where: { dedupKey: `${type}:${entityId}:${recipientId}` },
      update: { title: resolvedTitle, readAt: null },
      create: {
        id: id("notification"),
        recipientId,
        type,
        title: resolvedTitle,
        entityType: "LIVE_SESSION",
        entityId,
        dedupKey: `${type}:${entityId}:${recipientId}`,
      },
    });
}
