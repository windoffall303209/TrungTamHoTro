import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { prepareVerifiedDownload } from "../../src/infrastructure/verified-download.js";

describe("Luồng dữ liệu được kiểm chứng", () => {
  it("chỉ trả nội dung sau khi checksum đúng", async () => {
    const content = Buffer.from("Nội dung học liệu");
    const checksum = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const result = await prepareVerifiedDownload(
      () => Promise.resolve(Readable.from([content])),
      checksum,
    );
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(content);
    expect(result.size).toBe(content.length);
    await expect(
      prepareVerifiedDownload(
        () => Promise.resolve(Readable.from([content])),
        "sha256:wrong",
      ),
    ).rejects.toThrow("Checksum");
  });
});
