import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassRoster, LearningClass } from "@/lib/learning-types";
import ClassOperationsPage from "../../../../../src/app/(workspace)/class-operations/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "CENTER_MANAGER" }, notify: notifyMock }),
}));
vi.mock("@/shared/ui/user-picker", () => ({ UserPicker: () => <div /> }));
vi.mock("@/shared/ui/searchable-select", () => ({
  SearchableSelect: ({ "aria-label": label, onChange, options, value }: {
    "aria-label": string;
    onChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => <select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));

const classes: LearningClass[] = ["a", "b"].map((id) => ({
  id, courseId: "course", courseVersion: 1, code: id, name: `Class ${id}`, term: "2026",
  startAt: "2026-01-01T00:00:00Z", endAt: "2026-12-31T00:00:00Z", capacity: 30,
  timezone: "Asia/Bangkok", allowLateEnrollment: false, status: "ACTIVE", instructorIds: [], learnerIds: [],
}));

// Tạo API trì hoãn để xác nhận phản hồi của lớp cũ không ghi đè lớp mới.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo dữ liệu roster riêng cho mỗi lớp để dễ nhận diện kết quả trả sai thứ tự.
function makeRoster(id: string): ClassRoster {
  return {
    classId: id, instructors: [{ instructorId: `instructor-${id}`, role: "PRIMARY", assignedAt: "2026-10-31T00:00:00Z", displayName: `Instructor ${id}` }],
    enrollments: [], history: [],
  };
}

describe("ClassOperationsPage request lifecycle", () => {
  const requests = new Map<string, ReturnType<typeof deferred<ClassRoster>>>();

  beforeEach(() => {
    requests.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve(classes);
      const match = /^\/manager\/classes\/(a|b)\/roster$/.exec(path);
      if (match?.[1]) {
        const request = deferred<ClassRoster>();
        requests.set(match[1], request);
        return request.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("does not show the previous class roster when requests return out of order", async () => {
    render(<ClassOperationsPage />);
    await waitFor(() => expect(requests.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp học" }), { target: { value: "b" } });
    await waitFor(() => expect(requests.has("b")).toBe(true));
    await act(async () => requests.get("b")!.resolve(makeRoster("b")));
    expect(screen.getByText("Instructor b")).toBeInTheDocument();
    await act(async () => requests.get("a")!.resolve(makeRoster("a")));
    expect(screen.getByText("Instructor b")).toBeInTheDocument();
    expect(screen.queryByText("Instructor a")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([path]) => path === "/classes")).toHaveLength(1);
  });

  it("does not notify about an obsolete roster request failure", async () => {
    render(<ClassOperationsPage />);
    await waitFor(() => expect(requests.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp học" }), { target: { value: "b" } });
    await waitFor(() => expect(requests.has("b")).toBe(true));
    await act(async () => requests.get("a")!.reject(new Error("Obsolete roster failure")));
    await act(async () => requests.get("b")!.resolve(makeRoster("b")));
    expect(screen.getByText("Instructor b")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
