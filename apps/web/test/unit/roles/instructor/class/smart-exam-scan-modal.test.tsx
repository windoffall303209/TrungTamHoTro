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

    // Bấm vào khung Vùng 1 vẫn kích hoạt input file ẩn
    const dropzoneButton = screen.getByRole("button", { name: /Bấm vào đây để chọn ảnh đề thi/ });
    expect(dropzoneButton).toBeInTheDocument();

    const fileInput = container.querySelector("#smart-scan-image-input") as HTMLInputElement;
    const batch1 = [
      new File(["img1"], "trang-1.png", { type: "image/png" }),
      new File(["img2"], "trang-2.png", { type: "image/png" }),
    ];
    fireEvent.change(fileInput, { target: { files: batch1 } });

    // Hiển thị preview ảnh thật ngay tại Vùng 1 (2/5 ảnh)
    expect(await screen.findByAltText("Xem trước trang-1.png")).toBeInTheDocument();
    expect(screen.getByText(/Vùng 1: Ảnh chụp đề thi gốc \(2\/5\)/)).toBeInTheDocument();

    // Quét đợt 1 -> ra 2 câu hỏi
    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu quét AI \(2 ảnh\)/ }));
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 1")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 2")).toBeInTheDocument();

    // Chọn thêm ảnh đợt 2 (thử chọn 4 ảnh nhưng trần là 5 -> chỉ nhận thêm 3 ảnh = 5/5, KHÔNG mất 2 câu cũ!)
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

    // Bấm quét thêm 3 ảnh mới -> cộng dồn thành 5 câu hỏi
    fireEvent.click(screen.getByRole("button", { name: /Quét thêm 3 ảnh mới/ }));
    expect(await screen.findByDisplayValue("Câu hỏi từ ảnh số 5")).toBeInTheDocument();
    expect(screen.getByText(/Vùng 2: Kiểm tra & Chỉnh sửa câu hỏi \(5 câu\)/)).toBeInTheDocument();

    // Sửa nội dung câu 1, sửa phương án A câu 1 và xóa câu 2 trước khi nhập
    fireEvent.change(screen.getByLabelText("Nội dung câu 1"), {
      target: { value: "Câu hỏi số 1 đã được giáo viên chỉnh sửa" },
    });
    fireEvent.change(screen.getByLabelText("Phương án A câu 1"), {
      target: { value: "Phương án A mới" },
    });
    fireEvent.click(screen.getByLabelText("Đáp án đúng A câu 1"));
    fireEvent.click(screen.getByRole("button", { name: "Xóa câu hỏi 2" }));

    expect(screen.getByText(/Vùng 2: Kiểm tra & Chỉnh sửa câu hỏi \(4 câu\)/)).toBeInTheDocument();

    // Nhập 4 câu vào ngân hàng
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
});
