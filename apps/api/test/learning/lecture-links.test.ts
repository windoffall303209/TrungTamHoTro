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
  it("returns hidden lecture metadata without content URLs to administrators", async () => {
    const service = new LearningService();
    const data = { ...linkMaterial(links[0]!), visibility: "HIDDEN" as const, folder: "Chương mới" };
    await expect(service.createMaterial("class-web-01", data, undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await service.classFolders("class-web-01", "usr-instructor", { kind: "lectures", name: data.folder }, "INSTRUCTOR");
    const created = await service.createMaterial("class-web-01", data, undefined, "usr-instructor", "INSTRUCTOR");
    for (const role of ["SYSTEM_ADMIN", "CENTER_MANAGER"]) {
      const list = await service.searchAccessibleMaterials({ materialId: created.id }, role === "SYSTEM_ADMIN" ? "usr-admin" : "usr-manager", role);
      expect(list.items[0]?.tags).toEqual(["LECTURE"]);
    }
    const instructorList = await service.searchAccessibleMaterials({ materialId: created.id }, "usr-instructor", "INSTRUCTOR");
    expect(instructorList.items[0]?.tags).toEqual(data.tags);
  });
  it.each(links)("creates %s without a binary upload, then edits its URL", async (url) => {
    const service = new LearningService();
    const created = await service.createMaterial("class-web-01", linkMaterial(url), undefined, "usr-instructor", "INSTRUCTOR");
    expect(created).toMatchObject({
      classId: "class-web-01",
      mimeType: "text/uri-list",
      sizeBytes: Buffer.byteLength(url, "utf8"),
      visibility: "PUBLISHED",
      scope: "CLASS",
    });
    expect(created.tags).toContain(`lecture-url:${url}`);

    const replacement = "https://www.youtube.com/shorts/dQw4w9WgXcQ";
    const updated = await service.updateMaterial(created.id, {
      name: "Bài giảng đã sửa",
      tags: ["LECTURE", `lecture-url:${replacement}`],
    }, "usr-instructor", "INSTRUCTOR");
    expect(updated).toMatchObject({ name: "Bài giảng đã sửa", version: 2, sizeBytes: Buffer.byteLength(replacement, "utf8") });
    expect(updated.tags).toContain(`lecture-url:${replacement}`);
    expect(updated.tags).not.toContain(`lecture-url:${url}`);
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
    await expect(service.createMaterial("class-web-01", linkMaterial(url), undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
  });

  it("requires class scope, consistent metadata, valid tags, and teaching access", async () => {
    const service = new LearningService();
    const url = links[0]!;
    await expect(service.createMaterial(null, linkMaterial(url), undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), sizeBytes: 1 }, undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), tags: ["LECTURE"] }, undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", { ...linkMaterial(url), tags: ["LECTURE", `lecture-url:${url}`, `lecture-url:${url}`] }, undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(service.createMaterial("class-web-01", linkMaterial(url), undefined, "usr-outside", "INSTRUCTOR")).rejects.toThrow(NotFoundException);
  });

  it("rejects lecture URL tags on binary materials and invalid edits", async () => {
    const service = new LearningService();
    const url = links[0]!;
    const pdf = {
      name: "Giáo trình.pdf", mimeType: "application/pdf", sizeBytes: 200,
      folder: "Bài giảng", tags: ["LECTURE"], scope: "CLASS" as const,
    };
    await expect(service.createMaterial("class-web-01", { ...pdf, tags: ["LECTURE", `lecture-url:${url}`] }, undefined, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    const material = await service.createMaterial("class-web-01", pdf, undefined, "usr-instructor", "INSTRUCTOR");
    await expect(service.updateMaterial(material.id, { tags: ["LECTURE", `lecture-url:${url}`] }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    const linked = await service.createMaterial("class-web-01", linkMaterial(url), undefined, "usr-instructor", "INSTRUCTOR");
    await expect(service.updateMaterial(linked.id, { tags: ["LECTURE", "lecture-url:https://malicious.example/path"] }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
    await expect(service.updateMaterial(linked.id, { tags: ["LECTURE"] }, "usr-instructor", "INSTRUCTOR")).rejects.toThrow(BadRequestException);
  });
});
