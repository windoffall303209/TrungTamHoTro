import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstructorClassWorkspace } from "@/roles/instructor/class/instructor-class-workspace";
import type { LearningClass } from "@/lib/learning-types";

const { request, push, notify } = vi.hoisted(() => ({ request: vi.fn(), push: vi.fn(), notify: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", () => ({ apiRequest: request, downloadApiFile: vi.fn(), previewApiFile: vi.fn() }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ notify, session: { roleCode: "INSTRUCTOR", user: { id: "teacher", name: "GV" }, permissions: [] } }),
}));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ locale: "vi-VN", t: (text: string) => text }) }));

const classItem: LearningClass = {
  id: "class-1",
  code: "A1",
  name: "Lớp A1",
  courseId: "course-1",
  courseVersion: 1,
  term: "HK1",
  startAt: "2026-01-01",
  endAt: "2026-12-31",
  capacity: 20,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  allowLateEnrollment: true,
  instructorIds: ["teacher"],
  learnerIds: ["learner-1"],
};

const quizQuestion = {
  id: "q1",
  courseId: "course-1",
  type: "SINGLE_CHOICE",
  content: "Câu hỏi kiểm tra trắc nghiệm?",
  options: ["Đáp án đúng", "Đáp án nhiễu"],
  correctAnswers: ["Đáp án đúng"],
  difficulty: 1,
  tags: [],
  status: "PUBLISHED",
  version: 1,
};

const sampleExam = {
  id: "quiz",
  title: "Đề kiểm tra chương một",
  classId: "class-1",
  questionIds: ["q1"],
  totalScore: 10,
  durationMinutes: 15,
  attemptLimit: 2,
  openAt: "2026-01-01T00:00:00Z",
  closeAt: "2026-11-30T10:00:00Z",
  hidden: false,
  version: 1,
};

const sampleEssay = {
  id: "essay-1",
  classId: "class-1",
  title: "Bài tập tự luận chương 1",
  description: "Ngắn",
  instructions: "Viết báo cáo kiến trúc tối thiểu 2 trang",
  dueAt: "2026-12-20T10:00:00Z",
  maxScore: 10,
  rubric: [{ id: "r1", title: "Nội dung", description: "Đầy đủ ý", maxPoints: 10 }],
  hidden: false,
  version: 1,
};

function setupApiMock(options?: { withEssay?: boolean; withAttempts?: boolean }) {
  const withEssay = options?.withEssay ?? false;
  const withAttempts = options?.withAttempts ?? false;
  request.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
    if (url.includes("/folders")) return { assignments: [], materials: [], lectures: [] };
    if (url.startsWith("/materials/search")) return { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 };
    if (url.startsWith("/exams/page?")) {
      expect(new URLSearchParams(url.split("?")[1]).get("classId")).toBe(classItem.id);
      return { items: [sampleExam], page: 1, pageSize: 100, total: 1 };
    }
    if (url === `/academic/assignments?classId=${classItem.id}`) {
      return withEssay ? [sampleEssay] : [];
    }
    if (url === `/instructor/classes/${classItem.id}/learners`) {
      return [{ id: "learner-1", displayName: "Nguyễn Văn A", email: "a@test.local", roleCode: "LEARNER" }];
    }
    if (url === "/instructor/assignments/essay-1/submissions" || url === "/academic/assignments/essay-1/submissions") {
      return [
        {
          id: "sub-1",
          assignmentId: "essay-1",
          learnerId: "learner-1",
          submittedAt: "2026-11-10T08:00:00Z",
          textAnswer: "Bài nộp mẫu của học viên",
          status: "GRADED",
          score: 8.5,
          feedback: "Tốt",
        },
      ];
    }
    if (url === "/instructor/exams/quiz/preview") return [quizQuestion];
    if (url === "/instructor/exam-attempts?examId=quiz") {
      return withAttempts
        ? [
            {
              id: "att-1",
              examId: "quiz",
              learnerId: "learner-1",
              status: "GRADED",
              score: 10,
              startedAt: "2026-11-10T09:00:00Z",
              submittedAt: "2026-11-10T09:05:00Z",
              answers: { q1: ["Đáp án đúng"] },
            },
          ]
        : [];
    }
    if (url === "/instructor/exams/quiz/visibility" && init?.method === "PATCH") {
      return { hidden: true, version: 2 };
    }
    if (url === "/instructor/exams/quiz" && init?.method === "PATCH") {
      return { ...sampleExam, title: "Đề kiểm tra đã sửa", version: 2 };
    }
    if (url === "/instructor/exams/quiz" && init?.method === "DELETE") {
      return { ok: true };
    }
    if (url === "/instructor/assignments/essay-1" && init?.method === "PATCH") {
      return { ...sampleEssay, title: "Tự luận chương 1 (đã sửa)", version: 2 };
    }
    return [];
  });
}

