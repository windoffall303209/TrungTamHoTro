import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { withTemporaryFile } from "../../../infrastructure/file-streams.js";
import { BackupRun, RestoreRun } from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Liệt kê các job sao lưu từ DB hoặc dữ liệu nhớ demo. */
export async function listBackups(
  serviceContext: SystemServiceContext,
): Promise<BackupRun[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.backupJob.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapBackup(row));
  }
  return structuredClone(serviceContext.backups);
}

/** Xếp sao lưu vào hàng đợi bền vững để request không phải chờ tác vụ nặng. */
export async function runBackup(
  serviceContext: SystemServiceContext,
  type: BackupRun["type"],
  actorId = "usr-admin",
): Promise<BackupRun> {
  if (type === "INCREMENTAL")
    throw new BadRequestException(
      "Sao lưu gia tăng cần binary log và điểm khôi phục liên tục; hệ thống hiện chỉ cho phép FULL để bảo đảm khôi phục được.",
    );
  const prisma = serviceContext.database();
  if (
    !prisma ||
    !serviceContext.databaseBackup ||
    !serviceContext.objectStorage
  )
    throw new ServiceUnavailableException(
      "Sao lưu thật yêu cầu kết nối database và kho object đang hoạt động.",
    );
  const backupId = `backup-${randomUUID()}`;
  const row = await prisma.backupJob.create({
    data: {
      id: backupId,
      type,
      status: "PENDING",
      requestedBy: actorId,
      availableAt: new Date(),
    },
  });
  await serviceContext.logDatabase(
    prisma,
    actorId,
    "BACKUP_QUEUED",
    row.id,
    `${type} · chờ worker xử lý.`,
  );
  return serviceContext.mapBackup(row);
}

/** Tạo yêu cầu drill hoặc khôi phục vận hành và để trạng thái chờ một quản trị viên khác phê duyệt. */
export async function requestRestore(
  serviceContext: SystemServiceContext,
  input: {
    backupId: string;
    mode: "DRILL" | "OPERATIONAL";
    reason: string;
    targetDatabase?: string;
  },
  actorId = "usr-admin",
): Promise<RestoreRun> {
  if (input.reason.trim().length < 10)
    throw new BadRequestException("Cần lý do khôi phục ít nhất 10 ký tự.");
  if (
    input.mode === "OPERATIONAL" &&
    !/^[a-zA-Z0-9_]+$/.test(input.targetDatabase ?? "")
  )
    throw new BadRequestException(
      "Khôi phục vận hành cần tên database đích mới, chỉ gồm chữ, số và dấu gạch dưới.",
    );
  const prisma = serviceContext.database();
  if (!prisma)
    throw new ServiceUnavailableException(
      "Khôi phục thật yêu cầu kết nối database.",
    );
  const backup = await prisma.backupJob.findUnique({
    where: { id: input.backupId },
  });
  if (
    !backup ||
    backup.status !== "COMPLETED" ||
    !backup.checksum ||
    !backup.objectKey
  )
    throw new NotFoundException("Không tìm thấy điểm sao lưu thật hợp lệ.");
  const row = await prisma.restoreJob.create({
    data: {
      id: `restore-${randomUUID()}`,
      backupId: input.backupId,
      mode: input.mode,
      requestedBy: actorId,
      reason: input.reason.trim(),
      targetDatabase: input.targetDatabase?.trim(),
      status: "PENDING",
    },
  });
  await serviceContext.logDatabase(
    prisma,
    actorId,
    "RESTORE_REQUESTED",
    row.id,
    `${input.mode} · ${input.reason.trim()}`,
  );
  return serviceContext.mapRestore(row);
}

