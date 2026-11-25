import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import { validateAssignmentFiles } from "../../src/domains/learning/operations/academic/academic-files.js";
import type { UploadedAssignmentFile } from "../../src/domains/learning/academic/academic.shared.js";
import { assertSafeUpload } from "../../src/infrastructure/file-signature.js";
import { readFileHead } from "../../src/infrastructure/file-streams.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import {
  getActiveSubmissionUploadCount,
  SubmissionUploadInterceptor,
} from "../../src/infrastructure/submission-upload.interceptor.js";
import { deflateRawSync } from "node:zlib";

/** Tạo một gói ZIP DOCX tối thiểu trong bộ nhớ với danh sách entry tùy chỉnh để kiểm thử macro/XXE trên đĩa. */
function buildZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    // CRC-32 chuẩn IEEE 802.3 cho ZIP header.
    let crc = 0xffffffff;
    for (const byte of entry.data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/** Tạo ObjectStorageService cục bộ trong thư mục tạm riêng của test. */
function createLocalStorage(root: string): ObjectStorageService {
  const values: Record<string, unknown> = {
    STORAGE_PROVIDER: "local",
    STORAGE_ROOT: root,
    CLOUDINARY_FOLDER: "wind-edu",
    CLOUDINARY_CLOUD_NAME: "",
    CLOUDINARY_API_KEY: "",
    CLOUDINARY_API_SECRET: "",
  };
  const config = {
    get: (key: keyof Environment): unknown => values[key],
  } as unknown as ConfigService<Environment, true>;
  return new ObjectStorageService(config);
}

/** Đếm số thư mục tạm wind-submission-* còn sót lại trong tmpdir. */
async function countTempSubmissionDirs(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith("wind-submission-")).length;
}

