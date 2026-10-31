import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "../../../src/lib/learning-types";
import { isMaterialForClass, loadAllMaterials } from "../../../src/lib/materials";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./api-client", () => ({ apiRequest: request }));

describe("loadAllMaterials", () => {
  beforeEach(() => request.mockReset());

  it("nạp đầy đủ hơn 50 học liệu và giữ nguyên query cùng role của API cũ", async () => {
    const all = Array.from({ length: 121 }, (_, index) => ({ id: `material-${index}` })) as Material[];
    request.mockImplementation(async (path: string) => {
      const page = Number(new URL(path, "http://localhost").searchParams.get("page") ?? "1");
      return all.slice((page - 1) * 50, page * 50);
    });

    await expect(loadAllMaterials("/materials?classId=cls-1", { roleCode: "INSTRUCTOR" })).resolves.toEqual(all);
    expect(request.mock.calls).toEqual([
      ["/materials?classId=cls-1", { roleCode: "INSTRUCTOR" }],
      ["/materials?classId=cls-1&page=2", { roleCode: "INSTRUCTOR" }],
      ["/materials?classId=cls-1&page=3", { roleCode: "INSTRUCTOR" }],
    ]);
  });

  it("kiểm tra trang tiếp theo khi tổng số học liệu chia hết cho 50", async () => {
    request.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({ id: String(index) })))
      .mockResolvedValueOnce([]);

    expect(await loadAllMaterials()).toHaveLength(50);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toBe("/materials?page=2");
  });

  it("không trả danh sách bị cắt nếu một trang lỗi hoặc phản hồi sai cấu trúc", async () => {
    request.mockResolvedValueOnce(Array.from({ length: 50 }, () => ({ id: "file" })))
      .mockRejectedValueOnce(new Error("Không thể tải trang 2"));
    await expect(loadAllMaterials()).rejects.toThrow("Không thể tải trang 2");

    request.mockReset().mockResolvedValue({ items: [] });
    await expect(loadAllMaterials()).rejects.toThrow("Phản hồi danh sách học liệu không hợp lệ.");
  });

  it("dừng phân trang ngay khi tín hiệu bị hủy giữa hai lượt tải", async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => {
      controller.abort();
      return Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
    });

    await expect(loadAllMaterials("/materials", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe("isMaterialForClass", () => {
  const material = { classId: "cls-1", courseId: "crs-1", scope: "CLASS" } as Material;

  it("nhận tài liệu của lớp và tài liệu chia sẻ đúng môn", () => {
    expect(isMaterialForClass(material, "cls-1", "crs-1")).toBe(true);
    expect(isMaterialForClass({ ...material, classId: null, scope: "SHARED" }, "cls-1", "crs-1")).toBe(true);
  });

  it("loại tài liệu thuộc lớp khác, môn khác và tài liệu không được chia sẻ", () => {
    expect(isMaterialForClass({ ...material, classId: "cls-2" }, "cls-1", "crs-1")).toBe(false);
    expect(isMaterialForClass({ ...material, classId: null, courseId: "crs-2", scope: "SHARED" }, "cls-1", "crs-1")).toBe(false);
    expect(isMaterialForClass({ ...material, classId: null, scope: "CLASS" }, "cls-1", "crs-1")).toBe(false);
  });
});
