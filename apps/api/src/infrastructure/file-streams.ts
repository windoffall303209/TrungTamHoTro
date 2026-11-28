import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Đặt tệp tạm riêng trong thư mục duy nhất và luôn dọn dẹp sau thao tác. */
export async function withTemporaryFile<T>(operation: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "wind-private-"));
  try { return await operation(join(directory, "payload")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

/** Tính mã băm tăng dần mà không giữ toàn bộ nội dung tệp trong bộ nhớ. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

/** Chỉ đọc phần đầu cần thiết để kiểm tra định dạng tệp. */
export async function readFileHead(path: string, length = 8192): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

/** Sao chép theo tốc độ bên nhận, giới hạn số byte và chỉ tạo tệp mới; khi lỗi chỉ xóa tệp dở do thao tác này tạo. */
export async function streamToFile(source: Readable, target: string, maxBytes = Number.MAX_SAFE_INTEGER, createMode = 0o600): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  let created = false;
  const output = createWriteStream(target, { flags: "wx", mode: createMode });
  output.on("open", () => { created = true; });
  const meter = new Transform({ /** Giới hạn số byte và cập nhật mã băm trong khi chuyển tiếp từng khối dữ liệu. */
  transform(chunk: Buffer, _encoding, callback): void {
    size += chunk.length;
    if (size > maxBytes) return callback(new Error("File exceeds the permitted byte limit."));
    hash.update(chunk);
    callback(null, chunk);
  } });
  try { await pipeline(source, meter, output); }
  catch (error) {
    if (created) await rm(target, { force: true });
    throw error;
  }
  return { checksum: `sha256:${hash.digest("hex")}`, size };
}
