import { BadRequestException } from "@nestjs/common";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

const DOCX_ENTRY_LIMIT = 8 * 1024 * 1024;
const DOCX_TOTAL_LIMIT = 32 * 1024 * 1024;
const DOCX_ENTRY_COUNT_LIMIT = 2_048;

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
          stream.on("data", (chunk: Buffer) => {
            entryActual += chunk.length;
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
            opened.readEntry();
          });
        });
      });
      opened.on("end", () => finish(hasDocument ? undefined : new BadRequestException("Tệp DOCX không có nội dung tài liệu hợp lệ.")));
      opened.readEntry();
    });
  });
}
