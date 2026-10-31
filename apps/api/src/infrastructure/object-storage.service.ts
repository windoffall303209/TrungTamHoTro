import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary, type UploadApiErrorResponse, type UploadApiResponse } from "cloudinary";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { hashFile, streamToFile } from "./file-streams.js";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Environment } from "../config/environment.js";

export interface StoredObject {
  objectKey: string;
  checksum: string;
}

@Injectable()
/** Trừu tượng hóa kho tệp local và Cloudinary sau cùng một object-key contract. */
export class ObjectStorageService {
  private readonly provider: "local" | "cloudinary";
  private readonly storageRoot: string;
  private readonly cloudinaryFolder: string;
  private readonly cloudinaryConfigured: boolean;

  /** Đọc cấu hình provider và khởi tạo Cloudinary SDK nếu bộ credential đầy đủ. */
  constructor(config: ConfigService<Environment, true>) {
    this.provider = config.get("STORAGE_PROVIDER", { infer: true });
    this.storageRoot = resolve(config.get("STORAGE_ROOT", { infer: true }));
    this.cloudinaryFolder = config.get("CLOUDINARY_FOLDER", { infer: true }).replace(/^\/+|\/+$/g, "");
    const cloudName = config.get("CLOUDINARY_CLOUD_NAME", { infer: true });
    const apiKey = config.get("CLOUDINARY_API_KEY", { infer: true });
    const apiSecret = config.get("CLOUDINARY_API_SECRET", { infer: true });
    this.cloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);
    if (this.cloudinaryConfigured) cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
  }

  /** Trả provider đang được chọn để trang vận hành hiển thị đúng backend lưu trữ. */
  activeProvider(): "local" | "cloudinary" {
    return this.provider;
  }

  /** Xác nhận provider hiện tại có đủ cấu hình để nhận thao tác lưu trữ. */
  isConfigured(): boolean {
    return this.provider === "local" || this.cloudinaryConfigured;
  }

  /**
   * Ghi buffer theo object key bất biến và trả checksum SHA-256.
   * Local dùng cờ `wx` để không ghi đè; Cloudinary dùng authenticated raw resource.
   */
  async put(objectKey: string, buffer: Buffer): Promise<StoredObject> {
    this.assertObjectKey(objectKey);
    if (this.provider === "local") {
      const target = this.resolveLocalPath(objectKey);
      await mkdir(dirname(target), { recursive: true });
      const result = await streamToFile(Readable.from([buffer]), target, Number.MAX_SAFE_INTEGER, 0o666).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ConflictException("Khóa lưu trữ đã tồn tại.");
        throw new ServiceUnavailableException("Không thể ghi tệp vào kho local.");
      });
      return { objectKey, checksum: result.checksum };
    }

    this.assertCloudinaryConfigured();
    const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    const publicId = `${this.cloudinaryFolder}/${objectKey}`;
    const result = await this.uploadCloudinary(publicId, buffer);
    return { objectKey: `cloudinary:${encodeURIComponent(result.public_id)}`, checksum };
  }

  /** Tải tệp lên bằng luồng local hoặc Cloudinary có bộ nhớ giới hạn và tính mã kiểm tra tăng dần. */
  async putFile(objectKey: string, path: string): Promise<StoredObject> {
    this.assertObjectKey(objectKey);
    if (this.provider === "local") {
      const target = this.resolveLocalPath(objectKey);
      await mkdir(dirname(target), { recursive: true });
      const result = await streamToFile(createReadStream(path), target).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
          throw new ConflictException("Khóa lưu trữ đã tồn tại.");
        }
        throw error;
      });
      return { objectKey, checksum: result.checksum };
    }
    this.assertCloudinaryConfigured();
    const checksum = await hashFile(path);
    const publicId = `${this.cloudinaryFolder}/${objectKey}`;
    let resolveUpload!: (result: UploadApiResponse) => void;
    let rejectUpload!: (error: Error) => void;
    const completed = new Promise<UploadApiResponse>((resolveResult, rejectResult) => { resolveUpload = resolveResult; rejectUpload = rejectResult; });
    const stream = cloudinary.uploader.upload_chunked_stream({ public_id: publicId, resource_type: "raw", type: "authenticated", overwrite: false, unique_filename: false, chunk_size: 6 * 1024 * 1024, timeout: 120_000 }, (error, response) => {
      if (error) rejectUpload(new ServiceUnavailableException("Cloudinary từ chối tệp tải lên."));
      else if (response && response.done !== false) resolveUpload(response);
    });
    const source = createReadStream(path);
    const transfer = pipeline(source, stream);
    let result: UploadApiResponse;
    try { [result] = await Promise.all([completed, transfer]); }
    catch (error) {
      source.destroy();
      stream.destroy();
      await transfer.catch(() => undefined);
      throw error;
    }
    return { objectKey: `cloudinary:${encodeURIComponent(result.public_id)}`, checksum };
  }

  /** Tải trực tiếp vào tệp riêng; kiểm tra mã toàn vẹn và giới hạn kích thước tùy chọn trong khi truyền. */
  async getToFile(objectKey: string, target: string, maxBytes: number): Promise<{ checksum: string; size: number }> {
    return streamToFile(await this.openReadStream(objectKey), target, maxBytes);
  }

  /** Đọc object từ local hoặc URL Cloudinary đã ký, có fallback private download cho raw file. */
  async get(objectKey: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.openReadStream(objectKey)) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }

  /** Mở nội dung đã xác thực dưới dạng luồng; bên gọi chịu trách nhiệm đọc và hủy luồng. */
  async openReadStream(objectKey: string): Promise<Readable> {
    if (!objectKey.startsWith("cloudinary:")) {
      const file = await open(this.resolveLocalPath(objectKey), "r").catch(() => { throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ."); });
      return file.createReadStream();
    }

    this.assertCloudinaryConfigured();
    const publicId = this.cloudinaryPublicId(objectKey);
    const url = cloudinary.url(publicId, { resource_type: "raw", type: "authenticated", sign_url: true, secure: true });
    let response = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => { throw new ServiceUnavailableException("Không thể kết nối Cloudinary để tải tệp."); });
    if (response.status === 401 || response.status === 403) {
      // Một số tài khoản Cloudinary chặn URL delivery cho PDF/raw nhưng vẫn cho phép
      // endpoint tải riêng tư đã ký. Dùng endpoint này để không biến upload thành tệp chết.
      const privateUrl = cloudinary.utils.private_download_url(publicId, "", {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
      });
      await response.body?.cancel();
      response = await fetch(privateUrl, { signal: AbortSignal.timeout(120_000) }).catch(() => { throw new ServiceUnavailableException("Không thể kết nối Cloudinary để tải tệp."); });
    }
    if (!response.ok) {
      // Giải phóng response lỗi để kết nối HTTP không bị giữ đến khi hết timeout.
      await response.body?.cancel();
      if (response.status === 404) throw new NotFoundException("Tệp không còn tồn tại trên Cloudinary.");
      throw new ServiceUnavailableException(`Cloudinary trả về lỗi tải tệp (${response.status}).`);
    }
    if (!response.body) throw new ServiceUnavailableException("Cloudinary trả về tệp rỗng.");
    return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  }

  /** Xóa object; thao tác được coi là thành công nếu object vốn đã không còn tồn tại. */
  async remove(objectKey: string): Promise<void> {
    if (!objectKey.startsWith("cloudinary:")) {
      await unlink(this.resolveLocalPath(objectKey)).catch((error: unknown) => {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      });
      return;
    }

    this.assertCloudinaryConfigured();
    const result = await cloudinary.uploader.destroy(this.cloudinaryPublicId(objectKey), { resource_type: "raw", type: "authenticated", invalidate: true }) as unknown as { result: string };
    if (result.result !== "ok" && result.result !== "not found") throw new ServiceUnavailableException("Cloudinary không thể xóa tệp.");
  }

  /** Chọn upload stream thường hoặc chunked stream theo kích thước buffer. */
  private uploadCloudinary(publicId: string, buffer: Buffer): Promise<UploadApiResponse> {
    return new Promise((resolveUpload, rejectUpload) => {
      /** Chuyển kết quả tải lên Cloudinary thành Promise thành công hoặc lỗi dịch vụ. */
      const callback = (error?: UploadApiErrorResponse, result?: UploadApiResponse): void => {
        if (error || !result) {
          rejectUpload(new ServiceUnavailableException(`Cloudinary từ chối tệp tải lên${error?.http_code ? ` (${error.http_code})` : ""}.`));
          return;
        }
        resolveUpload(result);
      };
      const options = { public_id: publicId, resource_type: "raw" as const, type: "authenticated" as const, overwrite: false, unique_filename: false };
      const stream = buffer.length > 100 * 1024 * 1024
        ? cloudinary.uploader.upload_chunked_stream({ ...options, chunk_size: 20 * 1024 * 1024 }, callback)
        : cloudinary.uploader.upload_stream(options, callback);
      stream.end(buffer);
    });
  }

  /** Dừng sớm thao tác cloud nếu thiếu một phần credential Cloudinary. */
  private assertCloudinaryConfigured(): void {
    if (!this.cloudinaryConfigured) {
      throw new ServiceUnavailableException("Cloudinary chưa được cấu hình. Cần CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY và CLOUDINARY_API_SECRET.");
    }
  }

  /** Giải mã public ID từ object key nội bộ có tiền tố `cloudinary:`. */
  private cloudinaryPublicId(objectKey: string): string {
    const encoded = objectKey.slice("cloudinary:".length);
    if (!encoded) throw new BadRequestException("Khóa Cloudinary không hợp lệ.");
    try { return decodeURIComponent(encoded); } catch { throw new BadRequestException("Khóa Cloudinary không hợp lệ."); }
  }

  /** Chặn absolute path, backslash và path traversal trong object key. */
  private assertObjectKey(objectKey: string): void {
    if (!objectKey || objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.split("/").includes("..")) {
      throw new BadRequestException("Khóa lưu trữ không hợp lệ.");
    }
  }

  /** Resolve đường dẫn local và kiểm tra kết quả vẫn nằm dưới storage root. */
  private resolveLocalPath(objectKey: string): string {
    this.assertObjectKey(objectKey);
    const target = resolve(this.storageRoot, objectKey);
    if (target !== this.storageRoot && !target.startsWith(`${this.storageRoot}${sep}`)) throw new BadRequestException("Đường dẫn lưu trữ không hợp lệ.");
    return target;
  }
}
