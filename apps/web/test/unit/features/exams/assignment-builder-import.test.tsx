import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AssignmentBuilderModal,
  distributeEqualQuestionScores,
} from "../../../../src/features/exams/assignment-builder-modal";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiRequest: api }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ notify: vi.fn() }) }));
afterEach(cleanup);

it("chọn đúng đáp án API ghép từ bảng và để giảng viên xử lý câu mâu thuẫn", async () => {
  const question = {
    type: "SINGLE_CHOICE",
    content: "Hai cộng hai bằng mấy?",
    options: ["Ba", "Bốn"],
    correctAnswers: ["Bốn"],
    answerSource: "Bảng đáp án",
  };
  api.mockResolvedValueOnce({ maxFileSizeMb: 12, allowedMimeTypes: [] }).mockResolvedValueOnce({
    questions: [
      question,
      {
        ...question,
        correctAnswers: [],
        options: ["**Ba**", "Bốn"],
        answerSource: undefined,
        warnings: ["Đáp án mâu thuẫn"],
      },
    ],
  });
  render(
    <AssignmentBuilderModal
      open
      onClose={vi.fn()}
      initialType="MULTIPLE_CHOICE"
      targetClassName="Toán"
      onSaveAssignment={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Tạo bằng AI/ }));
  fireEvent.click(screen.getByRole("button", { name: /Tiếp tục/ }));
  fireEvent.change(screen.getByLabelText(/Chọn tệp để AI đọc/), {
    target: { files: [new File(["Đáp án: 1-B"], "de.txt", { type: "text/plain" })] },
  });
  expect(await screen.findByRole("radio", { name: "Đáp án đúng B câu 1" })).toBeChecked();
  const unresolved = screen.getByRole("radio", { name: "Đáp án đúng A câu 2" });
  expect(unresolved).not.toBeChecked();
  expect(screen.getByText("Bảng đáp án")).toBeVisible();
  fireEvent.click(unresolved);
  expect(unresolved).toBeChecked();
  expect(screen.getByText(/2 câu · Tổng 10 điểm/)).toBeVisible();
});

it("tự động chia đều tổng 10 điểm khi tách 4 câu từ tệp và cân bằng lại khi thêm câu mới", async () => {
  expect(distributeEqualQuestionScores(4, 10)).toEqual([2.5, 2.5, 2.5, 2.5]);
  expect(distributeEqualQuestionScores(3, 10)).toEqual([3.34, 3.33, 3.33]);

  const sampleQuestions = Array.from({ length: 4 }, (_, idx) => ({
    type: "SINGLE_CHOICE",
    content: `Câu hỏi trắc nghiệm số ${idx + 1}?`,
    options: ["Phương án 1", "Phương án 2", "Phương án 3", "Phương án 4"],
    correctAnswers: ["Phương án 2"],
    answerSource: "Bảng đáp án cuối đề",
  }));

  api.mockResolvedValueOnce({ maxFileSizeMb: 12, allowedMimeTypes: [] }).mockResolvedValueOnce({
    questions: sampleQuestions,
  });

  render(
    <AssignmentBuilderModal
      open
      onClose={vi.fn()}
      initialType="MULTIPLE_CHOICE"
      initialMethod="AI"
      targetClassName="Toán 10A1"
      onSaveAssignment={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText(/Chọn tệp để AI đọc/), {
    target: { files: [new File(["Đề 4 câu"], "de-4-cau.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })] },
  });

  expect(await screen.findByText(/4 câu · Tổng 10 điểm/)).toBeVisible();
  const scoreInputs = screen.getAllByLabelText("Điểm câu hỏi") as HTMLInputElement[];
  expect(scoreInputs.map((el) => Number(el.value))).toEqual([2.5, 2.5, 2.5, 2.5]);

  fireEvent.click(screen.getByRole("button", { name: /Thêm câu hỏi/ }));
  expect(screen.getByText(/5 câu · Tổng 10 điểm/)).toBeVisible();
  const updatedScoreInputs = screen.getAllByLabelText("Điểm câu hỏi") as HTMLInputElement[];
  expect(updatedScoreInputs.map((el) => Number(el.value))).toEqual([2, 2, 2, 2, 2]);
});
