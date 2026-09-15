import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Scope private scratch files to a unique directory and always remove them after the operation. */
export async function withTemporaryFile<T>(operation: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "wind-private-"));
  try { return await operation(join(directory, "payload")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

/** Hash a file incrementally without retaining its contents. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
}

/** Read only the signature prefix needed for format validation. */
export async function readFileHead(path: string, length = 8192): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await file.close(); }
}

/** Copy with backpressure, a hard byte ceiling and exclusive creation; delete only our partial file on failure. */
export async function streamToFile(source: Readable, target: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<{ checksum: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  let created = false;
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  output.on("open", () => { created = true; });
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback): void {
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
