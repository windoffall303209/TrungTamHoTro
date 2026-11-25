import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, LearningClass } from "@/lib/learning-types";
import { InstructorClassWorkspace } from "@/roles/instructor/class/instructor-class-workspace";
import { LearnerClassWorkspace } from "@/roles/learner/class/learner-class-workspace";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  roleCode: "INSTRUCTOR" as "INSTRUCTOR" | "LEARNER",
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/api-client", () => ({
  apiRequest: mocks.request,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    notify: mocks.notify,
    session: {
      roleCode: mocks.roleCode,
      user: { id: "user-1", name: "GV Kiểm thử" },
      permissions: [],
    },
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }),
}));

/** Tạo lớp học mẫu cho phép kiểm tra tách request theo từng tab và đổi lớp không dính dữ liệu cũ. */
function makeClass(id: string): LearningClass {
  return {
    id,
    code: id.toUpperCase(),
    name: `Lớp ${id}`,
    courseId: "course-1",
    courseVersion: 1,
    term: "HK1",
    startAt: "2026-01-01T00:00:00Z",
    endAt: "2026-12-31T00:00:00Z",
    capacity: 30,
    timezone: "Asia/Bangkok",
    status: "ACTIVE",
    allowLateEnrollment: true,
    instructorIds: ["user-1"],
    learnerIds: ["learner-1"],
  };
}

/** Tạo danh sách N bài tập tự luận có sẵn submissionCount từ backend để kiểm chứng xóa N+1. */
function makeAssignments(classId: string, count: number): Assignment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${classId}-asg-${index + 1}`,
    classId,
    classCode: classId.toUpperCase(),
    title: `Bài tập ${index + 1} (${classId})`,
    description: "Mô tả ngắn",
    instructions: "Hướng dẫn",
    dueAt: "2026-12-20T10:00:00Z",
    maxScore: 10,
    rubric: [{ id: "r1", title: "Tiêu chí", description: "Đủ ý", maxPoints: 10 }],
    status: "PUBLISHED",
    version: 1,
    createdById: "user-1",
    submissionCount: index + 2,
    createdAt: `2026-11-0${index + 1}T08:00:00Z`,
  }));
}

describe("Class page request waterfall and tab-scoped loading (C05)", () => {
  beforeEach(() => {
    mocks.request.mockReset();
    mocks.push.mockReset();
    mocks.notify.mockReset();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/courses/classes/cls-1");
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("giảng viên mở tab mặc định Bảng tin chỉ gọi 1 API bảng tin (tổng <= 3 kèm useClassDetailModel) và xóa N+1 submissions", async () => {
    mocks.roleCode = "INSTRUCTOR";
    const assignments = makeAssignments("cls-1", 5);
    mocks.request.mockImplementation(async (url: string) => {
      if (url.startsWith("/academic/announcements?classId=")) return [];
      if (url.startsWith("/instructor/classes/cls-1/folders")) return { assignments: [], lectures: [], materials: [] };
      if (url === "/instructor/classes/cls-1/learners") {
        return [{ id: "l-1", displayName: "Học viên 1", email: "l1@test.local", roleCode: "LEARNER" }];
      }
      if (url === "/academic/assignments?classId=cls-1") return assignments;
      if (url.startsWith("/exams/page?")) return { items: [], page: 1, pageSize: 20, total: 0 };
      if (url.startsWith("/instructor/assignments/") && url.endsWith("/submissions")) {
        return [{ id: "sub-1", assignmentId: "cls-1-asg-1", learnerId: "l-1", status: "SUBMITTED" }];
      }
      if (url.startsWith("/materials/search")) return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
      throw new Error(`Unexpected eager request: ${url}`);
    });

    render(<InstructorClassWorkspace item={makeClass("cls-1")} course={null} />);
    await screen.findByText("Lớp chưa có thông báo nào.");

    const initialUrls = mocks.request.mock.calls.map(([u]) => String(u));
    expect(initialUrls).toEqual(["/academic/announcements?classId=cls-1"]);

    // Chuyển sang tab Bài tập: chỉ tải dữ liệu của tab Bài tập và tối đa 1 request /submissions cho bài đang chọn.
    mocks.request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Bài tập" }));
    await screen.findByRole("button", { name: /Bài tập 5 \(cls-1\)/ });

    await waitFor(() => {
      const submissionCalls = mocks.request.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.includes("/submissions"));
      expect(submissionCalls).toHaveLength(1);
    });
    const assignmentTabUrls = mocks.request.mock.calls.map(([u]) => String(u));
    expect(assignmentTabUrls.some((u) => u === "/instructor/classes")).toBe(false);
    expect(assignmentTabUrls.some((u) => u.startsWith("/materials/search"))).toBe(false);
    // Thẻ bài tập khác vẫn hiển thị đúng submissionCount từ backend mà không gọi N+1.
    expect(screen.getByText("6/1 đã nộp")).toBeInTheDocument();
  });

  it("học viên mở tab mặc định Bảng tin chỉ gọi 1 API bảng tin và chỉ tải dữ liệu từng tab khi chuyển tab", async () => {
    mocks.roleCode = "LEARNER";
    mocks.request.mockImplementation(async (url: string) => {
      if (url.startsWith("/academic/announcements?classId=")) return [];
      if (url === "/learner/classes/cls-1/exams") return [];
      if (url === "/academic/assignments?classId=cls-1") return [];
      if (url === "/learner/results") return [];
      if (url.startsWith("/materials/search")) return { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 };
      if (url === "/sessions") return [];
      throw new Error(`Unexpected eager learner request: ${url}`);
    });

    const { rerender } = render(
      <LearnerClassWorkspace item={makeClass("cls-1")} course={null} teacherName="GV" />,
    );
    await screen.findByText("Lớp chưa có thông báo nào.");

    expect(mocks.request.mock.calls.map(([u]) => String(u))).toEqual([
      "/academic/announcements?classId=cls-1",
    ]);

    mocks.request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Tài liệu/ }));
    await waitFor(() => {
      expect(mocks.request.mock.calls.some(([u]) => String(u).startsWith("/materials/search"))).toBe(true);
    });
    expect(mocks.request.mock.calls.some(([u]) => String(u) === "/sessions")).toBe(false);
    expect(mocks.request.mock.calls.some(([u]) => String(u) === "/learner/results")).toBe(false);

    // Đổi sang lớp khác phải nạp dữ liệu lớp mới thay vì giữ dữ liệu cũ.
    mocks.request.mockClear();
    rerender(<LearnerClassWorkspace item={makeClass("cls-2")} course={null} teacherName="GV" />);
    await waitFor(() => {
      expect(mocks.request.mock.calls.some(([u]) => String(u).includes("classId=cls-2"))).toBe(true);
    });
  });
});
