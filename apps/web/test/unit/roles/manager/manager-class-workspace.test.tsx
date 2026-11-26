import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManagerClassWorkspace } from "../../../../src/roles/manager/manager-class-workspace";
import type { Course, LearningClass, Material } from "@/lib/learning-types";
import { usePagination } from "@/shared/ui/ui";

const mockApiRequest = vi.hoisted(() => vi.fn());
const mockDownloadApiFile = vi.hoisted(() => vi.fn());
const mockPreviewApiFile = vi.hoisted(() => vi.fn());
const mockLoadClassMaterials = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  apiRequest: mockApiRequest,
  downloadApiFile: mockDownloadApiFile,
  previewApiFile: mockPreviewApiFile,
}));

vi.mock("@/lib/materials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/materials")>();
  return {
    ...actual,
    loadClassMaterials: mockLoadClassMaterials,
  };
});

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      sessionId: "manager-session",
      roleCode: "CENTER_MANAGER",
      permissions: [],
      availableRoles: [],
      user: {
        id: "mgr-1",
        username: "manager",
        name: "Quản lý trung tâm",
        email: "manager@windoffall.me",
        roleName: "Quản lý trung tâm",
      },
    },
    notify: vi.fn(),
  }),
}));

vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }),
}));

const dummyClass: LearningClass = {
  id: "cls-1",
  courseId: "crs-1",
  courseVersion: 1,
  code: "TOAN10A",
  name: "Lớp Toán 10A",
  term: "2026-2027",
  startAt: "2026-10-01T00:00:00Z",
  endAt: "2026-12-31T00:00:00Z",
  capacity: 40,
  timezone: "Asia/Bangkok",
  allowLateEnrollment: true,
  status: "ACTIVE",
  instructorIds: ["ins-1"],
  learnerIds: ["lrn-1"],
};

const dummyCourse: Course = {
  id: "crs-1",
  code: "MATH101",
  name: "Toán học cơ bản",
  description: "Khóa học toán",
  outcomes: [],
  version: 1,
  status: "PUBLISHED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sampleMaterials: Material[] = [
  {
    id: "mat-pub",
    classId: "cls-1",
    ownerId: "ins-1",
    name: "Đề cương công khai.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1048576,
    folder: "Chương 1",
    tags: [],
    version: 1,
    visibility: "PUBLISHED",
    scope: "CLASS",
    createdAt: "2026-10-20T09:00:00Z",
  },
  {
    id: "mat-hid",
    classId: "cls-1",
    ownerId: "ins-1",
    name: "Đáp án đang ẩn.pdf",
    mimeType: "application/pdf",
    sizeBytes: 524288,
    folder: "Chương 1",
    tags: [],
    version: 1,
    visibility: "HIDDEN",
    scope: "CLASS",
    createdAt: "2026-10-21T09:00:00Z",
  },
  {
    id: "lec-pub",
    classId: "cls-1",
    ownerId: "ins-1",
    name: "Bài giảng công khai.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2097152,
    folder: "Chuyên đề 1",
    tags: ["lecture"],
    version: 1,
    visibility: "PUBLISHED",
    scope: "CLASS",
    createdAt: "2026-10-20T10:00:00Z",
  },
  {
    id: "lec-hid",
    classId: "cls-1",
    ownerId: "ins-1",
    name: "Bài giảng đã ẩn.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2097152,
    folder: "Chuyên đề 1",
    tags: ["lecture"],
    version: 1,
    visibility: "HIDDEN",
    scope: "CLASS",
    createdAt: "2026-10-21T10:00:00Z",
  },
];

// Bọc ManagerClassWorkspace với state phân trang tối thiểu để kiểm thử giao diện quản trị viên.
function ManagerWorkspaceHarness() {
  const learnerPagination = usePagination([], 10);
  return (
    <ManagerClassWorkspace
      item={dummyClass}
      course={dummyCourse}
      roster={null}
      readiness={null}
      saving={false}
      onBack={vi.fn()}
      instructorForm={{ userId: "", role: "CO_INSTRUCTOR" }}
      setInstructorForm={vi.fn()}
      learnerId=""
      setLearnerId={vi.fn()}
      bulkLearners=""
      setBulkLearners={vi.fn()}
      importResults={[]}
      removeTarget={null}
      setRemoveTarget={vi.fn()}
      transferTarget={null}
      setTransferTarget={vi.fn()}
      activeEnrollments={[]}
      instructors={[]}
      primaryInstructor={{ instructorId: "ins-1", displayName: "Cô Lan" }}
      learnerPagination={learnerPagination}
      assignInstructor={vi.fn(async () => {})}
      transferPrimary={vi.fn(async () => {})}
      enrollLearner={vi.fn(async () => {})}
      importEnrollments={vi.fn(async () => {})}
      removeMember={vi.fn(async () => {})}
      activate={vi.fn(async () => {})}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockLoadClassMaterials.mockReset();
  mockLoadClassMaterials.mockResolvedValue(sampleMaterials);
  mockApiRequest.mockResolvedValue({ url: "/materials/mat-pub/download" });
});

describe("ManagerClassWorkspace visibility controls", () => {
  it("hiển thị tài liệu đã ẩn với nhãn Đã ẩn và khóa nút Xem trước, Tải xuống với quản lý", async () => {
    render(<ManagerWorkspaceHarness />);
    expect(mockLoadClassMaterials).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Tài liệu" }));
    await waitFor(() => expect(mockLoadClassMaterials).toHaveBeenCalledWith("cls-1", expect.objectContaining({ roleCode: "CENTER_MANAGER" })));

    expect((await screen.findAllByText("Đề cương công khai.pdf")).length).toBeGreaterThan(0);
    expect(screen.getByText("Đáp án đang ẩn.pdf")).toBeInTheDocument();

    // Khi đang chọn tài liệu công khai, các nút xem trước và tải xuống hoạt động bình thường.
    expect(screen.getByRole("button", { name: "Xem trước" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Tải xuống" })).not.toBeDisabled();

    // Chọn tài liệu đang ẩn: hiện thông báo và khóa toàn bộ nút xem/tải.
    fireEvent.click(screen.getByText("Đáp án đang ẩn.pdf"));
    expect(
      screen.getByText("Tài liệu đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem trước" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tải xuống" })).toBeDisabled();
  });

  it("không còn ô Tóm tắt nội dung ở tab Bài giảng và khóa Xem bài giảng khi mục đã ẩn", async () => {
    render(<ManagerWorkspaceHarness />);
    expect(mockLoadClassMaterials).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Bài giảng" }));

    expect((await screen.findAllByText("Bài giảng công khai.mp4")).length).toBeGreaterThan(0);
    expect(screen.getByText("Bài giảng đã ẩn.mp4")).toBeInTheDocument();
    expect(screen.queryByText("Tóm tắt nội dung")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem bài giảng" })).not.toBeDisabled();

    fireEvent.click(screen.getByText("Bài giảng đã ẩn.mp4"));
    expect(
      screen.getByText("Bài giảng đang ở trạng thái đã ẩn nên quản trị viên không thể xem hoặc tải xuống."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem bài giảng" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tổng quan" }));
    fireEvent.click(screen.getByRole("button", { name: "Tài liệu" }));
    expect(screen.getByText("Đáp án đang ẩn.pdf")).toBeInTheDocument();
    expect(mockLoadClassMaterials).toHaveBeenCalledTimes(1);
  });
});
