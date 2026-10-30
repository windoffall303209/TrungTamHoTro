import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../../database/prisma.service.js";
import type { Prisma } from "../../../generated/prisma/client.js";
import { withTemporaryFile } from "../../../infrastructure/file-streams.js";
import {
  verifyRetentionStream,
  writeRetentionArchive,
} from "../../../infrastructure/retention-archive.js";
import { ownedJobWhere } from "../operational-lease.js";
import {
  retentionCategories,
  RetentionCategory,
  RetentionPolicyView,
} from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Lấy policy đã có hiệu lực mới nhất cho danh mục. */
export async function getLatestRetentionPolicy(
  serviceContext: SystemServiceContext,
  category: string,
): Promise<RetentionPolicyView | undefined> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.retentionPolicy.findFirst({
      where: { category, effectiveAt: { lte: new Date() } },
      orderBy: { version: "desc" },
    });
    return row ? serviceContext.mapRetentionPolicy(row) : undefined;
  }
  return serviceContext.retentionPolicies
    .filter(
      (item) =>
        item.category === category && new Date(item.effectiveAt) <= new Date(),
    )
    .sort((a, b) => b.version - a.version)[0];
}

/** Đếm bản ghi cũ hơn cutoff theo danh mục trước khi chạy retention. */
export async function countRetentionRows(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
  category: string,
  cutoffAt: Date,
): Promise<number> {
  if (category === "AUDIT")
    return prisma.auditLog.count({ where: { createdAt: { lt: cutoffAt } } });
  if (category === "SUPPORT")
    return prisma.supportTicket.count({
      where: { createdAt: { lt: cutoffAt }, status: "CLOSED" },
    });
  if (category === "LEARNING")
    return prisma.learningClass.count({
      where: { archivedAt: { lt: cutoffAt } },
    });
  if (category === "AI_RESULTS") {
    const [settings, grading, study] = await Promise.all([
      serviceContext.aiResultSettings(prisma, cutoffAt),
      prisma.aiGradingSuggestion.count({
        where: { state: "READY", updatedAt: { lt: cutoffAt } },
      }),
      prisma.aiStudyDraft.count({
        where: {
          state: "READY",
          publishedAt: null,
          updatedAt: { lt: cutoffAt },
        },
      }),
    ]);
    return settings.length + grading + study;
  }
  return 0;
}

