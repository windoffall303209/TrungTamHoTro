import { Profiler } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectoryUser, GradebookRow, LearningClass } from "@/lib/learning-types";
import { InstructorGradebookTab } from "@/roles/instructor/class/tabs/instructor-gradebook-tab";
import { InstructorMembersTab } from "@/roles/instructor/class/tabs/instructor-members-tab";
import { InstructorRolesTab } from "@/roles/instructor/class/tabs/instructor-roles-tab";
import { InstructorSettingsTab } from "@/roles/instructor/class/tabs/instructor-settings-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ notify: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const learners: DirectoryUser[] = [
  { id: "lrn-1", displayName: "Nguyễn Minh Anh", email: "minhanh@wind.edu.vn", roleCode: "LEARNER" },
  { id: "lrn-2", displayName: "Trần Quốc Bảo", email: "quocbao@wind.edu.vn", roleCode: "LEARNER" },
];

const gradebookRows: GradebookRow[] = [
  {
    learnerId: "lrn-1",
    learnerName: "Nguyễn Minh Anh",
    learnerEmail: "minhanh@wind.edu.vn",
    examEarned: 9,
    examPossible: 10,
    assignmentEarned: 8,
    assignmentPossible: 10,
    totalPercent: 85,
    averageScore: 8.5,
    awaitingGrade: 0,
    notSubmitted: 0,
  },
  {
    learnerId: "lrn-2",
    learnerName: "Trần Quốc Bảo",
    learnerEmail: "quocbao@wind.edu.vn",
    examEarned: 7,
    examPossible: 10,
    assignmentEarned: 6,
    assignmentPossible: 10,
    totalPercent: 65,
    averageScore: 6.5,
    awaitingGrade: 0,
    notSubmitted: 0,
  },
];

const sampleClass: LearningClass = {
  id: "cls-1",
  code: "TOAN-10A",
  name: "Toán 10A",
  courseId: "course-1",
  courseVersion: 1,
  grade: "10",
  subject: "Toán",
  term: "HK1",
  startAt: "2026-01-01T00:00:00Z",
  endAt: "2026-12-31T00:00:00Z",
  capacity: 30,
  timezone: "Asia/Bangkok",
  status: "ACTIVE",
  instructorIds: ["inst-1"],
  learnerIds: ["lrn-1", "lrn-2"],
};

describe("C06a Instructor core tabs isolation (members, roles, gradebook, settings)", () => {
  it("cô lập state tìm kiếm trong InstructorMembersTab — gõ phím không re-render thành phần cha", () => {
    let parentRenders = 0;
    /** Vỏ cha mô phỏng workspace để đo số lần render khi gõ vào ô tìm kiếm của tab con. */
    function ParentHarness() {
      parentRenders += 1;
      return (
        <InstructorMembersTab
          instructorName="GV Chính"
          instructorEmail="gv@wind.edu.vn"
          learners={learners}
        />
      );
    }

    const onProfile = vi.fn();
    render(
      <Profiler id="members-parent" onRender={onProfile}>
        <ParentHarness />
      </Profiler>,
    );

    expect(parentRenders).toBe(1);
    const input = screen.getByPlaceholderText("Tìm học sinh theo tên/email...");
    fireEvent.change(input, { target: { value: "Minh" } });
    fireEvent.change(input, { target: { value: "Minh Anh" } });

    expect(screen.getByText("Nguyễn Minh Anh")).toBeInTheDocument();
    expect(screen.queryByText("Trần Quốc Bảo")).not.toBeInTheDocument();
    expect(parentRenders).toBe(1);
  });

  it("cô lập state tìm kiếm trong InstructorGradebookTab — gõ phím lọc bảng điểm không re-render cha", () => {
    let parentRenders = 0;
    /** Vỏ cha mô phỏng workspace để đo số lần render khi lọc bảng điểm. */
    function GradebookParent() {
      parentRenders += 1;
      return <InstructorGradebookTab className="Toán 10A" gradebook={gradebookRows} />;
    }

    render(<GradebookParent />);
    expect(parentRenders).toBe(1);

    const search = screen.getByPlaceholderText("Tìm theo tên hoặc email...");
    fireEvent.change(search, { target: { value: "quocbao" } });

    expect(screen.getByText("Trần Quốc Bảo")).toBeInTheDocument();
    expect(screen.queryByText("Nguyễn Minh Anh")).not.toBeInTheDocument();
    expect(parentRenders).toBe(1);
  });

  it("hiển thị đúng danh sách đồng giảng viên trong InstructorRolesTab và thông tin lớp trong InstructorSettingsTab", () => {
    render(
      <>
        <InstructorRolesTab
          currentUserId="inst-1"
          currentUserName="GV Chính"
          currentUserEmail="gv@wind.edu.vn"
          instructors={[
            { instructorId: "inst-1", role: "PRIMARY", displayName: "GV Chính", email: "gv@wind.edu.vn" },
            { instructorId: "inst-2", role: "CO_INSTRUCTOR", displayName: "GV Phụ", email: "gvphu@wind.edu.vn" },
          ]}
        />
        <InstructorSettingsTab item={sampleClass} course={null} />
      </>,
    );

    expect(screen.getByText("GV Phụ")).toBeInTheDocument();
    expect(screen.getByText("Đồng giáo viên")).toBeInTheDocument();
    expect(screen.getByText("TOAN-10A")).toBeInTheDocument();
    expect(screen.getByText("Khối 10")).toBeInTheDocument();
  });
});
