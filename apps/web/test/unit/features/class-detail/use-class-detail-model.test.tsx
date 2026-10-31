import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassCapabilities, LearningClass } from "@/lib/learning-types";
import { useClassDetailModel } from "../../../../src/features/class-detail/use-class-detail-model";

const mocks = vi.hoisted(() => ({
  classId: "class-a",
  request: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ classId: mocks.classId }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "CENTER_MANAGER" }, notify: mocks.notify }),
}));
vi.mock("@/shared/ui/ui", () => ({ usePagination: () => ({}) }));

const capabilities = {
  classId: "class-a",
  relationship: "MANAGER",
  classStatus: "ACTIVE",
  actions: Object.fromEntries(
    ["view", "manageRoster", "manageContent", "submitWork", "grade", "postForum", "joinLive", "chat"]
      .map((action) => [action, { allowed: true }]),
  ),
} as ClassCapabilities;
const classes = ["class-a", "class-b"].map((id) => ({
  id,
  name: id,
  courseId: `course-${id}`,
  courseVersion: 1,
  code: id,
  term: "2026-FALL",
  startAt: "2026-09-01T00:00:00Z",
  endAt: "2026-12-01T00:00:00Z",
  capacity: 30,
  timezone: "Asia/Bangkok",
  allowLateEnrollment: false,
  status: "ACTIVE" as const,
  instructorIds: [],
  learnerIds: [],
})) satisfies LearningClass[];

// Tạo yêu cầu bất đồng bộ để chủ động điều khiển thứ tự hoàn tất.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

describe("useClassDetailModel request lifecycle", () => {
  const classRequests: ReturnType<typeof deferred<LearningClass[]>>[] = [];

  beforeEach(() => {
    classRequests.length = 0;
    mocks.classId = "class-a";
    mocks.request.mockReset();
    mocks.notify.mockReset();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/classes") {
        const pending = deferred<LearningClass[]>();
        classRequests.push(pending);
        return pending.promise;
      }
      if (path.endsWith("/capabilities")) return Promise.resolve(capabilities);
      if (path.endsWith("/roster")) {
        return Promise.resolve({ instructors: [], enrollments: [], history: [] });
      }
      if (path.endsWith("/closure-readiness")) return Promise.resolve({});
      if (path === "/manager/courses") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("bỏ qua dữ liệu lớp cũ khi đổi lớp trước khi API trả về", async () => {
    const { result, rerender } = renderHook(() => useClassDetailModel());
    await waitFor(() => expect(classRequests).toHaveLength(1));
    mocks.classId = "class-b";
    rerender();
    await waitFor(() => expect(classRequests).toHaveLength(2));

    await act(async () => classRequests[1]!.resolve(classes));
    await waitFor(() => expect(result.current.item?.id).toBe("class-b"));
    await act(async () => classRequests[0]!.resolve(classes));

    expect(result.current.item?.id).toBe("class-b");
    expect(result.current.loading).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi từ yêu cầu thuộc lớp trước đó", async () => {
    const { result, rerender } = renderHook(() => useClassDetailModel());
    await waitFor(() => expect(classRequests).toHaveLength(1));
    mocks.classId = "class-b";
    rerender();
    await waitFor(() => expect(classRequests).toHaveLength(2));

    await act(async () => classRequests[0]!.reject(new Error("Old class error")));
    await act(async () => classRequests[1]!.resolve(classes));
    await waitFor(() => expect(result.current.item?.id).toBe("class-b"));

    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi khi request hoàn tất sau khi unmount", async () => {
    const hook = renderHook(() => useClassDetailModel());
    await waitFor(() => expect(classRequests).toHaveLength(1));
    hook.unmount();
    await act(async () => classRequests[0]!.reject(new Error("Unmounted class error")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
