import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "../../../../generated/prisma/client.js";
import {
  RubricCriterion,
  UploadedAssignmentFile,
} from "../../academic/academic.shared.js";

/** Giới hạn số lượng, kích thước, MIME và magic bytes của tệp bài nộp. */
export function validateAssignmentFiles(files: UploadedAssignmentFile[]): void {
  if (files.length > 5)
    throw new BadRequestException("Mỗi lần chỉ được chọn tối đa 5 tệp.");
  const mimeByExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain",
  };
  for (const file of files) {
    if (!file.originalName || file.originalName.length > 255)
      throw new BadRequestException("Tên tệp phải có từ 1 đến 255 ký tự.");
    if (
      file.size <= 0 ||
      file.size > 20 * 1024 * 1024 ||
      file.buffer.length !== file.size
    )
      throw new BadRequestException(
        `Tệp ${file.originalName} phải có dung lượng từ 1 byte đến 20 MB.`,
      );
    const extension = file.originalName.split(".").pop()?.toLowerCase() ?? "";
    const expectedMime = mimeByExtension[extension];
    if (
      !expectedMime ||
      (file.mimeType &&
        file.mimeType !== "application/octet-stream" &&
        file.mimeType !== expectedMime)
    )
      throw new BadRequestException(
        `Tệp ${file.originalName} không đúng định dạng JPG, PNG, WebP, PDF, DOC, DOCX hoặc TXT.`,
      );
    const validSignature =
      extension === "txt"
        ? !file.buffer.includes(0) &&
          !file.buffer.toString("utf8").includes("\uFFFD")
        : extension === "jpg" || extension === "jpeg"
          ? file.buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
          : extension === "png"
            ? file.buffer
                .subarray(0, 8)
                .equals(
                  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                )
            : extension === "webp"
              ? file.buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
                file.buffer.subarray(8, 12).toString("ascii") === "WEBP"
              : extension === "pdf"
                ? file.buffer.subarray(0, 4).toString("ascii") === "%PDF"
                : extension === "doc"
                  ? file.buffer
                      .subarray(0, 8)
                      .equals(
                        Buffer.from([
                          0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
                        ]),
                      )
                  : file.buffer.subarray(0, 2).toString("ascii") === "PK";
    if (!validSignature)
      throw new BadRequestException(
        `Nội dung tệp ${file.originalName} không khớp với phần mở rộng.`,
      );
    file.mimeType = expectedMime;
  }
}

/** Thu hẹp JSON rubric đã lưu về cấu trúc tiêu chí ứng dụng sử dụng. */
export function rubric(value: Prisma.JsonValue): RubricCriterion[] {
  if (!Array.isArray(value))
    throw new BadRequestException("Rubric lưu trữ không hợp lệ.");
  const usedIds = new Set<string>();
  return value.map((item, index) => {
    const row = item as Record<string, unknown>;
    const storedId = typeof row.id === "string" ? row.id.trim() : "";
    let id =
      storedId && !usedIds.has(storedId)
        ? storedId
        : `criterion-legacy-${index}`;
    while (usedIds.has(id)) id = `${id}-${index}`;
    usedIds.add(id);
    return {
      id,
      title: String(row.title),
      description: String(row.description),
      maxPoints: Number(row.maxPoints),
    };
  });
}

/** Thu hẹp JSON điểm rubric, trả mảng rỗng khi dữ liệu không phải danh sách. */
export function rubricScores(
  value: Prisma.JsonValue | null,
): Array<{ criterionId: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return { criterionId: String(row.criterionId), score: Number(row.score) };
  });
}
