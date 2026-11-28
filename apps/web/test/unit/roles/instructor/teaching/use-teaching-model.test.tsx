import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningClass } from "@/lib/learning-types";
import { useTeachingModel } from "../../../../../src/roles/instructor/teaching/use-teaching-model";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/access-control", () => ({ hasEveryPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "INSTRUCTOR" }, notify: mocks.notify }),
}));

const teachingClass = { id: "class-a", name: "Lớp A" } as LearningClass;
const updatedClass = { id: "class-b", name: "Lớp B" } as LearningClass;

describe("useTeachingModel", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.notify = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it("giữ danh sách lớp đã tải khi lần làm mới lớp thất bại", async () => {
    let classRequests = 0;
    mocks.request.mockImplementation((path: string) => {
      if (path === "/instructor/classes") {
        classRequests += 1;
        return classRequests === 1 ? Promise.resolve([teachingClass]) : Promise.reject(new Error("Lỗi tải lớp"));
      }
      return Promise.resolve([]);
    });

    const { result, rerender } = renderHook(() => useTeachingModel());
    await waitFor(() => expect(result.current.instructorClasses).toEqual([teachingClass]));

    mocks.notify = vi.fn();
    rerender();
    await waitFor(() => expect(classRequests).toBe(2));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith("Lỗi tải lớp", "error"));
    expect(result.current.instructorClasses).toEqual([teachingClass]);
  });

  it("bỏ qua phản hồi của lần tải lớp cũ đến sau lần tải mới", async () => {
    const oldRequest: { resolve?: (classes: LearningClass[]) => void } = {};
    let classRequests = 0;
    mocks.request.mockImplementation((path: string) => {
      if (path === "/instructor/classes") {
        classRequests += 1;
        if (classRequests === 1) {
          return new Promise<LearningClass[]>((resolve) => { oldRequest.resolve = resolve; });
        }
        return Promise.resolve([updatedClass]);
      }
      return Promise.resolve([]);
    });

    const { result, rerender } = renderHook(() => useTeachingModel());
    await waitFor(() => expect(classRequests).toBe(1));

    mocks.notify = vi.fn();
    rerender();
    await waitFor(() => expect(result.current.instructorClasses).toEqual([updatedClass]));

    if (!oldRequest.resolve) throw new Error("Thiếu yêu cầu tải lớp đang chờ.");
    await act(async () => { oldRequest.resolve?.([teachingClass]); });
    expect(result.current.instructorClasses).toEqual([updatedClass]);
  });
});
