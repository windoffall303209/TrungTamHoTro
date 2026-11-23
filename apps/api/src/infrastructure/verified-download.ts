import { BadRequestException, HttpException, Logger } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { streamToFile } from "./file-streams.js";

let activeDownloads = 0;
const logger = new Logger("VerifiedDownload");
/** Số lượt tải đồng thời mỗi tiến trình; mặc định 32 thay vì 4 để vài kết nối chậm không khóa cả trường. */
const MAX_CONCURRENT_DOWNLOADS = Math.max(1, Number(process.env.DOWNLOAD_CONCURRENCY) || 32);

/** Kiểm tra checksum trên tệp tạm trước khi phát byte, giới hạn đĩa và số download đồng thời. */
export async function prepareVerifiedDownload(openSource: () => Promise<Readable>, checksum?: string): Promise<{ stream: ReturnType<typeof createReadStream>; size: number }> {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) throw new HttpException("Có quá nhiều lượt tải tệp. Hãy thử lại sau.", 429);
  activeDownloads++;
  let directory: string | undefined;
  let released = false;
  // Chỉ giải phóng một lần, sau khi luồng đọc đã đóng file handle.
  const cleanup = async (): Promise<void> => {
    if (released) return;
    released = true;
    activeDownloads--;
    if (directory) await rm(directory, { recursive: true, force: true });
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "wind-download-"));
    const path = join(directory, "payload");
    const result = await streamToFile(await openSource(), path, 500 * 1024 * 1024);
    if (checksum && result.checksum !== checksum) throw new BadRequestException("Checksum học liệu không hợp lệ.");
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
