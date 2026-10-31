import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GradebookRow, LearningClass } from "@/lib/learning-types";
import { useAcademicModel } from "../../../../src/features/academic/use-academic-model";

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn() }));
const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams }));
vi.mock("@/lib/api-client", () => ({
  apiRequest: mocks.request,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "INSTRUCTOR" }, notify: mocks.notify }),
}));
vi.mock("@/shared/ui/ui", () => ({ usePagination: () => ({ resetPage: vi.fn() }) }));

const classes: LearningClass[] = ["a", "b"].map((id) => ({
  id, courseId: `course-${id}`, courseVersion: 1, code: id, name: id,
  term: "2026-FALL", startAt: "2026-09-01T00:00:00Z", endAt: "2026-12-01T00:00:00Z",
  capacity: 30, timezone: "Asia/Bangkok", allowLateEnrollment: false,
  status: "ACTIVE", instructorIds: [], learnerIds: [],
}));

// Tạo một dòng điểm đủ các trường bắt buộc để phát hiện dữ liệu sai lớp.
function makeGrade(learnerId: string): GradebookRow[] {
  return [{
    learnerId, learnerName: learnerId, learnerEmail: `${learnerId}@example.com`,
    examEarned: 0, examPossible: 0, assignmentEarned: 0, assignmentPossible: 0,
    totalPercent: 0, awaitingGrade: 0, notSubmitted: 0,
  }];
}

// Cho phép giải quyết hoặc từ chối lời gọi API sau một lần chuyển lớp.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

describe("useAcademicModel request lifecycle", () => {
  const oldGradeRequests: ReturnType<typeof deferred<GradebookRow[]>>[] = [];

  beforeEach(() => {
    oldGradeRequests.length = 0;
    mocks.request.mockReset();
    mocks.notify.mockReset();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve(classes);
      if (path === "/academic/classes/a/gradebook") {
        const pending = deferred<GradebookRow[]>();
        oldGradeRequests.push(pending);
        return pending.promise;
      }
      if (path === "/academic/classes/b/gradebook") return Promise.resolve(makeGrade("b"));
      if (["/academic/assignments", "/academic/calendar", "/academic/announcements"].includes(path)) {
        return Promise.resolve([]);
      }
      throw new Error(`Unexpected API request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("không ghi đè sổ điểm lớp mới bằng phản hồi của lớp cũ", async () => {
    const { result } = renderHook(() => useAcademicModel());
    await waitFor(() => expect(oldGradeRequests.length).toBeGreaterThan(0));
    act(() => { void result.current.changeClass("b"); });
    await waitFor(() => expect(result.current.gradebook[0]?.learnerId).toBe("b"));

    await act(async () => {
      for (const pending of oldGradeRequests) pending.resolve(makeGrade("a"));
    });
    expect(result.current.gradebook[0]?.learnerId).toBe("b");
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi sổ điểm của lớp không còn được chọn", async () => {
    const { result } = renderHook(() => useAcademicModel());
    await waitFor(() => expect(oldGradeRequests.length).toBeGreaterThan(0));
    act(() => { void result.current.changeClass("b"); });
    await waitFor(() => expect(result.current.gradebook[0]?.learnerId).toBe("b"));

    await act(async () => {
      for (const pending of oldGradeRequests) pending.reject(new Error("Old gradebook error"));
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi sau khi trang bị tháo khỏi giao diện", async () => {
    const pending = deferred<LearningClass[]>();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/classes") return pending.promise;
      return Promise.resolve([]);
    });
    const hook = renderHook(() => useAcademicModel());
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", expect.anything()));
    hook.unmount();
    await act(async () => pending.reject(new Error("Unmounted academic error")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
