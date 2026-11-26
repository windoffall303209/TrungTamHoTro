import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, AssignmentSubmission, DirectoryUser, LearningClass } from "@/lib/learning-types";
import { AssignmentSubmissionReviewScreen } from "@/roles/instructor/class/assignment-submission-review-screen";
import { ClassWorkDetailView } from "@/roles/instructor/class/class-work-detail-view";
import { InstructorQuestionsTab } from "@/roles/instructor/class/tabs/instructor-questions-tab";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  documentViewerRenders: 0,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ classId: "cls-1", assignmentId: "asg-1" }),
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", () => ({
  apiRequest: mocks.apiRequest,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    notify: mocks.notify,
    session: {
      roleCode: "INSTRUCTOR",
      permissions: ["exam:manage", "class:view"],
      user: { id: "inst-1", name: "GV Chấm Bài", email: "gv@wind.edu.vn" },
    },
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }),
}));
vi.mock("@/features/academic/assignment-ai-grading", () => ({
  AssignmentAiGrading: () => <div data-testid="mock-ai-grading" />,
}));
vi.mock("@/features/academic/document-rich-viewer", () => ({
  DocumentRichViewer: function MockDocumentRichViewer() {
    mocks.documentViewerRenders += 1;
    return <div data-testid="mock-document-viewer">Document Viewer</div>;
  },
}));

const sampleAssignment: Assignment = {
  id: "asg-1",
  classId: "cls-1",
  classCode: "TOAN-10A",
  title: "Bài tự luận Chương 1",
  description: "Giải chi tiết",
  instructions: "Câu 1: Chứng minh bất đẳng thức.",
  dueAt: "2026-12-20T10:00:00Z",
  maxScore: 10,
  rubric: [{ id: "r1", title: "Lập luận", description: "Đúng logic", maxPoints: 10 }],
  status: "PUBLISHED",
  version: 1,
  createdById: "inst-1",
  createdAt: "2026-11-01T08:00:00Z",
};

const sampleSubmission: AssignmentSubmission = {
  id: "sub-1",
  assignmentId: "asg-1",
  learnerId: "lrn-1",
  learnerName: "Nguyễn Minh Anh",
  learnerEmail: "anh@wind.edu.vn",
  content: "Lời giải trình bày đầy đủ từng bước.",
  attachments: [
    {
      id: "att-1",
      originalName: "bai-lam.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12000,
      createdAt: "2026-11-10T08:00:00Z",
      canPreview: true,
    },
  ],
  status: "SUBMITTED",
  revision: 1,
  submittedAt: "2026-11-10T08:00:00Z",
  rubricScores: [],
};

const sampleClass: LearningClass = {
  id: "cls-1",
  code: "TOAN-10A",
  name: "Toán 10A",
  courseId: "course-1",
  courseVersion: 1,
  term: "HK1",
  startAt: "2026-01-01T00:00:00Z",
  endAt: "2026-12-31T00:00:00Z",
  capacity: 30,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  instructorIds: ["inst-1"],
  learnerIds: ["lrn-1"],
};

const learners: DirectoryUser[] = [
  { id: "lrn-1", displayName: "Nguyễn Minh Anh", email: "anh@wind.edu.vn", roleCode: "LEARNER" },
  { id: "lrn-2", displayName: "Lê Hoàng Nam", email: "nam@wind.edu.vn", roleCode: "LEARNER" },
];

