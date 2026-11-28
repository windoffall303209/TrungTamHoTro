import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { v2 as cloudinary, type UploadApiErrorResponse } from "cloudinary";
import { PassThrough } from "node:stream";
import { Client } from "pg";
import type { Environment } from "../../src/config/environment.js";
import { EmailDeliveryService, normalizeResendSender } from "../../src/infrastructure/email-delivery.service.js";
import { ObjectStorageService } from "../../src/infrastructure/object-storage.service.js";
import { AntivirusService } from "../../src/infrastructure/antivirus.service.js";
import { DatabaseBackupService } from "../../src/infrastructure/database-backup.service.js";
import { streamToFile, withTemporaryFile } from "../../src/infrastructure/file-streams.js";
import { Readable } from "node:stream";

/** Tạo dịch vụ cấu hình giả lập từ các giá trị riêng của ca kiểm thử. */
function config(values: Partial<Environment>): ConfigService<Environment, true> {
  return { get: (key: keyof Environment) => values[key] ?? "" } as unknown as ConfigService<Environment, true>;
}

describe("Infrastructure services", () => {
  it("closes PostgreSQL clients after failed backup connections", async () => {
    const connect = vi.spyOn(Client.prototype, "connect").mockRejectedValue(new Error("offline"));
    const end = vi.spyOn(Client.prototype, "end").mockResolvedValue(undefined);
    try {
      const backup = new DatabaseBackupService(config({ DB_NAME: "wind_test", DB_BACKUP_TIMEOUT_MS: 1_000 }));
      await withTemporaryFile(async (path) => {
        await streamToFile(Readable.from([Buffer.from("PGDMP")]), path);
        await expect(backup.verifyRestore(path)).rejects.toThrow("Không thể kết nối PostgreSQL");
      });
      expect(connect).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
    } finally {
      connect.mockRestore();
      end.mockRestore();
    }
  });

  it("chuẩn hóa sender Resend từ đúng hai biến cấu hình", () => {
    expect(normalizeResendSender("WIND OF FALL noreply@windoffall3k32k9.online")).toBe("WIND OF FALL <noreply@windoffall3k32k9.online>");
    expect(normalizeResendSender("noreply@windoffall3k32k9.online")).toBe("noreply@windoffall3k32k9.online");
    expect(() => normalizeResendSender("WIND OF FALL")).toThrow("RESEND_FROM");
  });

  it("lưu, đọc, kiểm tra checksum và xóa tệp bằng provider local", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-storage-provider-"));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "local", STORAGE_ROOT: storageRoot, CLOUDINARY_FOLDER: "wind-edu" }));
      const content = Buffer.from("noi dung kiem thu", "utf8");
      const stored = await storage.put("files/class-01/material-01.txt", content);
      expect(stored.objectKey).toBe("files/class-01/material-01.txt");
      expect(stored.checksum).toMatch(/^sha256:/);
      expect(await storage.get(stored.objectKey)).toEqual(content);
      await storage.remove(stored.objectKey);
      await expect(storage.get(stored.objectKey)).rejects.toThrow("không còn tồn tại");
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("chặn path traversal trước khi ghi tệp", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "wind-storage-path-"));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "local", STORAGE_ROOT: storageRoot, CLOUDINARY_FOLDER: "wind-edu" }));
      await expect(storage.put("../secret.txt", Buffer.from("x"))).rejects.toThrow("không hợp lệ");
    } finally {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it("streams files through local storage with exact checksums and byte ceilings", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-storage-stream-"));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "local", STORAGE_ROOT: root, CLOUDINARY_FOLDER: "wind-edu" }));
      await withTemporaryFile(async (source) => {
        await streamToFile(Readable.from([Buffer.alloc(1024 * 1024, 7)]), source);
        const stored = await storage.putFile("backup/test.dump", source);
        await withTemporaryFile(async (target) => {
          expect(await storage.getToFile(stored.objectKey, target, 1024 * 1024)).toEqual({ size: 1024 * 1024, checksum: stored.checksum });
        });
        await withTemporaryFile(async (target) => {
          await expect(storage.getToFile(stored.objectKey, target, 10)).rejects.toThrow("byte limit");
        });
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("rejects duplicate streamed objects consistently without overwriting the original", async () => {
    const root = await mkdtemp(join(tmpdir(), "wind-storage-conflict-"));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "local", STORAGE_ROOT: root, CLOUDINARY_FOLDER: "wind-edu" }));
      const original = Buffer.from("existing material");
      await storage.put("files/existing.txt", original);
      await expect(storage.put("files/existing.txt", Buffer.from("replacement"))).rejects.toMatchObject({ status: 409 });
      await withTemporaryFile(async (source) => {
        await streamToFile(Readable.from([Buffer.from("replacement")]), source);
        await expect(storage.putFile("files/existing.txt", source)).rejects.toMatchObject({ status: 409 });
      });
      expect(await storage.get("files/existing.txt")).toEqual(original);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("closes cloud upload streams before propagating provider rejection", async () => {
    const stream = new PassThrough();
    const upload = vi.spyOn(cloudinary.uploader, "upload_chunked_stream").mockImplementation((_options, callback) => {
      queueMicrotask(() => callback?.({ message: "rejected", http_code: 400, name: "test" } as UploadApiErrorResponse));
      return stream as ReturnType<typeof cloudinary.uploader.upload_chunked_stream>;
    });
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "cloudinary", CLOUDINARY_FOLDER: "test", CLOUDINARY_CLOUD_NAME: "fake", CLOUDINARY_API_KEY: "fake", CLOUDINARY_API_SECRET: "fake" }));
      await withTemporaryFile(async (source) => {
        await streamToFile(Readable.from([Buffer.alloc(1024 * 1024)]), source);
        await expect(storage.putFile("backup/test.dump", source)).rejects.toThrow("Cloudinary");
        expect(stream.destroyed).toBe(true);
      });
    } finally { upload.mockRestore(); }
  });

  it("releases Cloudinary error responses after a failed direct download", async () => {
    const cancel = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      new ReadableStream({ cancel }),
      { status: 503 },
    ));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "cloudinary", CLOUDINARY_FOLDER: "test", CLOUDINARY_CLOUD_NAME: "fake", CLOUDINARY_API_KEY: "fake", CLOUDINARY_API_SECRET: "fake" }));
      await expect(storage.get("cloudinary:test%2Fsample.pdf")).rejects.toThrow("(503)");
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally { fetchMock.mockRestore(); }
  });

  it("releases both Cloudinary responses when private download fallback returns 404", async () => {
    const directCancel = vi.fn();
    const privateCancel = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: directCancel }), { status: 403 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: privateCancel }), { status: 404 }));
    try {
      const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "cloudinary", CLOUDINARY_FOLDER: "test", CLOUDINARY_CLOUD_NAME: "fake", CLOUDINARY_API_KEY: "fake", CLOUDINARY_API_SECRET: "fake" }));
      await expect(storage.get("cloudinary:test%2Fsample.pdf")).rejects.toThrow("không còn tồn tại");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(directCancel).toHaveBeenCalledOnce();
      expect(privateCancel).toHaveBeenCalledOnce();
    } finally { fetchMock.mockRestore(); }
  });

  it("từ chối Cloudinary và Resend khi credential chưa được cấu hình", async () => {
    const storage = new ObjectStorageService(config({ STORAGE_PROVIDER: "cloudinary", STORAGE_ROOT: "unused", CLOUDINARY_FOLDER: "wind-edu" }));
    const email = new EmailDeliveryService(config({ RESEND_API_KEY: "", RESEND_FROM: "" }));
    await expect(storage.put("files/class-01/material.pdf", Buffer.from("pdf"))).rejects.toThrow("Cloudinary chưa được cấu hình");
    await expect(email.send({ to: "admin@wind.edu.vn", subject: "Test", text: "Test", idempotencyKey: "test/01" })).rejects.toThrow("Resend chưa được cấu hình");
  });

  it("gửi nội dung tới ClamAV và nhận diện chữ ký mã độc", async () => {
    const server = createServer((socket) => {
      socket.on("data", () => undefined);
      socket.on("end", () => socket.end("stream: Win.Test.EICAR_HDB-1 FOUND\0"));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Không lấy được cổng kiểm thử ClamAV.");
      const antivirus = new AntivirusService(config({ ANTIVIRUS_PROVIDER: "clamav", CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: address.port, CLAMAV_TIMEOUT_MS: 2_000 }));
      await expect(antivirus.scan(Buffer.from("sample"))).resolves.toEqual({ clean: false, engine: "clamav", signature: "Win.Test.EICAR_HDB-1" });
      await withTemporaryFile(async (path) => {
        await streamToFile(Readable.from([Buffer.alloc(1024 * 1024)]), path);
        await expect(antivirus.scanFile(path)).resolves.toEqual({ clean: false, engine: "clamav", signature: "Win.Test.EICAR_HDB-1" });
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
