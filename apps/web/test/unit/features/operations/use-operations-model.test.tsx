import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOperationsModel } from "../../../../src/features/operations/use-operations-model";

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
  it("khôi phục từ bản được chọn và chặn bản chưa có tệp", async () => {
    api.mockImplementation(async (path: string) => path === "/system/backups" ? [
      { id: "missing-file", status: "COMPLETED", canRestore: false },
      { id: "older-backup", status: "COMPLETED", canRestore: true },
    ] : []);
    const { result } = renderHook(() => useOperationsModel("data"));
    await waitFor(() => expect(result.current.backups).toHaveLength(2));
    const submit = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    act(() => result.current.setRestoreForm((form) => ({ ...form, backupId: "missing-file" })));
    await act(() => result.current.requestRestore(submit));
    expect(api.mock.calls.some(([path, options]) => path === "/system/restores" && options?.method === "POST")).toBe(false);
    act(() => result.current.setRestoreForm((form) => ({ ...form, backupId: "older-backup" })));
    await act(() => result.current.requestRestore(submit));
    const post = api.mock.calls.find(([path, options]) => path === "/system/restores" && options?.method === "POST");
    expect(JSON.parse(post?.[1].body)).toMatchObject({ backupId: "older-backup", mode: "DRILL" });
  });
  beforeEach(() => {
    api.mockReset();
    api.mockResolvedValue([]);
  });
  afterEach(cleanup);
  it("gõ bộ lọc chỉ gọi nhật ký", async () => {
    const { result } = renderHook(useOperationsModel);
    await waitFor(() =>
      expect(
        api.mock.calls.some(([path]) => path.startsWith("/system/audit?")),
      ).toBe(true),
    );
    api.mockClear();
    act(() => result.current.setQuery("giảng viên"));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toContain("/system/audit?");
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
