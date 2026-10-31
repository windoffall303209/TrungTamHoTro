import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassClosureReadiness, LearningClass } from "@/lib/learning-types";
import ClassLifecyclePage from "../../../../../src/app/(workspace)/class-lifecycle/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "CENTER_MANAGER" }, notify: notifyMock }),
}));
vi.mock("@/shared/ui/searchable-select", () => ({
  SearchableSelect: ({ "aria-label": label, onChange, options, value }: {
    "aria-label": string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
    value: string;
  }) => <select aria-label={label} onChange={(event) => onChange(event.target.value)} value={value}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));

const classes: LearningClass[] = ["a", "b"].map((id) => ({
  id, courseId: "course", courseVersion: 1, code: id, name: `Class ${id}`, term: "2026",
  startAt: "2026-01-01T00:00:00Z", endAt: "2026-12-31T00:00:00Z", capacity: 30,
  timezone: "Asia/Bangkok", allowLateEnrollment: false, status: "ACTIVE",
  instructorIds: [], learnerIds: [],
}));

// Tạo Promise có thể hoàn thành thủ công để mô phỏng kết quả API đến sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Chuẩn bị kết quả kiểm tra điều kiện theo từng lớp để phát hiện dữ liệu cũ.
function makeReadiness(openExams: number): ClassClosureReadiness {
  return {
    eligible: false, blockers: ["Còn kỳ thi đang mở"], openExams,
    inProgressAttempts: 0, pendingGrades: 0, openAssignments: 0,
    pendingAssignmentGrades: 0, openRegrades: 0, activeSessions: 0,
    unlockedAttendanceSessions: 0, openAppeals: 0,
  };
}

describe("ClassLifecyclePage request lifecycle", () => {
  const requests = new Map<string, ReturnType<typeof deferred<ClassClosureReadiness>>>();

  beforeEach(() => {
    requests.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve(classes);
      const match = /^\/manager\/classes\/(a|b)\/closure-readiness$/.exec(path);
      if (match?.[1]) {
        const request = deferred<ClassClosureReadiness>();
        requests.set(match[1], request);
        return request.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("does not reload classes or show stale readiness after selecting another class", async () => {
    render(<ClassLifecyclePage />);
    await waitFor(() => expect(requests.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp cần quản lý" }), { target: { value: "b" } });
    await waitFor(() => expect(requests.has("b")).toBe(true));

    await act(async () => requests.get("b")!.resolve(makeReadiness(7)));
    const metrics = screen.getByRole("region", { name: "Chỉ số điều kiện đóng lớp" });
    expect(within(metrics).getByText("7")).toBeInTheDocument();
    await act(async () => requests.get("a")!.resolve(makeReadiness(3)));
    expect(within(metrics).getByText("7")).toBeInTheDocument();
    expect(within(metrics).queryByText("3")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([path]) => path === "/classes")).toHaveLength(1);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores errors from a superseded readiness request", async () => {
    render(<ClassLifecyclePage />);
    await waitFor(() => expect(requests.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp cần quản lý" }), { target: { value: "b" } });
    await waitFor(() => expect(requests.has("b")).toBe(true));
    await act(async () => requests.get("a")!.reject(new Error("Outdated readiness")));
    await act(async () => requests.get("b")!.resolve(makeReadiness(7)));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
