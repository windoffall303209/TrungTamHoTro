import { BadRequestException } from "@nestjs/common";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import { validateDocxArchive } from "../../../../infrastructure/validate-docx-archive.js";
import type { AttachmentDocumentPreview } from "../../academic/academic.shared.js";

const PREVIEW_TEXT_LIMIT = 200_000;
/** Ảnh nhúng lớn hơn ngưỡng này không được chuyển sang base64 trong HTML xem trước. */
const PREVIEW_IMAGE_BYTES = 2 * 1024 * 1024;
/** Tổng dung lượng ảnh nhúng tối đa cho một bản xem trước để HTML không phình tới hàng chục MB. */
const PREVIEW_IMAGES_TOTAL_BYTES = 6 * 1024 * 1024;
/** Trần độ dài HTML trước khi chạy sanitize-html; vượt ngưỡng thì yêu cầu tải tệp về. */
const PREVIEW_HTML_LIMIT = 10 * 1024 * 1024;
const PREVIEW_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const ALLOWED_HTML_IMG_SRC = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;
const ALLOWED_LINK_HREF = /^(?:https?:\/\/|mailto:|#)/i;
/** Giữ định dạng văn bản, liên kết an toàn và ảnh raster nhúng trong bản xem trước. */
export function sanitizePreviewHtml(rawHtml: string): string {
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "em", "b", "i",
      "u", "s", "del", "sup", "sub", "ol", "ul", "li", "blockquote", "pre", "code",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "a", "img",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "id"],
      img: ["src", "alt"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
      li: ["id"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data"] },
    allowProtocolRelative: false,
    transformTags: {
      li: (tagName, attrs) => ({
        tagName,
        attribs: attrs.id ? { id: `doc-preview-${attrs.id}` } : attrs,
      }),
      a: (tagName, attrs) => {
        const attribs: Record<string, string> = {};
        if (attrs.id) attribs.id = `doc-preview-${attrs.id}`;
        if (attrs.href && ALLOWED_LINK_HREF.test(attrs.href)) {
          attribs.href = attrs.href.startsWith("#") ? `#doc-preview-${attrs.href.slice(1)}` : attrs.href;
          attribs.target = "_blank";
          attribs.rel = "noopener noreferrer";
        }
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" && !ALLOWED_HTML_IMG_SRC.test(frame.attribs.src ?? ""),
  });
}

/** Giải mã văn bản thuần từ tệp TXT với fallback UTF-8 an toàn, bỏ ký tự điều khiển nhiễu. */
function decodeTextPreview(buffer: Buffer): string {
  if (!buffer.length) return "";
  let raw = "";
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    raw = buffer.toString("utf8");
  }
  let normalized = "";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (ch === "\r") continue;
    if (code === 9 || code === 10 || (code >= 32 && code !== 127)) {
      normalized += ch;
    }
    if (normalized.length >= PREVIEW_TEXT_LIMIT) break;
  }
  return normalized;
}

/** Trích xuất văn bản đọc được từ định dạng Word nhị phân .doc cũ để giảng viên xem nhanh trên trình duyệt. */
export function extractLegacyDocText(buffer: Buffer): string {
  if (buffer.length < 512) return "";
  const candidates: string[] = [];
  const metaFilter = /^(?:Root Entry|Word\.?Document|1Table|0Table|SummaryInformation|Microsoft Word|Normal\.dotm?|Times New Roman|Calibri|Arial|Cambria|bjbj)/i;

  // Thử tách chuỗi UTF-16LE (chuẩn Unicode bên trong các tài liệu Word .doc hiện đại hỗ trợ tiếng Việt).
  const utf16Runs: string[] = [];
  let current = "";
  const limit = Math.min(buffer.length - 1, 2_000_000);
  for (let i = 0; i < limit; i += 2) {
    const code = buffer.readUInt16LE(i);
    const isWhitespace = code === 9 || code === 10 || code === 13 || code === 32;
    const isPrintable =
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0x00c0 && code <= 0x024f) ||
      (code >= 0x1e00 && code <= 0x1eff);
    if (isWhitespace || isPrintable) {
      current += code === 13 ? "\n" : String.fromCharCode(code);
    } else {
      if (current.trim().length >= 8) utf16Runs.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length >= 8) utf16Runs.push(current.trim());
  const cleanedUtf16 = utf16Runs
    .filter((line) => !metaFilter.test(line))
    .filter((line) => /[\p{L}\p{N}]{2,}/u.test(line));
  if (cleanedUtf16.length) candidates.push(cleanedUtf16.join("\n"));

  // Dự phòng chuỗi ASCII đơn byte nếu tệp .doc không dùng UTF-16LE.
  const latinRuns: string[] = [];
  let asciiBuf = "";
  const asciiLimit = Math.min(buffer.length, 2_000_000);
  for (let i = 0; i < asciiLimit; i += 1) {
    const byte = buffer[i]!;
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 0x20 && byte <= 0x7e)) {
      asciiBuf += byte === 13 ? "\n" : String.fromCharCode(byte);
    } else {
      const trimmed = asciiBuf.trim();
      if (trimmed.length >= 12 && /[a-zA-Z0-9]{3,}/.test(trimmed) && !metaFilter.test(trimmed)) {
        latinRuns.push(trimmed);
      }
      asciiBuf = "";
    }
  }
  const trailingTrimmed = asciiBuf.trim();
  if (trailingTrimmed.length >= 12 && /[a-zA-Z0-9]{3,}/.test(trailingTrimmed) && !metaFilter.test(trailingTrimmed)) {
    latinRuns.push(trailingTrimmed);
  }
  if (latinRuns.length) candidates.push(latinRuns.join("\n"));

  const best = candidates.sort((a, b) => b.length - a.length)[0] ?? "";
  return best.slice(0, PREVIEW_TEXT_LIMIT).trim();
}

