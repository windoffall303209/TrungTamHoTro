import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClassGradebookTable } from "../../../../../src/features/academic/class-gradebook-table";
import { ClassFeedView } from "../../../../../src/features/class-feed/class-feed-view";
import { InstructorGradebookTab } from "../../../../../src/roles/instructor/class/tabs/instructor-gradebook-tab";
import { InstructorSettingsTab } from "../../../../../src/roles/instructor/class/tabs/instructor-settings-tab";
import type { GradebookAssessmentColumn, GradebookRow, LearningClass } from "../../../../../src/lib/learning-types";

const { apiRequest, notify, push, session } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  notify: vi.fn(),
  push: vi.fn(),
  session: {
    current: {
      roleCode: "INSTRUCTOR" as "INSTRUCTOR" | "LEARNER",
      user: { id: "inst-1", name: "GV Toán", username: "gvtoan", avatarUrl: null },
    },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
  publicApiUrl: (path: string) => `http://localhost:4000/api/v1${path}`,
}));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: session.current, notify }) }));
vi.mock("@/providers/i18n-provider", () => ({ useI18n: () => ({ locale: "vi-VN", t: (v: string) => v }) }));

const baseClass: LearningClass = {
  id: "cls-1",
  courseId: "crs-1",
  courseVersion: 1,
  code: "TOAN-10A1",
  name: "Lớp Toán 10A1",
  term: "2026-2027",
  grade: "10",
  subject: "Toán học",
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2027-05-30T00:00:00.000Z",
  capacity: 40,
  timezone: "Asia/Bangkok",
  allowPeerGradeViewing: false,
  allowLearnerFeedPosting: true,
  avatarUrl: null,
  status: "ACTIVE",
  instructorIds: ["inst-1"],
  learnerIds: ["learner-1"],
};

const assessments: GradebookAssessmentColumn[] = [
  { id: "asg-1", kind: "ASSIGNMENT", title: "Bài tự luận 1", maxScore: 10 },
  { id: "exam-1", kind: "EXAM", title: "Đề trắc nghiệm 1", maxScore: 10 },
  { id: "exam-2", kind: "EXAM", title: "Đề hỗn hợp 2", maxScore: 10 },
];

