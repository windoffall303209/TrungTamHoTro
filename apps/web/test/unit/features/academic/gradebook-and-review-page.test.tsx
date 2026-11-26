import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEssayQuestions } from "../../../../src/features/academic/assignment-question-parser";
import { ClassGradebookTable } from "../../../../src/features/academic/class-gradebook-table";
import { DocumentRichViewer } from "../../../../src/features/academic/document-rich-viewer";
import type { Assignment, AssignmentSubmission, GradebookRow, LearningClass } from "../../../../src/lib/learning-types";
import { AssignmentSubmissionReviewScreen } from "../../../../src/roles/instructor/class/assignment-submission-review-screen";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  downloadApiFile: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/api-client", () => ({
  publicApiUrl: (path: string) => path,
  apiRequest: mocks.apiRequest,
  downloadApiFile: mocks.downloadApiFile,
}));

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      user: {
        id: "ins-1",
        displayName: "Giảng viên",
        email: "gv@example.com",
        roleCode: "INSTRUCTOR",
      },
      roleCode: "INSTRUCTOR",
      permissions: ["exam:manage", "assignment:grade", "material:view"],
    },
    notify: mocks.notify,
  }),
}));

vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({
    locale: "vi-VN",
    language: "vi",
    t: (text: string) => text,
  }),
}));

const sampleClass: LearningClass = {
  id: "cls-1",
  courseId: "crs-1",
  courseVersion: 1,
  code: "TOAN-10A",
  name: "Lớp Toán 10A",
  term: "2026-FALL",
  startAt: "2026-09-01T00:00:00Z",
  endAt: "2026-12-30T00:00:00Z",
  capacity: 35,
  timezone: "Asia/Ho_Chi_Minh",
  status: "ACTIVE",
  instructorIds: ["ins-1"],
  learnerIds: ["lrn-1", "lrn-2", "lrn-3"],
};

const sampleAssignment: Assignment = {
  id: "asg-1",
  classId: "cls-1",
  classCode: "TOAN-10A",
  title: "Bài tập tự luận Hình học",
  description: "Giải chi tiết các bài toán chứng minh và đính kèm bản scan hoặc Word.",
  instructions:
    "Trình bày rõ từng bước biến đổi.\nCâu 1: Giải phương trình $x^2 - 5x + 6 = 0$.\nCâu 2: Chứng minh định lý Pythagoras trên tam giác vuông ABC.",
  sourceMaterial: {
    id: "mat-src-1",
    name: "de-bai-mau.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 4096,
  },
  dueAt: "2026-11-30T17:00:00Z",
  maxScore: 10,
  rubric: [
    { id: "crit-1", title: "Lập luận Câu 1", description: "Đúng nghiệm", maxPoints: 5 },
    { id: "crit-2", title: "Chứng minh Câu 2", description: "Hình vẽ & chứng minh", maxPoints: 5 },
  ],
  status: "PUBLISHED",
  version: 1,
  createdById: "ins-1",
  createdAt: "2026-11-01T08:00:00Z",
};

const sampleSubmissions: AssignmentSubmission[] = [
  {
    id: "sub-a",
    assignmentId: "asg-1",
    learnerId: "lrn-1",
    learnerName: "Nguyễn Văn A",
    learnerEmail: "vana@example.com",
    content: "Em đã giải Câu 1 ra x = 2 và x = 3, phần chứng minh đính kèm file Word.",
    status: "SUBMITTED",
    revision: 1,
    submittedAt: "2026-11-10T09:00:00Z",
    rubricScores: [],
    attachments: [
      {
        id: "att-docx",
        originalName: "bai-lam-a.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 8192,
        createdAt: "2026-11-10T09:00:00Z",
        canPreview: true,
      },
    ],
  },
  {
    id: "sub-b",
    assignmentId: "asg-1",
    learnerId: "lrn-2",
    learnerName: "Trần Thị B",
    learnerEmail: "thib@example.com",
    content: "Em gửi ảnh chụp bài làm tay.",
    status: "GRADED",
    revision: 2,
    submittedAt: "2026-11-10T10:00:00Z",
    score: 9,
    rubricScores: [
      { criterionId: "crit-1", score: 4.5 },
      { criterionId: "crit-2", score: 4.5 },
    ],
    feedback: "Trình bày rất sạch đẹp.",
    attachments: [
      {
        id: "att-img",
        originalName: "hinh-ve-b.png",
        mimeType: "image/png",
        sizeBytes: 12288,
        createdAt: "2026-11-10T10:00:00Z",
        canPreview: true,
      },
    ],
  },
];

