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
