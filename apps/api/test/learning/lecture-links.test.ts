import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

const links = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.facebook.com/watch/?v=123456789",
  "https://fb.watch/abc123XYZ/",
  "https://drive.google.com/file/d/sample-file-id/view",
];

// Tạo metadata liên kết giống payload JSON gửi từ màn hình giảng viên.
function linkMaterial(url: string): {
  name: string;
  mimeType: string;
  sizeBytes: number;
  folder: string;
  tags: string[];
  scope: "CLASS";
} {
  return {
    name: "Bài giảng liên kết",
    mimeType: "text/uri-list",
    sizeBytes: Buffer.byteLength(url, "utf8"),
    folder: "Bài giảng",
    tags: ["LECTURE", `lecture-url:${url}`],
    scope: "CLASS" as const,
  };
}

describe("class lecture links", () => {
  it.each(links)("creates %s without a binary upload, then edits its URL", async (url) => {
    const service = new LearningService();
    const created = await service.createMaterial("class-web-01", linkMaterial(url));
    expect(created).toMatchObject({
      classId: "class-web-01",
      mimeType: "text/uri-list",
      sizeBytes: Buffer.byteLength(url, "utf8"),
      visibility: "DRAFT",
      scope: "CLASS",
    });
    expect(created.tags).toContain(`lecture-url:${url}`);

    const replacement = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
    const updated = await service.updateMaterial(created.id, {
      name: "Bài giảng đã sửa",
      tags: ["LECTURE", `lecture-url:${replacement}`],
    });
    expect(updated).toMatchObject({ name: "Bài giảng đã sửa", version: 2, sizeBytes: Buffer.byteLength(replacement, "utf8") });
    expect(updated.tags).toContain(`lecture-url:${replacement}`);
    expect(updated.tags).not.toContain(`lecture-url:${url}`);
    expect((await service.listMaterialVersions(created.id, "INSTRUCTOR")).map((version) => version.version)).toEqual([2, 1]);
  });

  it.each([
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://evil.example/lecture",
    "https://www.youtube.com/watch?v=invalid",
    "https://drive.google.com/",
    "https://user:password@www.facebook.com/watch?v=123",
    "https://drive.google.com:8443/file/d/test/view",
    "javascript:alert(1)",
  ])("rejects unsupported or unsafe URL: %s", async (url) => {
    const service = new LearningService();
    await expect(service.createMaterial("class-web-01", linkMaterial(url))).rejects.toThrow(BadRequestException);
  });

  it("requires class scope, consistent metadata, valid tags, and teaching access", async () => {
    const service = new LearningService();
    const url = links[0]!;
    await expect(service.createMaterial(null, linkMaterial(url))).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), sizeBytes: 1 })).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), tags: ["LECTURE"] })).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), tags: ["LECTURE", `lecture-url:${url}`, `lecture-url:${url}`] })).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", linkMaterial(url), undefined, "usr-outside")).rejects.toThrow(NotFoundException);
  });

  it("rejects lecture URL tags on binary materials and invalid edits", async () => {
    const service = new LearningService();
    const url = links[0]!;
    const pdf = {
      name: "Giáo trình.pdf", mimeType: "application/pdf", sizeBytes: 200,
      folder: "Bài giảng", tags: ["LECTURE"], scope: "CLASS" as const,
    };
    await expect(service.createMaterial("class-web-01", { ...pdf, tags: ["LECTURE", `lecture-url:${url}`] })).rejects.toThrow(BadRequestException);
    const material = await service.createMaterial("class-web-01", pdf);
    await expect(service.updateMaterial(material.id, { tags: ["LECTURE", `lecture-url:${url}`] })).rejects.toThrow(BadRequestException);
    const linked = await service.createMaterial("class-web-01", linkMaterial(url));
    await expect(service.updateMaterial(linked.id, { tags: ["LECTURE", "lecture-url:https://malicious.example/path"] })).rejects.toThrow(BadRequestException);
    await expect(service.updateMaterial(linked.id, { tags: ["LECTURE"] })).rejects.toThrow(BadRequestException);
  });
});
