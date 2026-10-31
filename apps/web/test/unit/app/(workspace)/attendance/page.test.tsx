import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttendanceSessionReview, LiveSession } from "@/lib/learning-types";
import AttendancePage from "../../../../../src/app/(workspace)/attendance/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "CENTER_MANAGER" }, notify: notifyMock }),
}));
vi.mock("@/shared/ui/searchable-select", () => ({
  SearchableSelect: ({ "aria-label": ariaLabel, onChange, options, value }: {
    "aria-label": string;
    onChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => <select aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} value={value}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));

const sessions: LiveSession[] = ["a", "b"].map((id) => ({
  id, classId: "class-1", title: `Session ${id}`, startsAt: "2026-10-31T08:00:00Z",
  endsAt: "2026-10-31T09:00:00Z", provider: "JITSI", status: "COMPLETED",
  hostUrl: "", attendeeUrl: "", timezone: "Asia/Bangkok",
}));

// Tạo yêu cầu trì hoãn để mô phỏng API trả kết quả sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo dữ liệu điểm danh phân biệt rõ từng buổi học.
function makeReview(id: string): AttendanceSessionReview {
  const session = sessions.find((item) => item.id === id);
  if (!session) throw new Error(`Unexpected session: ${id}`);
  return {
    session, enrolledLearnerIds: [`learner-${id}`], appeals: [],
    records: [{ sessionId: id, learnerId: `learner-${id}`, attendedMinutes: 60, status: "PRESENT" }],
  };
}

describe("AttendancePage request lifecycle", () => {
  const reviews = new Map<string, ReturnType<typeof deferred<AttendanceSessionReview>>>();

  beforeEach(() => {
    reviews.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/sessions") return Promise.resolve(sessions);
      const match = /^\/manager\/sessions\/(a|b)\/attendance$/.exec(path);
      if (match?.[1]) {
        const pending = deferred<AttendanceSessionReview>();
        reviews.set(match[1], pending);
        return pending.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("không tải lại danh sách khi chọn buổi khác và không hiện dữ liệu cũ đến muộn", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(reviews.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn buổi học đã kết thúc" }), { target: { value: "b" } });
    await waitFor(() => expect(reviews.has("b")).toBe(true));

    await act(async () => reviews.get("b")!.resolve(makeReview("b")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();
    await act(async () => reviews.get("a")!.resolve(makeReview("a")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();
    expect(screen.queryByText("learner-a")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([path]) => path === "/sessions")).toHaveLength(1);
  });

  it("không thông báo lỗi từ yêu cầu điểm danh đã bị thay thế", async () => {
    render(<AttendancePage />);
    await waitFor(() => expect(reviews.has("a")).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn buổi học đã kết thúc" }), { target: { value: "b" } });
    await waitFor(() => expect(reviews.has("b")).toBe(true));

    await act(async () => reviews.get("a")!.reject(new Error("Stale review failure")));
    await act(async () => reviews.get("b")!.resolve(makeReview("b")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
