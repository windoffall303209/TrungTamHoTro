import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withTemporaryFile } from "../../src/infrastructure/file-streams.js";
import { prepareVerifiedDownload } from "../../src/infrastructure/verified-download.js";
import { verifyRetentionStream, writeRetentionArchive } from "../../src/infrastructure/retention-archive.js";

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

  it("xử lý nhiều dòng trong cùng một chunk mà vẫn giữ checksum và thứ tự", async () => {
    const recordCount = 30000;
    const lines = [
      JSON.stringify({ kind: "manifest", format: "wind-edu-retention-archive", version: 3, category: "AUDIT" }),
      ...Array.from({ length: recordCount }, (_, id) => JSON.stringify({ kind: "record", value: { id } })),
      JSON.stringify({ kind: "end", recordCount, assetCount: 0 }),
    ];
    const content = Buffer.from(`${lines.join("\n")}\n`);
    expect(await verifyRetentionStream(Readable.from([content]))).toEqual({
      category: "AUDIT",
      recordCount,
      assetCount: 0,
      checksum: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    });
  });

  it("giữ ký tự UTF-8 khi chunk tách giữa ký tự và từ chối dòng vượt giới hạn", async () => {
    const content = Buffer.from([
      JSON.stringify({ kind: "manifest", format: "wind-edu-retention-archive", version: 3, category: "SUPPORT" }),
      JSON.stringify({ kind: "record", value: "Tiếng Việt 🌱" }),
      JSON.stringify({ kind: "end", recordCount: 1, assetCount: 0 }),
      "",
    ].join("\n"));
    const split = content.indexOf(Buffer.from("🌱")) + 1;
    expect(await verifyRetentionStream(Readable.from([content.subarray(0, split), content.subarray(split)]))).toMatchObject({
      category: "SUPPORT", recordCount: 1, assetCount: 0,
    });
    await expect(verifyRetentionStream(Readable.from([Buffer.alloc(8 * 1024 * 1024 + 1, 65), Buffer.from("\n")]))).rejects.toThrow("Dòng archive quá lớn.");
  });
});