/** Thực thi archive/delete theo category trong transaction và trả số dòng ảnh hưởng. */
export async function executeRetention(
  serviceContext: SystemServiceContext,
  prisma: PrismaService,
  category: string,
  action: "ARCHIVE" | "DELETE",
  cutoffAt: Date,
  jobId: string,
  assertOwned?: () => Promise<void>,
  claim?: { id: string; attempts: number },
): Promise<{
  affectedRows: number;
  skippedRows: number;
  archiveObjectKey?: string;
  archiveChecksum?: string;
  removedObjects: number;
  objectCleanupFailures: number;
}> {
  let records: unknown[];
  let objectKeys: string[] = [];
  if (category === "AUDIT") {
    records = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoffAt } },
      orderBy: { createdAt: "asc" },
    });
  } else if (category === "SUPPORT") {
    const tickets = await prisma.supportTicket.findMany({
      where: { createdAt: { lt: cutoffAt }, status: "CLOSED" },
      include: { comments: true, attachments: true },
    });
    records = tickets;
    objectKeys = tickets.flatMap((ticket) =>
      ticket.attachments.map((attachment) => attachment.objectKey),
    );
  } else if (category === "LEARNING") {
    const classes = await prisma.learningClass.findMany({
      where: { archivedAt: { lt: cutoffAt } },
      include: {
        instructors: true,
        instructorHistory: true,
        enrollments: true,
        enrollmentHistory: true,
        materials: {
          include: {
            versions: true,
            accessLogs: true,
            reviews: true,
            forumAttachments: true,
          },
        },
        exams: {
          include: {
            questions: true,
            approvals: true,
            attempts: {
              include: {
                answers: true,
                regradeRequests: true,
                gradeHistory: true,
              },
            },
          },
        },
        forumTopics: {
          include: {
            posts: { include: { attachments: true, mentions: true } },
          },
        },
        sessions: { include: { attendance: true, appeals: true } },
        assignments: {
          include: {
            submissions: {
              include: {
                attachments: true,
                revisions: true,
                gradeChanges: true,
              },
            },
            changes: true,
          },
        },
        announcements: true,
      },
    });
    records = classes;
    objectKeys = classes.flatMap((classItem) => [
      ...classItem.materials.flatMap((material) => [
        material.objectKey,
        ...material.versions.map((version) => version.objectKey),
      ]),
      ...classItem.assignments.flatMap((assignment) =>
        assignment.submissions.flatMap((submission) =>
          submission.attachments.map((attachment) => attachment.objectKey),
        ),
      ),
    ]);
  } else if (category === "AI_RESULTS") {
    const [settings, grading, study] = await Promise.all([
      serviceContext.aiResultSettings(prisma, cutoffAt),
      prisma.aiGradingSuggestion.findMany({
        where: { state: "READY", updatedAt: { lt: cutoffAt } },
        orderBy: { updatedAt: "asc" },
      }),
      prisma.aiStudyDraft.findMany({
        where: {
          state: "READY",
          publishedAt: null,
          updatedAt: { lt: cutoffAt },
        },
        orderBy: { updatedAt: "asc" },
      }),
    ]);
    records = [
      ...settings.map((record) => ({
        entity: "system_setting_ai_result",
        record,
      })),
      ...grading.map((record) => ({ entity: "ai_grading_suggestion", record })),
      ...study.map((record) => ({ entity: "ai_study_draft", record })),
    ];
  } else {
    throw new BadRequestException("Danh mục retention không được hỗ trợ.");
  }

  let archiveObjectKey: string | undefined;
  let archiveChecksum: string | undefined;
  if (action === "ARCHIVE" && records.length) {
    if (!serviceContext.objectStorage)
      throw new ServiceUnavailableException(
        "Kho object chưa sẵn sàng để lưu archive retention.",
      );
    await withTemporaryFile(async (path) => {
      const written = await writeRetentionArchive(
        path,
        category,
        cutoffAt,
        records,
        objectKeys,
        (key) => serviceContext.objectStorage!.openReadStream(key),
      );
      await assertOwned?.();
      const stored = await serviceContext.objectStorage!.putFile(
        `retention/${category.toLowerCase()}/${jobId}-${randomUUID()}.jsonl`,
        path,
      );
      const verified = await verifyRetentionStream(
        await serviceContext.objectStorage!.openReadStream(stored.objectKey),
      );
      if (
        verified.checksum !== written.checksum ||
        verified.checksum !== stored.checksum
      )
        throw new ServiceUnavailableException(
          "Archive không vượt qua kiểm tra checksum; dữ liệu nguồn chưa bị xóa.",
        );
      archiveObjectKey = stored.objectKey;
      archiveChecksum = stored.checksum;
    });
  }

  let affectedRows = 0;
  if (records.length) {
    await assertOwned?.();
    affectedRows = await prisma.$transaction(
      async (transaction) => {
        // Giữ khóa hàng tác vụ đến khi xóa xong; tiến trình đã mất quyền không được xóa dữ liệu.
        if (claim) {
          const owned = await transaction.retentionJob.updateMany({
            where: ownedJobWhere(claim),
            data: { availableAt: serviceContext.jobLeaseExpiry() },
          });
          if (owned.count !== 1)
            throw new ServiceUnavailableException("Tác vụ đã mất quyền xử lý.");
          if (
            await transaction.legalHold.findFirst({
              where: { category, active: true },
            })
          )
            throw new BadRequestException(
              "Dữ liệu đang được bảo vệ bởi legal hold.",
            );
        }
        if (category === "AUDIT")
          return (
            await transaction.auditLog.deleteMany({
              where: {
                id: {
                  in: (records as Array<{ id: bigint }>).map((item) => item.id),
                },
                createdAt: { lt: cutoffAt },
              },
            })
          ).count;
        if (category === "SUPPORT")
          return (
            await transaction.supportTicket.deleteMany({
              where: {
                id: {
                  in: (records as Array<{ id: string }>).map((item) => item.id),
                },
                status: "CLOSED",
              },
            })
          ).count;
        if (category === "LEARNING")
          return (
            await transaction.learningClass.deleteMany({
              where: {
                id: {
                  in: (records as Array<{ id: string }>).map((item) => item.id),
                },
                archivedAt: { lt: cutoffAt },
              },
            })
          ).count;
        const grouped = records as Array<{
          entity: string;
          record: { id?: string; key?: string; updatedAt: Date };
        }>;
        let deleted = 0;
        // So sánh đúng snapshot đã lưu trữ, không xóa bản vừa sửa, vừa xuất bản hoặc nhận quyền xử lý lại.
        for (const item of grouped) {
          const where = { updatedAt: item.record.updatedAt };
          if (item.entity === "system_setting_ai_result" && item.record.key)
            deleted += (
              await transaction.systemSetting.deleteMany({
                where: { ...where, key: item.record.key },
              })
            ).count;
          if (item.entity === "ai_grading_suggestion" && item.record.id)
            deleted += (
              await transaction.aiGradingSuggestion.deleteMany({
                where: { ...where, id: item.record.id, state: "READY" },
              })
            ).count;
          if (item.entity === "ai_study_draft" && item.record.id)
            deleted += (
              await transaction.aiStudyDraft.deleteMany({
                where: {
                  ...where,
                  id: item.record.id,
                  state: "READY",
                  publishedAt: null,
                },
              })
            ).count;
        }
        return deleted;
      },
      { timeout: 30_000 },
    );
  }

  let removedObjects = 0;
  let objectCleanupFailures = 0;
  if (serviceContext.objectStorage && affectedRows === records.length) {
    for (const objectKey of [...new Set(objectKeys)]) {
      await assertOwned?.();
      try {
        await serviceContext.objectStorage.remove(objectKey);
        removedObjects += 1;
      } catch {
        objectCleanupFailures += 1;
      }
    }
  } else objectCleanupFailures = new Set(objectKeys).size;
  return {
    affectedRows,
    skippedRows: records.length - affectedRows,
    archiveObjectKey,
    archiveChecksum,
    removedObjects,
    objectCleanupFailures,
  };
}

