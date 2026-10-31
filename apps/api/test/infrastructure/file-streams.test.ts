import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { hashFile, readFileHead, streamToFile, withTemporaryFile } from "../../src/infrastructure/file-streams.js";

describe("bounded file streams", () => {
  it("streams bytes with a checksum and cleans up after success", async () => {
    let temporary = "";
    await withTemporaryFile(async (path) => {
      temporary = path;
      const result = await streamToFile(Readable.from([Buffer.from("abc"), Buffer.from("def")]), path, 6);
      expect(result).toEqual({ size: 6, checksum: `sha256:${createHash("sha256").update("abcdef").digest("hex")}` });
      expect(await hashFile(path)).toBe(result.checksum);
      expect((await readFileHead(path, 3)).toString()).toBe("abc");
      await expect(streamToFile(Readable.from(["overwrite"]), path)).rejects.toThrow();
      expect((await readFile(path)).toString()).toBe("abcdef");
    });
    expect(existsSync(temporary)).toBe(false);
  });

  it("rejects oversized streams and removes the incomplete target", async () => {
    await withTemporaryFile(async (path) => {
      await expect(streamToFile(Readable.from([Buffer.alloc(1024)]), path, 5)).rejects.toThrow("byte limit");
      expect(existsSync(path)).toBe(false);
    });
  });
});