describe("E02 Disk-backed submission upload, magic/DOCX/antivirus validation & cleanup", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("chuyển upload bài nộp sang đĩa tạm, kiểm tra magic bytes/DOCX macro/antivirus, dọn sạch khi lỗi và chịu 16 upload đồng thời", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-e02-storage-"));
    tempDirs.push(storageRoot);
    const storage = createLocalStorage(storageRoot);
    let antivirusClean = true;
    const scanFileSpy = vi.fn<
      (filePath: string) => Promise<{ clean: boolean; engine: "clamav"; signature?: string }>
    >(() =>
      Promise.resolve({
        clean: antivirusClean,
        engine: "clamav" as const,
        signature: antivirusClean ? undefined : "Eicar-Test-Signature",
      }),
    );
    const putFileSpy = vi.spyOn(storage, "putFile");
    const putBufferSpy = vi.spyOn(storage, "put");

    @Controller("e02-test")
    class TestUploadController {
      /** Nhận tệp multipart qua SubmissionUploadInterceptor, kiểm tra và lưu bằng luồng từ đĩa. */
      @Post("upload")
      @UseInterceptors(SubmissionUploadInterceptor)
      async upload(
        @UploadedFiles()
        files: Array<{
          originalname: string;
          mimetype: string;
          size: number;
          buffer?: Buffer;
          path?: string;
        }> = [],
      ): Promise<{ count: number; checksums: string[]; usedDiskPath: boolean }> {
        const normalized: UploadedAssignmentFile[] = [];
        for (const file of files) {
          expect(file.path).toBeTruthy();
          expect(file.buffer).toBeUndefined();
          normalized.push({
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            path: file.path,
            buffer: await readFileHead(file.path!),
          });
        }
        validateAssignmentFiles(normalized);
        for (const file of normalized) {
          await assertSafeUpload(file);
        }
        const checksums: string[] = [];
        for (const file of normalized) {
          const scan = await scanFileSpy(file.path!);
          if (!scan.clean) {
            throw new Error(`Tệp ${file.originalName} không an toàn và đã bị từ chối.`);
          }
          const saved = await storage.putFile(
            `submissions/${Date.now()}-${Math.random().toString(16).slice(2)}`,
            file.path!,
          );
          checksums.push(saved.checksum);
        }
        return {
          count: normalized.length,
          checksums,
          usedDiskPath: normalized.every((f) => Boolean(f.path)),
        };
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [TestUploadController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): { port: number } };
    const uploadUrl = `http://127.0.0.1:${server.address().port}/e02-test/upload`;

    try {
      const tempBefore = await countTempSubmissionDirs();

      // 1. Upload hợp lệ (PDF + DOCX sạch + TXT) dùng disk path + scanFile + putFile, không gọi storage.put(buffer).
      const validPdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(64 * 1024)]);
      const validDocx = buildZip([
        { name: "word/document.xml", data: Buffer.from("<w:document><w:body><w:p>Bai lam</w:p></w:body></w:document>") },
      ]);
      const validTxt = Buffer.from("Bài làm tự luận hợp lệ có tiếng Việt.", "utf8");

      const okForm = new FormData();
      okForm.append("files", new Blob([new Uint8Array(validPdf)], { type: "application/pdf" }), "bai-lam.pdf");
      okForm.append(
        "files",
        new Blob([new Uint8Array(validDocx)], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        "bai-lam.docx",
      );
      okForm.append("files", new Blob([new Uint8Array(validTxt)], { type: "text/plain" }), "ghi-chu.txt");

      const okRes = await fetch(uploadUrl, { method: "POST", body: okForm });
      expect(okRes.status).toBe(201);
      const okJson = (await okRes.json()) as { count: number; checksums: string[]; usedDiskPath: boolean };
      expect(okJson.count).toBe(3);
      expect(okJson.usedDiskPath).toBe(true);
      expect(okJson.checksums[0]).toBe(`sha256:${createHash("sha256").update(validPdf).digest("hex")}`);
      expect(scanFileSpy).toHaveBeenCalledTimes(3);
      expect(putFileSpy).toHaveBeenCalledTimes(3);
      expect(putBufferSpy).not.toHaveBeenCalled();
      expect(await countTempSubmissionDirs()).toBe(tempBefore);

      // 2. Tệp giả mạo magic bytes (HTML giả PDF) bị chặn 400 và dọn sạch thư mục tạm.
      const spoofForm = new FormData();
      spoofForm.append("files", new Blob(["<html><script>alert(1)</script></html>"], { type: "application/pdf" }), "fake.pdf");
      const spoofRes = await fetch(uploadUrl, { method: "POST", body: spoofForm });
      expect(spoofRes.status).toBe(400);
      expect(await countTempSubmissionDirs()).toBe(tempBefore);

      // 3. Tệp DOCX chứa macro vbaProject.bin upload qua đĩa vẫn bị chặn 400 và dọn sạch thư mục tạm.
      const macroDocx = buildZip([
        { name: "word/document.xml", data: Buffer.from("<w:document/>") },
        { name: "word/vbaProject.bin", data: Buffer.from("macro-payload") },
      ]);
      const macroForm = new FormData();
      macroForm.append(
        "files",
        new Blob([new Uint8Array(macroDocx)], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        "macro.docx",
      );
      const macroRes = await fetch(uploadUrl, { method: "POST", body: macroForm });
      expect(macroRes.status).toBe(400);
      expect(await countTempSubmissionDirs()).toBe(tempBefore);

      // 4. Tệp vượt trần dung lượng 20 MB bị Multer từ chối 413 và dọn sạch thư mục tạm.
      const oversized = Buffer.alloc(21 * 1024 * 1024);
      oversized.write("%PDF-1.7\n", 0, "ascii");
      const bigForm = new FormData();
      bigForm.append("files", new Blob([new Uint8Array(oversized)], { type: "application/pdf" }), "too-big.pdf");
      const bigRes = await fetch(uploadUrl, { method: "POST", body: bigForm });
      expect(bigRes.status).toBe(413);
      expect(await countTempSubmissionDirs()).toBe(tempBefore);

      // 5. Antivirus từ chối tệp nhiễm mã độc -> lỗi và dọn sạch thư mục tạm, không lưu kho object.
      antivirusClean = false;
      const putCountBeforeVirus = putFileSpy.mock.calls.length;
      const virusForm = new FormData();
      virusForm.append("files", new Blob([new Uint8Array(validPdf)], { type: "application/pdf" }), "infected.pdf");
      const virusRes = await fetch(uploadUrl, { method: "POST", body: virusForm });
      expect(virusRes.status).toBe(500);
      expect(putFileSpy.mock.calls.length).toBe(putCountBeforeVirus);
      expect(await countTempSubmissionDirs()).toBe(tempBefore);
      antivirusClean = true;

      // 6. 16 lượt upload đồng thời tệp PDF 1 MB -> toàn bộ thành công, slot về 0 và không rò thư mục tạm.
      const oneMbPdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(1024 * 1024)]);
      const expectedOneMbSha = `sha256:${createHash("sha256").update(oneMbPdf).digest("hex")}`;
      const concurrentResults = await Promise.all(
        Array.from({ length: 16 }, async (_, idx) => {
          const form = new FormData();
          form.append("files", new Blob([new Uint8Array(oneMbPdf)], { type: "application/pdf" }), `concurrent-${idx}.pdf`);
          const response = await fetch(uploadUrl, { method: "POST", body: form });
          expect(response.status).toBe(201);
          return (await response.json()) as { checksums: string[] };
        }),
      );
      expect(concurrentResults).toHaveLength(16);
      expect(concurrentResults.every((r) => r.checksums[0] === expectedOneMbSha)).toBe(true);
      expect(getActiveSubmissionUploadCount()).toBe(0);
      expect(await countTempSubmissionDirs()).toBe(tempBefore);
    } finally {
      await app.close();
    }
  });
});
