import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assignment, LearningClass } from "@/lib/learning-types";
import { AssignmentSubmissionDialog } from "../../../../src/features/academic/assignment-submission-dialog";
import { useAcademicModel } from "../../../../src/features/academic/use-academic-model";
import { ClassWorkDetailView } from "../../../../src/roles/instructor/class/class-work-detail-view";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  roleCode: "LEARNER" as "LEARNER" | "INSTRUCTOR",
}));

const searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/api-client", () => ({
  publicApiUrl: (path: string) => path,
  apiRequest: mocks.request,
  downloadApiFile: mocks.downloadApiFile,
  previewApiFile: mocks.previewApiFile,
}));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: mocks.roleCode }, notify: mocks.notify }),
}));
vi.mock("@/shared/ui/ui", async () => {
  const actual = await vi.importActual<typeof import("@/shared/ui/ui")>("@/shared/ui/ui");
  return { ...actual, usePagination: () => ({ resetPage: vi.fn() }) };
});

const dummyClass: LearningClass = {
  id: "class-1",
  courseId: "course-1",
  courseVersion: 1,
  code: "C01",
  name: "Lớp thử nghiệm",
  term: "2026-FALL",
  startAt: "2026-09-01T00:00:00Z",
  endAt: "2026-12-01T00:00:00Z",
  capacity: 30,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  instructorIds: [],
  learnerIds: [],
};

const existingAssignment: Assignment = {
  id: "asg-1",
  classId: "class-1",
  classCode: "C01",
  title: "Bài tập viết báo cáo",
  description: "Mô tả bài tập",
  instructions: "Đính kèm tệp PDF bài làm.",
  dueAt: "2099-01-01T00:00:00Z",
  maxScore: 10,
  rubric: [{ id: "crit-1", title: "Nội dung", description: "Đúng yêu cầu", maxPoints: 10 }],
  status: "PUBLISHED",
  version: 1,
  createdById: "usr-instructor",
  createdAt: "2026-10-01T00:00:00Z",
  submission: {
    id: "sub-1",
    assignmentId: "asg-1",
    learnerId: "usr-learner",
    learnerName: "Nguyễn An",
    learnerEmail: "an@example.com",
    content: "Bài cũ",
    status: "SUBMITTED",
    revision: 1,
    submittedAt: "2026-10-02T00:00:00Z",
    rubricScores: [],
    attachments: [
      {
        id: "att-old",
        originalName: "cu.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        createdAt: "2026-10-02T00:00:00Z",
        canPreview: true,
      },
    ],
  },
};

// Dựng wrapper gắn hook useAcademicModel vào AssignmentSubmissionDialog để kiểm tra luồng nộp lại.
function Harness() {
  const model = useAcademicModel();
  return (
    <div>
      <button type="button" onClick={() => model.openSubmissionDialog(existingAssignment)}>
        Mở nộp bài
      </button>
      <AssignmentSubmissionDialog model={model} />
    </div>
  );
}

