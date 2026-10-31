import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("QuestionsPage request lifecycle", () => {
  const pending = new Map<string, { resolve: (value: Question[]) => void; reject: (error: Error) => void }>();

  beforeEach(() => {
    pending.clear();
    apiMock.mockReset();
    notifyMock.mockReset();
    apiMock.mockImplementation((path: string) => {
      if (path === "/manager/courses") return Promise.resolve([]);
      if (path.startsWith("/instructor/question-bank/questions?")) {
        const query = new URL(path, "http://localhost").searchParams.get("query") ?? "";
        return new Promise<Question[]>((resolve, reject) => { pending.set(query, { resolve, reject }); });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Chờ request mới sau debounce mà không phụ thuộc đồng hồ giả.
  async function expectPending(query: string) {
    await waitFor(() => expect(pending.has(query)).toBe(true));
    return pending.get(query)!;
  }

  it("ignores an older response after the latest search completes", async () => {
    render(<QuestionsPage />);
    const initial = await expectPending("");
    await act(async () => initial.resolve([makeQuestion("initial")]));

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "old" } });
    const old = await expectPending("old");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "new" } });
    const latest = await expectPending("new");

    await act(async () => latest.resolve([makeQuestion("new")]));
    expect(screen.getByText("Question new")).toBeInTheDocument();

    await act(async () => old.resolve([makeQuestion("old")]));
    expect(screen.getByText("Question new")).toBeInTheDocument();
    expect(screen.queryByText("Question old")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores an outdated error after a filter changes", async () => {
    render(<QuestionsPage />);
    const initial = await expectPending("");
    await act(async () => initial.resolve([makeQuestion("initial")]));

    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "old" } });
    const old = await expectPending("old");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm câu hỏi" }), { target: { value: "new" } });
    await act(async () => old.reject(new Error("Old request failed")));
    const latest = await expectPending("new");
    await act(async () => latest.resolve([makeQuestion("new")]));

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
});
