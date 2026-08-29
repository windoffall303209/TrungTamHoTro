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
export class ObjectStorageService {
  private readonly provider: "local" | "cloudinary";
  private readonly storageRoot: string;
  private readonly cloudinaryFolder: string;
  private readonly cloudinaryConfigured: boolean;

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

  activeProvider(): "local" | "cloudinary" {
    return this.provider;
  }

  isConfigured(): boolean {
    return this.provider === "local" || this.cloudinaryConfigured;
  }

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

  async get(objectKey: string): Promise<Buffer> {
    if (!objectKey.startsWith("cloudinary:")) {
      return readFile(this.resolveLocalPath(objectKey)).catch(() => { throw new NotFoundException("Tệp không còn tồn tại trong kho lưu trữ."); });
    }

    this.assertCloudinaryConfigured();
    const publicId = this.cloudinaryPublicId(objectKey);
    const url = cloudinary.url(publicId, { resource_type: "raw", type: "authenticated", sign_url: true, secure: true });
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => { throw new ServiceUnavailableException("Không thể kết nối Cloudinary để tải tệp."); });
    if (response.status === 404) throw new NotFoundException("Tệp không còn tồn tại trên Cloudinary.");
    if (!response.ok) throw new ServiceUnavailableException(`Cloudinary trả về lỗi tải tệp (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

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

  private assertCloudinaryConfigured(): void {
    if (!this.cloudinaryConfigured) {
      throw new ServiceUnavailableException("Cloudinary chưa được cấu hình. Cần CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY và CLOUDINARY_API_SECRET.");
    }
  }

  private cloudinaryPublicId(objectKey: string): string {
    const encoded = objectKey.slice("cloudinary:".length);
    if (!encoded) throw new BadRequestException("Khóa Cloudinary không hợp lệ.");
    try { return decodeURIComponent(encoded); } catch { throw new BadRequestException("Khóa Cloudinary không hợp lệ."); }
  }

  private assertObjectKey(objectKey: string): void {
    if (!objectKey || objectKey.startsWith("/") || objectKey.includes("\\") || objectKey.split("/").includes("..")) {
      throw new BadRequestException("Khóa lưu trữ không hợp lệ.");
    }
  }

  private resolveLocalPath(objectKey: string): string {
    this.assertObjectKey(objectKey);
    const target = resolve(this.storageRoot, objectKey);
    if (target !== this.storageRoot && !target.startsWith(`${this.storageRoot}${sep}`)) throw new BadRequestException("Đường dẫn lưu trữ không hợp lệ.");
    return target;
  }
}
