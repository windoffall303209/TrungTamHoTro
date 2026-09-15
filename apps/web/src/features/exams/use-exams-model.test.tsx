import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExamsModel } from "./use-exams-model";

const api = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => api(...args),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      user: { id: "instructor-test" },
      roleCode: "INSTRUCTOR",
      permissions: ["exam:manage"],
    },
    notify,
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));
vi.mock("@/components/material-search", () => ({
  useMaterialSearch: () => ({ items: [] }),
}));

describe("Bản nháp trình tạo đề", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    api.mockReset();
    api.mockResolvedValue([]);
  });

  it("phục hồi sau khi rời trang mà không cần tạm đóng trước", async () => {
    const first = renderHook(useExamsModel);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.openCreate("MANUAL"));
    act(() => first.result.current.setForm((form) => ({ ...form, title: "Qua trang khác vẫn còn" })));
    first.unmount();
    const second = renderHook(useExamsModel);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    act(() => second.result.current.openCreate("MANUAL"));
    expect(second.result.current.form.title).toBe("Qua trang khác vẫn còn");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("giữ nội dung khi tạm đóng và tách nháp thủ công với AI", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({ ...form, title: "Đề đang soạn" })),
    );
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("AI"));
    expect(result.current.form.title).toBe("");
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("Đề đang soạn");
  });

  it("chỉ bỏ nội dung khi đồng ý và không giữ lại nháp đã bỏ", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({ ...form, title: "Giữ lại" })),
    );
    act(() => result.current.discardEditor());
    expect(result.current.form.title).toBe("Giữ lại");
    confirm.mockReturnValue(true);
    act(() => result.current.discardEditor());
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("");
  });

  it("không cho đóng hoặc bỏ form khi đang gửi và giữ nội dung khi API lỗi", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({
        ...form,
        title: "Đề lỗi",
        openAt: "2026-09-16T08:00",
        closeAt: "2026-09-17T08:00",
      })),
    );
    let rejectRequest!: (error: Error) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    let request!: Promise<void>;
    act(() => {
      request = result.current.create({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });
    act(() => result.current.closeEditor());
    expect(result.current.open).toBe(true);
    await act(async () => {
      rejectRequest(new Error("Mất kết nối"));
      await request;
    });
    expect(result.current.form.title).toBe("Đề lỗi");
    expect(result.current.open).toBe(true);
  });

  it("xóa nháp sau khi lưu thành công", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({
        ...form,
        title: "Đề đã lưu",
        openAt: "2026-09-16T08:00",
        closeAt: "2026-09-17T08:00",
      })),
    );
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("MANUAL"));
    await act(async () => {
      await result.current.create({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("");
  });
});
