import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question } from "@/lib/learning-types";
import QuestionsPage from "../../../../src/features/questions/questions-screen";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "INSTRUCTOR" }, notify: notifyMock }),
}));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ t: (value: string) => value }) }));

// Tạo câu hỏi hợp lệ để kết quả lọc có thể render đầy đủ.
function makeQuestion(id: string): Question {
  return {
    id, courseId: "course-1", type: "SINGLE_CHOICE", content: `Question ${id}`,
    options: ["Yes", "No"], correctAnswers: ["Yes"], difficulty: 2,
    tags: [], status: "PUBLISHED", version: 1,
  };
}

// Tạo payload phân trang câu hỏi chuẩn giống phản hồi từ máy chủ.
function toQuestionPage(items: Question[], page = 1, pageSize = 10, total = items.length) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

describe("QuestionsPage request lifecycle", () => {
  const pending = new Map<
    string,
    { resolve: (value: ReturnType<typeof toQuestionPage>) => void; reject: (error: Error) => void }
  >();

  beforeEach(() => {
    pending.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/manager/courses") return Promise.resolve([]);
      if (path.startsWith("/instructor/question-bank/questions/page?")) {
        const url = new URL(path, "http://localhost");
        const query = url.searchParams.get("query") ?? "";
        const page = url.searchParams.get("page") ?? "1";
        return new Promise<ReturnType<typeof toQuestionPage>>((resolve, reject) => {
          pending.set(`${query}|${page}`, { resolve, reject });
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Chờ request mới sau debounce mà không phụ thuộc đồng hồ giả.
  async function expectPending(query: string, page = "1") {
    const key = `${query}|${page}`;
    await waitFor(() => expect(pending.has(key)).toBe(true));
    return pending.get(key)!;
  }

  it("ignores an older response after the latest search completes", async () => {
    render(<QuestionsPage />);
    const initial = await expectPending("");
    await act(async () => initial.resolve(toQuestionPage([makeQuestion("initial")])));

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "old" } });
    const old = await expectPending("old");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "new" } });
    const latest = await expectPending("new");

    await act(async () => latest.resolve(toQuestionPage([makeQuestion("new")])));
    expect(screen.getByText("Question new")).toBeInTheDocument();

    await act(async () => old.resolve(toQuestionPage([makeQuestion("old")])));
    expect(screen.getByText("Question new")).toBeInTheDocument();
    expect(screen.queryByText("Question old")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores an outdated error after a filter changes", async () => {
    render(<QuestionsPage />);
    const initial = await expectPending("");
    await act(async () => initial.resolve(toQuestionPage([makeQuestion("initial")])));

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "old" } });
    const old = await expectPending("old");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "new" } });
    await act(async () => old.reject(new Error("Old request failed")));
    const latest = await expectPending("new");
    await act(async () => latest.resolve(toQuestionPage([makeQuestion("new")])));

    expect(screen.getByText("Question new")).toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not notify when a pending request fails after unmount", async () => {
    const page = render(<QuestionsPage />);
    const initial = await expectPending("");
    page.unmount();
    await act(async () => initial.reject(new Error("Unmounted request failed")));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("renders LaTeX in list view and toggles rendered preview via Xem giao diện when editing", async () => {
    const latexQuestion: Question = {
      id: "q-latex",
      courseId: "course-1",
      type: "SINGLE_CHOICE",
      content: "Rút gọn phân số $\\frac{16}{24}$:",
      options: ["$\\frac{2}{3}$", "$\\frac{4}{6}$"],
      correctAnswers: ["$\\frac{2}{3}$"],
      difficulty: 1,
      tags: ["phân số"],
      status: "PUBLISHED",
      version: 1,
    };
    const { container } = render(<QuestionsPage />);
    const initial = await expectPending("");
    await act(async () => initial.resolve(toQuestionPage([latexQuestion])));

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText(/\$\\frac\{16\}\{24\}\$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sửa thành phiên bản mới" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: /Nội dung câu hỏi/ })).toHaveValue(latexQuestion.content);

    fireEvent.click(within(dialog).getByRole("button", { name: "Xem giao diện" }));
    expect(within(dialog).getByText("Bản xem trước giao diện sau khi render LaTeX")).toBeVisible();
    expect(within(dialog).queryByRole("textbox", { name: /Nội dung câu hỏi/ })).not.toBeInTheDocument();
    expect(dialog.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
    expect(within(dialog).queryByText(/\$\\frac\{16\}\{24\}\$/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Quay lại chỉnh sửa" }));
    expect(within(dialog).getByRole("textbox", { name: /Nội dung câu hỏi/ })).toHaveValue(latexQuestion.content);
  });

  it("requests page 2 from server without refetching /manager/courses", async () => {
    render(<QuestionsPage />);
    const page1 = await expectPending("", "1");
    await act(async () => page1.resolve(toQuestionPage([makeQuestion("p1-q1")], 1, 10, 15)));
    expect(screen.getByText("15 câu hỏi phù hợp")).toBeInTheDocument();
    expect(screen.getByText("Trang 1/2")).toBeInTheDocument();

    const coursesCallsBefore = apiMock.mock.calls.filter(([p]) => p === "/manager/courses").length;
    fireEvent.click(screen.getByRole("button", { name: /Trang sau/i }));
    const page2 = await expectPending("", "2");
    await act(async () => page2.resolve(toQuestionPage([makeQuestion("p2-q11")], 2, 10, 15)));

    expect(screen.getByText("Question p2-q11")).toBeInTheDocument();
    expect(screen.getByText("Trang 2/2")).toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([p]) => p === "/manager/courses")).toHaveLength(coursesCallsBefore);
  });
});