describe("Tab Bài tập trong không gian lớp học giảng viên", () => {
  beforeEach(() => {
    request.mockReset();
    push.mockReset();
    notify.mockReset();
    window.history.replaceState({}, "", "/?tab=assignments");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("hiển thị đủ 6 nút hành động và xem đề trắc nghiệm trực tiếp trong lớp mà không nhảy sang /exams", async () => {
    setupApiMock();
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    fireEvent.click(await screen.findByRole("button", { name: /Đề kiểm tra chương một/ }));
    for (const label of ["Loại", "Hạn nộp", "Điểm tối đa", "Thời lượng"]) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(screen.queryByText(/Chưa có bài tập nào/)).not.toBeInTheDocument();

    for (const action of ["Xem bài tập", "Xem chi tiết", "Làm thử", "Chỉnh sửa bài tập"]) {
      expect(screen.getByRole("button", { name: action })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: "Ẩn bài tập" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Xóa bài tập" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Xem bài tập" }));
    expect(push).not.toHaveBeenCalled();

    const previewDialog = await screen.findByRole("dialog", { name: /Đề kiểm tra chương một/ });
    expect(within(previewDialog).getByText("Câu hỏi kiểm tra trắc nghiệm?")).toBeVisible();
    expect(within(previewDialog).getByText("Đáp án đúng")).toBeVisible();
  });

  it("phân tách Xem đề và Xem chi tiết cho bài tập tự luận", async () => {
    setupApiMock({ withEssay: true });
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    fireEvent.click(await screen.findByRole("button", { name: /Bài tập tự luận chương 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Xem bài tập" }));
    expect(push).not.toHaveBeenCalled();

    const previewDialog = await screen.findByRole("dialog", { name: /Bài tập tự luận chương 1/ });
    expect(within(previewDialog).getByText("Viết báo cáo kiến trúc tối thiểu 2 trang")).toBeVisible();
    expect(within(previewDialog).queryByText("Bảng điểm")).not.toBeInTheDocument();

    fireEvent.click(within(previewDialog).getByRole("button", { name: "Đóng xem đề bài tự luận" }));
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết" }));

    expect(await screen.findByText("Nguyễn Văn A")).toBeVisible();
    expect(screen.getByText(/8\.5\s*\/\s*10/)).toBeVisible();
  });

  it("mở bảng điểm trắc nghiệm ở Xem chi tiết và chấm làm thử không lưu DB", async () => {
    setupApiMock({ withAttempts: true });
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    fireEvent.click(await screen.findByRole("button", { name: /Đề kiểm tra chương một/ }));
    fireEvent.click(screen.getByRole("button", { name: "Xem chi tiết" }));
    expect(await screen.findByText("Nguyễn Văn A")).toBeVisible();
    expect(screen.getByText(/10\s*\/\s*10/)).toBeVisible();

    fireEvent.click(screen.getAllByRole("button", { name: "Bài tập" }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Làm thử" }));

    fireEvent.click(await screen.findByText("Đáp án đúng"));
    expect(screen.queryByRole("button", { name: "Bắt đầu làm thử" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài" }));
    fireEvent.click(await screen.findByRole("button", { name: "Nộp bài ngay" }));

    expect(await screen.findByText("Đã nộp bài")).toBeVisible();
    expect(screen.queryByText(/không lưu lịch sử/i)).not.toBeInTheDocument();
    const scoreTotalLabel = screen.getByText("/ 10 điểm");
    expect(scoreTotalLabel).toBeVisible();
    expect(scoreTotalLabel.parentElement).toHaveTextContent("10/ 10 điểm");
    expect(
      request.mock.calls.some(([url]) => typeof url === "string" && url.includes("/learner/")),
    ).toBe(false);
  });

  it("làm thử bài tập tự luận và chỉnh sửa trực tiếp không vướng description cũ", async () => {
    setupApiMock({ withEssay: true });
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    fireEvent.click(await screen.findByRole("button", { name: /Bài tập tự luận chương 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Làm thử" }));

    const trialDialog = await screen.findByRole("dialog", { name: /Bài tập tự luận chương 1/ });
    expect(trialDialog.parentElement?.className).toContain("w-screen");
    expect(trialDialog.parentElement?.className).toContain("h-dvh");
    expect(screen.queryByText(/không lưu lịch sử/i)).not.toBeInTheDocument();

    const trialBox = within(trialDialog).getByPlaceholderText("Nhập nội dung bài làm thử của bạn...");
    fireEvent.change(trialBox, { target: { value: "Nội dung bài làm thử nghiệm thu" } });
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài thử" }));

    expect(await screen.findByText("Đã nộp bài thử thành công")).toBeVisible();
    expect(screen.queryByText(/lưu vào lịch sử/i)).not.toBeInTheDocument();
    expect(
      request.mock.calls.some(
        ([url, init]) => typeof url === "string" && url.includes("/submissions") && (init as { method?: string } | undefined)?.method === "POST",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    fireEvent.click(screen.getByRole("button", { name: "Chỉnh sửa bài tập" }));

    const titleInput = await screen.findByLabelText(/Tiêu đề bài tập/);
    fireEvent.change(titleInput, { target: { value: "Tự luận chương 1 (đã sửa)" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu bài tập" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/instructor/assignments/essay-1",
        expect.objectContaining({
          method: "PATCH",
        }),
      ),
    );
  });

  it("chỉnh sửa trắc nghiệm trực tiếp, ẩn/hiện và xóa bài tập theo expectedVersion", async () => {
    setupApiMock();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<InstructorClassWorkspace item={classItem} course={null} />);

      fireEvent.click(await screen.findByRole("button", { name: /Đề kiểm tra chương một/ }));
      fireEvent.click(screen.getByRole("button", { name: "Chỉnh sửa bài tập" }));
      expect(push).not.toHaveBeenCalled();

      const examTitle = await screen.findByLabelText(/Tiêu đề bài tập/);
      fireEvent.change(examTitle, { target: { value: "Đề kiểm tra đã sửa" } });
      fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/instructor/exams/quiz",
          expect.objectContaining({ method: "PATCH" }),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Ẩn bài tập" }));
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/instructor/exams/quiz/visibility",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ hidden: true, expectedVersion: 1 }),
          }),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Xóa bài tập" }));
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/instructor/exams/quiz",
          expect.objectContaining({ method: "DELETE" }),
        ),
      );
      expect(confirmSpy).toHaveBeenCalledOnce();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("chỉ tải đề thi khi mở tab Bài tập và tải bảng điểm khi mở tab Bảng điểm", async () => {
    window.history.replaceState({}, "", "/");
    setupApiMock();
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/instructor/classes/${classItem.id}/learners`,
        expect.anything(),
      ),
    );
    expect(request.mock.calls.some(([url]) => String(url).startsWith("/exams/page?"))).toBe(false);
    expect(request.mock.calls.some(([url]) => String(url) === `/academic/classes/${classItem.id}/gradebook`)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Bài tập/ }));
    expect(await screen.findByRole("button", { name: /Đề kiểm tra chương một/ })).toBeVisible();
    expect(request.mock.calls.some(([url]) => String(url).startsWith("/exams/page?"))).toBe(true);
    expect(request.mock.calls.some(([url]) => String(url) === `/academic/classes/${classItem.id}/gradebook`)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Bảng điểm/ }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        `/academic/classes/${classItem.id}/gradebook`,
        expect.anything(),
      ),
    );
  });
});
