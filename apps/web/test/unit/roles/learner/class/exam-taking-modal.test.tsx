import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamTakingModal } from "../../../../../src/roles/learner/class/exam-taking-modal";

const mockApiRequest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({ apiRequest: mockApiRequest }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExamTakingModal instructor preview", () => {
  it.each([
    {
      label: "plain options with prefixed labels",
      options: ["A. First", "B. Second"],
      correctAnswers: ["B. Second"],
      selection: "Second",
    },
    {
      label: "object options with nonsequential keys",
      options: [{ key: "Z", text: "First", value: "first" }, { key: "K", text: "Second", value: "second" }],
      correctAnswers: ["second"],
      selection: "Second",
    },
    {
      label: "object options with answer key",
      options: [{ key: "Z", text: "First", value: "first" }, { key: "K", text: "Second", value: "second" }],
      correctAnswers: ["K"],
      selection: "Second",
    },
  ])("scores $label correctly", async ({ options, correctAnswers, selection }) => {
    mockApiRequest.mockResolvedValueOnce([{
      id: "question-1",
      content: "Choose the correct option",
      options,
      correctAnswers,
    }]);
    const onSubmitted = vi.fn();
    const { container } = render(
      <ExamTakingModal
        open
        exam={{ id: "exam-1", title: "Preview", durationMinutes: 15, totalScore: 10 }}
        isInstructorPreview
        onClose={vi.fn()}
        onSubmitted={onSubmitted}
      />,
    );

    expect(container.firstElementChild?.className).toContain("w-screen");
    expect(container.firstElementChild?.className).toContain("h-dvh");
    fireEvent.click(await screen.findByText(selection));
    expect(screen.queryByRole("button", { name: "Bắt đầu làm thử" })).not.toBeInTheDocument();
    expect(screen.queryByText(/lưu lịch sử/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Nộp bài$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài ngay" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ score: 10, total: 10 }));
    expect(screen.queryByText(/lưu lịch sử/i)).not.toBeInTheDocument();
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });

  it("renders LaTeX expressions with KaTeX in taking and result review views", async () => {
    mockApiRequest.mockResolvedValueOnce([{
      id: "q-math",
      content: "Rút gọn phân số $\\frac{16}{24}$ ta được phân số tối giản là:",
      options: ["$\\frac{2}{3}$", "$\\frac{8}{12}$"],
      correctAnswers: ["$\\frac{2}{3}$"],
      explanation: "Chia cả tử và mẫu cho $8$ thu được $\\frac{2}{3}$.",
    }]);

    const { container } = render(
      <ExamTakingModal
        open
        exam={{ id: "exam-math", title: "Toán", durationMinutes: 15, totalScore: 10 }}
        isInstructorPreview
        onClose={vi.fn()}
      />,
    );

    await screen.findByText(/Rút gọn phân số/);
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".katex-mathml annotation")?.textContent).toContain("\\frac{16}{24}");
    expect(screen.queryByText(/\$\\frac\{16\}\{24\}\$/)).not.toBeInTheDocument();

    const firstOptionBadge = screen.getByText("A");
    fireEvent.click(firstOptionBadge);
    fireEvent.click(screen.getByRole("button", { name: /^Nộp bài$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài ngay" }));

    expect(await screen.findByText("Đã nộp bài")).toBeVisible();
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/\$\\frac\{16\}\{24\}\$/)).not.toBeInTheDocument();
  });
});

describe("ExamTakingModal learner attempt lifecycle", () => {
  it("không tạo lượt thi khi chỉ mở modal rồi Hủy; chỉ tạo sau khi bấm Bắt đầu làm bài", async () => {
    mockApiRequest.mockImplementation((path: string) => {
      if (path === "/learner/exams/exam-2/attempts") return Promise.resolve({ id: "attempt-1", startedAt: new Date().toISOString(), serverTime: new Date().toISOString(), answers: {} });
      if (path === "/learner/exams/exam-2/questions") return Promise.resolve([{ id: "q-1", type: "ESSAY", content: "Trình bày khái niệm REST", options: [], correctAnswers: [] }]);
      return Promise.resolve({});
    });
    const onClose = vi.fn();
    const exam = { id: "exam-2", title: "Kiểm tra", durationMinutes: 15, totalScore: 10, totalQuestions: 1, remainingAttempts: 1 };
    const { rerender } = render(<ExamTakingModal open exam={exam} onClose={onClose} />);
    expect(await screen.findByText("Xác nhận bắt đầu làm bài")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockApiRequest).not.toHaveBeenCalled();

    rerender(<ExamTakingModal open exam={exam} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu làm bài" }));
    await waitFor(() => expect(mockApiRequest).toHaveBeenCalledWith("/learner/exams/exam-2/attempts", { method: "POST" }));
    expect(await screen.findByText("Trình bày khái niệm REST")).toBeInTheDocument();
  });
});
