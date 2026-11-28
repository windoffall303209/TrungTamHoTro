import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateMaterialDto } from "../../src/domains/learning/core/learning.dto.js";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe("Quota lưu trữ không tin sizeBytes do client gửi", () => {
  it("route JSON chỉ nhận bài giảng dạng liên kết", async () => {
    const base = { name: "Tài liệu", sizeBytes: 50_000_000, folder: "Bài giảng", tags: ["LECTURE"] };
    expect(await validate(plainToInstance(CreateMaterialDto, { ...base, mimeType: "application/pdf" }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(CreateMaterialDto, { ...base, mimeType: "text/uri-list" }))).toHaveLength(0);
  });

  it("metadata không kèm tệp không chiếm dung lượng dù client khai 50 MB", async () => {
    const service = new LearningService();
    const material = await service.createMaterial("class-web-01", { name: "Giáo trình.pdf", mimeType: "application/pdf", sizeBytes: 50_000_000, folder: "Bài giảng", tags: ["LECTURE"], scope: "CLASS" }, undefined, "usr-instructor", "INSTRUCTOR");
    expect(material.sizeBytes).toBe(0);
  });
});