/** Lấy riêng cache OCR/hỏi đáp READY quá hạn; claim đang chạy hoặc chưa rõ kết quả luôn được giữ lại để đối soát. */
export async function aiResultSettings(
  prisma: PrismaService,
  cutoffAt: Date,
): Promise<Array<Prisma.SystemSettingGetPayload<Record<string, never>>>> {
  const candidates = await prisma.systemSetting.findMany({
    where: {
      updatedAt: { lt: cutoffAt },
      OR: [
        { key: { startsWith: "ai-doc:" } },
        { key: { startsWith: "ai-doc-answer:" } },
      ],
    },
    orderBy: { updatedAt: "asc" },
  });
  return candidates.filter((item) => {
    if (
      !item.value ||
      typeof item.value !== "object" ||
      Array.isArray(item.value)
    )
      return item.key.startsWith("ai-doc:") && Array.isArray(item.value);
    return (item.value as Record<string, unknown>).state === "READY";
  });
}

/** Chuẩn hóa danh mục retention và chặn policy không có executor tương ứng. */
export function retentionCategory(value: string): RetentionCategory {
  const category = value.trim().toUpperCase();
  if (!retentionCategories.includes(category as RetentionCategory))
    throw new BadRequestException("Danh mục retention không được hỗ trợ.");
  return category as RetentionCategory;
}
