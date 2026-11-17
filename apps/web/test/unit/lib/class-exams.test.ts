import { describe, expect, it, vi } from "vitest";
import type { Exam } from "@/lib/learning-types";
import { loadClassExams } from "@/lib/class-exams";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: mockApiRequest,
}));

// Tạo đề thi giả lập phục vụ kiểm thử tải phân trang song song.
function makeExam(index: number, classId = "class-1"): Exam {
  return {
    id: `exam-${index}`,
    classId,
    title: `Đề thi số ${index}`,
    questionIds: ["q-1"],
    totalScore: 10,
    durationMinutes: 15,
    attemptLimit: 1,
    openAt: "2026-01-01T00:00:00Z",
    closeAt: "2026-12-31T23:59:59Z",
    status: "PUBLISHED",
    hidden: false,
    version: 1,
  };
}

// Tạo danh sách gồm nhiều phần tử giả lập cho một trang API.
function makePageItems(startIndex: number, count: number): Exam[] {
  return Array.from({ length: count }, (_, offset) => makeExam(startIndex + offset));
}

describe("loadClassExams", () => {
  it("gọi onProgress ngay sau trang đầu tiên (1 RTT) trước khi các trang sau hoàn tất", async () => {
    mockApiRequest.mockReset();
    let releasePage2!: (value: { items: Exam[]; total: number; pageSize: number; page: number }) => void;
    const page2Promise = new Promise<{ items: Exam[]; total: number; pageSize: number; page: number }>((resolve) => {
      releasePage2 = resolve;
    });

    mockApiRequest.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 1) {
        return { items: makePageItems(1, 100), total: 101, pageSize: 100, page: 1 };
      }
      return page2Promise;
    });

    const controller = new AbortController();
    const progressSnapshots: number[] = [];
    const loadPromise = loadClassExams("class-1", "INSTRUCTOR", controller.signal, {
      onProgress: (exams) => progressSnapshots.push(exams.length),
    });

    await vi.waitFor(() => {
      expect(progressSnapshots).toEqual([100]);
    });

    releasePage2({ items: [makeExam(101)], total: 101, pageSize: 100, page: 2 });
    const allExams = await loadPromise;
    expect(allExams).toHaveLength(101);
    expect(progressSnapshots).toEqual([100, 101]);
  });

  it("tải song song có giới hạn concurrency đối với lớp có 501 đề (6 trang)", async () => {
    mockApiRequest.mockReset();
    let inFlight = 0;
    let maxInFlight = 0;

    mockApiRequest.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const count = page === 6 ? 1 : 100;
      return {
        items: makePageItems((page - 1) * 100 + 1, count),
        total: 501,
        pageSize: 100,
        page,
      };
    });

    const controller = new AbortController();
    const exams = await loadClassExams("class-1", "INSTRUCTOR", controller.signal, { concurrency: 4 });
    expect(exams).toHaveLength(501);
    expect(mockApiRequest).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("dừng tải các đợt tiếp theo khi AbortSignal bị hủy", async () => {
    mockApiRequest.mockReset();
    const controller = new AbortController();

    mockApiRequest.mockImplementation(async (url: string) => {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      if (page === 1) {
        return { items: makePageItems(1, 100), total: 650, pageSize: 100, page: 1 };
      }
      controller.abort();
      return { items: makePageItems((page - 1) * 100 + 1, 100), total: 650, pageSize: 100, page };
    });

    const exams = await loadClassExams("class-1", "INSTRUCTOR", controller.signal, { concurrency: 2 });
    expect(exams).toHaveLength(100);
    // Chỉ gọi trang 1 + batch đầu tiên (trang 2, 3), không gọi sang batch trang 4..7.
    expect(mockApiRequest).toHaveBeenCalledTimes(3);
  });
});
