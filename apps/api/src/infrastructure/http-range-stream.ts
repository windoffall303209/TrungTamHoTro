import { HttpException, HttpStatus, StreamableFile } from "@nestjs/common";
import type { Request, Response } from "express";
import { Readable, Transform } from "node:stream";

export interface ByteRange {
  start: number;
  end: number;
  length: number;
}

export type ParsedByteRange =
  | { kind: "full" }
  | { kind: "partial"; range: ByteRange }
  | { kind: "unsatisfiable"; totalSize: number };

export interface StreamDownloadPayload {
  stream: Readable;
  totalSize: number;
  range?: ByteRange;
  fileName: string;
  mimeType: string;
  disposition: string;
}

/** Ngoại lệ HTTP 416 mang kèm tổng kích thước tệp để gắn header Content-Range: bytes * /total. */
export class RangeNotSatisfiableException extends HttpException {
  constructor(public readonly totalSize: number) {
    super(
      "Phạm vi byte yêu cầu không hợp lệ.",
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
  }
}

/** Phân tích header HTTP Range theo RFC 9110 cho đơn vị bytes (hỗ trợ start-end, start- và -suffix). */
export function parseByteRange(
  rangeHeader: string | undefined,
  totalSize: number,
): ParsedByteRange {
  if (!rangeHeader || !rangeHeader.trim()) return { kind: "full" };
  const trimmed = rangeHeader.trim();
  if (!/^bytes=/i.test(trimmed)) return { kind: "full" };
  const spec = trimmed.slice(6).trim();
  if (!spec) return { kind: "unsatisfiable", totalSize };
  // Multi-range không phổ biến ở trình duyệt/trình phát media: trả đủ 200 OK hợp chuẩn RFC 9110 thay vì multipart.
  if (spec.includes(",")) return { kind: "full" };
  if (totalSize <= 0) return { kind: "unsatisfiable", totalSize };

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return { kind: "unsatisfiable", totalSize };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { kind: "unsatisfiable", totalSize };

  let start: number;
  let end: number;
  if (!rawStart) {
    // Suffix range: bytes=-N lấy N byte cuối cùng.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) {
      return { kind: "unsatisfiable", totalSize };
    }
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
      return { kind: "unsatisfiable", totalSize };
    }
    if (!rawEnd) {
      end = totalSize - 1;
    } else {
      end = Number(rawEnd);
      if (!Number.isSafeInteger(end) || end < start) {
        return { kind: "unsatisfiable", totalSize };
      }
      end = Math.min(end, totalSize - 1);
    }
  }
  return {
    kind: "partial",
    range: { start, end, length: end - start + 1 },
  };
}

/** Cắt một luồng bất kỳ về đúng khoảng [start, end] rồi hủy nguồn sớm ngay khi đủ byte. */
export function sliceStreamToRange(
  source: Readable,
  start: number,
  end: number,
): Readable {
  let position = 0;
  const slicer = new Transform({
    /** Chỉ đẩy đúng phần giao giữa chunk hiện tại với [start, end] và kết thúc ngay sau byte end. */
    transform(chunk: Buffer, _encoding, callback): void {
      const chunkStart = position;
      const chunkEnd = position + chunk.length - 1;
      position += chunk.length;

      if (chunkEnd < start) {
        callback();
        return;
      }
      if (chunkStart > end) {
        source.destroy();
        this.push(null);
        callback();
        return;
      }
      const sliceFrom = Math.max(0, start - chunkStart);
      const sliceTo = Math.min(chunk.length, end - chunkStart + 1);
      this.push(chunk.subarray(sliceFrom, sliceTo));
      if (chunkEnd >= end) {
        source.destroy();
        this.push(null);
      }
      callback();
    },
  });
  source.on("error", (error) => slicer.destroy(error));
  slicer.once("close", () => {
    if (!source.destroyed) source.destroy();
  });
  return source.pipe(slicer);
}

/** Gắn header Accept-Ranges/Content-Range, xử lý 206/416 và hủy ngay luồng đọc khi client ngắt kết nối. */
export function sendRangedStreamableFile(
  req: Request,
  res: Response,
  payload: StreamDownloadPayload,
): StreamableFile {
  res.setHeader("Accept-Ranges", "bytes");

  // Đóng file descriptor / socket nguồn lập tức nếu client hủy request giữa chừng.
  const destroyOnAbort = (): void => {
    if (!res.writableEnded && !payload.stream.destroyed) {
      payload.stream.destroy();
    }
  };
  res.once("close", destroyOnAbort);
  req.once("aborted", destroyOnAbort);
  payload.stream.once("close", () => {
    res.off("close", destroyOnAbort);
    req.off("aborted", destroyOnAbort);
  });

  if (payload.range) {
    res.status(HttpStatus.PARTIAL_CONTENT);
    res.setHeader(
      "Content-Range",
      `bytes ${payload.range.start}-${payload.range.end}/${payload.totalSize}`,
    );
    return new StreamableFile(payload.stream, {
      type: payload.mimeType,
      disposition: payload.disposition,
      length: payload.range.length,
    });
  }

  return new StreamableFile(payload.stream, {
    type: payload.mimeType,
    disposition: payload.disposition,
    ...(payload.totalSize >= 0 ? { length: payload.totalSize } : {}),
  });
}

/** Bắt RangeNotSatisfiableException để gắn header Content-Range chuẩn RFC 9110 trước khi ném 416. */
export function rethrowWithRangeHeaders(res: Response, error: unknown): never {
  if (error instanceof RangeNotSatisfiableException) {
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Range", `bytes */${error.totalSize}`);
  }
  throw error;
}
