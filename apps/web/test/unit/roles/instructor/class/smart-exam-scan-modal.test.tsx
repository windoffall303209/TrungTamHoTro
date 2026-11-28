import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartExamScanModal } from "../../../../../src/roles/instructor/class/smart-exam-scan-modal";

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
  let blobSeq = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = vi.fn(() => `blob:scan-preview-${++blobSeq}`);
      static override revokeObjectURL = vi.fn();
    },
  );
  apiMock.mockReset();
  notifyMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SmartExamScanModal", () => {
  it("hỗ trợ chọn tối đa 5 ảnh có preview ở Vùng 1, quét cộng dồn câu hỏi và cho phép sửa/xóa trước khi nhập", async () => {
    let scanCall = 0;
    apiMock.mockImplementation((path: string, init?: { body?: unknown }) => {
      if (path === "/instructor/question-bank/scan-image") {
        scanCall += 1;
        return Promise.resolve({
          provider: "GEMINI",
          model: "gemini-2.5-flash",
          questions: [
            {
              type: "SINGLE_CHOICE",
              content: `Câu hỏi từ ảnh số ${scanCall}`,
              options: ["A. Đáp án 1", "B. Đáp án 2", "C. Đáp án 3", "D. Đáp án 4"],
              correctAnswers: ["B"],
              difficulty: 2,
              tags: ["OCR"],
              confidence: 0.96,
              warnings: [],
            },
          ],
        });
      }
      if (path === "/instructor/question-bank/questions/import") {
        const parsed = JSON.parse(String(init?.body ?? "{}")) as { questions: unknown[] };
        return Promise.resolve(
          parsed.questions.map((_, idx) => ({
            row: idx + 1,
            status: "IMPORTED",
            questionId: `q-imported-${idx + 1}`,
            message: "OK",
          })),
        );
      }
      return Promise.resolve({});
    });

    const onImported = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <SmartExamScanModal
        open
        courseId="course-math"
        roleCode="INSTRUCTOR"
        onClose={onClose}
        onImported={onImported}
      />,
    );

    const dropzoneButton = screen.getByRole("button", { name: /Bấm vào đây để chọn ảnh đề thi/ });
    expect(dropzoneButton).toBeInTheDocument();

    const fileInput = container.querySelector("#smart-scan-image-input") as HTMLInputElement;
    const batch1 = [
      new File(["img1"], "trang-1.png", { type: "image/png" }),
      new File(["img2"], "trang-2.png", { type: "image/png" }),
    ];
    fireEvent.change(fileInput, { target: { files: batch1 } });

    expect(await screen.findByAltText("Xem trước trang-1.png")).toBeInTheDocument();
    expect(screen.getByText(/Vùng 1: Ảnh chụp đề thi gốc \(2\/5\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu quét AI \(2 ảnh\)/ }));
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 1")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 2")).toBeInTheDocument();

    const batch2 = [
      new File(["img3"], "trang-3.png", { type: "image/png" }),
      new File(["img4"], "trang-4.png", { type: "image/png" }),
      new File(["img5"], "trang-5.png", { type: "image/png" }),
      new File(["img6"], "trang-6.png", { type: "image/png" }),
    ];
    fireEvent.change(fileInput, { target: { files: batch2 } });
    expect(screen.getByText(/Vùng 1: Ảnh chụp đề thi gốc \(5\/5\)/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Câu hỏi từ ảnh số 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Câu hỏi từ ảnh số 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Quét thêm 3 ảnh mới/ }));
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 5")).toBeInTheDocument();
    expect(screen.getByText(/Vùng 2: Kiểm tra & Chỉnh sửa câu hỏi \(5 câu\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nội dung câu 1"), {
      target: { value: "Câu hỏi số 1 đã được giáo viên chỉnh sửa" },
    });
    fireEvent.change(screen.getByLabelText("Phương án A câu 1"), {
      target: { value: "Phương án A mới" },
    });
    fireEvent.click(screen.getByLabelText("Đáp án đúng A câu 1"));
    fireEvent.click(screen.getByRole("button", { name: "Xóa câu hỏi 2" }));

    expect(screen.getByText(/Vùng 2: Kiểm tra & Chỉnh sửa câu hỏi \(4 câu\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nhập 4 câu vào ngân hàng" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);

    const importCall = apiMock.mock.calls.find(
      ([p]) => p === "/instructor/question-bank/questions/import",
    );
    const body = JSON.parse(String((importCall?.[1] as { body?: string })?.body ?? "{}")) as {
      questions: Array<{ content: string; options: string[]; correctAnswers: string[] }>;
    };
    expect(body.questions).toHaveLength(4);
    expect(body.questions[0]).toMatchObject({
      content: "Câu hỏi số 1 đã được giáo viên chỉnh sửa",
      options: ["Phương án A mới", "Đáp án 2", "Đáp án 3", "Đáp án 4"],
      correctAnswers: ["Phương án A mới"],
    });
  });

  it("đóng gói trực tiếp câu hỏi quét được thành đề trắc nghiệm tổng 10 điểm hoặc bài tập tự luận", async () => {
    apiMock.mockResolvedValue({
      provider: "GEMINI",
      model: "gemini-2.5-flash",
      questions: Array.from({ length: 4 }, (_, idx) => ({
        type: "SINGLE_CHOICE",
        content: `Câu hỏi trắc nghiệm OCR ${idx + 1}`,
        options: ["A. Lựa chọn 1", "B. Lựa chọn 2", "C. Lựa chọn 3", "D. Lựa chọn 4"],
        correctAnswers: ["B"],
        difficulty: 2,
        confidence: 0.95,
      })),
    });

    const onSaveAssignment = vi.fn().mockResolvedValue(undefined);
    const onImported = vi.fn();
    const onClose = vi.fn();

    const { container } = render(
      <SmartExamScanModal
        open
        courseId="course-math"
        roleCode="INSTRUCTOR"
        targetMode="MULTIPLE_CHOICE"
        onClose={onClose}
        onImported={onImported}
        onSaveAssignment={onSaveAssignment}
      />,
    );

    const fileInput = container.querySelector("#smart-scan-image-input") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["img"], "de-toan-4-cau.png", { type: "image/png" })] },
    });

    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu quét AI \(1 ảnh\)/ }));
    expect(await screen.findByDisplayValue("Câu hỏi trắc nghiệm OCR 4")).toBeInTheDocument();
    expect(screen.getByText(/4 câu · Tổng 10 điểm/)).toBeInTheDocument();

    // Bấm nút + tăng 0,25 điểm rồi bấm - giảm 0,25 điểm trên câu 1
    fireEvent.click(screen.getByRole("button", { name: "Tăng 0,25 câu 1" }));
    expect((screen.getByLabelText("Điểm câu 1") as HTMLInputElement).value).toBe("2.75");
    fireEvent.click(screen.getByRole("button", { name: "Giảm 0,25 câu 1" }));
    expect((screen.getByLabelText("Điểm câu 1") as HTMLInputElement).value).toBe("2.5");

    expect(screen.queryByRole("button", { name: /Chỉ lưu vào ngân hàng/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lưu & Tạo đề trắc nghiệm (4 câu)" }));
    await waitFor(() => expect(onSaveAssignment).toHaveBeenCalledTimes(1));

    const payload = onSaveAssignment.mock.calls[0]?.[0] as {
      type: string;
      title: string;
      questions: Array<{ score: number; correctAnswer: string }>;
    };
    expect(payload.type).toBe("MULTIPLE_CHOICE");
    expect(payload.title).toContain("de-toan-4-cau");
    expect(payload.questions.map((q) => q.score)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(payload.questions.every((q) => q.correctAnswer === "B")).toBe(true);
  });

  it("hiển thị cảnh báo xác nhận hủy khi tắt modal lúc đang có ảnh/câu hỏi và làm mới 100% ở phiên mở lại", async () => {
    apiMock.mockResolvedValue({
      provider: "GEMINI",
      model: "gemini-2.5-flash",
      questions: [
        {
          type: "SINGLE_CHOICE",
          content: "Câu hỏi đang quét dở cần xác nhận hủy",
          options: ["A. Một", "B. Hai", "C. Ba", "D. Bốn"],
          correctAnswers: ["A"],
          difficulty: 2,
          confidence: 0.9,
        },
      ],
    });

    const onClose = vi.fn();
    const onBackToHub = vi.fn();
    const { container, rerender } = render(
      <SmartExamScanModal
        open
        courseId="course-math"
        roleCode="INSTRUCTOR"
        targetMode="MULTIPLE_CHOICE"
        onClose={onClose}
        onBackToHub={onBackToHub}
        onImported={vi.fn()}
        onSaveAssignment={vi.fn()}
      />,
    );

    const fileInput = container.querySelector("#smart-scan-image-input") as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["img"], "anh-cu.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu quét AI \(1 ảnh\)/ }));
    expect(await screen.findByDisplayValue("Câu hỏi đang quét dở cần xác nhận hủy")).toBeInTheDocument();

    // Bấm X đóng cửa sổ -> hiện hộp thoại xác nhận, chưa đóng ngay
    fireEvent.click(screen.getByRole("button", { name: "Đóng cửa sổ quét đề" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Bạn đang có đề quét dở chưa hoàn tất/)).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();

    // Chọn "Tiếp tục tạo đề" -> giữ nguyên màn hình và câu hỏi đang sửa
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục tạo đề" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Câu hỏi đang quét dở cần xác nhận hủy")).toBeInTheDocument();

    // Bấm lại X và chọn "Dừng & Hủy tạo đề" -> xóa sạch trạng thái và đóng
    fireEvent.click(screen.getByRole("button", { name: "Đóng cửa sổ quét đề" }));
    fireEvent.click(screen.getByRole("button", { name: "Dừng & Hủy tạo đề" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    // Giả lập đóng hẳn rồi mở lại phiên mới -> hoàn toàn sạch sẽ (0 ảnh, 0 câu hỏi)
    rerender(
      <SmartExamScanModal
        open={false}
        courseId="course-math"
        roleCode="INSTRUCTOR"
        targetMode="MULTIPLE_CHOICE"
        onClose={onClose}
        onBackToHub={onBackToHub}
        onImported={vi.fn()}
        onSaveAssignment={vi.fn()}
      />,
    );
    rerender(
      <SmartExamScanModal
        open
        courseId="course-math"
        roleCode="INSTRUCTOR"
        targetMode="MULTIPLE_CHOICE"
        onClose={onClose}
        onBackToHub={onBackToHub}
        onImported={vi.fn()}
        onSaveAssignment={vi.fn()}
      />,
    );

    expect(screen.getByText(/Vùng 1: Ảnh chụp đề thi gốc \(0\/5\)/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Câu hỏi đang quét dở cần xác nhận hủy")).not.toBeInTheDocument();

    // Khi phiên đang trống, bấm "Chọn cách tạo khác" quay lại ngay không cần cảnh báo
    fireEvent.click(screen.getAllByRole("button", { name: /Chọn cách tạo khác/ })[0]!);
    expect(onBackToHub).toHaveBeenCalledTimes(1);
  });
});
