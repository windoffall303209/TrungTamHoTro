import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeClient } from "../../../../src/lib/realtime-client";
import { useOperationsModel } from "../../../../src/features/operations/use-operations-model";

const api = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => api(...args),
  publicApiUrl: (path: string) => path,
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { sessionId: "admin-session", user: { id: "admin" }, roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"] },
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
    expect(api.mock.calls.some(([path]) => String(path).includes("retention") || String(path).includes("legal-holds") || String(path).includes("alerts"))).toBe(false);
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
    realtimeClient.setSession({ sessionId: "admin-session", userId: "admin", roleCode: "SYSTEM_ADMIN" });
    api.mockReset();
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/system/audit/page?")) {
        return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };
      }
      return [];
    });
  });
  afterEach(() => { cleanup(); realtimeClient.setSession(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("nhận tín hiệu job, không poll khi RUNNING và đóng stream khi rời tab", async () => {
    vi.useFakeTimers();
    const streams: Array<{ onmessage?: (event: { data: string }) => void; onerror?: () => void; close: ReturnType<typeof vi.fn> }> = [];
    class EventSourceFixture {
      onmessage?: (event: { data: string }) => void;
      onerror?: () => void;
      close = vi.fn();
      // Ghi nhận stream được mở để phát tín hiệu có kiểm soát trong test.
      constructor() { streams.push(this); }
    }
    vi.stubGlobal("EventSource", EventSourceFixture);
    api.mockImplementation(async (path: string) => path === "/system/backups" ? [{ id: "job", status: "RUNNING" }] : []);
    const { result, rerender, unmount } = renderHook(({ view }) => useOperationsModel(view), { initialProps: { view: "data" as "data" | "monitoring" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(25); });
    expect(streams).toHaveLength(1);
    await act(async () => { streams[0]!.onmessage?.({ data: JSON.stringify({ channel: "operations", value: { revision: 1 } }) }); await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.backups).toHaveLength(1);
    expect(api).toHaveBeenCalledTimes(5);
    api.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(api).not.toHaveBeenCalled();
    await act(async () => {
      for (let i = 0; i < 20; i++) streams[0]!.onmessage?.({ data: JSON.stringify({ channel: "operations", value: { revision: 1 } }) });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(api).toHaveBeenCalledTimes(5);
    act(() => streams[0]!.onerror?.());
    expect(result.current.loadError).toContain("gián đoạn");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); streams[1]!.onmessage?.({ data: JSON.stringify({ channel: "operations", value: { revision: 2 } }) }); await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.loadError).toBe("");
    const notification = vi.fn();
    const offNotifications = realtimeClient.subscribe(
      { sessionId: "admin-session", userId: "admin", roleCode: "SYSTEM_ADMIN" },
      { channel: "notifications" }, { next: notification });
    rerender({ view: "monitoring" });
    await act(async () => { await vi.advanceTimersByTimeAsync(25); });
    const shared = streams.at(-1)!;
    shared.onmessage?.({ data: JSON.stringify({ channel: "notifications", value: [] }) });
    expect(notification).toHaveBeenCalledWith([]);
    expect(shared.close).not.toHaveBeenCalled();
    offNotifications();
    expect(shared.close).toHaveBeenCalledOnce();
    expect(streams[0]!.close).toHaveBeenCalledOnce();
    unmount();
  });
  it("gõ bộ lọc chỉ gọi nhật ký", async () => {
    const { result } = renderHook(useOperationsModel);
    await waitFor(() =>
      expect(
        api.mock.calls.some(([path]) => path.startsWith("/system/audit/page?")),
      ).toBe(true),
    );
    api.mockClear();
    act(() => result.current.setQuery("giảng viên"));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toContain("/system/audit/page?");
    expect(api.mock.calls[0]![0]).toContain("page=1");
  });
  it("chuyển trang nhật ký và đặt lại về trang 1 khi thay bộ lọc", async () => {
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/system/audit/page?")) {
        const params = new URLSearchParams(path.split("?")[1] ?? "");
        const page = Number(params.get("page") ?? "1");
        return {
          items: [{ id: `audit-${page}`, actor: "admin", action: "UPDATE", target: `t-${page}`, detail: "", createdAt: "2026-11-01T00:00:00Z" }],
          total: 25,
          page,
          pageSize: 20,
          totalPages: 2,
        };
      }
      return [];
    });
    const { result } = renderHook(useOperationsModel);
    await waitFor(() => expect(result.current.auditPagination.totalItems).toBe(25));
    act(() => result.current.auditPagination.setPage(2));
    await waitFor(() =>
      expect(api.mock.calls.some(([path]) => String(path).includes("page=2"))).toBe(true),
    );
    api.mockClear();
    act(() => result.current.setAuditFilter((prev) => ({ ...prev, action: "UPDATE" })));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toContain("page=1");
  });
  it("giữ lỗi tải ngay trong trang và cho phép thử lại", async () => {
    api.mockRejectedValue(new Error("Mạng tạm thời không khả dụng"));
    const { result } = renderHook(useOperationsModel);
    await waitFor(() =>
      expect(result.current.auditError).toBe("Mạng tạm thời không khả dụng"),
    );
    api.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
    await act(async () => {
      await result.current.reloadAudit();
    });
    expect(result.current.auditError).toBe("");
  });
});
