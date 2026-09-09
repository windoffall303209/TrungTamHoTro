import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary, type UploadApiErrorResponse, type UploadApiResponse } from "cloudinary";
import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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
    const checksum = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
    if (this.provider === "local") {
      const target = this.resolveLocalPath(objectKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, buffer, { flag: "wx" }).catch((error: unknown) => {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") throw new ConflictException("Khóa lưu trữ đã tồn tại.");
        throw new ServiceUnavailableException("Không thể ghi tệp vào kho local.");
      });
      return { objectKey, checksum };
    }

    this.assertCloudinaryConfigured();
    const publicId = `${this.cloudinaryFolder}/${objectKey}`;
    const result = await this.uploadCloudinary(publicId, buffer);
    return { objectKey: `cloudinary:${encodeURIComponent(result.public_id)}`, checksum };
  }

  /** Đọc object từ local hoặc URL Cloudinary đã ký, có fallback private download cho raw file. */
  async get(objectKey: string): Promise<Buffer> {
    if (!objectKey.startsWith("cloudinary:")) {
      return readFile(this.resolveLocalPath(objectKey)).catch(() => { throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ."); });
    }

    this.assertCloudinaryConfigured();
    const publicId = this.cloudinaryPublicId(objectKey);
    const url = cloudinary.url(publicId, { resource_type: "raw", type: "authenticated", sign_url: true, secure: true });
    let response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => { throw new ServiceUnavailableException("Không thể kết nối Cloudinary để tải tệp."); });
    if (response.status === 401 || response.status === 403) {
      // Một số tài khoản Cloudinary chặn URL delivery cho PDF/raw nhưng vẫn cho phép
      // endpoint tải riêng tư đã ký. Dùng endpoint này để không biến upload thành tệp chết.
      const privateUrl = cloudinary.utils.private_download_url(publicId, "", {
        resource_type: "raw",
        type: "authenticated",
        expires_at: Math.floor(Date.now() / 1000) + 60,
      });
      response = await fetch(privateUrl, { signal: AbortSignal.timeout(30_000) }).catch(() => { throw new ServiceUnavailableException("Không thể kết nối Cloudinary để tải tệp."); });
    }
    if (response.status === 404) throw new NotFoundException("Tệp không còn tồn tại trên Cloudinary.");
    if (!response.ok) throw new ServiceUnavailableException(`Cloudinary trả về lỗi tải tệp (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
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
