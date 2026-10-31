import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFileName, apiRequest, downloadApiFile, previewApiFile } from "../../../src/lib/api-client";

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

describe("downloadApiFile resource cleanup", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("dọn anchor và URL cả khi browser từ chối thao tác tải", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = vi.fn(() => "blob:download-test");
      static override revokeObjectURL = revokeObjectURL;
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("file", {
      status: 200,
      headers: { "content-disposition": 'attachment; filename="export.csv"' },
    })));
    const originalAnchors = document.querySelectorAll("a").length;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("Download blocked"); });

    await expect(downloadApiFile("/exports/1", "LEARNER")).rejects.toThrow("Download blocked");
    expect(document.querySelectorAll("a")).toHaveLength(originalAnchors);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:download-test");
  });
});

describe("previewApiFile resource cleanup", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("không tạo object URL hoặc báo lỗi khi người dùng đóng cửa sổ trước lúc tệp tải xong", async () => {
    // Phản hồi tải tệp được điều khiển để mô phỏng thao tác đóng cửa sổ giữa chừng.
    let finishDownload: (response: Response) => void = () => { throw new Error("Chưa thiết lập yêu cầu tải."); };
    const download = new Promise<Response>((resolve) => { finishDownload = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(download));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview-test");
    const popup = {
      closed: false,
      document: document.implementation.createHTMLDocument(""),
      close: vi.fn(),
    } as unknown as Window;

    const pendingPreview = previewApiFile("/materials/preview", "LEARNER", "Bài giảng", popup);
    Object.assign(popup, { closed: true });
    finishDownload(new Response("file", { status: 200, headers: { "content-type": "application/pdf" } }));

    await expect(pendingPreview).resolves.toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(popup.close).not.toHaveBeenCalled();
  });
});