describe("Resubmission and attachment preview/download flows", () => {
  beforeEach(() => {
    mocks.roleCode = "LEARNER";
    mocks.request.mockReset();
    mocks.downloadApiFile.mockReset().mockResolvedValue(undefined);
    mocks.previewApiFile.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["pdf"], { type: "application/pdf" }) }));
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL() { return "blob:test"; }
      static override revokeObjectURL() {}
    });
    mocks.notify.mockReset();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/classes") return Promise.resolve([dummyClass]);
      if (path === "/academic/classes/class-1/gradebook") return Promise.resolve([]);
      if (path.startsWith("/academic/assignments/page?")) {
        return Promise.resolve({ items: [existingAssignment], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      }
      if (path === "/academic/calendar") return Promise.resolve([]);
      if (path === "/academic/announcements") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("không xóa bài hiện tại khi nộp lại thất bại và gửi keepAttachmentIds nguyên tử khi lưu", async () => {
    const { result } = renderHook(() => useAcademicModel());
    await waitFor(() => expect(result.current.dataReady).toBe(true));

    act(() => result.current.openSubmissionDialog(existingAssignment));
    expect(result.current.removedStoredIds).toEqual([]);

    // Đánh dấu bỏ tệp cũ chỉ diễn ra cục bộ, chưa gọi DELETE lên server.
    act(() => result.current.removeStoredAttachment("att-old"));
    expect(result.current.removedStoredIds).toEqual(["att-old"]);
    expect(mocks.request).not.toHaveBeenCalledWith(
      expect.stringContaining("/attachments/"),
      expect.anything(),
    );

    // Khôi phục lại rồi gỡ lại để xác nhận trạng thái cục bộ.
    act(() => result.current.restoreStoredAttachment("att-old"));
    expect(result.current.removedStoredIds).toEqual([]);
    act(() => result.current.removeStoredAttachment("att-old"));

    // Chọn tệp mới thay thế.
    const newFile = new File(["%PDF-1.4\nnew"], "moi.pdf", { type: "application/pdf" });
    const fileList = { 0: newFile, length: 1, item: (i: number) => (i === 0 ? newFile : null) } as unknown as FileList;
    act(() => result.current.chooseSubmissionFiles(fileList));

    // Giả lập lỗi máy chủ (antivirus/xung đột) khi bấm Lưu thay đổi.
    mocks.request.mockImplementationOnce(() => Promise.reject(new Error("Tệp không an toàn.")));
    await act(async () => {
      await result.current.submitAssignment({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });
    expect(result.current.submissionError).toBe("Tệp không an toàn.");
    expect(result.current.submitting?.submission?.attachments[0]?.id).toBe("att-old");

    // Nộp lại thành công: gửi expectedRevision=1, keepAttachmentIds=[] và file mới.
    let submittedFormData: FormData | undefined;
    mocks.request.mockImplementation((path: string, init?: { method?: string; body?: BodyInit }) => {
      if (path === "/learner/assignments/asg-1/submissions" && init?.method === "POST") {
        submittedFormData = init.body as FormData;
        return Promise.resolve({ ...existingAssignment.submission, revision: 2 });
      }
      if (path === "/classes") return Promise.resolve([dummyClass]);
      if (path === "/academic/classes/class-1/gradebook") return Promise.resolve([]);
      if (path.startsWith("/academic/assignments/page?")) {
        return Promise.resolve({ items: [existingAssignment], total: 1, page: 1, pageSize: 10, totalPages: 1 });
      }
      if (path === "/academic/calendar") return Promise.resolve([]);
      if (path === "/academic/announcements") return Promise.resolve([]);
      throw new Error(`Unexpected request: ${path}`);
    });

    await act(async () => {
      await result.current.submitAssignment({ preventDefault: vi.fn() } as unknown as React.FormEvent);
    });
    expect(submittedFormData?.get("expectedRevision")).toBe("1");
    expect(submittedFormData?.get("keepAttachmentIds")).toBe("[]");
    expect((submittedFormData?.getAll("files")[0] as File | undefined)?.name).toBe("moi.pdf");
    expect(result.current.submitting).toBeNull();
  });

  it("hỗ trợ xem trước, tải về và hoàn tác tệp đã nộp trong hộp thoại AssignmentSubmissionDialog", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        expect.stringMatching(/^\/academic\/assignments\/page\?/),
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Mở nộp bài" }));
    expect(screen.getByText(/^cu\.pdf/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xem trước cu.pdf" }));
    expect(await screen.findByTitle("cu.pdf")).toHaveAttribute("src", "blob:test");

    fireEvent.click(screen.getByRole("button", { name: "Tải cu.pdf" }));
    expect(mocks.downloadApiFile).toHaveBeenCalledWith(
      "/assignment-submissions/sub-1/attachments/att-old",
      "LEARNER",
    );

    fireEvent.click(screen.getByRole("button", { name: "Xóa cu.pdf" }));
    expect(screen.getByText("Sẽ xóa khi lưu bài nộp mới")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Khôi phục cu.pdf" }));
    expect(screen.queryByText("Sẽ xóa khi lưu bài nộp mới")).not.toBeInTheDocument();
  });

  it("cho phép giảng viên mở trang chấm và xem bài làm chuyên biệt từ ClassWorkDetailView", async () => {
    mocks.roleCode = "INSTRUCTOR";
    mocks.push.mockReset();
    render(
      <ClassWorkDetailView
        work={{ kind: "ASSIGNMENT", assignment: existingAssignment }}
        roleCode="INSTRUCTOR"
        locale="vi-VN"
        learners={[{ id: "usr-learner", displayName: "Nguyễn An", email: "an@example.com", roleCode: "LEARNER" }]}
        submissions={[existingAssignment.submission!]}
        subTab="gradebook"
        onChangeSubTab={vi.fn()}
        statusFilter="ALL"
        onChangeStatusFilter={vi.fn()}
        studentSearch=""
        onChangeStudentSearch={vi.fn()}
        changingWork={false}
        onBack={vi.fn()}
        onOpenPreviewModal={vi.fn()}
        onTryWork={vi.fn()}
        onEditWork={vi.fn()}
        onToggleVisibility={vi.fn()}
        onDeleteWork={vi.fn()}
        onPreviewMaterial={vi.fn()}
        onDownloadMaterial={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem bài làm" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/courses/classes/class-1/assignments/asg-1/submissions?submissionId=sub-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "Trang chấm bài" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/courses/classes/class-1/assignments/asg-1/submissions",
    );
  });
});