const gradebookRows: GradebookRow[] = [
  {
    learnerId: "learner-1",
    learnerName: "Nguyễn Minh An",
    learnerEmail: "hocvien001@wind.edu.vn",
    examEarned: 10,
    examPossible: 10,
    assignmentEarned: 0,
    assignmentPossible: 10,
    totalPercent: 50,
    averageScore: 5,
    awaitingGrade: 2,
    notSubmitted: 0,
    cells: [
      { assessmentId: "asg-1", status: "AWAITING_GRADE", submissionId: "sub-1" },
      { assessmentId: "exam-1", status: "GRADED", score: 10, attemptId: "att-1" },
      { assessmentId: "exam-2", status: "AWAITING_GRADE", attemptId: "att-2" },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  session.current = {
    roleCode: "INSTRUCTOR",
    user: { id: "inst-1", name: "GV Toán", username: "gvtoan", avatarUrl: null },
  };
});

describe("Bảng điểm tương tác giảng viên, bảng điểm chỉ xem học sinh và cài đặt lớp học", () => {
  it("nhấn Chờ chấm ở bài tự luận chuyển tới màn hình chấm bài, nhấn điểm ở đề thi mở modal xem chi tiết và chấm bài chờ chấm", async () => {
    const refresh = vi.fn();
    apiRequest
      .mockResolvedValueOnce({
        attempt: { id: "att-1", examId: "exam-1", learnerId: "learner-1", status: "GRADED", score: 10, feedback: "Làm bài rất tốt" },
        exam: { id: "exam-1", classId: "cls-1", title: "Đề trắc nghiệm 1", totalScore: 10 },
        learner: { id: "learner-1", name: "Nguyễn Minh An", email: "hocvien001@wind.edu.vn" },
        questions: [
          { questionId: "q-1", type: "SINGLE_CHOICE", content: "1 + 1 = ?", submittedAnswers: ["2"], awardedScore: 10, maxScore: 10, requiresManualGrade: false },
        ],
      })
      .mockResolvedValueOnce({
        attempt: { id: "att-2", examId: "exam-2", learnerId: "learner-1", status: "SUBMITTED", score: 5 },
        exam: { id: "exam-2", classId: "cls-1", title: "Đề hỗn hợp 2", totalScore: 10 },
        learner: { id: "learner-1", name: "Nguyễn Minh An", email: "hocvien001@wind.edu.vn" },
        questions: [
          { questionId: "q-obj", type: "SINGLE_CHOICE", content: "2 + 2 = ?", submittedAnswers: ["4"], awardedScore: 5, maxScore: 5, requiresManualGrade: false },
          { questionId: "q-essay", type: "ESSAY", content: "Giải thích định lý", submittedAnswers: ["Trình bày rõ"], awardedScore: 0, maxScore: 5, requiresManualGrade: true },
        ],
      })
      .mockResolvedValueOnce({ id: "att-2", status: "GRADED", score: 9 });

    render(
      <InstructorGradebookTab
        classId="cls-1"
        roleCode="INSTRUCTOR"
        className="Lớp Toán 10A1"
        gradebook={gradebookRows}
        assessments={assessments}
        onRefreshGradebook={refresh}
      />,
    );

    // 1. Nhấn Chờ chấm bài tự luận → điều hướng thẳng màn hình chấm bài của học sinh đó
    fireEvent.click(screen.getByLabelText("Chấm bài Bài tự luận 1 của Nguyễn Minh An"));
    expect(push).toHaveBeenCalledWith(
      "/courses/classes/cls-1/assignments/asg-1/submissions?submissionId=sub-1&from=gradebook",
    );

    // 2. Nhấn điểm số 10 ở đề thi đã chấm → mở modal Chi tiết bài làm (không có nút Lưu điểm)
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Xem chi tiết Đề trắc nghiệm 1 của Nguyễn Minh An"));
    });
    expect(await screen.findByText(/Chi tiết bài làm/)).toBeInTheDocument();
    expect(screen.getByText("Làm bài rất tốt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lưu điểm & Công bố" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Đóng chi tiết bài làm"));

    // 3. Nhấn Chờ chấm ở đề thi hỗn hợp → mở modal Chấm bài và lưu điểm tự luận
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Chấm bài Đề hỗn hợp 2 của Nguyễn Minh An"));
    });
    expect(await screen.findByText(/Chấm bài chờ chấm/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Điểm câu 2"), { target: { value: "4" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Lưu điểm & Công bố" }));
    });
    expect(apiRequest).toHaveBeenLastCalledWith("/instructor/exam-attempts/att-2/grade", {
      method: "PATCH",
      roleCode: "INSTRUCTOR",
      body: JSON.stringify({
        score: 9,
        feedback: "",
        questionScores: [{ questionId: "q-essay", score: 4 }],
      }),
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("bảng điểm ở phía học sinh ở chế độ chỉ xem, không dựng nút bấm chấm bài hoặc xem chi tiết", () => {
    render(<ClassGradebookTable rows={gradebookRows} assessments={assessments} />);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getAllByText("Chờ chấm")).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("giảng viên lưu cài đặt xem bảng điểm, quyền học sinh đăng bài và cập nhật/xóa avatar lớp", async () => {
    const onClassUpdated = vi.fn();
    apiRequest
      .mockResolvedValueOnce({
        ...baseClass,
        name: "Lớp Toán 10A1 Nâng cao",
        allowPeerGradeViewing: true,
        allowLearnerFeedPosting: false,
      })
      .mockResolvedValueOnce({ ...baseClass, avatarUrl: "/classes/cls-1/avatar?v=123" })
      .mockResolvedValueOnce({ ...baseClass, avatarUrl: null });

    const { rerender } = render(
      <InstructorSettingsTab
        item={baseClass}
        course={null}
        roleCode="INSTRUCTOR"
        onClassUpdated={onClassUpdated}
      />,
    );

    expect(screen.queryByText(/Cho phép ghi danh muộn/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Cho phép học sinh xem bảng điểm/));
    fireEvent.click(screen.getByLabelText(/Cho phép học sinh đăng bài trên bảng tin/));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Lưu cài đặt" }));
    });
    expect(apiRequest).toHaveBeenCalledWith("/classes/cls-1/settings", {
      method: "PATCH",
      roleCode: "INSTRUCTOR",
      body: JSON.stringify({
        name: "Lớp Toán 10A1",
        capacity: 40,
        allowPeerGradeViewing: true,
        allowLearnerFeedPosting: false,
      }),
    });
    expect(onClassUpdated).toHaveBeenCalled();

    // Tải ảnh đại diện lớp
    const avatarFile = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "lop.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Chọn ảnh đại diện lớp học"), {
        target: { files: [avatarFile] },
      });
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "/classes/cls-1/avatar",
      expect.objectContaining({ method: "POST", roleCode: "INSTRUCTOR", body: expect.any(FormData) }),
    );

    // Gỡ ảnh đại diện lớp về icon mặc định
    rerender(
      <InstructorSettingsTab
        item={{ ...baseClass, avatarUrl: "/classes/cls-1/avatar?v=123" }}
        course={null}
        roleCode="INSTRUCTOR"
        onClassUpdated={onClassUpdated}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dùng icon mặc định" }));
    });
    expect(apiRequest).toHaveBeenLastCalledWith("/classes/cls-1/avatar", {
      method: "DELETE",
      roleCode: "INSTRUCTOR",
    });
  });

  it("ẩn khung đăng bài bảng tin đối với học viên khi allowLearnerFeedPosting = false", async () => {
    session.current = {
      roleCode: "LEARNER",
      user: { id: "learner-1", name: "Học viên", username: "hs", avatarUrl: null },
    };
    apiRequest.mockResolvedValueOnce([]);
    render(
      <ClassFeedView
        classItem={{ id: "cls-1", code: "TOAN-10A1", name: "Lớp Toán 10A1", allowLearnerFeedPosting: false }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("Giảng viên hiện tắt quyền đăng bài của học sinh trên bảng tin."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Nội dung bài viết bảng tin")).not.toBeInTheDocument();
  });
});
