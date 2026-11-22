import { BadRequestException } from "@nestjs/common";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

const DOCX_ENTRY_LIMIT = 8 * 1024 * 1024;
const DOCX_TOTAL_LIMIT = 32 * 1024 * 1024;
const DOCX_ENTRY_COUNT_LIMIT = 2_048;

/**
 * Kiểm tra nội dung XML của DOCX: chặn khai báo DTD/thực thể (XXE, bom thực thể) và quan hệ trỏ ra ngoài
 * (template, OLE, ảnh từ xa dùng để theo dõi/rò NTLM); chỉ cho phép hyperlink ngoài như tài liệu Word thông thường.
 */
export function assertSafeDocxXml(fileName: string, xml: string): void {
  if (/<!(?:DOCTYPE|ENTITY)/i.test(xml)) throw new BadRequestException("Tệp DOCX chứa khai báo XML không an toàn.");
  if (!/\.rels$/i.test(fileName)) return;
  for (const relationship of xml.match(/<Relationship\b[^>]*>/gi) ?? []) {
    if (!/TargetMode\s*=\s*["']External["']/i.test(relationship)) continue;
    if (!/Type\s*=\s*["'][^"']*\/hyperlink["']/i.test(relationship)) throw new BadRequestException("Tệp DOCX chứa liên kết ngoài không được phép.");
  }
}

/** Kiểm tra danh mục ZIP và luồng giải nén thực tế, chặn tệp nén phình lớn hoặc giả mạo kích thước trước khi đọc DOCX. */
export function validateDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let archive: ZipFile | undefined;
    let settled = false;
    let entries = 0;
    let declaredTotal = 0;
    let actualTotal = 0;
    let hasDocument = false;
    /** Kết thúc việc đọc tệp nén đúng một lần, đóng tài nguyên rồi trả kết quả hoặc lỗi. */
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      archive?.close();
      if (error) reject(error); else resolve();
    };
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: false, strictFileNames: true }, (openError, opened) => {
      if (openError) { finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")); return; }
      archive = opened;
      opened.on("error", () => finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")));
      opened.on("entry", (entry: Entry) => {
        entries += 1;
        declaredTotal += entry.uncompressedSize;
        if (entry.fileName === "word/document.xml") hasDocument = true;
        // Macro VBA và ActiveX không cần cho bài nộp/học liệu Word và là đường thực thi mã phổ biến.
        if (/(?:^|\/)vbaProject\.bin$/i.test(entry.fileName) || /(?:^|\/)activeX\//i.test(entry.fileName)) {
          finish(new BadRequestException("Tệp DOCX chứa macro không được phép."));
          return;
        }
        if (entries > DOCX_ENTRY_COUNT_LIMIT || entry.uncompressedSize > DOCX_ENTRY_LIMIT || declaredTotal > DOCX_TOTAL_LIMIT) {
          finish(new BadRequestException("Tệp DOCX có cấu trúc giải nén vượt giới hạn an toàn."));
          return;
        }
        if (entry.fileName.endsWith("/") && entry.uncompressedSize === 0 && entry.compressedSize === 0) {
          opened.readEntry();
          return;
        }
        opened.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng."));
            return;
          }
          let entryActual = 0;
          const inspectXml = /\.(?:xml|rels)$/i.test(entry.fileName);
          const xmlChunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => {
            entryActual += chunk.length;
            if (inspectXml) xmlChunks.push(chunk);
            actualTotal += chunk.length;
            if (entryActual > DOCX_ENTRY_LIMIT || actualTotal > DOCX_TOTAL_LIMIT || entryActual > entry.uncompressedSize) {
              stream.destroy();
              finish(new BadRequestException("Tệp DOCX có cấu trúc giải nén vượt giới hạn an toàn."));
            }
          });
          stream.on("error", () => {
            stream.destroy();
            finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng."));
          });
          stream.on("end", () => {
            if (settled) return;
            if (entryActual !== entry.uncompressedSize) {
              finish(new BadRequestException("Tệp DOCX có cấu trúc giải nén vượt giới hạn an toàn."));
              return;
            }
            if (inspectXml) {
              try {
                assertSafeDocxXml(entry.fileName, Buffer.concat(xmlChunks).toString("utf8"));
              } catch (error) {
                finish(error instanceof Error ? error : new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng."));
                return;
              }
            }
            opened.readEntry();
          });
        });
      });
      opened.on("end", () => finish(hasDocument ? undefined : new BadRequestException("Tệp DOCX không có nội dung tài liệu hợp lệ.")));
      opened.readEntry();
    });
  });
}