/** Xác thực người duyệt độc lập rồi chạy drill hoặc phục hồi vào database staging mới. */
export async function approveRestore(
  serviceContext: SystemServiceContext,
  restoreId: string,
  approverId: string,
): Promise<RestoreRun> {
  const prisma = serviceContext.database();
  if (
    !prisma ||
    !serviceContext.databaseBackup ||
    !serviceContext.objectStorage
  )
    throw new ServiceUnavailableException("Dịch vụ khôi phục chưa sẵn sàng.");
  const restore = await prisma.restoreJob.findUnique({
    where: { id: restoreId },
    include: { backup: true },
  });
  if (!restore)
    throw new NotFoundException("Không tìm thấy yêu cầu khôi phục.");
  if (restore.status !== "PENDING")
    throw new BadRequestException(
      "Yêu cầu khôi phục không còn ở trạng thái chờ duyệt.",
    );
  if (restore.requestedBy === approverId)
    throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
  const approver = await prisma.user.findUnique({
    where: { id: approverId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  const canApprove =
    approver?.status === "ACTIVE" &&
    approver.roles.some((entry) =>
      entry.role.permissions.some(
        (grant) => grant.permission.code === "system:configure",
      ),
    );
  if (!canApprove)
    throw new BadRequestException(
      "Người phê duyệt không còn tài khoản hoạt động hoặc thiếu quyền vận hành hệ thống.",
    );
  if (
    !restore.backup.checksum ||
    !restore.backup.objectKey ||
    restore.backup.status !== "COMPLETED"
  )
    throw new BadRequestException("Điểm sao lưu không còn hợp lệ.");
  if (
    restore.mode === "OPERATIONAL" &&
    !(await serviceContext.getSettings()).maintenanceMode
  )
    throw new BadRequestException(
      "Khôi phục vận hành chỉ được chạy khi hệ thống đang ở chế độ bảo trì.",
    );
  const claimed = await prisma.restoreJob.updateMany({
    where: { id: restoreId, status: "PENDING" },
    data: { status: "RUNNING", approvedBy: approverId, approvedAt: new Date() },
  });
  if (claimed.count !== 1)
    throw new BadRequestException(
      "Yêu cầu vừa được người khác xử lý; hãy tải lại trạng thái.",
    );
  try {
    const result = await withTemporaryFile(async (path) => {
      const expectedSize = Number(restore.backup.sizeBytes);
      if (!Number.isSafeInteger(expectedSize) || expectedSize < 5)
        throw new BadRequestException(
          "Checksum bản sao lưu không hợp lệ; đã dừng khôi phục.",
        );
      const downloaded = await serviceContext.objectStorage!.getToFile(
        restore.backup.objectKey!,
        path,
        expectedSize,
      );
      if (
        downloaded.checksum !== restore.backup.checksum ||
        downloaded.size !== expectedSize
      )
        throw new BadRequestException(
          "Checksum bản sao lưu không hợp lệ; đã dừng khôi phục.",
        );
      return restore.mode === "OPERATIONAL"
        ? serviceContext.databaseBackup!.restoreToDatabase(
            path,
            restore.targetDatabase ?? "",
          )
        : serviceContext.databaseBackup!.verifyRestore(path);
    });
    const verification =
      restore.mode === "OPERATIONAL"
        ? `Checksum hợp lệ; đã khôi phục ${result.tableCount} bảng và ${result.rowCount} dòng vào database staging ${result.database}. Cần cutover hạ tầng theo runbook riêng.`
        : `Checksum hợp lệ; đã phục hồi thử nghiệm ${result.tableCount} bảng và ${result.rowCount} dòng vào database tạm, sau đó dọn dẹp an toàn.`;
    const row = await prisma.restoreJob.update({
      where: { id: restoreId },
      data: { status: "COMPLETED", verification, completedAt: new Date() },
    });
    await serviceContext.logDatabase(
      prisma,
      approverId,
      restore.mode === "OPERATIONAL"
        ? "RESTORE_STAGING_COMPLETED"
        : "RESTORE_DRILL_COMPLETED",
      restore.backupId,
      verification,
    );
    return serviceContext.mapRestore(row);
  } catch (error) {
    await prisma.restoreJob
      .update({
        where: { id: restoreId },
        data: {
          status: "FAILED",
          verification:
            "Khôi phục thất bại; database vận hành hiện tại không bị thay đổi.",
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);
    if (
      error instanceof BadRequestException ||
      error instanceof ServiceUnavailableException
    )
      throw error;
    throw new ServiceUnavailableException("Khôi phục thất bại.");
  }
}

/** Giữ API service cũ ở dạng drill một bước chỉ để tương thích test không kết nối DB. */
export async function restoreBackup(
  serviceContext: SystemServiceContext,
  backupId: string,
  approvedBy: string,
  actorId = "usr-admin",
): Promise<RestoreRun> {
  if (approvedBy.trim().length < 3)
    throw new BadRequestException("Cần người phê duyệt khôi phục.");
  if (approvedBy.trim() === actorId)
    throw new BadRequestException("Người phê duyệt phải khác người yêu cầu.");
  return serviceContext.requestRestore(
    {
      backupId,
      mode: "DRILL",
      reason: "Kiểm tra khả năng phục hồi bản sao lưu",
    },
    actorId,
  );
}

/** Liệt kê lịch sử kiểm tra phục hồi sao lưu. */
export async function listRestores(
  serviceContext: SystemServiceContext,
): Promise<RestoreRun[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.restoreJob.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapRestore(row));
  }
  return structuredClone(serviceContext.restores);
}
