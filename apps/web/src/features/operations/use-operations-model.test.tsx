import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationsModel } from "./use-operations-model";

const api = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => api(...args),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"] },
    notify,
  }),
}));

describe("Tải nhật ký độc lập", () => {
  it("mở giám sát chỉ gọi hai API, chuyển nội dung mới tải chính sách và mẫu", async () => {
    const { rerender } = renderHook(({ view }: { view: "monitoring" | "content" }) => useOperationsModel(view), {
      initialProps: { view: "monitoring" },
    });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api.mock.calls.map(([path]) => path).sort()).toEqual(["/system/alerts", "/system/audit?"].sort());
    api.mockClear();
    rerender({ view: "content" });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api.mock.calls.map(([path]) => path).sort()).toEqual(["/system/moderation-policy", "/system/notification-templates"].sort());
  });
  it("chuyển nhóm rồi quay lại không ghi đè chính sách đang sửa", async () => {
    api.mockImplementation(async (path: string) => path === "/system/moderation-policy" ? {
      version: 1, prohibitedTerms: [], maxPostsPerMinute: 10, action: "FLAG", updatedAt: "2026-09-16",
    } : []);
    const { result, rerender } = renderHook(({ view }: { view: "monitoring" | "content" }) => useOperationsModel(view), {
      initialProps: { view: "content" },
    });
    await waitFor(() => expect(result.current.policy).not.toBeNull());
    act(() => result.current.setPolicy((current) => current ? { ...current, prohibitedTerms: ["Đang nhập"] } : null));
    rerender({ view: "monitoring" });
    await waitFor(() => expect(api.mock.calls.some(([path]) => path.startsWith("/system/audit?"))).toBe(true));
    api.mockClear();
    rerender({ view: "content" });
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(result.current.policy?.prohibitedTerms).toEqual(["Đang nhập"]);
    expect(api.mock.calls[0]![0]).toBe("/system/notification-templates");
  });
  it("một nguồn lỗi không chặn nguồn khác cập nhật và thử lại xóa lỗi", async () => {
    api.mockImplementation(async (path: string) => {
      if (path === "/system/backups") throw new Error("Không tải được bản sao lưu");
      if (path === "/system/outbox/stats") return { PENDING: 3 };
      return [];
    });
    const { result } = renderHook(() => useOperationsModel("data"));
    await waitFor(() => expect(result.current.loadError).toContain("bản sao lưu"));
    expect(result.current.outboxStats).toEqual({ PENDING: 3 });
    api.mockResolvedValue([]);
    await act(async () => { await result.current.reload(); });
    expect(result.current.loadError).toBe("");
  });
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue([]);
  });
  afterEach(cleanup);
  it("gõ bộ lọc chỉ gọi nhật ký và không làm mất policy đang sửa", async () => {
    const { result } = renderHook(useOperationsModel);
    await waitFor(() =>
      expect(
        api.mock.calls.some(([path]) => path.startsWith("/system/audit?")),
      ).toBe(true),
    );
    act(() =>
      result.current.setPolicy({
        version: 1,
        prohibitedTerms: ["Đang sửa"],
        maxPostsPerMinute: 10,
        action: "FLAG",
        updatedAt: "2026-09-16",
      }),
    );
    api.mockClear();
    act(() => result.current.setQuery("giảng viên"));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toContain("/system/audit?");
    expect(result.current.policy?.prohibitedTerms).toEqual(["Đang sửa"]);
  });
  it("giữ lỗi tải ngay trong trang và cho phép thử lại", async () => {
    api.mockRejectedValue(new Error("Mạng tạm thời không khả dụng"));
    const { result } = renderHook(useOperationsModel);
    await waitFor(() =>
      expect(result.current.auditError).toBe("Mạng tạm thời không khả dụng"),
    );
    api.mockResolvedValue([]);
    await act(async () => {
      await result.current.reloadAudit();
    });
    expect(result.current.auditError).toBe("");
  });
});
