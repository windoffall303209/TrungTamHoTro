import { BadRequestException } from "@nestjs/common";
import { UploadedMaterialFile } from "../learning.shared.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Chuẩn hóa văn bản diễn đàn và áp dụng giới hạn độ dài/nội dung rỗng. */
export function validateForumContent(value: string, label: string): string {
  const normalized = value.trim();
  if (/<\/?[a-z][^>]*>|javascript:|data:text\/html/i.test(normalized))
    throw new BadRequestException(
      `${label} chứa HTML hoặc mã thực thi không được phép.`,
    );
  return normalized;
}

/** Chuẩn hóa văn bản phiếu hỗ trợ và chặn nội dung rỗng/quá dài. */
export function validateSupportText(
  serviceContext: LearningServiceContext,
  value: string,
  label: string,
): string {
  const normalized = serviceContext.validateForumContent(value, label);
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /(?:password|passwd|mật\s*khẩu)\s*[:=]\s*\S+/i,
    /(?:access[_-]?token|api[_-]?key|secret)\s*[:=]\s*[A-Za-z0-9_\-./+=]{8,}/i,
    /(?:Bearer\s+)[A-Za-z0-9_\-.]{12,}/i,
  ];
  if (secretPatterns.some((pattern) => pattern.test(normalized))) {
    throw new BadRequestException(
      `${label} có dấu hiệu chứa mật khẩu, token hoặc khóa bí mật. Hãy xóa dữ liệu nhạy cảm trước khi gửi.`,
    );
  }
  return normalized;
}

/** Kiểm tra kích thước, MIME và chữ ký tệp bằng chứng hỗ trợ. */
export function validateSupportUpload(
  serviceContext: LearningServiceContext,
  upload: UploadedMaterialFile,
): void {
  const allowedMimeTypes = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "text/plain",
  ]);
  if (upload.size !== upload.buffer.length)
    throw new BadRequestException(
      "Kích thước tệp bằng chứng không khớp nội dung nhận được.",
    );
  if (upload.size < 1 || upload.size > 10 * 1024 * 1024)
    throw new BadRequestException(
      "Tệp bằng chứng phải có kích thước từ 1 byte đến 10 MB.",
    );
  if (!allowedMimeTypes.has(upload.mimeType))
    throw new BadRequestException(
      "Chỉ chấp nhận bằng chứng PDF, PNG, JPEG hoặc TXT.",
    );
  if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName))
    throw new BadRequestException(
      "Loại tệp bằng chứng có nguy cơ thực thi không được phép.",
    );
  if (upload.mimeType === "text/plain")
    serviceContext.validateSupportText(
      upload.buffer.toString("utf8"),
      "Tệp bằng chứng",
    );
}
