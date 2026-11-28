import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiExamBuilderModal } from "../../../../../src/roles/instructor/class/ai-exam-builder-modal";

const { apiMock, notifyMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiMock(...args),
}));

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ notify: notifyMock }),
}));

beforeEach(() => {
  apiMock.mockReset();
  notifyMock.mockReset();
});

afterEach(cleanup);

describe("AiExamBuilderModal", () => {
  it("sinh bản nháp câu hỏi trắc nghiệm bằng AI, chia đều 10 điểm và cho phép sửa nội dung trước khi duyệt phát hành", async () => {
    apiMock.mockResolvedValue({
      courseId: "course-1",
      providerId: "gemini",
      provider: "GEMINI",
      model: "gemini-2.5-flash",
      questions: Array.from({ length: 4 }, (_, idx) => ({
        type: "SINGLE_CHOICE",
        content: `Câu hỏi AI gốc số ${idx + 1}`,
        options: ["A. Phương án 1", "B. Phương án 2", "C. Phương án 3", "D. Phương án 4"],
        correctAnswers: ["C. Phương án 3"],
        difficulty: 2,
        tags: ["AI"],
        confidence: 0.9,
        warnings: [],
      })),
      context: { mode: "COURSE_MATERIALS", materialIds: ["m1"], materialNames: ["GiaoTrinh.pdf"], sources: [] },
      warnings: [],
    });

    const onSaveAssignment = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <AiExamBuilderModal
        open
        initialMode="MULTIPLE_CHOICE"
        classId="class-1"
        defaultSubject="Toán học"
        roleCode="INSTRUCTOR"
        onClose={onClose}
        onSaveAssignment={onSaveAssignment}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "4 câu" }));
    fireEvent.click(screen.getByRole("button", { name: /AI sinh 4 câu trắc nghiệm nháp/ }));

    expect(await screen.findByDisplayValue("Câu hỏi AI gốc số 1")).toBeInTheDocument();
    expect(screen.getByText(/4 câu · Tổng 10 điểm/)).toBeInTheDocument();
    expect((screen.getByLabelText("Điểm câu 1") as HTMLInputElement).value).toBe("2.5");

    // Giảng viên chỉnh sửa nội dung câu 1 và đổi đáp án đúng sang A
    fireEvent.change(screen.getByLabelText("Nội dung câu 1"), {
      target: { value: "Câu hỏi AI số 1 đã được giảng viên biên tập lại" },
    });
    fireEvent.click(screen.getByLabelText("Đáp án đúng A câu 1"));

    fireEvent.click(screen.getByRole("button", { name: "Duyệt & Phát hành đề trắc nghiệm (4 câu)" }));
    await waitFor(() => expect(onSaveAssignment).toHaveBeenCalledTimes(1));

    const draftRequest = JSON.parse(String((apiMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}"));
    expect(draftRequest.distribution).toEqual([{ type: "SINGLE_CHOICE", count: 4 }]);

    const savedPayload = onSaveAssignment.mock.calls[0]?.[0] as {
      type: string;
      questions: Array<{ content: string; correctAnswer: string; score: number }>;
    };
    expect(savedPayload.type).toBe("MULTIPLE_CHOICE");
    expect(savedPayload.questions).toHaveLength(4);
    expect(savedPayload.questions[0]).toMatchObject({
      content: "Câu hỏi AI số 1 đã được giảng viên biên tập lại",
      correctAnswer: "A",
      score: 2.5,
    });
    expect(savedPayload.questions.reduce((s, q) => s + q.score, 0)).toBe(10);
  });

  it("sinh đúng câu hỏi tự luận khi giảng viên chọn Đề Tự luận từ đầu và phát hành thành bài tập tự luận", async () => {
    apiMock.mockResolvedValue({
      courseId: "course-1",
      providerId: "gemini",
      provider: "GEMINI",
      model: "gemini-2.5-flash",
      questions: [
        {
          type: "ESSAY",
          content: "Phân tích sự biến thiên và vẽ bảng biến thiên của hàm số bậc ba.",
          options: [],
          correctAnswers: ["1. Tìm tập xác định\n2. Tính đạo hàm và xét dấu"],
          difficulty: 2,
          tags: ["Tự luận"],
          confidence: 0.92,
          warnings: [],
        },
        {
          type: "ESSAY",
          content: "Biện luận số nghiệm phương trình bằng đồ thị hàm số.",
          options: [],
          correctAnswers: ["Cô lập tham số m và xét tương giao"],
          difficulty: 3,
          tags: ["Tự luận"],
          confidence: 0.9,
          warnings: [],
        },
      ],
      context: { mode: "WEB_SEARCH", materialIds: [], materialNames: [], sources: [] },
      warnings: [],
    });

    const onSaveAssignment = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onBackToHub = vi.fn();

    render(
      <AiExamBuilderModal
        open
        initialMode="ESSAY"
        classId="class-1"
        defaultSubject="Toán học"
        roleCode="INSTRUCTOR"
        onClose={onClose}
        onBackToHub={onBackToHub}
        onSaveAssignment={onSaveAssignment}
      />,
    );

    expect(screen.getByText(/Tạo đề tự luận bằng AI/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Đề Trắc nghiệm" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Chọn cách tạo khác/ })[0]!);
    expect(onBackToHub).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "2 câu" }));
    fireEvent.click(screen.getByRole("button", { name: /AI sinh 2 câu tự luận nháp/ }));

    expect(
      await screen.findByDisplayValue("Phân tích sự biến thiên và vẽ bảng biến thiên của hàm số bậc ba."),
    ).toBeInTheDocument();
    expect(screen.getByText(/1\. Tìm tập xác định/)).toBeVisible();
    expect((screen.getByLabelText("Điểm câu 1") as HTMLInputElement).value).toBe("5");

    // Tăng điểm câu tự luận 1 thêm 0,25 -> 5.25 điểm, tổng điểm tự luận tự động cập nhật thành 10.25
    fireEvent.click(screen.getByRole("button", { name: "Tăng 0,25 câu 1" }));
    expect((screen.getByLabelText("Điểm câu 1") as HTMLInputElement).value).toBe("5.25");

    fireEvent.change(screen.getByLabelText("Nội dung câu 2"), {
      target: { value: "Biện luận số nghiệm thực của phương trình bằng phương pháp đồ thị." },
    });

    fireEvent.click(screen.getByRole("button", { name: "Duyệt & Phát hành bài tự luận (2 câu)" }));
    await waitFor(() => expect(onSaveAssignment).toHaveBeenCalledTimes(1));

    const draftRequest = JSON.parse(String((apiMock.mock.calls[0]?.[1] as { body?: string })?.body ?? "{}"));
    expect(draftRequest.distribution).toEqual([{ type: "ESSAY", count: 2 }]);

    const savedPayload = onSaveAssignment.mock.calls[0]?.[0] as {
      type: string;
      essayQuestions: string[];
      essayQuestionScores?: number[];
      scoreBreakdown?: { essayPoints: number };
    };
    expect(savedPayload.type).toBe("ESSAY");
    expect(savedPayload.essayQuestions).toEqual([
      "Phân tích sự biến thiên và vẽ bảng biến thiên của hàm số bậc ba.",
      "Biện luận số nghiệm thực của phương trình bằng phương pháp đồ thị.",
    ]);
    expect(savedPayload.essayQuestionScores).toEqual([5.25, 5]);
    expect(savedPayload.scoreBreakdown?.essayPoints).toBe(10.25);
  });
});
