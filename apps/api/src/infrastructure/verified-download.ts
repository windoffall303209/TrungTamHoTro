import { BadRequestException, HttpException, Logger, NotFoundException } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { hashFile, streamToFile } from "./file-streams.js";
import {
  parseByteRange,
  RangeNotSatisfiableException,
  sliceStreamToRange,
  type ByteRange,
} from "./http-range-stream.js";
import type { ObjectStorageService, StoredObjectStat } from "./object-storage.service.js";

let activeDownloads = 0;
const logger = new Logger("VerifiedDownload");
/** Số lượt tải đồng thời mỗi tiến trình; tăng lên 128 nhờ streaming trực tiếp không sao chép tệp tạm. */
const MAX_CONCURRENT_DOWNLOADS = Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY) || 128);
const CHECKSUM_CACHE_TTL_MS = 5 * 60_000;
const CHECKSUM_CACHE_MAX_ENTRIES = 512;
const CHECKSUM_CACHE_MIN_BYTES = 16 * 1024;

const verifiedChecksumCache = new Map<string, { checksum: string; expiresAt: number }>();
const inflightChecksums = new Map<string, Promise<string>>();

/** Trả số luồng tải xuống đang hoạt động để giám sát và kiểm thử dọn dẹp khi client ngắt kết nối. */
export function getActiveDownloadCount(): number {
  return activeDownloads;
}

/** Xóa bộ nhớ đệm checksum tệp cục bộ (dùng cho kiểm thử độc lập). */
export function clearVerifiedChecksumCacheForTests(): void {
  verifiedChecksumCache.clear();
  inflightChecksums.clear();
}

/** Xác minh checksum SHA-256 của tệp cục bộ theo stream (0 tệp tạm, gộp lượt băm song song cùng phiên bản tệp). */
export async function verifyLocalFileChecksum(
  localPath: string,
  expectedChecksum: string,
  size: number,
  mtimeNs?: bigint,
  mismatchError: () => Error = () => new BadRequestException("Checksum học liệu không hợp lệ."),
): Promise<string> {
  const canCache = mtimeNs !== undefined && size > CHECKSUM_CACHE_MIN_BYTES;
  const cacheKey = canCache ? `${localPath}:${size}:${mtimeNs.toString()}` : "";
  const now = Date.now();
  if (canCache) {
    const cached = verifiedChecksumCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      if (cached.checksum !== expectedChecksum) throw mismatchError();
      return cached.checksum;
    }
    const pending = inflightChecksums.get(cacheKey);
    if (pending) {
      const actual = await pending;
      if (actual !== expectedChecksum) throw mismatchError();
      return actual;
    }
  }

  const hashPromise = hashFile(localPath);
  if (canCache) inflightChecksums.set(cacheKey, hashPromise);
  let actual: string;
  try {
    actual = await hashPromise;
  } finally {
    if (canCache) inflightChecksums.delete(cacheKey);
  }
  if (canCache) {
    if (verifiedChecksumCache.size >= CHECKSUM_CACHE_MAX_ENTRIES) {
      const oldestKey = verifiedChecksumCache.keys().next().value;
      if (oldestKey) verifiedChecksumCache.delete(oldestKey);
    }
    verifiedChecksumCache.set(cacheKey, { checksum: actual, expiresAt: Date.now() + CHECKSUM_CACHE_TTL_MS });
  }
  if (actual !== expectedChecksum) throw mismatchError();
  return actual;
}

export interface DirectDownloadResult {
  stream: Readable;
  totalSize: number;
  range?: ByteRange;
}

export interface OpenVerifiedDownloadOptions {
  objectStorage?: Pick<ObjectStorageService, "openReadStream"> & Partial<Pick<ObjectStorageService, "stat">>;
  objectKey: string;
  fallbackLocalPath?: string;
  checksum?: string;
  expectedSize?: number;
  rangeHeader?: string;
  mismatchError?: () => Error;
}

/**
 * Mở luồng tải tệp trực tiếp có hỗ trợ HTTP Range (206/416), không tạo tệp tạm trên đĩa và không nạp toàn bộ vào RAM.
 * Tệp cục bộ được kiểm chứng checksum bằng streaming hash trực tiếp; kho từ xa chỉ fallback tệp tạm khi cần kiểm checksum toàn tệp.
 */
