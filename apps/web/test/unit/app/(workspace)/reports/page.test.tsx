import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassProgressReport, ClassRoster, OperationalReport } from "@/lib/learning-types";
import ReportsPage from "../../../../../src/app/(workspace)/reports/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock, downloadApiFile: vi.fn() }));
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
    <option value="">Tất cả</option>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));

const classes = ["a", "b"].map((id) => ({
  classId: id, classCode: `CLASS-${id}`, className: `Class ${id}`, learners: 1,
  instructors: 1, publishedMaterials: 0, exams: 0, submittedAttempts: 0,
  averageScore: 0, sessions: 0, attendanceRate: 0, status: "ACTIVE",
}));

const overview: OperationalReport = {
  courses: 1, classes: 2, activeClasses: 2, learners: 2, materials: 0,
  publishedMaterials: 0, questions: 0, exams: 0, liveSessions: 0,
  openReports: 0, openTickets: 0, generatedAt: "2026-10-31T00:00:00Z",
  definitionVersion: "1", timezone: "Asia/Bangkok", metricDefinitions: {},
};

// Tạo promise có thể giải quyết theo thứ tự bất kỳ để kiểm tra kết quả API đến muộn.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

// Tạo dữ liệu tiến độ đủ để nhận diện lớp đang hiển thị trên màn hình.
function makeProgress(classId: string): ClassProgressReport {
  return {
    classId, classCode: `CLASS-${classId}`, from: "2026-01-01", to: "2026-10-31",
    thresholds: { attendanceBelow: 70, scoreBelow: 50, completionBelow: 60 },
    learners: [{
      learnerId: `learner-${classId}`, materialCompletionRate: 50,
      assessmentCompletionRate: 50, attendanceRate: 50, averageScore: 50,
      riskLevel: "LOW", riskReasons: [], interventions: [],
    }],
    generatedAt: "2026-10-31T00:00:00Z",
  };
}

describe("ReportsPage request lifecycle", () => {
  const progressRequests = new Map<string, ReturnType<typeof deferred<ClassProgressReport>>>();
  let overviewRequest: ReturnType<typeof deferred<OperationalReport>>;

  beforeEach(() => {
    progressRequests.clear();
    overviewRequest = deferred<OperationalReport>();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/reports/operations?")) return overviewRequest.promise;
      if (path === "/reports/classes") return Promise.resolve(classes);
      if (path === "/manager/reports/exports") return Promise.resolve([]);
      if (path.includes("/progress?")) {
        const classId = path.split("/")[3];
        if (!classId) throw new Error(`Class ID missing from ${path}`);
        const pending = deferred<ClassProgressReport>();
        progressRequests.set(classId, pending);
        return pending.promise;
      }
      if (path.endsWith("/roster")) {
        const classId = path.split("/")[3];
        if (!classId) throw new Error(`Class ID missing from ${path}`);
        return Promise.resolve({ classId, instructors: [], enrollments: [], history: [] } satisfies ClassRoster);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  // Chờ một request lớp thực sự bắt đầu trước khi thao tác tiếp.
  async function pendingProgress(classId: string) {
    await waitFor(() => expect(progressRequests.has(classId)).toBe(true));
    return progressRequests.get(classId)!;
  }

  it("ignores stale progress when selecting a different class", async () => {
    render(<ReportsPage />);
    await act(async () => overviewRequest.resolve(overview));
    const old = await pendingProgress("a");
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp cần theo dõi" }), { target: { value: "b" } });
    const latest = await pendingProgress("b");

    await act(async () => latest.resolve(makeProgress("b")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();

    await act(async () => old.resolve(makeProgress("a")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();
    expect(screen.queryByText("learner-a")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores an obsolete progress error after the class changes", async () => {
    render(<ReportsPage />);
    await act(async () => overviewRequest.resolve(overview));
    const old = await pendingProgress("a");
    fireEvent.change(screen.getByRole("combobox", { name: "Tìm và chọn lớp cần theo dõi" }), { target: { value: "b" } });
    const latest = await pendingProgress("b");

    await act(async () => old.reject(new Error("Old progress request failed")));
    await act(async () => latest.resolve(makeProgress("b")));
    expect(screen.getByText("learner-b")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not notify for a late overview failure after unmount", async () => {
    const page = render(<ReportsPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining("/reports/operations?"), expect.anything()));
    page.unmount();
    await act(async () => overviewRequest.reject(new Error("Unmounted report request failed")));
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
