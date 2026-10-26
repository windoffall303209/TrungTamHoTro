import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiniChatWidget } from "./mini-chat-widget";

const useApp = vi.fn();

vi.mock("@/providers/app-provider", () => ({
  useApp: () => useApp(),
}));

describe("MiniChatWidget", () => {
  beforeEach(() => {
    useApp.mockReturnValue({
      session: {
        user: { id: "learner-test", name: "Nguyễn Văn Test" },
        roleCode: "LEARNER",
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hiển thị nút Logo Chat và các bong bóng avatar thu gọn kèm số tin nhắn chưa đọc", () => {
    render(<MiniChatWidget />);

    // Nút logo chat
    const logoButton = screen.getByTitle("Soạn tin nhắn mới");
    expect(logoButton).toBeInTheDocument();

    // Bong bóng avatar ban đầu có bạn Phạm Ánh Hải và bạn Nguyễn Thảo My
    expect(screen.getByTitle("Mở chat với Phạm Ánh Hải")).toBeInTheDocument();
    expect(screen.getByTitle("Mở chat với Nguyễn Thảo My")).toBeInTheDocument();

    // Có chỉ số tin nhắn chưa đọc là 1 trên avatar Thảo My
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("cho phép xóa bong bóng avatar khi bấm nút x", () => {
    render(<MiniChatWidget />);

    const closeButtons = screen.getAllByTitle("Tắt cuộc trò chuyện");
    expect(closeButtons.length).toBeGreaterThan(0);

    // Bấm xóa bubble đầu tiên
    fireEvent.click(closeButtons[0]);
    expect(screen.queryByTitle("Mở chat với Phạm Ánh Hải")).not.toBeInTheDocument();
  });

  it("click vào avatar thu nhỏ sẽ mở ô chat mini và xóa khỏi danh sách bubble", () => {
    render(<MiniChatWidget />);

    const bubbleButton = screen.getByTitle("Mở chat với Phạm Ánh Hải");
    fireEvent.click(bubbleButton);

    // Bubble đã được mở thành ô chat
    expect(screen.queryByTitle("Mở chat với Phạm Ánh Hải")).not.toBeInTheDocument();
    expect(screen.getAllByText("Phạm Ánh Hải").length).toBeGreaterThan(0);

    // Có nút thu nhỏ và đóng ô chat
    expect(screen.getByTitle("Thu nhỏ ô chat thành avatar")).toBeInTheDocument();
    expect(screen.getByTitle("Đóng ô chat")).toBeInTheDocument();
  });

  it("mở khung chọn người nhắn khi bấm nút Logo Chat và chọn người để mở ô chat", () => {
    render(<MiniChatWidget />);

    const logoButton = screen.getByTitle("Soạn tin nhắn mới");
    fireEvent.click(logoButton);

    // Hiển thị khung chọn người nhắn
    expect(screen.getByText("Tin nhắn mới")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm kiếm theo tên hoặc vai trò...")).toBeInTheDocument();

    // Chọn giáo viên Hà Thị Lý
    const teacherButton = screen.getByRole("button", { name: /Hà Thị Lý/i });
    fireEvent.click(teacherButton);

    // Khung chọn người đóng và ô chat Hà Thị Lý mở ra
    expect(screen.queryByText("Tin nhắn mới")).not.toBeInTheDocument();
    expect(screen.getAllByText("Hà Thị Lý").length).toBeGreaterThan(0);
  });

  it("hỗ trợ gửi tin nhắn và gửi like nhanh trong ô chat", () => {
    render(<MiniChatWidget />);

    // Mở chat với Phạm Ánh Hải
    fireEvent.click(screen.getByTitle("Mở chat với Phạm Ánh Hải"));

    const input = screen.getByPlaceholderText("Aa");
    fireEvent.change(input, { target: { value: "Chào bạn Hải nhé!" } });

    const sendButton = screen.getByTitle("Gửi tin nhắn");
    fireEvent.click(sendButton);

    expect(screen.getByText("Chào bạn Hải nhé!")).toBeInTheDocument();

    // Gửi like nhanh
    const likeButton = screen.getByTitle("Gửi Like nhanh");
    fireEvent.click(likeButton);

    expect(screen.getAllByText("👍").length).toBeGreaterThan(0);
  });

  it("cho phép mở tối đa 2 ô chat và thu nhỏ ô chat thành avatar trên logo", () => {
    render(<MiniChatWidget />);

    // Mở ô 1 từ bubble
    fireEvent.click(screen.getByTitle("Mở chat với Phạm Ánh Hải"));
    expect(screen.getAllByText("Phạm Ánh Hải").length).toBeGreaterThan(0);

    // Mở ô 2 từ bubble Thảo My
    fireEvent.click(screen.getByTitle("Mở chat với Nguyễn Thảo My"));
    expect(screen.getAllByText("Nguyễn Thảo My").length).toBeGreaterThan(0);

    // Cả 2 ô chat đều đang mở
    const minimizeButtons = screen.getAllByTitle("Thu nhỏ ô chat thành avatar");
    expect(minimizeButtons.length).toBe(2);

    // Thu nhỏ ô chat đầu tiên
    fireEvent.click(minimizeButtons[0]);

    // Bubble xuất hiện trở lại trên logo chat
    expect(screen.getByTitle(/Mở chat với/i)).toBeInTheDocument();
  });
});
