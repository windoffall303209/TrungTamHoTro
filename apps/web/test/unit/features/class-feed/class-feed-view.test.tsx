import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassFeedView } from "../../../../src/features/class-feed/class-feed-view";

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: { roleCode: "INSTRUCTOR", user: { name: "Teacher A", username: "teacher" } },
    notify: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ClassFeedView", () => {
  it("mở cùng một ô phản hồi cho bình luận cấp một và cấp hai, đồng thời đặt lại bản nháp", () => {
    render(<ClassFeedView classItem={{ id: "class-a", code: "A", name: "A" }} />);
    fireEvent.click(screen.getByRole("button", { name: "3 bình luận" }));

    const replyButtons = screen.getAllByRole("button", { name: "Trả lời" });
    fireEvent.click(replyButtons[0]!);
    expect(screen.getByText("@Trương Sỹ Quý:")).toBeInTheDocument();
    const replyInput = screen.getByPlaceholderText("Viết phản hồi công khai...");
    fireEvent.change(replyInput, { target: { value: "Bản nháp cấp một" } });

    fireEvent.click(replyButtons[1]!);
    expect(screen.getByText("@Trần Long:")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Viết phản hồi công khai...")).toHaveValue("");
    expect(screen.getAllByPlaceholderText("Viết phản hồi công khai...")).toHaveLength(1);
  });

  it("resets the open post and unsent text when switching classes", () => {
    const { rerender } = render(<ClassFeedView classItem={{ id: "class-a", code: "A", name: "A" }} teacherName="Teacher A" />);
    fireEvent.change(screen.getByPlaceholderText("Chia sẻ bài viết, câu hỏi hoặc thông báo với lớp học..."), {
      target: { value: "Unsent text from class A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "0 bình luận" }));
    expect(screen.getByRole("heading", { name: "Bài viết của Teacher A" })).toBeInTheDocument();

    rerender(<ClassFeedView classItem={{ id: "class-b", code: "B", name: "B" }} teacherName="Teacher A" />);
    expect(screen.queryByRole("heading", { name: "Bài viết của Teacher A" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Chia sẻ bài viết, câu hỏi hoặc thông báo với lớp học...")).toHaveValue("");
    expect(localStorage.getItem("class_feed_posts_class-a")).not.toBeNull();
    expect(localStorage.getItem("class_feed_posts_class-b")).not.toBeNull();
  });

  it("never adds more than five images when multiple reads complete out of order", () => {
    const pendingReads: Array<() => void> = [];
    vi.stubGlobal("FileReader", class {
      onload: ((event: { target: { result: string } }) => void) | null = null;

      // Hoãn hoàn thành đọc tệp để mô phỏng hai đợt chọn ảnh đang chạy đồng thời.
      readAsDataURL(file: File) {
        pendingReads.push(() => this.onload?.({ target: { result: `data:image/png;base64,${file.name}` } }));
      }
    });
    const { container } = render(<ClassFeedView classItem={{ id: "class-a", code: "A" }} />);
    const fileInput = container.querySelector('input[type="file"]')!;
    const files = Array.from({ length: 10 }, (_, index) => new File(["image"], `${index}.png`, { type: "image/png" }));
    fireEvent.change(fileInput, { target: { files: files.slice(0, 5) } });
    fireEvent.change(fileInput, { target: { files: files.slice(5) } });
    expect(pendingReads).toHaveLength(10);

    act(() => { pendingReads.reverse().forEach((complete) => complete()); });
    expect(screen.getByRole("button", { name: "Đính kèm ảnh (5/5)" })).toBeInTheDocument();
    expect(container.querySelectorAll('img[alt^="Ảnh đính kèm"]')).toHaveLength(5);
  });

  it("keeps the draft when storage quota prevents publishing", () => {
    render(<ClassFeedView classItem={{ id: "class-a", code: "A" }} />);
    const editor = screen.getByPlaceholderText("Chia sẻ bài viết, câu hỏi hoặc thông báo với lớp học...");
    fireEvent.change(editor, { target: { value: "Keep my unsent draft" } });
    const original = localStorage.getItem("class_feed_posts_class-a");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Đăng bài" }));

    expect(editor).toHaveValue("Keep my unsent draft");
    expect(localStorage.getItem("class_feed_posts_class-a")).toBe(original);
    expect(screen.queryByText("Keep my unsent draft", { selector: "p" })).not.toBeInTheDocument();
  });
});
