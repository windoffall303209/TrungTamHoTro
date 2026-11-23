import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassFeedView } from "../../../../src/features/class-feed/class-feed-view";

const { apiRequest, notify, session } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  notify: vi.fn(),
  session: { current: { roleCode: "INSTRUCTOR", user: { name: "Teacher A", username: "teacher" } } },
}));

vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: session.current, notify }) }));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }) }));

const announcement = { id: "a-1", classId: "class-a", classCode: "A", title: "Lịch kiểm tra", body: "Thứ Hai kiểm tra chương 1.", authorName: "Teacher A", publishedAt: "2026-11-20T02:00:00.000Z" };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  session.current = { roleCode: "INSTRUCTOR", user: { name: "Teacher A", username: "teacher" } };
});

describe("ClassFeedView", () => {
  it("hiển thị thông báo thật của lớp từ máy chủ, không chèn bài viết mẫu hay đọc localStorage", async () => {
    localStorage.setItem("class_feed_posts_class-a", JSON.stringify([{ id: "fake" }]));
    apiRequest.mockResolvedValueOnce([announcement]);
    render(<ClassFeedView classItem={{ id: "class-a", code: "A", name: "A" }} />);
    expect(await screen.findByText("Lịch kiểm tra")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/academic/announcements?classId=class-a", { roleCode: "INSTRUCTOR" });
    expect(screen.queryByText(/REST hay GraphQL/)).not.toBeInTheDocument();
  });

  it("giảng viên đăng thông báo qua API và chỉ báo thành công khi máy chủ đã lưu", async () => {
    apiRequest.mockResolvedValueOnce([]).mockResolvedValueOnce({ ...announcement, id: "a-2", title: "Nghỉ học", body: "Lớp nghỉ ngày mai." });
    render(<ClassFeedView classItem={{ id: "class-a", code: "A", name: "A" }} />);
    expect(await screen.findByText("Lớp chưa có thông báo nào.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tiêu đề thông báo"), { target: { value: "Nghỉ học" } });
    fireEvent.change(screen.getByLabelText("Nội dung thông báo"), { target: { value: "Lớp nghỉ ngày mai." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Đăng thông báo" }));
    });
    expect(apiRequest).toHaveBeenLastCalledWith("/academic/classes/class-a/announcements", {
      method: "POST",
      roleCode: "INSTRUCTOR",
      body: JSON.stringify({ title: "Nghỉ học", body: "Lớp nghỉ ngày mai." }),
    });
    expect(await screen.findByText("Lớp nghỉ ngày mai.")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("Đã đăng thông báo tới cả lớp.");
  });

  it("học viên chỉ xem, không có ô đăng bài", async () => {
    session.current = { roleCode: "LEARNER", user: { name: "Learner", username: "learner" } };
    apiRequest.mockResolvedValueOnce([announcement]);
    render(<ClassFeedView classItem={{ id: "class-a", code: "A", name: "A" }} />);
    await waitFor(() => expect(screen.getByText("Lịch kiểm tra")).toBeInTheDocument());
    expect(screen.queryByLabelText("Tiêu đề thông báo")).not.toBeInTheDocument();
  });
});