describe("Gradebook UI, question parser, document viewer, and essay review page", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.downloadApiFile.mockReset().mockResolvedValue(undefined);
    mocks.push.mockReset();
    mocks.notify.mockReset();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static override createObjectURL() {
          return "blob:preview-object";
        }
        static override revokeObjectURL() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("tách rõ từng câu hỏi tự luận từ hướng dẫn đề bài và hỗ trợ dự phòng", () => {
    const parsed = parseEssayQuestions(sampleAssignment.instructions, sampleAssignment.description);
    expect(parsed).toEqual([
      { index: 0, label: "Hướng dẫn chung", prompt: "Trình bày rõ từng bước biến đổi.", isGeneral: true },
      { index: 1, label: "Câu 1", prompt: "Giải phương trình $x^2 - 5x + 6 = 0$." },
      { index: 2, label: "Câu 2", prompt: "Chứng minh định lý Pythagoras trên tam giác vuông ABC." },
    ]);

    const numbered = parseEssayQuestions("1. Phân tích đề\n2. Viết kết luận");
    expect(numbered.map((item) => item.label)).toEqual(["Câu 1", "Câu 2"]);

    const fallback = parseEssayQuestions("", "Mô tả duy nhất");
    expect(fallback).toEqual([{ index: 1, label: "Yêu cầu đề bài", prompt: "Mô tả duy nhất", isGeneral: true }]);
  });

  it("hiển thị bảng điểm 20% Học sinh, 15% Trung bình, tên các bài kiểm tra và cuộn ngang khi > 7 bài", () => {
    const rowsTwoCols: GradebookRow[] = [
      {
        learnerId: "lrn-1",
        learnerName: "Lê Minh An",
        learnerEmail: "an@example.com",
        examEarned: 9,
        examPossible: 10,
        assignmentEarned: 0,
        assignmentPossible: 10,
        totalPercent: 45,
        averageScore: 9.0,
        awaitingGrade: 1,
        notSubmitted: 0,
        assessments: [
          { id: "ex-1", kind: "EXAM", title: "Bai1", maxScore: 10 },
          { id: "asg-1", kind: "ASSIGNMENT", title: "Bai2", maxScore: 10 },
        ],
        cells: [
          { assessmentId: "ex-1", kind: "EXAM", score: 9, maxScore: 10, status: "GRADED", attemptCount: 3 },
          { assessmentId: "asg-1", kind: "ASSIGNMENT", score: null, maxScore: 10, status: "AWAITING_GRADE", attemptCount: 1 },
        ],
      },
    ];

    const { rerender } = render(<ClassGradebookTable rows={rowsTwoCols} />);
    expect(screen.getByRole("columnheader", { name: "Học sinh" })).toHaveStyle({ width: "max(165px, 20cqw)" });
    expect(screen.getByRole("columnheader", { name: "Trung bình" })).toHaveStyle({ width: "max(105px, 15cqw)" });
    expect(screen.queryByRole("columnheader", { name: /^Điểm$/ })).not.toBeInTheDocument();
    expect(screen.getByText("Bai1")).toBeInTheDocument();
    expect(screen.getByText("Bai2")).toBeInTheDocument();
    expect(screen.getByText("9.00")).toBeInTheDocument();
    expect(screen.getByText("Cao nhất (3 lượt)")).toBeInTheDocument();
    expect(screen.getByText("Chờ chấm")).toBeInTheDocument();

    const nineCols = Array.from({ length: 9 }, (_, i) => ({
      id: `item-${i + 1}`,
      kind: "EXAM" as const,
      title: `Bai${i + 1}`,
      maxScore: 10,
    }));
    const nineRows: GradebookRow[] = [
      {
        ...rowsTwoCols[0]!,
        assessments: nineCols,
        cells: nineCols.map((col, idx) => ({
          assessmentId: col.id,
          kind: col.kind,
          score: idx === 0 ? 9 : 8,
          maxScore: 10,
          status: "GRADED",
          attemptCount: 1,
        })),
      },
    ];
    rerender(<ClassGradebookTable rows={nineRows} />);

    const table = screen.getByRole("table");
    expect(table).toHaveStyle({ width: "calc(35cqw + 9 * (65cqw / 7))" });
    expect(screen.getByText("Bai9")).toBeInTheDocument();
  });

  it("hỗ trợ xem trước ảnh (zoom/xoay), PDF và DOCX (tìm từ khóa, chỉnh cỡ chữ) trong DocumentRichViewer", async () => {
    // Máy chủ trả đúng kiểu nội dung theo tệp; trình xem chỉ hiển thị khi kiểu khớp ảnh raster/PDF.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => Promise.resolve({
        ok: true,
        blob: async () => new Blob(["binary"], { type: String(url).includes("att-pdf") ? "application/pdf" : "image/png" }),
      })),
    );

    const { rerender } = render(
      <DocumentRichViewer
        kind="SUBMISSION_ATTACHMENT"
        submissionId="sub-b"
        attachment={sampleSubmissions[1]!.attachments[0]!}
      />,
    );

    const img = await screen.findByRole("img", { name: "hinh-ve-b.png" });
    expect(img).toHaveAttribute("src", "blob:preview-object");
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Phóng to ảnh" }));
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xoay phải 90 độ" }));
    expect(img).toHaveStyle({ transform: "scale(1.25) rotate(90deg)" });

    rerender(
      <DocumentRichViewer
        kind="SUBMISSION_ATTACHMENT"
        submissionId="sub-pdf"
        attachment={{
          id: "att-pdf",
          originalName: "bai-lam.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          createdAt: "2026-11-10T09:00:00Z",
          canPreview: true,
        }}
      />,
    );
    await waitFor(() => {
      const frame = document.querySelector('iframe[title="bai-lam.pdf"]');
      expect(frame).not.toBeNull();
      expect(frame).toHaveAttribute("src", "blob:preview-object");
    });

    mocks.apiRequest.mockResolvedValueOnce({
      kind: "html",
      fileName: "bai-lam-a.docx",
      mimeType: sampleSubmissions[0]!.attachments[0]!.mimeType,
      html: "<p>Lời giải định lý Pythagoras hoàn chỉnh</p>",
      warnings: [],
    });

    rerender(
      <DocumentRichViewer
        kind="SUBMISSION_ATTACHMENT"
        submissionId="sub-a"
        attachment={sampleSubmissions[0]!.attachments[0]!}
      />,
    );

    expect(await screen.findByText(/Lời giải định lý Pythagoras/i)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm trong tài liệu" }), {
      target: { value: "Pythagoras" },
    });
    expect(screen.getByText("1 kết quả")).toBeInTheDocument();
    expect(screen.getByText("Pythagoras").tagName).toBe("MARK");
  });

  it("tải đầy đủ câu hỏi, chuyển học sinh và lưu điểm trên trang chấm tự luận AssignmentSubmissionReviewScreen", async () => {
    mocks.apiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/classes") return [sampleClass];
      if (path.startsWith("/academic/assignments?classId=")) return [sampleAssignment];
      if (path === "/instructor/assignments/asg-1/submissions") return sampleSubmissions;
      if (path === "/instructor/classes/cls-1/learners") {
        return [
          { id: "lrn-1", displayName: "Nguyễn Văn A", email: "vana@example.com", roleCode: "LEARNER" },
          { id: "lrn-2", displayName: "Trần Thị B", email: "thib@example.com", roleCode: "LEARNER" },
          { id: "lrn-3", displayName: "Phạm C", email: "c@example.com", roleCode: "LEARNER" },
        ];
      }
      if (path.includes("/preview-content")) {
        return {
          kind: "html",
          fileName: "bai-lam-a.docx",
          mimeType: sampleSubmissions[0]!.attachments[0]!.mimeType,
          html: "<p>Nội dung Word của Nguyễn Văn A</p>",
          warnings: [],
        };
      }
      if (path === "/instructor/assignment-submissions/sub-a/grade" && options?.method === "PATCH") {
        return {
          ...sampleSubmissions[0]!,
          status: "GRADED",
          score: 9,
          feedback: "Bài giải rõ ràng và đủ ý.",
          rubricScores: [
            { criterionId: "crit-1", score: 5 },
            { criterionId: "crit-2", score: 4 },
          ],
        };
      }
      return [];
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["img"], { type: "image/png" }),
      }),
    );

    render(<AssignmentSubmissionReviewScreen classId="cls-1" assignmentId="asg-1" initialSubmissionId="sub-a" />);

    expect(await screen.findByText("Đề bài")).toBeInTheDocument();
    expect(screen.getByText("Câu 1")).toBeInTheDocument();
    expect(screen.getByText("Câu 2")).toBeInTheDocument();
    expect(screen.getByText(/1 học viên chưa nộp/)).toBeInTheDocument();
    expect(await screen.findByText("Nội dung Word của Nguyễn Văn A")).toBeInTheDocument();

    const firstScoreInput = screen.getByLabelText("Điểm Lập luận Câu 1");
    expect(firstScoreInput).toHaveAttribute("step", "0.25");
    fireEvent.change(firstScoreInput, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Điểm Chứng minh Câu 2"), { target: { value: "4" } });
    // Cho phép lưu điểm ngay cả khi không nhập nhận xét (feedback rỗng).
    fireEvent.change(screen.getByLabelText("Nhận xét chi tiết"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Lưu điểm" }));

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "/instructor/assignment-submissions/sub-a/grade",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            rubricScores: [
              { criterionId: "crit-1", score: 5 },
              { criterionId: "crit-2", score: 4 },
            ],
            feedback: "",
            expectedSubmissionRevision: 1,
          }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Học sinh tiếp theo" }));
    expect(await screen.findByRole("img", { name: "hinh-ve-b.png" })).toBeInTheDocument();
  });

  it("hiển thị đúng dòng Phần trắc nghiệm : ? / 7 và Phần tự luận : ? / 3, bước tăng 0.25 và cho phép gõ số lẻ từ bàn phím", async () => {
    const mixedAssignment = {
      ...sampleAssignment,
      maxScore: 10,
      rubric: [
        { id: "mc-1", title: "Phần trắc nghiệm", description: "Điểm phần trắc nghiệm.", maxPoints: 7 },
        { id: "es-1", title: "Phần tự luận", description: "Điểm phần tự luận.", maxPoints: 3 },
      ],
    };

    mocks.apiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/classes") return [sampleClass];
      if (path.startsWith("/academic/assignments?classId=")) return [mixedAssignment];
      if (path === "/instructor/assignments/asg-1/submissions") {
        return [{ ...sampleSubmissions[0]!, attachments: [], content: "Bài giải học sinh" }];
      }
      if (path === "/instructor/classes/cls-1/learners") return [];
      if (path === "/instructor/assignment-submissions/sub-a/grade" && options?.method === "PATCH") {
        return {
          ...sampleSubmissions[0]!,
          status: "GRADED",
          score: 9.35,
          feedback: "",
          rubricScores: [
            { criterionId: "mc-1", score: 6.75 },
            { criterionId: "es-1", score: 2.6 },
          ],
        };
      }
      return [];
    });

    render(<AssignmentSubmissionReviewScreen classId="cls-1" assignmentId="asg-1" initialSubmissionId="sub-a" />);

    const mcInput = await screen.findByLabelText("Điểm Phần trắc nghiệm");
    const essayInput = screen.getByLabelText("Điểm Phần tự luận");
    expect(mcInput).toHaveAttribute("placeholder", "?");
    expect(mcInput).toHaveAttribute("step", "0.25");
    expect(essayInput).toHaveAttribute("placeholder", "?");
    expect(essayInput).toHaveAttribute("step", "0.25");
    expect(screen.getByText("/ 7")).toBeInTheDocument();
    expect(screen.getByText("/ 3")).toBeInTheDocument();

    fireEvent.change(mcInput, { target: { value: "6.75" } });
    fireEvent.change(essayInput, { target: { value: "2.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu điểm" }));

    await waitFor(() => {
      expect(mocks.apiRequest).toHaveBeenCalledWith(
        "/instructor/assignment-submissions/sub-a/grade",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            rubricScores: [
              { criterionId: "mc-1", score: 6.75 },
              { criterionId: "es-1", score: 2.6 },
            ],
            feedback: "",
            expectedSubmissionRevision: 1,
          }),
        }),
      );
    });
  });
});
