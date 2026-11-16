import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssignmentBuilderModal } from "../../../../src/features/exams/assignment-builder-modal";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: api }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ notify: vi.fn() }) }));
afterEach(cleanup);

it("chọn đúng đáp án API ghép từ bảng và để giảng viên xử lý câu mâu thuẫn", async () => {
  const question = { type: "SINGLE_CHOICE", content: "Hai cộng hai bằng mấy?", options: ["Ba", "Bốn"], correctAnswers: ["Bốn"], answerSource: "Bảng đáp án" };
  api.mockResolvedValueOnce({ maxFileSizeMb: 12, allowedMimeTypes: [] }).mockResolvedValueOnce({
    questions: [question, { ...question, correctAnswers: [], options: ["**Ba**", "Bốn"], answerSource: undefined, warnings: ["Đáp án mâu thuẫn"] }],
  });
  render(<AssignmentBuilderModal open onClose={vi.fn()} initialType="MULTIPLE_CHOICE" targetClassName="Toán" onSaveAssignment={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Tạo bằng AI/ }));
  fireEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));
  fireEvent.change(screen.getByLabelText(/Chọn tệp để AI đọc/), { target: { files: [new File(["Đáp án: 1-B"], "de.txt", { type: "text/plain" })] } });
  expect(await screen.findByRole("radio", { name: "Đáp án đúng B câu 1" })).toBeChecked();
  const unresolved = screen.getByRole("radio", { name: "Đáp án đúng A câu 2" });
  expect(unresolved).not.toBeChecked();
  expect(screen.getByText("Bảng đáp án")).toBeVisible();
  fireEvent.click(unresolved);
  expect(unresolved).toBeChecked();
});
