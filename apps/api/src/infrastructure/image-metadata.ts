import { BadRequestException } from "@nestjs/common";

/** Marker JPEG mang metadata cá nhân: APP1 (Exif/XMP chứa GPS, thiết bị), APP13 (IPTC/Photoshop) và COM. */
const JPEG_METADATA_MARKERS = new Set([0xe1, 0xed, 0xfe]);
/** Chunk PNG chứa Exif, văn bản tự do hoặc thời điểm chỉnh sửa. */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
/** Chunk WebP chứa Exif/XMP. */
const WEBP_METADATA_CHUNKS = new Set(["EXIF", "XMP "]);

/** Lỗi thống nhất khi cấu trúc ảnh không đọc được để bỏ metadata. */
function invalidImage(): BadRequestException {
  return new BadRequestException("Ảnh đại diện bị hỏng hoặc có cấu trúc không hợp lệ.");
}

/** Bỏ segment Exif/XMP/IPTC/COM trước SOS của JPEG, giữ nguyên dữ liệu ảnh nén. */
function stripJpeg(buffer: Buffer): Buffer {
  const parts: Buffer[] = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw invalidImage();
    const marker = buffer[offset + 1];
    if (marker === undefined) throw invalidImage();
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Từ SOS trở đi là dữ liệu ảnh nén: chép nguyên phần còn lại.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(buffer.subarray(offset));
      return Buffer.concat(parts);
    }
    if (offset + 4 > buffer.length) throw invalidImage();
    const length = buffer.readUInt16BE(offset + 2);
    const end = offset + 2 + length;
    if (length < 2 || end > buffer.length) throw invalidImage();
    if (!JPEG_METADATA_MARKERS.has(marker)) parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  throw invalidImage();
}

/** Bỏ chunk metadata của PNG; chunk ảnh và IEND được giữ nguyên kèm CRC gốc. */
function stripPng(buffer: Buffer): Buffer {
  const parts: Buffer[] = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const end = offset + 12 + length;
    if (end > buffer.length) throw invalidImage();
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(buffer.subarray(offset, end));
    offset = end;
    if (type === "IEND") return Buffer.concat(parts);
  }
  throw invalidImage();
}

/** Bỏ chunk EXIF/XMP của WebP, xóa cờ tương ứng trong VP8X và tính lại kích thước RIFF. */
function stripWebp(buffer: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("latin1");
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > buffer.length) throw invalidImage();
    if (!WEBP_METADATA_CHUNKS.has(type)) {
      const chunk = Buffer.from(buffer.subarray(offset, Math.min(end, buffer.length)));
      // Byte cờ VP8X: bit 0x08 = có EXIF, 0x04 = có XMP.
      if (type === "VP8X" && chunk.length > 8) chunk[8] = chunk[8]! & ~0x0c;
      parts.push(chunk);
    }
    offset = end;
  }
  const body = Buffer.concat(parts);
  const header = Buffer.from(buffer.subarray(0, 12));
  header.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([header, body]);
}

/**
 * Trả bản ảnh không còn metadata Exif/GPS/XMP/IPTC/văn bản nhúng trước khi lưu avatar công khai trong hệ thống.
 * Chỉ thao tác trên cấu trúc container nên không giải nén hay tái mã hóa điểm ảnh.
 */
export function stripImageMetadata(buffer: Buffer, mimeType: string): Buffer {
  if (mimeType === "image/jpeg") return stripJpeg(buffer);
  if (mimeType === "image/png") return stripPng(buffer);
  if (mimeType === "image/webp") return stripWebp(buffer);
  throw new BadRequestException("Chỉ chấp nhận ảnh PNG, JPEG hoặc WebP hợp lệ.");
}
