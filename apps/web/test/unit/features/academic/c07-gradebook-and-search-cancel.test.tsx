import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GradebookResponse, GradebookRow } from "@/lib/learning-types";
import {
  ClassGradebookTable,
  normalizeGradebookResponse,
} from "@/features/academic/class-gradebook-table";
import { useOperationsModel } from "@/features/operations/use-operations-model";
import { useAcademicModel } from "@/features/academic/use-academic-model";
import { exportGradebookCsv } from "@/roles/instructor/class/instructor-class-workspace.helpers";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  notify: vi.fn(),
  roleCode: "SYSTEM_ADMIN" as "SYSTEM_ADMIN" | "INSTRUCTOR",
  permissions: ["system:configure", "exam:manage", "class:view"] as string[],
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: mocks.apiRequest,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    notify: mocks.notify,
    session: {
      sessionId: "sess-c07",
      roleCode: mocks.roleCode,
      permissions: mocks.permissions,
      user: { id: "usr-c07", name: "C07 Tester", email: "c07@wind.edu.vn" },
    },
  }),
}));

vi.mock("@/lib/realtime-client", () => ({
  realtimeClient: { subscribe: vi.fn(() => vi.fn()) },
}));

/** Tạo promise kiểm soát được từ bên ngoài để mô phỏng phản hồi chậm đến sau. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("C07 Compact gradebook payload & search debounce/abort cancellation", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.notify.mockReset();
    mocks.roleCode = "SYSTEM_ADMIN";
    mocks.permissions = ["system:configure", "exam:manage", "class:view"];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("hiển thị đúng bảng điểm và xuất CSV từ payload gọn không lặp assessments trên từng dòng", async () => {
    const payload: GradebookResponse = {
      assessments: [
        { id: "exam-1", kind: "EXAM", title: "Giữa kỳ Toán", maxScore: 10, dueAt: "2026-12-01T00:00:00Z" },
        { id: "asg-1", kind: "ASSIGNMENT", title: "Tự luận 1", maxScore: 10, dueAt: "2026-12-05T00:00:00Z" },
      ],
      rows: [
        {
          learnerId: "lrn-1",
          learnerName: "Nguyễn Minh Anh",
          learnerEmail: "anh@wind.edu.vn",
          examEarned: 9.5,
          examPossible: 10,
          assignmentEarned: 0,
          assignmentPossible: 10,
          totalPercent: 47.5,
          averageScore: 4.75,
          awaitingGrade: 0,
          notSubmitted: 1,
          // Ô asg-1 chưa nộp được lược bỏ ở ma trận thưa, không kèm kind/maxScore.
          cells: [{ assessmentId: "exam-1", score: 9.5, status: "GRADED", attemptCount: 2 }],
        },
        {
          learnerId: "lrn-2",
          learnerName: "Trần Quốc Bảo",
          learnerEmail: "bao@wind.edu.vn",
          examEarned: 0,
          examPossible: 0,
          assignmentEarned: 8,
          assignmentPossible: 10,
          totalPercent: 80,
          averageScore: 8,
          awaitingGrade: 0,
          notSubmitted: 0,
          cells: [{ assessmentId: "asg-1", score: 8, status: "GRADED" }],
        },
      ],
    };

    const normalized = normalizeGradebookResponse(payload);
    // Mô phỏng phân trang sang trang 2 (chỉ truyền hàng thứ 2, không có assessments trong row).
    render(
      <ClassGradebookTable
        rows={[normalized.rows[1]!]}
        assessments={normalized.assessments}
      />,
    );

    expect(screen.getByText("Giữa kỳ Toán")).toBeInTheDocument();
    expect(screen.getByText("Tự luận 1")).toBeInTheDocument();
    expect(screen.getByText("Trần Quốc Bảo")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();

    // Kiểm tra xuất CSV với mảng assessments rời và ô khuyết map thành "Chưa nộp".
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:c07-gradebook";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    exportGradebookCsv(normalized.rows, "Toan 10A", normalized.assessments);
    expect(blobs).toHaveLength(1);
    const csv = await blobs[0]!.text();
    expect(csv).toContain("Giữa kỳ Toán (/10)");
    expect(csv).toContain("Tự luận 1 (/10)");
    expect(csv).toContain("9.5");
    expect(csv).toContain("Chưa nộp");
  });

  it("useOperationsModel debounce gõ tìm nhật ký và hủy request cũ bằng AbortSignal để kết quả cũ không ghi đè mới", async () => {
    vi.useFakeTimers();
    const firstSlow = deferred<{ items: Array<{ id: string; action: string; actorName: string; target: string; createdAt: string }>; total: number; page: number; pageSize: number; totalPages: number }>();
    const secondFast = deferred<{ items: Array<{ id: string; action: string; actorName: string; target: string; createdAt: string }>; total: number; page: number; pageSize: number; totalPages: number }>();
    const signals: Array<AbortSignal | undefined> = [];

    mocks.apiRequest.mockImplementation((path: string, options?: { signal?: AbortSignal }) => {
      signals.push(options?.signal);
      if (path.includes("query=login")) return firstSlow.promise;
      if (path.includes("query=grade")) return secondFast.promise;
      return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
    });

    const { result } = renderHook(() => useOperationsModel("monitoring"));

    // Gõ nhanh 3 ký tự liên tiếp chỉ kích hoạt 1 request duy nhất sau debounce 250ms.
    act(() => {
      result.current.setQuery("l");
      result.current.setQuery("lo");
      result.current.setQuery("login");
    });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    // Đổi sang truy vấn mới khi request đầu còn đang bay -> phải abort request cũ.
    act(() => {
      result.current.setQuery("grade");
    });
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    expect(mocks.apiRequest).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    // Kết quả mới về trước, sau đó kết quả cũ chậm mới resolve -> tuyệt đối không ghi đè.
    await act(async () => {
      secondFast.resolve({
        items: [{ id: "aud-new", action: "GRADE_UPDATED", actorName: "GV", target: "sub-1", createdAt: "2026-11-25T10:00:00Z" }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      await Promise.resolve();
    });
    expect(result.current.audit.map((a) => a.id)).toEqual(["aud-new"]);

    await act(async () => {
      firstSlow.resolve({
        items: [{ id: "aud-old", action: "LOGIN", actorName: "Old", target: "u-1", createdAt: "2026-11-25T09:00:00Z" }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      await Promise.resolve();
    });
    expect(result.current.audit.map((a) => a.id)).toEqual(["aud-new"]);
  });

  it("useAcademicModel chuẩn hóa payload sổ điểm mới và hủy request sổ điểm cũ qua AbortSignal khi đổi lớp nhanh", async () => {
    mocks.roleCode = "INSTRUCTOR";
    mocks.permissions = ["exam:manage", "class:view"];

    const slowClassA = deferred<GradebookResponse>();
    const gradeSignals: Array<AbortSignal | undefined> = [];
    const makeResponse = (learnerId: string, colTitle: string): GradebookResponse => ({
      assessments: [{ id: `col-${learnerId}`, kind: "EXAM", title: colTitle, maxScore: 10 }],
      rows: [
        {
          learnerId,
          learnerName: `HV ${learnerId}`,
          learnerEmail: `${learnerId}@wind.edu.vn`,
          examEarned: 9,
          examPossible: 10,
          assignmentEarned: 0,
          assignmentPossible: 0,
          totalPercent: 90,
          averageScore: 9,
          awaitingGrade: 0,
          notSubmitted: 0,
          cells: [{ assessmentId: `col-${learnerId}`, score: 9, status: "GRADED" }],
        } as GradebookRow,
      ],
    });

    mocks.apiRequest.mockImplementation((path: string, options?: { signal?: AbortSignal }) => {
      if (path === "/classes") return Promise.resolve([{ id: "cls-a", code: "A", name: "Lớp A" }, { id: "cls-b", code: "B", name: "Lớp B" }]);
      if (path === "/academic/calendar" || path === "/academic/announcements") return Promise.resolve([]);
      if (path.startsWith("/academic/assignments/page")) return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 });
      if (path === "/academic/classes/cls-a/gradebook") {
        gradeSignals.push(options?.signal);
        return slowClassA.promise;
      }
      if (path === "/academic/classes/cls-b/gradebook") {
        gradeSignals.push(options?.signal);
        return Promise.resolve(makeResponse("lrn-b", "Đề lớp B"));
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useAcademicModel());
    await waitFor(() => expect(gradeSignals).toHaveLength(1));
    expect(gradeSignals[0]?.aborted).toBe(false);

    // Đổi ngay sang lớp B trong khi sổ điểm lớp A còn đang tải.
    await act(async () => {
      await result.current.changeClass("cls-b");
    });

    expect(gradeSignals[0]?.aborted).toBe(true);
    expect(result.current.gradebook.map((r) => r.learnerId)).toEqual(["lrn-b"]);
    expect(result.current.gradebookAssessments.map((c) => c.title)).toEqual(["Đề lớp B"]);

    // Phản hồi lớp A trễ về sau không ghi đè cả rows lẫn assessments của lớp B.
    await act(async () => {
      slowClassA.resolve(makeResponse("lrn-a", "Đề lớp A"));
      await Promise.resolve();
    });
    expect(result.current.gradebook.map((r) => r.learnerId)).toEqual(["lrn-b"]);
    expect(result.current.gradebookAssessments.map((c) => c.title)).toEqual(["Đề lớp B"]);
  });
});
