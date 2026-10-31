import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import { storeUpload, writeStoredFile } from "../../src/domains/learning/operations/storage/learning-storage.js";

describe("Learning storage fallback", () => {
  it("keeps upload bytes and SHA-256 intact, rejects collisions and invalid sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-learning-upload-"));
    try {
      const context = {
        objectStorage: undefined,
        resolveObjectPath: (objectKey: string) => join(root, objectKey),
      } as unknown as LearningServiceContext;
      const buffer = Buffer.from("original learning material");
      const upload = { originalName: "notes.txt", mimeType: "text/plain", size: buffer.length, buffer };
      const stored = await storeUpload(context, "class-1", "material-1", upload);
      expect(stored).toEqual({
        objectKey: "files/class-1/material-1.txt",
        checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
      });
      await expect(storeUpload(context, "class-1", "material-1", upload)).rejects.toMatchObject({ status: 409 });
      expect(await readFile(join(root, stored.objectKey))).toEqual(buffer);
      await expect(storeUpload(context, "class-1", "material-2", { ...upload, size: buffer.length + 1 })).rejects.toMatchObject({ status: 400 });

      const empty = await storeUpload(context, "class-1", "empty", { originalName: "empty.bin", mimeType: "application/octet-stream", size: 0, buffer: Buffer.alloc(0) });
      expect(empty.checksum).toBe(`sha256:${createHash("sha256").digest("hex")}`);
      expect(await readFile(join(root, empty.objectKey))).toEqual(Buffer.alloc(0));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("preserves existing evidence files when the object key is reused", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-learning-evidence-"));
    try {
      const context = {
        objectStorage: undefined,
        resolveObjectPath: (objectKey: string) => join(root, objectKey),
      } as unknown as LearningServiceContext;
      const buffer = Buffer.from("original evidence");
      const objectKey = "evidence/report-1.bin";
      const stored = await writeStoredFile(context, objectKey, buffer);
      expect(stored).toEqual({
        objectKey,
        checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
      });
      await expect(writeStoredFile(context, objectKey, Buffer.from("replacement"))).rejects.toMatchObject({ status: 409 });
      expect(await readFile(join(root, objectKey))).toEqual(buffer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
