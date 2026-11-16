import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuideScreen } from "@/features/guide/guide-screen";

const useAppMock = vi.fn();

vi.mock("@/providers/app-provider", () => ({
  useApp: () => useAppMock(),
}));

vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value }),
}));

describe("GuideScreen", () => {
  beforeEach(() => {
    useAppMock.mockReset();
    useAppMock.mockReturnValue({
      session: { roleCode: "INSTRUCTOR", user: { id: "gv-1", name: "Hoàng Thanh Mai" } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("tự động chọn đúng tab hướng dẫn theo vai trò đang đăng nhập và cho phép chuyển tab", () => {
    render(<GuideScreen />);

    expect(screen.getByRole("tab", { name: "Giáo viên" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Ngân hàng câu hỏi LaTeX và quét ảnh đề OCR" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Mở Ngân hàng câu hỏi" })).toHaveAttribute("href", "/questions");
    expect(screen.getByRole("link", { name: "Mở trang Học Liệu" })).toHaveAttribute("href", "/materials");

    fireEvent.click(screen.getByRole("tab", { name: "Quản trị hệ thống" }));
    expect(screen.getByRole("tab", { name: "Quản trị hệ thống" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Vận hành, Nhật ký Audit, Sao lưu & Khôi phục" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Mở Vận hành & tuân thủ" })).toHaveAttribute("href", "/admin/operations");
  });

  it("lọc hướng dẫn theo từ khóa, hiển thị trạng thái rỗng khi không khớp và đặt lại tìm kiếm", () => {
    render(<GuideScreen />);

    const searchInput = screen.getByRole("textbox", { name: "Tìm kiếm hướng dẫn" });
    fireEvent.change(searchInput, { target: { value: "LaTeX" } });

    expect(screen.getByRole("heading", { name: "Ngân hàng câu hỏi LaTeX và quét ảnh đề OCR" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Quản lý lớp học và lịch giảng dạy Google Meet" })).not.toBeInTheDocument();
    expect(screen.getByText(/Hãy bấm nút Xem giao diện trên hộp thoại chỉnh sửa/)).toBeVisible();

    fireEvent.change(searchInput, { target: { value: "khong-ton-tai-abc" } });
    expect(screen.getByText("Không tìm thấy hướng dẫn phù hợp với từ khóa hiện tại.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Xem toàn bộ hướng dẫn" }));
    expect(searchInput).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Quản lý lớp học và lịch giảng dạy Google Meet" })).toBeVisible();
  });

  it("đóng mở câu hỏi thường gặp và liên kết tới trang Hỗ trợ", () => {
    useAppMock.mockReturnValue({
      session: { roleCode: "LEARNER", user: { id: "hv-1", name: "Nguyễn An" } },
    });
    render(<GuideScreen />);

    const faqButton = screen.getByRole("button", {
      name: "Tại sao bấm vào buổi học nhưng chưa vào được phòng họp?",
    });
    expect(faqButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(faqButton);
    expect(faqButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Buổi học cần có link Google Meet hợp lệ/)).toBeVisible();

    fireEvent.click(faqButton);
    expect(faqButton).toHaveAttribute("aria-expanded", "false");

    expect(screen.getByRole("link", { name: "Gửi yêu cầu hỗ trợ" })).toHaveAttribute("href", "/support");
    expect(screen.getByRole("link", { name: "Mở trang Hỗ trợ" })).toHaveAttribute("href", "/support");
  });
});
