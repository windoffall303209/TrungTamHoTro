import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { DataExport } from "../../core/system.shared.js";
import type { SystemServiceContext } from "../../core/system.context.js";

/** Đọc lại tệp export còn hạn và kiểm tra checksum ngay trước khi tải xuống. */
export async function downloadExport(
  serviceContext: SystemServiceContext,
  exportId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const prisma = serviceContext.database();
  if (prisma) {
    const row = await prisma.dataExportJob.findUnique({
      where: { id: exportId },
    });
    if (!row || row.status !== "COMPLETED" || !row.objectKey || !row.checksum)
      throw new NotFoundException("Không tìm thấy tệp export hoàn tất.");
    if (!row.expiresAt || row.expiresAt <= new Date())
      throw new BadRequestException(
        "Tệp export đã hết hạn; hãy tạo bản xuất mới.",
      );
    if (!serviceContext.objectStorage)
      throw new ServiceUnavailableException("Kho object chưa sẵn sàng.");
    const buffer = await serviceContext.objectStorage.get(row.objectKey);
    const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    if (checksum !== row.checksum)
      throw new ServiceUnavailableException(
        "Checksum tệp export không hợp lệ.",
      );
    const format = row.format === "JSON" ? "JSON" : "CSV";
    return {
      buffer,
      filename: `${row.category.toLowerCase()}-${row.id}.${format.toLowerCase()}`,
      mimeType:
        format === "JSON"
          ? "application/json; charset=utf-8"
          : "text/csv; charset=utf-8",
    };
  }
  const item = serviceContext.exports.find((entry) => entry.id === exportId);
  const buffer = serviceContext.exportFiles.get(exportId);
  if (!item || !buffer)
    throw new NotFoundException("Không tìm thấy tệp export.");
  if (new Date(item.expiresAt) <= new Date())
    throw new BadRequestException(
      "Tệp export đã hết hạn; hãy tạo bản xuất mới.",
    );
  return {
    buffer,
    filename: `${item.category.toLowerCase()}-${item.id}.${item.format.toLowerCase()}`,
    mimeType:
      item.format === "JSON"
        ? "application/json; charset=utf-8"
        : "text/csv; charset=utf-8",
  };
}

/** Liệt kê các lần xuất dữ liệu hệ thống. */
export async function listExports(
  serviceContext: SystemServiceContext,
): Promise<DataExport[]> {
  const prisma = serviceContext.database();
  if (prisma) {
    const rows = await prisma.dataExportJob.findMany({
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => serviceContext.mapExport(row));
  }
  return structuredClone(serviceContext.exports);
}
