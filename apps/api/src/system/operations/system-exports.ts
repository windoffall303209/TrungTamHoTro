import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { DataExport } from "../system.shared.js";
import type { SystemServiceContext } from "../system.context.js";

/** Xếp export vào hàng đợi bền vững; worker mới tạo tệp và xác minh checksum. */
export async function runExport(
  serviceContext: SystemServiceContext,
  category: string,
  format: DataExport["format"],
  actorId = "usr-admin",
): Promise<DataExport> {
  const normalizedCategory = category.trim().toUpperCase();
  if (!["AUDIT", "LEARNING", "USERS"].includes(normalizedCategory))
    throw new BadRequestException(
      "Export chỉ hỗ trợ AUDIT, LEARNING hoặc USERS.",
    );
  const prisma = serviceContext.database();
  if (prisma) {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 86_400_000);
    if (!serviceContext.objectStorage)
      throw new ServiceUnavailableException(
        "Kho object chưa sẵn sàng để tạo tệp export.",
      );
    const exportId = `export-${randomUUID()}`;
    const row = await prisma.dataExportJob.create({
      data: {
        id: exportId,
        category: normalizedCategory,
        format,
        status: "PENDING",
        expiresAt,
        requestedBy: actorId,
        availableAt: new Date(),
      },
    });
    await serviceContext.logDatabase(
      prisma,
      actorId,
      "DATA_EXPORT_QUEUED",
      row.id,
      `${normalizedCategory} · ${format} · chờ worker xử lý.`,
    );
    return serviceContext.mapExport(row);
  }
  const rows =
    normalizedCategory === "AUDIT"
      ? serviceContext.audit.map((item) => ({ ...item }))
      : [];
  const content = serviceContext.serializeExport(rows, format);
  const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const item: DataExport = {
    id: `export-${randomUUID()}`,
    category: normalizedCategory,
    format,
    status: "COMPLETED",
    rowCount: rows.length,
    checksum,
    sizeBytes: content.length,
    downloadAvailable: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    attempts: 1,
    progress: 100,
  };
  serviceContext.exportFiles.set(item.id, content);
  serviceContext.exports.unshift(item);
  serviceContext.log(
    actorId,
    "DATA_EXPORTED",
    item.id,
    `${normalizedCategory} · ${format} · ${item.rowCount} dòng · ${checksum}`,
  );
  return structuredClone(item);
}
