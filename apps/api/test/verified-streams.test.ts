import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withTemporaryFile } from "../src/infrastructure/file-streams.js";
import { prepareVerifiedDownload } from "../src/infrastructure/verified-download.js";
import { verifyRetentionStream, writeRetentionArchive } from "../src/infrastructure/retention-archive.js";

describe("Luồng dữ liệu được kiểm chứng", () => {
  it("chỉ trả nội dung sau khi checksum đúng", async () => {
    const content = Buffer.from("Nội dung học liệu");
    const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const result = await prepareVerifiedDownload(() => Promise.resolve(Readable.from([content])), checksum);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(content);
    expect(result.size).toBe(content.length);
    await expect(prepareVerifiedDownload(() => Promise.resolve(Readable.from([content])), "sha256:wrong")).rejects.toThrow("Checksum");
  });
  it("ghi và kiểm chứng archive chia khối, giữ số nguyên lớn", async () => {
    await withTemporaryFile(async (path) => {
      const result = await writeRetentionArchive(path, "AUDIT", new Date(0), [{ id: 9007199254740993n }], ["asset"], () => Promise.resolve(Readable.from([Buffer.alloc(180000, 65)])));
      expect(await verifyRetentionStream(createReadStream(path))).toMatchObject({ checksum: result.checksum, recordCount: 1, assetCount: 1 });
      const content = await readFile(path, "utf8");
      expect(content).toContain('"id":"9007199254740993"');
      await expect(verifyRetentionStream(Readable.from([Buffer.from(content.replace('"sizeBytes":180000', '"sizeBytes":1'))]))).rejects.toThrow("Checksum");
      await expect(verifyRetentionStream(Readable.from([Buffer.from(content.slice(0, -12))]))).rejects.toThrow();
    });
  });
});
