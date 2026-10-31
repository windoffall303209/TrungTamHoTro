import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { LearningServiceContext } from "../../src/domains/learning/core/learning.context.js";
import { MATERIAL_READ_RELATIONS } from "../../src/domains/learning/operations/access/learning-access.js";
import {
  createMaterialVersionAccess,
  resolveMaterialVersionDownload,
} from "../../src/domains/learning/operations/materials/learning-material-versions.js";

type VersionFixture = {
  row: {
    material: {
      visibility: string;
      quarantinedAt: Date | null;
      class: { enrollments: Array<{ learnerId: string; status: string }> };
    };
  };
  findUnique: ReturnType<typeof vi.fn>;
  logAccess: ReturnType<typeof vi.fn>;
  verifyMaterialAccess: ReturnType<typeof vi.fn>;
  signMaterialAccess: ReturnType<typeof vi.fn>;
  context: LearningServiceContext;
};

// Tạo dữ liệu Prisma tối thiểu để kiểm tra hai luồng cấp URL và tải phiên bản.
function makeVersionFixture(): VersionFixture {
  const row = {
    name: "bai-giang.pdf",
    mimeType: "application/pdf",
    objectKey: "files/lecture-2",
    checksum: "sha256:abc",
    visibility: "PUBLISHED",
    material: {
      ownerId: "instructor-1",
      scope: "CLASS",
      visibility: "PUBLISHED",
      classId: "class-1",
      quarantinedAt: null as Date | null,
      editors: [] as Array<{ userId: string }>,
      class: {
        enrollments: [{ learnerId: "learner-1", status: "ACTIVE" }],
        instructors: [{ instructorId: "instructor-1" }],
      },
    },
  };
  const findUnique = vi.fn().mockResolvedValue(row);
  const logAccess = vi.fn().mockResolvedValue({});
  const verifyMaterialAccess = vi.fn();
  const signMaterialAccess = vi.fn().mockReturnValue("signed-value");
  const context = {
    database: () => ({
      materialVersion: { findUnique },
      materialAccessLog: { create: logAccess },
    }),
    isMaterialObjectKey: (key: string) => key.startsWith("files/"),
    signMaterialAccess,
    verifyMaterialAccess,
    userIdForRole: () => "learner-1",
  } as unknown as LearningServiceContext;
  return { row, findUnique, logAccess, verifyMaterialAccess, signMaterialAccess, context };
}

describe("Quyền truy cập phiên bản học liệu qua Prisma", () => {
  it("dùng cùng quan hệ và kiểm tra quyền khi cấp URL rồi tải phiên bản", async () => {
    const { context, findUnique, logAccess, verifyMaterialAccess, signMaterialAccess } = makeVersionFixture();
    const access = await createMaterialVersionAccess(context, "material-1", 2, "LEARNER", "DOWNLOAD", "learner-1");
    const url = new URL(access.url, "http://localhost");
    expect(url.searchParams.get("signature")).toBe("signed-value");
    expect(signMaterialAccess).toHaveBeenCalledWith("material-1:2", expect.any(Number), "DOWNLOAD");

    const downloaded = await resolveMaterialVersionDownload(
      context, "material-1", 2, Number(url.searchParams.get("expires")),
      "signed-value", "LEARNER", "DOWNLOAD", "learner-1",
    );
    expect(downloaded).toEqual({
      fileName: "bai-giang.pdf",
      mimeType: "application/pdf",
      objectKey: "files/lecture-2",
      checksum: "sha256:abc",
    });
    expect(verifyMaterialAccess).toHaveBeenCalledWith(
      "material-1:2", Number(url.searchParams.get("expires")), "signed-value", "DOWNLOAD",
    );
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledWith({
      where: { materialId_version: { materialId: "material-1", version: 2 } },
      include: { material: { include: MATERIAL_READ_RELATIONS } },
    });
    const loggedAccess: unknown = logAccess.mock.calls[0]?.[0];
    expect(loggedAccess).toMatchObject({
      data: {
        materialId: "material-1", userId: "learner-1", action: "DOWNLOAD_V2",
      },
    });
  });

  it("từ chối phiên bản ẩn ngay cả với chữ ký hợp lệ", async () => {
    const { context, row, logAccess, signMaterialAccess } = makeVersionFixture();
    row.material.visibility = "HIDDEN";
    await expect(createMaterialVersionAccess(context, "material-1", 2, "LEARNER")).rejects.toThrow(NotFoundException);
    await expect(resolveMaterialVersionDownload(
      context, "material-1", 2, 123, "signed-value", "LEARNER",
    )).rejects.toThrow(NotFoundException);
    expect(signMaterialAccess).not.toHaveBeenCalled();
    expect(logAccess).not.toHaveBeenCalled();
  });

  it("từ chối người học ngoài lớp và học liệu bị cách ly", async () => {
    const { context, row } = makeVersionFixture();
    row.material.class.enrollments = [];
    await expect(createMaterialVersionAccess(
      context, "material-1", 2, "LEARNER", "DOWNLOAD", "learner-outside",
    )).rejects.toThrow(NotFoundException);
    row.material.quarantinedAt = new Date();
    await expect(createMaterialVersionAccess(
      context, "material-1", 2, "INSTRUCTOR", "DOWNLOAD", "instructor-1",
    )).rejects.toThrow(NotFoundException);
  });
});