describe("C06c Questions tab debounce & grading state isolation", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.notify.mockReset();
    mocks.push.mockReset();
    mocks.documentViewerRenders = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("gõ tìm kiếm trong InstructorQuestionsTab cô lập ở state cục bộ và chỉ gửi 1 lần sau debounce 250ms", () => {
    vi.useFakeTimers();
    let parentRenders = 0;
    const onSearchCommit = vi.fn();

    /** Vỏ cha đo số lần re-render khi người dùng gõ liên tiếp vào ô tìm câu hỏi. */
    function QuestionsParent() {
      parentRenders += 1;
      return (
        <InstructorQuestionsTab
          className="Toán 10A"
          questionBankTab="ALL"
          questionBankSearch=""
          questionBankDifficulty="ALL"
          questionSummary={{ total: 2, multipleChoice: 2, essay: 0 }}
          questionBankLoading={false}
          questionBankError=""
          pagedClassQuestions={[]}
          questionDisplayPage={1}
          questionPageSize={10}
          questionTotalItems={0}
          onChangeTab={vi.fn()}
          onSearchCommit={onSearchCommit}
          onChangeDifficulty={vi.fn()}
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
          onRetry={vi.fn()}
          onOpenCreateExam={vi.fn()}
          onOpenCreateQuestion={vi.fn()}
          onEditQuestion={vi.fn()}
        />
      );
    }

    render(<QuestionsParent />);
    expect(parentRenders).toBe(1);

    const searchInput = screen.getByPlaceholderText("Tìm câu hỏi, nguồn...");
    fireEvent.change(searchInput, { target: { value: "h" } });
    fireEvent.change(searchInput, { target: { value: "hà" } });
    fireEvent.change(searchInput, { target: { value: "hàm số" } });

    expect(parentRenders).toBe(1);
    expect(onSearchCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(260);
    expect(onSearchCommit).toHaveBeenCalledTimes(1);
    expect(onSearchCommit).toHaveBeenCalledWith("hàm số");
  });

  it("gõ lọc học sinh và đổi tab con trong ClassWorkDetailView không re-render thành phần cha", () => {
    let parentRenders = 0;

    /** Vỏ cha kiểm chứng ClassWorkDetailView tự quản lý state lọc bảng điểm bài tập. */
    function DetailParent() {
      parentRenders += 1;
      return (
        <ClassWorkDetailView
          work={{ kind: "ASSIGNMENT", assignment: sampleAssignment }}
          roleCode="INSTRUCTOR"
          locale="vi-VN"
          learners={learners}
          submissions={[sampleSubmission]}
          changingWork={false}
          onBack={vi.fn()}
          onOpenPreviewModal={vi.fn()}
          onTryWork={vi.fn()}
          onEditWork={vi.fn()}
          onToggleVisibility={vi.fn()}
          onDeleteWork={vi.fn()}
          onPreviewMaterial={vi.fn()}
          onDownloadMaterial={vi.fn()}
        />
      );
    }

    render(<DetailParent />);
    expect(parentRenders).toBe(1);

    const searchInput = screen.getByPlaceholderText("Nhập để tìm kiếm...");
    fireEvent.change(searchInput, { target: { value: "Minh Anh" } });
    expect(screen.getByText("Nguyễn Minh Anh")).toBeInTheDocument();
    expect(screen.queryByText("Lê Hoàng Nam")).not.toBeInTheDocument();

    // Đổi sub-tab giữa Tổng quan và Bảng điểm vẫn không re-render thành phần cha.
    fireEvent.click(screen.getByRole("button", { name: "Tổng quan" }));
    fireEvent.click(screen.getByRole("button", { name: "Bảng điểm" }));
    expect(parentRenders).toBe(1);
  });

  it("gõ nhận xét và sửa điểm rubric trong AssignmentSubmissionReviewScreen không re-render DocumentRichViewer", async () => {
    mocks.apiRequest.mockImplementation(async (path: string) => {
      if (path === "/classes") return [sampleClass];
      if (path === "/academic/assignments?classId=cls-1") return [sampleAssignment];
      if (path === "/instructor/assignments/asg-1/submissions") return [sampleSubmission];
      if (path === "/instructor/classes/cls-1/learners") return learners;
      return [];
    });

    render(<AssignmentSubmissionReviewScreen classId="cls-1" assignmentId="asg-1" />);
    await screen.findByTestId("mock-document-viewer");
    const rendersBeforeTyping = mocks.documentViewerRenders;
    expect(rendersBeforeTyping).toBeGreaterThanOrEqual(1);

    const scoreInput = screen.getByLabelText("Điểm Lập luận");
    const feedbackInput = screen.getByLabelText("Nhận xét chi tiết");

    fireEvent.change(scoreInput, { target: { value: "8.5" } });
    fireEvent.change(feedbackInput, { target: { value: "Trình bày rõ" } });
    fireEvent.change(feedbackInput, { target: { value: "Trình bày rõ ràng, lập luận chặt chẽ" } });
    fireEvent.change(feedbackInput, { target: { value: "Trình bày rõ ràng, lập luận chặt chẽ và sạch đẹp." } });

    await waitFor(() => {
      expect(feedbackInput).toHaveValue("Trình bày rõ ràng, lập luận chặt chẽ và sạch đẹp.");
    });
    // Cột tài liệu/DocumentRichViewer không hề re-render thêm lần nào khi gõ điểm & nhận xét.
    expect(mocks.documentViewerRenders).toBe(rendersBeforeTyping);
  });
});
