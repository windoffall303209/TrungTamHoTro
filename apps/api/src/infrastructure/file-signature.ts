import { BadRequestException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { validateDocxArchive, validateDocxArchiveFile } from "./validate-docx-archive.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_ZIP_TYPES = new Set([
  DOCX,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** MIME mà trình duyệt có thể thực thi script khi render cùng origin; không bao giờ nhận làm tệp người dùng. */
export const ACTIVE_CONTENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
]);

/**
 * CSP cho mọi phản hồi tệp do người dùng tải lên: tài liệu mở trực tiếp bị sandbox và không được tải tài nguyên nào,
 * nên kể cả tệp ngụy trang HTML/SVG cũng không chạy script trên origin của API.
 */
export const USER_FILE_CSP = "sandbox; default-src 'none'";

/** MIME có thể xem trực tiếp (inline) an toàn trong trình duyệt khi kèm CSP sandbox. */
export function isInlineSafeMime(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"].includes(mimeType) || mimeType.startsWith("audio/") || mimeType.startsWith("video/");
}

/**
 * So khớp magic bytes với MIME đã khai báo. Trả undefined khi hệ thống chưa biết chữ ký của MIME đó
 * (caller tự quyết có nhận định dạng chưa biết hay không).
 */
export function matchesFileSignature(mimeType: string, head: Buffer): boolean | undefined {
  // Đọc một đoạn byte dưới dạng latin1 để so khớp chuỗi magic ASCII.
  const ascii = (start: number, end: number): string => head.subarray(start, end).toString("latin1");
  switch (mimeType) {
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "image/gif":
      return ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a";
    case "application/pdf":
      return ascii(0, 4) === "%PDF";
    case "application/msword":
      return head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    case "video/mp4":
    case "audio/mp4":
      return ascii(4, 8) === "ftyp";
    case "video/webm":
    case "audio/webm":
      return head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0);
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/wav":
    case "audio/x-wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE";
    case "text/plain": {
      if (head.includes(0) || head.toString("utf8").includes("�")) return false;
      // Văn bản ngụy trang HTML/SVG vẫn bị từ chối dù khai báo text/plain.
      return !/^\s*<(?:!doctype|html|svg|script|\?xml)/i.test(head.toString("utf8"));
    }
    default:
      if (OOXML_ZIP_TYPES.has(mimeType)) return head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      return undefined;
  }
}

/** Quét toàn bộ tệp văn bản trên đĩa theo luồng để phát hiện byte NUL hoặc chuỗi UTF-8 hỏng mà không nạp cả tệp vào RAM. */
async function assertSafeTextFile(filePath: string, originalName: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for await (const raw of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
      const chunk = raw as Buffer;
      if (chunk.includes(0)) {
        throw new BadRequestException(`Nội dung tệp ${originalName} không khớp với phần mở rộng.`);
      }
      decoder.decode(chunk, { stream: true });
    }
    decoder.decode();
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`Nội dung tệp ${originalName} không khớp với phần mở rộng.`);
  }
}

/**
 * Chặn tệp người dùng nguy hiểm: MIME có thể chứa script, nội dung không khớp chữ ký đã khai báo và DOCX độc hại
 * (cả tệp trong bộ nhớ lẫn tệp tạm trên đĩa). allowUnknownTypes cho phép MIME do quản trị cấu hình mà chưa có chữ ký.
 */
export async function assertSafeUpload(
  file: { mimeType: string; buffer: Buffer; originalName: string; path?: string },
  options: { allowUnknownTypes?: boolean } = {},
): Promise<void> {
  const mimeType = file.mimeType.toLowerCase();
  const signature = matchesFileSignature(mimeType, file.buffer);
  if (ACTIVE_CONTENT_MIME_TYPES.has(mimeType) || signature === false || (signature === undefined && !options.allowUnknownTypes))
    throw new BadRequestException(`Nội dung tệp ${file.originalName} không khớp với phần mở rộng.`);
  if (mimeType === "text/plain" && file.path) {
    await assertSafeTextFile(file.path, file.originalName);
  }
  if (mimeType === DOCX) {
    if (file.path) await validateDocxArchiveFile(file.path);
    else await validateDocxArchive(file.buffer);
  }
}

/** Từ chối danh sách MIME cấu hình có chứa định dạng có thể chạy script. */
export function assertNoActiveContentMimeTypes(mimeTypes: readonly string[]): void {
  if (mimeTypes.some((mimeType) => ACTIVE_CONTENT_MIME_TYPES.has(mimeType.trim().toLowerCase())))
    throw new BadRequestException("Không được cho phép định dạng có thể chứa script (HTML, SVG, XML, JavaScript).");
}
