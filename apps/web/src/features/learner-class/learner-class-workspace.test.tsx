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
    expect(screen.getAllByText(/Đã làm/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Chưa làm/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Cần xem lại/i)).toBeInTheDocument();
    expect(screen.getByText("Nộp bài")).toBeInTheDocument();
  });

  it("tab Bài tập hiển thị giao diện 3 cột Master-Detail: Thư mục, Danh sách và Bảng chi tiết điểm", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Bài tập"));

    // Cột 1: Cây thư mục
    expect(screen.getByText("Thư mục")).toBeInTheDocument();
    expect(screen.getByText("Tất cả bài tập")).toBeInTheDocument();
    expect(screen.getByText("Toán 1")).toBeInTheDocument();

    // Cột 2: Danh sách có bài tập mẫu
    expect(screen.getByText("Test bài tập")).toBeInTheDocument();

    // Cột 3: Bảng thông số chi tiết
    expect(screen.getByText("Số lần làm bài")).toBeInTheDocument();
    expect(screen.getByText("Lấy điểm")).toBeInTheDocument();
    expect(screen.getByText("Ngày tạo")).toBeInTheDocument();
    expect(screen.getByText("Chi tiết")).toBeInTheDocument();
  });

  it("tab Bài giảng hiển thị giao diện 3 cột với cấu trúc cây thư mục và thông số video", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Bài giảng"));

    expect(screen.getByText("Tất cả bài giảng")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm kiếm bài giảng...")).toBeInTheDocument();
    expect(screen.getAllByText(/Xem bài giảng/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Tiến độ xem")).toBeInTheDocument();
  });

  it("tab Tài liệu hiển thị giao diện 3 cột với cấu trúc thư mục học liệu và thông số tài liệu", () => {
    render(
      <LearnerClassWorkspace
        item={dummyClass}
        course={dummyCourse}
        teacherName="Thầy Nam"
      />
    );

    fireEvent.click(screen.getByText("Tài liệu"));

    expect(screen.getByText("Tất cả tài liệu")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm kiếm tài liệu...")).toBeInTheDocument();
    expect(screen.getAllByText(/Xem trước/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Định dạng")).toBeInTheDocument();
    expect(screen.getByText("Dung lượng")).toBeInTheDocument();
  });
});
