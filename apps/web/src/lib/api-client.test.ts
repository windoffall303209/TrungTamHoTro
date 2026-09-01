import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFileName, apiRequest } from "./api-client";

describe("apiRequest", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("trả undefined cho phản hồi 204 không có body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest<void>("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("đọc data từ JSON envelope bình thường", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      data: { id: "usr-1" },
      meta: { requestId: "req-1", timestamp: "2026-08-30T00:00:00.000Z" },
    })));

    await expect(apiRequest<{ id: string }>("/account/profile")).resolves.toEqual({ id: "usr-1" });
  });

  it("trả ApiError ổn định khi phản hồi lỗi không có body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(apiRequest("/system/failure")).rejects.toMatchObject({
      name: "ApiError",
      message: "Không thể xử lý yêu cầu.",
      status: 500,
    } satisfies Partial<ApiError>);
  });

  it("không làm lộ lỗi JSON parser khi máy chủ trả dữ liệu sai định dạng", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 502 })));

    await expect(apiRequest("/system/failure")).rejects.toMatchObject({
      name: "ApiError",
      message: "Phản hồi từ hệ thống không đúng định dạng.",
      status: 502,
    } satisfies Partial<ApiError>);
  });
});

describe("apiFileName", () => {
  it("ưu tiên tên UTF-8 và giữ nguyên dấu tiếng Việt", () => {
    expect(apiFileName("attachment; filename=\"Bai giang.pdf\"; filename*=UTF-8''B%C3%A0i%20gi%E1%BA%A3ng.pdf")).toBe("Bài giảng.pdf");
  });

  it("dùng filename tương thích khi máy chủ không gửi filename*", () => {
    expect(apiFileName('attachment; filename="tai-lieu.docx"')).toBe("tai-lieu.docx");
  });
});
