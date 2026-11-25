import { Controller, Get, Headers, Req, Res, type StreamableFile } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import type { Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResponseInterceptor } from "../../src/common/response.interceptor.js";
import type { Environment } from "../../src/config/environment.js";
import {
  parseByteRange,
  rethrowWithRangeHeaders,
  sendRangedStreamableFile,
} from "../../src/infrastructure/http-range-stream.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import {
  clearVerifiedChecksumCacheForTests,
  getActiveDownloadCount,
  openVerifiedObjectStream,
} from "../../src/infrastructure/verified-download.js";

/** Tạo ObjectStorageService local trên thư mục tạm độc lập cho bài test streaming/Range. */
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

/** Đếm số thư mục tạm wind-download-* đang tồn tại trong tmpdir để đo temp disk I/O. */
async function countTempDownloadDirs(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter((name) => name.startsWith("wind-download-")).length;
}

describe("E01 Streaming download, HTTP Range (206/416), disconnect cleanup & 50 concurrent downloads", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    clearVerifiedChecksumCacheForTests();
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("phân tích chuẩn RFC 9110 cho byte range hợp lệ và từ chối range sai", () => {
    expect(parseByteRange(undefined, 1000)).toEqual({ kind: "full" });
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({
      kind: "partial",
      range: { start: 0, end: 99, length: 100 },
    });
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({
      kind: "partial",
      range: { start: 900, end: 999, length: 100 },
    });
    expect(parseByteRange("bytes=800-", 1000)).toEqual({
      kind: "partial",
      range: { start: 800, end: 999, length: 200 },
    });
    expect(parseByteRange("bytes=-250", 1000)).toEqual({
      kind: "partial",
      range: { start: 750, end: 999, length: 250 },
    });
    expect(parseByteRange("bytes=1000-1100", 1000)).toEqual({
      kind: "unsatisfiable",
      totalSize: 1000,
    });
    expect(parseByteRange("bytes=500-100", 1000)).toEqual({
      kind: "unsatisfiable",
      totalSize: 1000,
    });
    expect(parseByteRange("bytes=-0", 1000)).toEqual({
      kind: "unsatisfiable",
      totalSize: 1000,
    });
    expect(parseByteRange("bytes=abc-def", 1000)).toEqual({
      kind: "unsatisfiable",
      totalSize: 1000,
    });
  });

  it("hỗ trợ 200, 206 Partial Content, 416 Range Not Satisfiable, chặn tệp hỏng checksum, hủy luồng khi client ngắt và chịu tải 50 download đồng thời với 0 temp I/O", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-e01-storage-"));
    tempDirs.push(root);
    const storage = createLocalStorage(root);

    // Tạo tệp 8 MB ngẫu nhiên để kiểm tra streaming Range, abort và 50 lượt tải đồng thời.
    const payload = randomBytes(8 * 1024 * 1024);
    const stored = await storage.put("materials/video-lecture.bin", payload);
    const expectedSha = stored.checksum;

    // Tạo một tệp thứ hai rồi làm hỏng nội dung trên đĩa để chứng minh chặn trước khi phát byte.
    const corruptSeed = Buffer.from("Original immutable content for tamper test");
    const corruptStored = await storage.put("materials/corrupt.txt", corruptSeed);
    const corruptStat = await storage.stat(corruptStored.objectKey);
    await writeFile(corruptStat.localPath!, Buffer.from("TAMPERED immutable content for tamper test"));

    @Controller("e01-test")
    class TestDownloadController {
      /** Phục vụ luồng tải tệp chuẩn với Range và checksum cho bài kiểm thử HTTP thật. */
      @Get("file")
      async getFile(
        @Headers("range") rangeHeader: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
      ): Promise<StreamableFile> {
        try {
          const opened = await openVerifiedObjectStream({
            objectStorage: storage,
            objectKey: stored.objectKey,
            checksum: expectedSha,
            expectedSize: payload.length,
            rangeHeader,
          });
          return sendRangedStreamableFile(req, res, {
            stream: opened.stream,
            totalSize: opened.totalSize,
            range: opened.range,
            fileName: "video-lecture.bin",
            mimeType: "application/octet-stream",
            disposition: 'attachment; filename="video-lecture.bin"',
          });
        } catch (error) {
          rethrowWithRangeHeaders(res, error);
        }
      }

      /** Phục vụ tệp đã bị sửa trái phép trên đĩa để xác minh từ chối checksum trước khi gửi byte. */
      @Get("corrupt")
      async getCorrupt(
        @Headers("range") rangeHeader: string | undefined,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
      ): Promise<StreamableFile> {
        try {
          const opened = await openVerifiedObjectStream({
            objectStorage: storage,
            objectKey: corruptStored.objectKey,
            checksum: corruptStored.checksum,
            expectedSize: corruptSeed.length,
            rangeHeader,
          });
          return sendRangedStreamableFile(req, res, {
            stream: opened.stream,
            totalSize: opened.totalSize,
            range: opened.range,
            fileName: "corrupt.txt",
            mimeType: "text/plain",
            disposition: 'attachment; filename="corrupt.txt"',
          });
        } catch (error) {
          rethrowWithRangeHeaders(res, error);
        }
      }
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [TestDownloadController],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as { address(): { port: number } };
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}/e01-test`;

    try {
      const tempBefore = await countTempDownloadDirs();

      // 1. Tải đầy đủ 200 OK kèm Accept-Ranges: bytes.
      const fullRes = await fetch(`${baseUrl}/file`);
      expect(fullRes.status).toBe(200);
      expect(fullRes.headers.get("accept-ranges")).toBe("bytes");
      expect(Number(fullRes.headers.get("content-length"))).toBe(payload.length);
      const fullBuf = Buffer.from(await fullRes.arrayBuffer());
      expect(`sha256:${createHash("sha256").update(fullBuf).digest("hex")}`).toBe(expectedSha);

      // 2. Range hợp lệ 206 Partial Content (đầu, giữa, mở cuối, suffix).
      const partialRes = await fetch(`${baseUrl}/file`, {
        headers: { Range: "bytes=1024-4095" },
      });
      expect(partialRes.status).toBe(206);
      expect(partialRes.headers.get("accept-ranges")).toBe("bytes");
      expect(partialRes.headers.get("content-range")).toBe(
        `bytes 1024-4095/${payload.length}`,
      );
      expect(Number(partialRes.headers.get("content-length"))).toBe(3072);
      const partialBuf = Buffer.from(await partialRes.arrayBuffer());
      expect(partialBuf.equals(payload.subarray(1024, 4096))).toBe(true);

      const suffixRes = await fetch(`${baseUrl}/file`, {
        headers: { Range: "bytes=-512" },
      });
      expect(suffixRes.status).toBe(206);
      expect(suffixRes.headers.get("content-range")).toBe(
        `bytes ${payload.length - 512}-${payload.length - 1}/${payload.length}`,
      );
      const suffixBuf = Buffer.from(await suffixRes.arrayBuffer());
      expect(suffixBuf.equals(payload.subarray(payload.length - 512))).toBe(true);

      // 3. Range sai / vượt biên -> 416 Range Not Satisfiable + Content-Range: bytes */size.
      const invalidRes = await fetch(`${baseUrl}/file`, {
        headers: { Range: `bytes=${payload.length + 100}-` },
      });
      expect(invalidRes.status).toBe(416);
      expect(invalidRes.headers.get("content-range")).toBe(`bytes */${payload.length}`);
      await invalidRes.arrayBuffer();

      const reversedRes = await fetch(`${baseUrl}/file`, {
        headers: { Range: "bytes=5000-100" },
      });
      expect(reversedRes.status).toBe(416);
      expect(reversedRes.headers.get("content-range")).toBe(`bytes */${payload.length}`);
      await reversedRes.arrayBuffer();

      // 4. Tệp bị sửa checksum trên đĩa bị từ chối kể cả khi client gửi Range.
      const corruptRes = await fetch(`${baseUrl}/corrupt`, {
        headers: { Range: "bytes=0-10" },
      });
      expect(corruptRes.status).toBe(400);
      await corruptRes.arrayBuffer();

      // 5. Client ngắt kết nối giữa chừng -> luồng phía server hủy ngay và slot tải về 0.
      const abortController = new AbortController();
      const abortedRes = await fetch(`${baseUrl}/file`, { signal: abortController.signal });
      expect(abortedRes.status).toBe(200);
      const reader = abortedRes.body!.getReader();
      await reader.read();
      abortController.abort();
      await reader.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getActiveDownloadCount()).toBe(0);

      // 6. 50 lượt tải đồng thời tệp 8 MB (tổng truyền 400 MB) -> 0 temp files, không tăng heap tuyến tính 400 MB.
      const heapBefore = process.memoryUsage().heapUsed;
      const results = await Promise.all(
        Array.from({ length: 50 }, async () => {
          const response = await fetch(`${baseUrl}/file`);
          expect(response.status).toBe(200);
          const hash = createHash("sha256");
          let bytes = 0;
          const bodyReader = response.body!.getReader();
          while (true) {
            const { done, value } = await bodyReader.read();
            if (done) break;
            bytes += value.byteLength;
            hash.update(value);
          }
          return { bytes, checksum: `sha256:${hash.digest("hex")}` };
        }),
      );
      const heapAfter = process.memoryUsage().heapUsed;
      const tempAfter = await countTempDownloadDirs();

      expect(results).toHaveLength(50);
      expect(results.every((r) => r.bytes === payload.length && r.checksum === expectedSha)).toBe(true);
      expect(tempAfter - tempBefore).toBe(0);
      expect(getActiveDownloadCount()).toBe(0);
      // Nếu buffer toàn tệp như cũ (50 × 8 MB = 400 MB), heap tăng vọt; streaming giữ chênh lệch thấp.
      expect(heapAfter - heapBefore).toBeLessThan(150 * 1024 * 1024);
    } finally {
      await app.close();
    }
  });
});
