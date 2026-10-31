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
    render(
      <ExamTakingModal
        open
        exam={{ id: "exam-1", title: "Preview", durationMinutes: 15, totalScore: 10 }}
        isInstructorPreview
        onClose={vi.fn()}
        onSubmitted={onSubmitted}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Bắt đầu xem thử" }));
    fireEvent.click(screen.getByText(selection));
    fireEvent.click(screen.getByRole("button", { name: /^Nộp bài$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài ngay" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ score: 10, total: 10 }));
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });
});