/** Chuyển nội dung tài liệu văn phòng hoặc văn bản sang cấu trúc xem trước an toàn cho trang chấm bài. */
export async function buildDocumentPreview(file: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<AttachmentDocumentPreview> {
  if (
    file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.fileName)
  ) {
    await validateDocxArchive(file.buffer);
    let imageBudget = PREVIEW_IMAGES_TOTAL_BYTES;
    let skippedImages = 0;
    // Chỉ nhúng ảnh raster nhỏ trong ngân sách; ảnh lạ/quá lớn bị bỏ (src rỗng sẽ bị sanitize loại) thay vì tạo HTML base64 khổng lồ.
    const convertImage = mammoth.images.imgElement(async (image) => {
      const type = image.contentType.toLowerCase();
      if (!PREVIEW_IMAGE_TYPES.has(type)) {
        skippedImages += 1;
        return { src: "" };
      }
      const buffer = await image.readAsBuffer();
      if (buffer.length > PREVIEW_IMAGE_BYTES || buffer.length > imageBudget) {
        skippedImages += 1;
        return { src: "" };
      }
      imageBudget -= buffer.length;
      return { src: `data:${type};base64,${buffer.toString("base64")}` };
    });
    try {
      const result = await mammoth.convertToHtml({ buffer: file.buffer }, { includeEmbeddedStyleMap: false, convertImage });
      if (result.value.length > PREVIEW_HTML_LIMIT)
        throw new BadRequestException("Bản xem trước DOCX quá lớn. Hãy tải xuống để mở bằng Microsoft Word.");
      const warnings = result.messages
        .filter((message) => message.type === "warning" || message.type === "error")
        .map((message) => message.message)
        .slice(0, 10);
      if (skippedImages) warnings.unshift(`Đã ẩn ${skippedImages} ảnh quá lớn hoặc không hỗ trợ trong bản xem trước; tải tệp về để xem đầy đủ.`);
      return {
        kind: "html",
        fileName: file.fileName,
        mimeType: file.mimeType,
        html: sanitizePreviewHtml(result.value),
        warnings,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Không đọc được nội dung DOCX để xem trước. Hãy tải xuống để mở bằng Microsoft Word.");
    }
  }

  if (file.mimeType === "text/plain" || /\.txt$/i.test(file.fileName)) {
    return {
      kind: "text",
      fileName: file.fileName,
      mimeType: file.mimeType,
      text: decodeTextPreview(file.buffer),
      warnings: [],
    };
  }

  if (file.mimeType === "application/msword" || /\.doc$/i.test(file.fileName)) {
    const text = extractLegacyDocText(file.buffer);
    if (text.length >= 8) {
      return {
        kind: "text",
        fileName: file.fileName,
        mimeType: file.mimeType,
        text,
        warnings: [
          "Tệp Word (.doc) định dạng nhị phân cũ: đang hiển thị bản trích xuất văn bản. Hãy tải xuống để xem nguyên vẹn bảng biểu và công thức.",
        ],
      };
    }
    return {
      kind: "unsupported",
      fileName: file.fileName,
      mimeType: file.mimeType,
      warnings: [
        "Không trích xuất được văn bản từ tệp Word (.doc) này. Vui lòng tải xuống để mở trực tiếp.",
      ],
    };
  }

  return {
    kind: "unsupported",
    fileName: file.fileName,
    mimeType: file.mimeType,
    warnings: [],
  };
}
