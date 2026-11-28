import { describe, expect, it } from "vitest";
import { stripImageMetadata } from "../../src/infrastructure/image-metadata.js";

/** Tạo segment JPEG có marker và payload cho trước. */
function jpegSegment(marker: number, payload: string): Buffer {
  const data = Buffer.from(payload, "latin1");
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

/** Tạo chunk PNG (CRC giả vì bộ lọc không kiểm CRC). */
function pngChunk(type: string, payload: string): Buffer {
  const data = Buffer.from(payload, "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

/** Tạo chunk RIFF của WebP, đệm 1 byte khi kích thước lẻ. */
function webpChunk(type: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  return Buffer.concat([Buffer.from(type, "latin1"), size, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

describe("Bỏ metadata Exif/GPS khỏi avatar", () => {
  it("JPEG: bỏ APP1 Exif/XMP và COM, giữ JFIF và dữ liệu sau SOS", () => {
    const image = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      jpegSegment(0xe0, "JFIF\0"),
      jpegSegment(0xe1, "Exif\0\0GPSLatitude=21.0285"),
      jpegSegment(0xfe, "camera owner"),
      jpegSegment(0xda, "scan"),
      Buffer.from([0x12, 0x34, 0xff, 0xd9]),
    ]);
    const cleaned = stripImageMetadata(image, "image/jpeg").toString("latin1");
    expect(cleaned).not.toContain("GPSLatitude");
    expect(cleaned).not.toContain("camera owner");
    expect(cleaned).toContain("JFIF");
    expect(stripImageMetadata(image, "image/jpeg").subarray(-4).equals(Buffer.from([0x12, 0x34, 0xff, 0xd9]))).toBe(true);
  });

  it("PNG: bỏ eXIf/tEXt/iTXt, giữ IHDR/IDAT/IEND", () => {
    const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", "hdr"), pngChunk("eXIf", "GPS"), pngChunk("tEXt", "Author\0Ann"), pngChunk("IDAT", "pixels"), pngChunk("IEND", "")]);
    const cleaned = stripImageMetadata(image, "image/png").toString("latin1");
    expect(cleaned).not.toContain("GPS");
    expect(cleaned).not.toContain("Author");
    expect(cleaned).toContain("IDAT");
    expect(cleaned).toContain("IEND");
  });

  it("WebP: bỏ chunk EXIF/XMP, tắt cờ trong VP8X và tính lại kích thước RIFF", () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x0c;
    const body = Buffer.concat([webpChunk("VP8X", vp8x), webpChunk("VP8 ", Buffer.from("frame")), webpChunk("EXIF", Buffer.from("GPS data")), webpChunk("XMP ", Buffer.from("<xmp/>"))]);
    const header = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")]);
    header.writeUInt32LE(body.length + 4, 4);
    const cleaned = stripImageMetadata(Buffer.concat([header, body]), "image/webp");
    expect(cleaned.toString("latin1")).not.toContain("GPS data");
    expect(cleaned.toString("latin1")).not.toContain("<xmp/>");
    expect(cleaned.readUInt32LE(4)).toBe(cleaned.length - 8);
    expect(cleaned[20]! & 0x0c).toBe(0);
  });

  it("từ chối JPEG cắt cụt", () => {
    expect(() => stripImageMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00]), "image/jpeg")).toThrow("không hợp lệ");
  });
});
