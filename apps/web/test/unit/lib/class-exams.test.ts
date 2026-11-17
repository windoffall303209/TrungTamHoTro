import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useClassExamPage } from "@/lib/class-exams";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: request }));
beforeEach(() => { request.mockReset(); });

it("chỉ lấy trang yêu cầu trong lớp 501 đề và tìm trên toàn lớp", async () => {
  request.mockImplementation(async (url: string) => {
    const query = new URLSearchParams(url.split("?")[1]);
    const page = Number(query.get("page"));
    return { page, pageSize: 20, total: query.has("search") ? 1 : 501,
      items: [{ id: query.get("search") ?? String(page), classId: "c1" }, { id: "other", classId: "c2" }] };
  });
  const { result, rerender } = renderHook(({ search, active }) => useClassExamPage("c1", "INSTRUCTOR", active, search, "newest", vi.fn()),
    { initialProps: { search: "", active: false } });
  expect(request).not.toHaveBeenCalled();
  rerender({ search: "", active: true });
  await waitFor(() => expect(result.current.rows.map(row => row.id)).toEqual(["1"]));
  expect(result.current.total).toBe(501);
  expect(request).toHaveBeenCalledTimes(1);
  act(() => result.current.setPage(2));
  await waitFor(() => expect(result.current.rows[0]?.id).toBe("2"));
  rerender({ search: "Đề 501", active: true });
  await waitFor(() => expect(result.current.rows[0]?.id).toBe("Đề 501"));
  expect(result.current.page).toBe(1);
  expect(result.current.total).toBe(1);
  expect(request).toHaveBeenCalledTimes(3);
});

it("bỏ kết quả cũ đến sau khi đã chuyển lớp", async () => {
  let finishOld!: (data: unknown) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finishOld = resolve; }));
  request.mockResolvedValueOnce({ items: [{ id: "new", classId: "c2" }], total: 1, page: 1 });
  const { result, rerender } = renderHook(({ id }) => useClassExamPage(id, "INSTRUCTOR", true, "", "newest", vi.fn()), { initialProps: { id: "c1" } });
  const signal = request.mock.calls[0]![1].signal as AbortSignal;
  rerender({ id: "c2" });
  await waitFor(() => expect(result.current.rows[0]?.id).toBe("new"));
  expect(signal.aborted).toBe(true);
  await act(async () => { finishOld({ items: [{ id: "old", classId: "c1" }], total: 10, page: 1 }); });
  expect(result.current.total).toBe(1);
  expect(result.current.rows[0]?.id).toBe("new");
});

it("phục hồi trang đề khi tải lại sau lỗi API", async () => {
  const onError = vi.fn();
  request.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ items: [], total: 0, page: 1 });
  const { result } = renderHook(() => useClassExamPage("c1", "INSTRUCTOR", true, "", "oldest", onError));
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[0]).toContain("sort=oldest");
});
