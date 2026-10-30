import { BadRequestException } from "@nestjs/common";
import { UploadedMaterialFile } from "../learning.shared.js";
import type { LearningServiceContext } from "../learning.context.js";

/** Phát hiện mẫu tệp thực thi/script nguy hiểm khi antivirus ngoài không khả dụng. */
export function detectMaliciousUpload(
  upload: UploadedMaterialFile,
): string | undefined {
  const head = upload.buffer.subarray(0, Math.min(upload.buffer.length, 8192));
  const text = head.toString("utf8");
  if (head[0] === 0x4d && head[1] === 0x5a)
    return "Phát hiện chữ ký tệp thực thi Windows (MZ).";
  if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))
    return "Phát hiện chữ ký kiểm thử antivirus EICAR.";
  if (/<script\b|javascript:/i.test(text))
    return "Phát hiện nội dung script có khả năng thực thi.";
  if (/\.(?:exe|dll|bat|cmd|ps1|js|html?)$/i.test(upload.originalName))
    return "Phần mở rộng tệp có khả năng thực thi.";
  return undefined;
}

/** Kiểm tra giới hạn, MIME, magic bytes và quét virus cho ảnh câu hỏi. */
export async function validateQuestionImage(
  serviceContext: LearningServiceContext,
  upload: UploadedMaterialFile,
): Promise<void> {
  const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (upload.size !== upload.buffer.length)
    throw new BadRequestException(
      "Kích thước ảnh không khớp nội dung nhận được.",
    );
  if (upload.size < 1 || upload.size > 8 * 1024 * 1024)
    throw new BadRequestException(
      "Ảnh câu hỏi phải có kích thước từ 1 byte đến 8 MB.",
    );
  if (!allowedMimeTypes.has(upload.mimeType))
    throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP.");
  const buffer = upload.buffer;
  const isPng =
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";
  const signatureMatches =
    upload.mimeType === "image/png"
      ? isPng
      : upload.mimeType === "image/jpeg"
        ? isJpeg
        : isWebp;
  if (!signatureMatches)
    throw new BadRequestException(
      "Nội dung ảnh không khớp định dạng tệp đã khai báo.",
    );
  const threat = await serviceContext.scanUpload(upload);
  if (threat)
    throw new BadRequestException(`Ảnh câu hỏi không an toàn: ${threat}`);
}

/** Gọi antivirus service và trả lý do cách ly thay vì ném lỗi khi phát hiện malware. */
export async function scanUpload(
  serviceContext: LearningServiceContext,
  upload: UploadedMaterialFile,
): Promise<string | undefined> {
  const signatureReason = serviceContext.detectMaliciousUpload(upload);
  if (signatureReason) return signatureReason;
  if (!serviceContext.antivirus) return undefined;
  const result = upload.path
    ? await serviceContext.antivirus.scanFile(upload.path)
    : await serviceContext.antivirus.scan(upload.buffer);
  return result.clean
    ? undefined
    : `ClamAV phát hiện mã độc: ${result.signature ?? "không xác định"}.`;
}
