import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearnerClassWorkspace } from "./learner-class-workspace";
import type { LearningClass, Course } from "@/lib/learning-types";

const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

describe("LearnerClassWorkspace", () => {
  const dummyClass: LearningClass = {
    id: "cls-1",
    courseId: "crs-1",
    courseVersion: 1,
    code: "TOAN6A",
    name: "Lớp Toán 6",
    term: "2026-2027",
    startAt: "2026-10-01T00:00:00Z",
    endAt: "2026-12-31T00:00:00Z",
    capacity: 40,
    timezone: "Asia/Bangkok",
    allowLateEnrollment: true,
    status: "ACTIVE",
    instructorIds: ["ins-1"],
    learnerIds: ["lrn-1", "lrn-2"],
  };

  const dummyCourse: Course = {
    id: "crs-1",
    code: "MATH101",
    name: "Toán học cơ bản",
    description: "Khóa học toán nền tảng",
    outcomes: ["Nắm chắc hàm số"],
    version: 1,
    status: "PUBLISHED",
  };

  beforeEach(() => {
    mockRouterPush.mockReset();
  });
  afterEach(cleanup);

  it("hiển thị sidebar lớp học với thông tin lớp, giáo viên và 6 danh mục con", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    expect(screen.getByText("Lớp Toán 6")).toBeInTheDocument();
    expect(screen.getByText("TOAN6A")).toBeInTheDocument();
    expect(screen.getAllByText("Thầy Nam").length).toBeGreaterThan(0);
    expect(screen.getByText("Bảng tin")).toBeInTheDocument();
    expect(screen.getByText("Lịch học")).toBeInTheDocument();
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Bài tập")).toBeInTheDocument();
    expect(screen.getByText("Bài giảng")).toBeInTheDocument();
    expect(screen.getByText("Tài liệu")).toBeInTheDocument();
  });

  it("chuyển sang tab Lịch học và cho phép chuyển đổi chế độ tuần và tháng", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Lịch học"));
    expect(screen.getByText(/Lịch học của Lớp Toán 6/i)).toBeInTheDocument();
    expect(screen.getByText("Dạng tuần (Lưới)")).toBeInTheDocument();

    // Chuyển sang dạng tháng
    fireEvent.click(screen.getByText("Dạng tháng (Danh sách)"));
    expect(screen.getByText(/Buổi 01:/i)).toBeInTheDocument();
  });

  it("tab Thành viên hiển thị danh sách kèm nút Nhắn tin phát sự kiện open-mini-chat", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Thành viên"));
    const chatButtons = screen.getAllByTitle(/Nhắn tin với/i);
    expect(chatButtons.length).toBeGreaterThan(0);

    // Bấm nút Nhắn tin với giáo viên
    fireEvent.click(chatButtons[0]);
    expect(dispatchSpy).toHaveBeenCalled();
    const eventArg = dispatchSpy.mock.calls[0][0] as CustomEvent;
    expect(eventArg.type).toBe("open-mini-chat");
    dispatchSpy.mockRestore();
  });

  it("tab Bài tập cho phép tìm kiếm và mở ExamTakingModal với Question Palette 3 màu", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Bài tập"));
    expect(screen.getByPlaceholderText("Tìm kiếm bài tập...")).toBeInTheDocument();

    const startButtons = screen.getAllByText("Làm bài");
    fireEvent.click(startButtons[0]);

    // Question Palette Grid hiển thị 3 màu chú thích
    expect(screen.getByText(/Đã làm/i)).toBeInTheDocument();
    expect(screen.getByText(/Chưa làm/i)).toBeInTheDocument();
    expect(screen.getByText(/Cần xem lại/i)).toBeInTheDocument();
    expect(screen.getByText("Nộp bài")).toBeInTheDocument();
  });
});
