import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LearningService } from "../../src/domains/learning/core/learning.service.js";

describe("Giảng viên tham gia thảo luận trong lớp mình dạy", () => {
  it("giảng viên được phân công tạo, sửa và xóa phản hồi trong chủ đề của lớp", async () => {
    const service = new LearningService();
    const post = await service.createPost("topic-rest", "Giảng viên giải thích thêm về REST.", "usr-instructor");
    expect(post.authorId).toBe("usr-instructor");
    const edited = await service.updatePost(post.id, "Giảng viên bổ sung ví dụ về REST.", "usr-instructor");
    expect(edited.body).toContain("bổ sung");
    await expect(service.deletePost(post.id, "usr-instructor")).resolves.toMatchObject({ id: post.id });
  });

  it("người ngoài lớp vẫn bị từ chối", async () => {
    const service = new LearningService();
    await expect(service.createPost("topic-rest", "Phản hồi từ người ngoài lớp.", "usr-outsider")).rejects.toThrow(NotFoundException);
  });
});
