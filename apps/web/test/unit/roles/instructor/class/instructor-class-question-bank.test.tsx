import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  id: "cls-toan-10a1",
  code: "TOAN-10A1",
  name: "Lớp Toán 10A1 (Chuyên Toán)",
  courseId: "course-math-10",
  courseVersion: 1,
  term: "HK1",
  startAt: "2026-01-01",
  endAt: "2026-12-31",
  capacity: 30,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  instructorIds: ["teacher"],
  learnerIds: [],
};

const mathQuestion = {
  id: "q-math-1",
  courseId: "course-math-10",
  type: "SINGLE_CHOICE",
  content: "Rút gọn phân số $\\frac{16}{24}$ ta được phân số tối giản là:",
  options: ["$\\frac{2}{3}$", "$\\frac{8}{12}$", "$\\frac{4}{6}$", "\\(\\frac{3}{2}\\)"],
  correctAnswers: ["$\\frac{2}{3}$"],
  difficulty: 1,
  tags: ["toán lớp 4", "phân số"],
  solution: "Chia cả tử và mẫu cho $8$ ta được $\\frac{2}{3}$.",
  status: "PUBLISHED",
  version: 1,
};

const mathQuestion2 = {
  ...mathQuestion,
  id: "q-math-2",
  content: "Tính giá trị biểu thức $\\sqrt{144}$:",
  options: ["$12$", "$14$", "$10$", "$16$"],
  correctAnswers: ["$12$"],
  solution: "$12^2 = 144$ nên $\\sqrt{144} = 12$.",
};

function setupQuestionBankApiMock(options?: { total?: number }) {
  const total = options?.total ?? 1;
  request.mockImplementation(async (url: string) => {
    if (url.includes("/folders")) return { assignments: [], materials: [], lectures: [] };
    if (url.startsWith("/instructor/question-bank/questions/summary")) {
      return { total, multipleChoice: total, essay: 0 };
    }
    if (url.startsWith("/instructor/question-bank/questions/page")) {
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      const page = Number(params.get("page") ?? "1");
      if (total > 10 && page === 2) {
        return { items: [mathQuestion2], page: 2, pageSize: 10, total, totalPages: 2 };
      }
      return { items: [mathQuestion], page: 1, pageSize: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) };
    }
    if (url.startsWith("/instructor/question-bank/questions")) return [mathQuestion];
    if (url.startsWith("/exams/page?")) return { items: [], page: 1, pageSize: 100, total: 0 };
    if (url.startsWith("/materials/search")) return { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 };
    return [];
  });
}

describe("Tab Ngân hàng câu hỏi trong lớp học giảng viên", () => {
  beforeEach(() => {
    request.mockReset();
    push.mockReset();
    notify.mockReset();
    window.history.replaceState({}, "", "/courses/classes/cls-toan-10a1?tab=questions");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("render LaTeX bằng KaTeX ở chế độ xem danh sách và giữ nguyên text thô khi chỉnh sửa", async () => {
    setupQuestionBankApiMock();
    const { container } = render(<InstructorClassWorkspace item={classItem} course={null} />);

    await screen.findByText(/Rút gọn phân số/, {}, { timeout: 5000 });
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(6);
    const annotations = Array.from(container.querySelectorAll(".katex-mathml annotation")).map((el) => el.textContent);
    expect(annotations).toContain("\\frac{16}{24}");
    expect(annotations).toContain("\\frac{2}{3}");
    expect(annotations).toContain("\\frac{3}{2}");
    expect(screen.queryByText(/\$\\frac\{16\}\{24\}\$/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Chỉnh sửa" }));
    const dialog = await screen.findByRole("dialog", { name: "Chỉnh sửa câu hỏi ngân hàng lớp" });

    expect(within(dialog).getByRole("textbox", { name: "Nội dung câu hỏi" })).toHaveValue(mathQuestion.content);
    expect(within(dialog).getByRole("textbox", { name: "Phương án A" })).toHaveValue("$\\frac{2}{3}$");
    // Máy chủ chưa lưu lời giải nên modal không còn ô nhập lời giải (tránh mất dữ liệu âm thầm).
    expect(within(dialog).queryByRole("textbox", { name: "Hướng dẫn giải chi tiết / Gợi ý" })).not.toBeInTheDocument();
    expect(dialog.querySelectorAll(".katex")).toHaveLength(0);
  });

  it("hỗ trợ nút Xem giao diện để xem bản render LaTeX khi đang sửa và quay lại giữ nguyên nội dung", async () => {
    setupQuestionBankApiMock();
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    await screen.findByText(/Rút gọn phân số/);
    fireEvent.click(screen.getByRole("button", { name: "Chỉnh sửa" }));
    const dialog = await screen.findByRole("dialog", { name: "Chỉnh sửa câu hỏi ngân hàng lớp" });

    const contentInput = within(dialog).getByRole("textbox", { name: "Nội dung câu hỏi" });
    fireEvent.change(contentInput, { target: { value: "Tính tổng $\\frac{5}{10} + \\frac{1}{2}$:" } });

    const previewButton = within(dialog).getByRole("button", { name: "Xem giao diện" });
    fireEvent.click(previewButton);

    expect(within(dialog).getByText("Bản xem trước giao diện sau khi render LaTeX")).toBeVisible();
    expect(within(dialog).queryByRole("textbox", { name: "Nội dung câu hỏi" })).not.toBeInTheDocument();
    expect(dialog.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(4);
    expect(dialog.querySelector(".katex-mathml annotation")?.textContent).toContain("\\frac{5}{10}");
    expect(within(dialog).queryByText(/\$\\frac\{5\}\{10\}/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Quay lại chỉnh sửa" }));
    expect(within(dialog).getByRole("textbox", { name: "Nội dung câu hỏi" })).toHaveValue(
      "Tính tổng $\\frac{5}{10} + \\frac{1}{2}$:",
    );
  });

  it("tải phân trang ngân hàng câu hỏi theo từng trang và đặt lại trang khi đổi bộ lọc", async () => {
    setupQuestionBankApiMock({ total: 12 });
    render(<InstructorClassWorkspace item={classItem} course={null} />);

    await screen.findByText(/Rút gọn phân số/);
    expect(request.mock.calls.some(([url]) => String(url) === "/instructor/question-bank/questions?courseId=course-math-10")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText(/Tính giá trị biểu thức/);
    expect(
      request.mock.calls.some(
        ([url]) => String(url).includes("/instructor/question-bank/questions/page?") && String(url).includes("page=2"),
      ),
    ).toBe(true);

    request.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Trắc nghiệm/ }));
    await screen.findByText(/Rút gọn phân số/);
    const pageCalls = request.mock.calls.filter(([url]) => String(url).startsWith("/instructor/question-bank/questions/page?"));
    expect(pageCalls).toHaveLength(1);
    expect(String(pageCalls[0]?.[0])).toContain("page=1");
    expect(String(pageCalls[0]?.[0])).toContain("typeGroup=OBJECTIVE");
  });
});