export async function openVerifiedObjectStream(
  options: OpenVerifiedDownloadOptions,
): Promise<DirectDownloadResult> {
  const {
    objectStorage,
    objectKey,
    fallbackLocalPath,
    checksum,
    expectedSize,
    rangeHeader,
    mismatchError = (): Error => new BadRequestException("Checksum học liệu không hợp lệ."),
  } = options;

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    throw new HttpException("Có quá nhiều lượt tải tệp. Hãy thử lại sau.", 429);
  }
  activeDownloads++;
  let released = false;
  // Giải phóng đúng một lần khi luồng đóng hoặc khởi tạo thất bại.
  const releaseSlot = (): void => {
    if (released) return;
    released = true;
    activeDownloads = Math.max(0, activeDownloads - 1);
  };

  try {
    let info: StoredObjectStat | null = null;
    if (objectStorage?.stat) {
      info = await objectStorage.stat(objectKey);
    } else if (!objectStorage && fallbackLocalPath) {
      const fileStat = await stat(fallbackLocalPath, { bigint: true }).catch(() => {
        throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ.");
      });
      info = { size: Number(fileStat.size), localPath: fallbackLocalPath, mtimeNs: fileStat.mtimeNs };
    }

    // Nhánh tệp cục bộ trực tiếp: 0 temp I/O, kiểm kích thước + checksum theo stream, rồi mở Range trực tiếp trên đĩa.
    if (info?.localPath) {
      if (expectedSize !== undefined && info.size !== expectedSize) {
        throw mismatchError();
      }
      const parsed = parseByteRange(rangeHeader, info.size);
      if (parsed.kind === "unsatisfiable") {
        throw new RangeNotSatisfiableException(parsed.totalSize);
      }
      if (checksum) {
        await verifyLocalFileChecksum(info.localPath, checksum, info.size, info.mtimeNs, mismatchError);
      }
      const range = parsed.kind === "partial" ? parsed.range : undefined;
      const stream = createReadStream(
        info.localPath,
        range ? { start: range.start, end: range.end } : undefined,
      );
      attachStreamLifecycle(stream, releaseSlot);
      return { stream, totalSize: info.size, range };
    }

    // Nhánh kho từ xa (Cloudinary hoặc test double chỉ có openReadStream).
    const knownSize = info && info.size >= 0 ? info.size : (expectedSize ?? -1);
    if (knownSize >= 0) {
      if (expectedSize !== undefined && info && info.size >= 0 && info.size !== expectedSize) {
        throw mismatchError();
      }
      const parsed = parseByteRange(rangeHeader, knownSize);
      if (parsed.kind === "unsatisfiable") {
        throw new RangeNotSatisfiableException(parsed.totalSize);
      }
      if (parsed.kind === "partial" && objectStorage) {
        const stream = await objectStorage.openReadStream(objectKey, {
          start: parsed.range.start,
          end: parsed.range.end,
        });
        attachStreamLifecycle(stream, releaseSlot);
        return { stream, totalSize: knownSize, range: parsed.range };
      }
    }

    // Fallback kiểm checksum trên tệp tạm cho luồng từ xa không có localPath (hoặc không rõ kích thước trước khi đọc).
    releaseSlot();
    const verified = await prepareVerifiedDownload(
      async () =>
        objectStorage
          ? objectStorage.openReadStream(objectKey)
          : createReadStream(fallbackLocalPath!),
      checksum,
      mismatchError,
    );
    if (expectedSize !== undefined && verified.size !== expectedSize) {
      verified.stream.destroy();
      throw mismatchError();
    }
    const parsed = parseByteRange(rangeHeader, verified.size);
    if (parsed.kind === "unsatisfiable") {
      verified.stream.destroy();
      throw new RangeNotSatisfiableException(parsed.totalSize);
    }
    if (parsed.kind === "partial") {
      return {
        stream: sliceStreamToRange(verified.stream, parsed.range.start, parsed.range.end),
        totalSize: verified.size,
        range: parsed.range,
      };
    }
    return { stream: verified.stream, totalSize: verified.size };
  } catch (error) {
    releaseSlot();
    throw error;
  }
}

/** Gắn giới hạn thời gian và giải phóng slot concurrency khi luồng đọc đóng hoặc lỗi. */
function attachStreamLifecycle(stream: Readable, onRelease: () => void): void {
  const timer = setTimeout(() => {
    if (!stream.destroyed) stream.destroy();
  }, 10 * 60_000);
  timer.unref();
  // Đảm bảo dọn timer và slot đúng một lần trên mọi đường thoát stream.
  const finalize = (): void => {
    clearTimeout(timer);
    onRelease();
  };
  stream.once("close", finalize);
  stream.once("error", finalize);
}

/** Kiểm tra checksum trên tệp tạm trước khi phát byte cho luồng từ xa bất kỳ, giới hạn đĩa và số download đồng thời. */
export async function prepareVerifiedDownload(
  openSource: () => Promise<Readable>,
  checksum?: string,
  mismatchError: () => Error = () => new BadRequestException("Checksum học liệu không hợp lệ."),
): Promise<{ stream: ReturnType<typeof createReadStream>; size: number }> {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) throw new HttpException("Có quá nhiều lượt tải tệp. Hãy thử lại sau.", 429);
  activeDownloads++;
  let directory: string | undefined;
  let released = false;
  // Chỉ giải phóng một lần, sau khi luồng đọc đã đóng file handle.
  const cleanup = async (): Promise<void> => {
    if (released) return;
    released = true;
    activeDownloads = Math.max(0, activeDownloads - 1);
    if (directory) await rm(directory, { recursive: true, force: true });
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "wind-download-"));
    const path = join(directory, "payload");
    const result = await streamToFile(await openSource(), path, 500 * 1024 * 1024);
    if (checksum && result.checksum !== checksum) throw mismatchError();
    const stream = createReadStream(path);
    const timer = setTimeout(() => stream.destroy(), 10 * 60_000);
    timer.unref();
    stream.once("close", () => {
      clearTimeout(timer);
      void cleanup().catch(() => logger.error("Không dọn được tệp tải xuống tạm."));
    });
    return { stream, size: result.size };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
