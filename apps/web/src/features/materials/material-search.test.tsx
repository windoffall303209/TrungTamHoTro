import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/api-client";
import { useMaterialSearch } from "./material-search";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
beforeEach(() => { request.mockReset(); });

describe("server-paginated material pickers", () => {
  it("requests only one page and resets pagination when the class changes", async () => {
    request.mockResolvedValue({ items: [{ id: "material-1" }], total: 120, totalPages: 6 });
    const { result, rerender } = renderHook(({ classId }) => useMaterialSearch("INSTRUCTOR", { classId }, true, "teacher"), { initialProps: { classId: "class-1" } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toContain("pageSize=20");
    act(() => result.current.setPage(2));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1]![0]).toContain("page=2");
    rerender({ classId: "class-2" });
    expect(result.current.items).toHaveLength(0);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(request.mock.calls[2]![0]).toContain("classId=class-2");
    expect(request.mock.calls[2]![0]).toContain("page=1");
  });

  it("aborts stale requests and never retains another actor's page", async () => {
    request.mockResolvedValue({ items: [{ id: "private-material" }], total: 1, totalPages: 1 });
    const { result, rerender } = renderHook(({ actor }) => useMaterialSearch("INSTRUCTOR", {}, true, actor), { initialProps: { actor: "teacher-a" } });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const signal = request.mock.calls[0]![1]?.signal;
    request.mockResolvedValue({ items: [], total: 0, totalPages: 1 });
    rerender({ actor: "teacher-b" });
    expect(signal?.aborted).toBe(true);
    expect(result.current.items).toHaveLength(0);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
