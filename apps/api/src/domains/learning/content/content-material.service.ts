import { Injectable, Optional } from "@nestjs/common";
import type { Readable } from "node:stream";
import { DEFAULT_MATERIAL_MIME_TYPES } from "../../../infrastructure/file-transfer.js";
import type { ByteRange } from "../../../infrastructure/http-range-stream.js";
import type { AttachmentDocumentPreview } from "../academic/academic.shared.js";
import { LearningRuntimeService } from "../core/learning-runtime.service.js";
import type {
  MaterialAccessAction,
  MaterialDownload,
  MaterialSearchResult,
  MaterialSummaryBucket,
  UploadedMaterialFile,
} from "../core/learning.shared.js";
import type { LearningMaterial } from "../core/learning.types.js";
import * as folderOps from "../operations/materials/class-folders.js";
import * as material_downloads_ops from "../operations/materials/learning-material-downloads.js";
import * as materials_ops from "../operations/materials/learning-materials.js";

@Injectable()
/** Service miền học liệu, thư mục lớp học, chính sách tải lên, xem trước và phát luồng tải tệp. */
export class ContentMaterialService {
  private readonly runtime: LearningRuntimeService;

  constructor(@Optional() runtime?: LearningRuntimeService) {
    this.runtime = runtime ?? new LearningRuntimeService();
  }

  /** Đọc hoặc tạo thư mục một cấp trong lớp được phân công. */
  async classFolders(
    classId: string,
    actorId: string,
    input: { kind: string; name: string } | undefined,
    actorRole: string,
  ): Promise<{ materials: string[]; lectures: string[]; assignments: string[] }> {
    return folderOps.classFolders(this.runtime.context, classId, actorId, input, actorRole);
  }

  /** Liệt kê danh sách học liệu hiển thị theo phạm vi quyền của vai trò hiện tại. */
  async listMaterials(
    role: string,
    query: string | undefined,
    actorId: string,
    page = 1,
    materialId?: string,
  ): Promise<LearningMaterial[]> {
    return await materials_ops.listMaterials(
      this.runtime.context,
      role,
      query,
      actorId,
      page,
      materialId,
    );
  }

  /** Cung cấp giới hạn dung lượng và định dạng MIME hiện hành cho trình chọn học liệu. */
  async getMaterialUploadPolicy(): Promise<{
    maxFileSizeMb: number;
    allowedMimeTypes: string[];
  }> {
    const prisma = this.runtime.context.prisma;
    const policy = prisma
      ? await this.runtime.context.getStoragePolicy(prisma)
      : { maxFileSizeMb: 50, allowedMimeTypes: [...DEFAULT_MATERIAL_MIME_TYPES] };
    return {
      maxFileSizeMb: policy.maxFileSizeMb,
      allowedMimeTypes: policy.allowedMimeTypes,
    };
  }

  /** Tổng hợp nhanh số lượng học liệu theo lớp, thư mục và loại nội dung. */
  async getMaterialSummary(
    actorId: string,
    role: string,
    classId?: string,
  ): Promise<MaterialSummaryBucket[]> {
    return await materials_ops.getMaterialSummary(this.runtime.context, actorId, role, classId);
  }

  /** Tìm học liệu được truy cập bằng bộ lọc và phân trang có giới hạn. */
  async searchAccessibleMaterials(
    input: {
      query?: string;
      materialId?: string;
      classId?: string;
      courseId?: string;
      scope?: string;
      visibility?: string;
      aiOnly?: boolean;
      folder?: string;
      folderExact?: boolean;
      kind?: "materials" | "lectures";
      mimeType?: string;
      tag?: string;
      page?: number;
      pageSize?: number;
    },
    learnerId: string,
    role: string,
  ): Promise<MaterialSearchResult> {
    return await materials_ops.searchAccessibleMaterials(
      this.runtime.context,
      input,
      learnerId,
      role,
    );
  }

  /** Kiểm tra quyền lớp/chính sách tệp, quét virus, lưu object và tạo version đầu tiên. */
  async createMaterial(
    classId: string | null,
    input: Pick<LearningMaterial, "name" | "mimeType" | "sizeBytes" | "folder" | "tags"> & {
      scope?: LearningMaterial["scope"];
      courseId?: string;
      visibility?: "PUBLISHED" | "HIDDEN";
    },
    upload: UploadedMaterialFile | undefined,
    actorId: string,
    actorRole: string,
  ): Promise<LearningMaterial> {
    return await materials_ops.createMaterial(
      this.runtime.context,
      classId,
      input,
      upload,
      actorId,
      actorRole,
    );
  }

  /** Phát URL truy cập học liệu ký HMAC có thời hạn sau khi kiểm tra quyền. */
  async createMaterialAccess(
    materialId: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return await material_downloads_ops.createMaterialAccess(
      this.runtime.context,
      materialId,
      role,
      action,
      actorId,
    );
  }

  /** Giữ API đọc bộ đệm cho tác vụ nội bộ AI và kiểm thử với xác minh checksum. */
  async readMaterialDownload(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
  ): Promise<MaterialDownload> {
    return await material_downloads_ops.readMaterialDownload(
      this.runtime.context,
      materialId,
      expires,
      signature,
      role,
      action,
      actorId,
    );
  }

  /** Chuẩn bị luồng tải học liệu trực tiếp có kiểm chứng checksum và hỗ trợ HTTP Range. */
  async readMaterialDownloadStream(
    materialId: string,
    expires: number,
    signature: string,
    role: string,
    action: MaterialAccessAction = "DOWNLOAD",
    actorId: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    size: number;
    totalSize: number;
    range?: ByteRange;
    fileName: string;
    mimeType: string;
  }> {
    return await material_downloads_ops.readMaterialDownloadStream(
      this.runtime.context,
      materialId,
      expires,
      signature,
      role,
      action,
      actorId,
      rangeHeader,
    );
  }

  /** Xác thực quyền và trích xuất nội dung xem trước (DOCX/DOC/TXT) cho học liệu. */
  async readMaterialPreviewContent(
    materialId: string,
    role: string,
    actorId: string,
  ): Promise<AttachmentDocumentPreview> {
    return await material_downloads_ops.readMaterialPreviewContent(
      this.runtime.context,
      materialId,
      role,
      actorId,
    );
  }

  /** Cập nhật metadata/visibility của học liệu và ghi audit thay đổi. */
  async updateMaterial(
    materialId: string,
    input: Partial<Pick<LearningMaterial, "folder" | "tags" | "visibility" | "scope">> & {
      classId?: string | null;
      name?: string;
    },
    actorId: string,
    actorRole: string,
  ): Promise<LearningMaterial> {
    return await materials_ops.updateMaterial(
      this.runtime.context,
      materialId,
      input,
      actorId,
      actorRole,
    );
  }

  /** Người tải lên xóa hẳn học liệu cùng mọi phiên bản và tệp lưu trữ. */
  async deleteMaterial(materialId: string, actorId: string, actorRole: string): Promise<void> {
    return await materials_ops.deleteMaterial(
      this.runtime.context,
      materialId,
      actorId,
      actorRole,
    );
  }

  /** Quét và thay trực tiếp tệp hiện tại của học liệu, xóa ngay tệp cũ sau khi lưu xong. */
  async replaceMaterialFile(
    materialId: string,
    input: Pick<LearningMaterial, "folder" | "tags">,
    upload: UploadedMaterialFile,
    actorId: string,
  ): Promise<LearningMaterial> {
    return await materials_ops.replaceMaterialFile(
      this.runtime.context,
      materialId,
      input,
      upload,
      actorId,
    );
  }
}
