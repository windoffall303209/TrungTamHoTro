import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { streamToFile } from "./file-streams.js";

const MAX_LINE_BYTES = 8 * 1024 * 1024;

/** Mã hóa từng dòng có giới hạn; số lớn được giữ chính xác dưới dạng chuỗi. */
function encodeLine(value: unknown): string {
  const line = JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("Bản ghi lưu trữ vượt giới hạn an toàn.");
  return line + "\n";
}

/** Ghi archive v3 theo dòng, mỗi tệp đính kèm được chia khối thay vì gom Base64 vào RAM. */
export async function writeRetentionArchive(path: string, category: string, cutoffAt: Date, records: unknown[], objectKeys: string[], openAsset: (key: string) => Promise<Readable>): Promise<{ size: number; checksum: string }> {
  // Sinh từng phần với backpressure của luồng ghi tệp.
  async function* entries(): AsyncGenerator<string> {
    yield encodeLine({ kind: "manifest", format: "wind-edu-retention-archive", version: 3, category, cutoffAt: cutoffAt.toISOString() });
    for (const value of records) yield encodeLine({ kind: "record", value });
    const keys = [...new Set(objectKeys)];
    for (const objectKey of keys) {
      yield encodeLine({ kind: "asset", objectKey });
      const hash = createHash("sha256");
      let sizeBytes = 0;
      for await (const data of await openAsset(objectKey)) {
        const buffer = Buffer.from(data as Uint8Array);
        hash.update(buffer);
        sizeBytes += buffer.length;
        for (let offset = 0; offset < buffer.length; offset += 65536) yield encodeLine({ kind: "chunk", data: buffer.subarray(offset, offset + 65536).toString("base64") });
      }
      yield encodeLine({ kind: "asset-end", checksum: `sha256:${hash.digest("hex")}`, sizeBytes });
    }
    yield encodeLine({ kind: "end", recordCount: records.length, assetCount: keys.length });
  }
  return streamToFile(Readable.from(entries()), path);
}

/** Đọc từng dòng UTF-8 với giới hạn bộ đệm, từ chối archive bị cắt hoặc dòng quá lớn. */
async function* readLines(source: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  for await (const chunk of source) {
    const decoded = decoder.write(chunk as Buffer);
    let start = 0;
    let position = decoded.indexOf("\n", start);
    while (position >= 0) {
      const line = pending + decoded.slice(start, position);
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error("Dòng archive quá lớn.");
      yield line;
      pending = "";
      start = position + 1;
      position = decoded.indexOf("\n", start);
    }
    pending += decoded.slice(start);
    if (Buffer.byteLength(pending) > MAX_LINE_BYTES) throw new Error("Dòng archive quá lớn.");
  }
  pending += decoder.end();
  if (pending) throw new Error("Archive bị cắt giữa dòng.");
}

/** Kiểm chứng cấu trúc, checksum từng asset và tổng archive mà không nạp cả archive vào bộ nhớ. */
export async function verifyRetentionStream(source: Readable): Promise<{ category: string; recordCount: number; assetCount: number; checksum: string }> {
  let category = "";
  let records = 0;
  let assets = 0;
  let done = false;
  let asset: { hash: ReturnType<typeof createHash>; size: number } | undefined;
  const hash = createHash("sha256");
  // Băm chính xác byte nhận được trước khi bộ đọc dòng giải mã UTF-8.
  async function* measured(): AsyncGenerator<Buffer> {
    for await (const data of source) { hash.update(data as Buffer); yield data as Buffer; }
  }
  for await (const line of readLines(Readable.from(measured()))) {
    const item = JSON.parse(line) as Record<string, unknown>;
    if (!item || typeof item !== "object" || done) throw new Error("Cấu trúc archive không hợp lệ.");
    if (!category) {
      if (item.kind !== "manifest" || item.format !== "wind-edu-retention-archive" || item.version !== 3 || !["AUDIT", "SUPPORT", "LEARNING", "AI_RESULTS"].includes(String(item.category))) throw new Error("Định dạng archive không hợp lệ.");
      category = String(item.category);
    } else if (item.kind === "record" && !asset && "value" in item) records++;
    else if (item.kind === "asset" && !asset && typeof item.objectKey === "string") asset = { hash: createHash("sha256"), size: 0 };
    else if (item.kind === "chunk" && asset && typeof item.data === "string" && item.data.length <= 87384 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) {
      const data = Buffer.from(item.data, "base64");
      asset.hash.update(data); asset.size += data.length;
    } else if (item.kind === "asset-end" && asset) {
      if (item.sizeBytes !== asset.size || item.checksum !== `sha256:${asset.hash.digest("hex")}`) throw new Error("Checksum asset không hợp lệ.");
      asset = undefined; assets++;
    } else if (item.kind === "end" && !asset && item.recordCount === records && item.assetCount === assets) done = true;
    else throw new Error("Thứ tự hoặc nội dung archive không hợp lệ.");
  }
  if (!done || !category) throw new Error("Archive thiếu phần kết thúc.");
  return { category, recordCount: records, assetCount: assets, checksum: `sha256:${hash.digest("hex")}` };
}
