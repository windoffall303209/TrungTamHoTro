import { BadRequestException } from "@nestjs/common";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";

const DOCX_ENTRY_LIMIT = 8 * 1024 * 1024;
const DOCX_TOTAL_LIMIT = 32 * 1024 * 1024;
const DOCX_ENTRY_COUNT_LIMIT = 2_048;

/** Kiểm tra danh mục ZIP mà không giải nén, chặn tệp nén phình lớn trước khi đọc DOCX. */
export function validateDocxArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let archive: ZipFile | undefined;
    let settled = false;
    let entries = 0;
    let total = 0;
    let hasDocument = false;
    /** Kết thúc việc đọc tệp nén đúng một lần, đóng tài nguyên rồi trả kết quả hoặc lỗi. */
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      archive?.close();
      if (error) reject(error); else resolve();
    };
    fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (openError, opened) => {
      if (openError) { finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")); return; }
      archive = opened;
      opened.on("error", () => finish(new BadRequestException("Tệp DOCX không hợp lệ hoặc đã bị hỏng.")));
      opened.on("entry", (entry: Entry) => {
        entries += 1;
        total += entry.uncompressedSize;
        if (entry.fileName === "word/document.xml") hasDocument = true;
        if (entries > DOCX_ENTRY_COUNT_LIMIT || entry.uncompressedSize > DOCX_ENTRY_LIMIT || total > DOCX_TOTAL_LIMIT) {
          finish(new BadRequestException("Tệp DOCX có cấu trúc giải nén vượt giới hạn an toàn."));
          return;
        }
        opened.readEntry();
      });
      opened.on("end", () => finish(hasDocument ? undefined : new BadRequestException("Tệp DOCX không có nội dung tài liệu hợp lệ.")));
      opened.readEntry();
    });
  });
}
