import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course, CourseVersionSnapshot, LearningClass } from "@/lib/learning-types";
import CoursesPage from "../../../../../src/app/(workspace)/courses/page";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  notify: vi.fn(),
  session: { roleCode: "INSTRUCTOR" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: mocks.session, notify: mocks.notify }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (value: string) => value, locale: "vi-VN" }),
}));

// Tạo phản hồi chủ động để kiểm tra thứ tự hoàn thành của các request lớp học.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

// Tạo lớp hợp lệ với tên dễ nhận biết trên màn hình.
function makeClass(name: string): LearningClass {
  return {
    id: name, courseId: "course-1", courseVersion: 1, code: `CODE-${name}`,
    name, term: "2026-2027", startAt: "2026-10-31T00:00:00Z",
    endAt: "2027-10-31T00:00:00Z", capacity: 30, timezone: "Asia/Bangkok",
    allowLateEnrollment: false, status: "ACTIVE", instructorIds: [], learnerIds: [],
  };
}

// Tạo môn học có thể mở lịch sử phiên bản từ danh sách quản trị.
function makeCourse(id: string): Course {
  return {
    id, code: `COURSE-${id}`, name: `Course ${id}`, description: "Description",
    outcomes: [], status: "PUBLISHED", version: 1,
    createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z",
  };
}

// Tạo bản ghi lịch sử với nhãn riêng để xác định dữ liệu thực sự đang hiển thị.
function makeVersion(courseId: string, name: string): CourseVersionSnapshot {
  return {
    id: name, courseId, version: 1, name, description: "Description", outcomes: [],
    publishedBy: "admin", publishedAt: "2026-10-31T00:00:00Z",
  };
}

describe("CoursesPage request lifecycle", () => {
  let instructorRequest: ReturnType<typeof deferred<LearningClass[]>>;
  let learnerRequest: ReturnType<typeof deferred<LearningClass[]>>;

  beforeEach(() => {
    mocks.session.roleCode = "INSTRUCTOR";
    mocks.request.mockReset();
    mocks.notify.mockReset();
    instructorRequest = deferred<LearningClass[]>();
    learnerRequest = deferred<LearningClass[]>();
    mocks.request.mockImplementation((path: string, options?: { roleCode?: string }) => {
      if (path === "/classes") {
        return options?.roleCode === "INSTRUCTOR" ? instructorRequest.promise : learnerRequest.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("không ghi đè danh sách lớp mới bằng phản hồi của vai trò cũ", async () => {
    const page = render(<CoursesPage />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", { roleCode: "INSTRUCTOR" }));

    mocks.session.roleCode = "LEARNER";
    page.rerender(<CoursesPage />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", { roleCode: "LEARNER" }));

    await act(async () => learnerRequest.resolve([makeClass("Latest class")]));
    expect(screen.getByText("Latest class")).toBeInTheDocument();

    await act(async () => instructorRequest.resolve([makeClass("Old class")]));
    expect(screen.getByText("Latest class")).toBeInTheDocument();
    expect(screen.queryByText("Old class")).not.toBeInTheDocument();
  });

  it("bỏ qua lỗi của request lớp học đã lỗi thời", async () => {
    const page = render(<CoursesPage />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", { roleCode: "INSTRUCTOR" }));
    mocks.session.roleCode = "LEARNER";
    page.rerender(<CoursesPage />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", { roleCode: "LEARNER" }));

    await act(async () => instructorRequest.reject(new Error("Old request failed")));
    await act(async () => learnerRequest.resolve([makeClass("Latest class")]));
    expect(screen.getByText("Latest class")).toBeInTheDocument();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi khi request hoàn thành sau khi unmount", async () => {
    const page = render(<CoursesPage />);
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/classes", { roleCode: "INSTRUCTOR" }));
    page.unmount();
    await act(async () => instructorRequest.reject(new Error("Unmounted request failed")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});

describe("CoursesPage version history lifecycle", () => {
  let first: ReturnType<typeof deferred<CourseVersionSnapshot[]>>;
  let second: ReturnType<typeof deferred<CourseVersionSnapshot[]>>;

  beforeEach(() => {
    mocks.session.roleCode = "CENTER_MANAGER";
    mocks.request.mockReset();
    mocks.notify.mockReset();
    first = deferred<CourseVersionSnapshot[]>();
    second = deferred<CourseVersionSnapshot[]>();
    mocks.request.mockImplementation((path: string) => {
      if (path === "/manager/courses") return Promise.resolve([makeCourse("a"), makeCourse("b")]);
      if (path === "/classes") return Promise.resolve([]);
      if (path === "/manager/courses/a/versions") return first.promise;
      if (path === "/manager/courses/b/versions") return second.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("giữ lịch sử được chọn gần nhất khi hai request trả về đảo thứ tự", async () => {
    render(<CoursesPage />);
    fireEvent.click(screen.getByRole("button", { name: /Môn học/ }));
    const buttons = await screen.findAllByRole("button", { name: "Lịch sử" });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);

    await act(async () => second.resolve([makeVersion("b", "Latest version")]));
    expect(screen.getByText("Latest version")).toBeInTheDocument();
    await act(async () => first.resolve([makeVersion("a", "Obsolete version")]));
    expect(screen.getByText("Latest version")).toBeInTheDocument();
    expect(screen.queryByText("Obsolete version")).not.toBeInTheDocument();
  });

  it("không thông báo lỗi từ lịch sử phiên bản cũ", async () => {
    render(<CoursesPage />);
    fireEvent.click(screen.getByRole("button", { name: /Môn học/ }));
    const buttons = await screen.findAllByRole("button", { name: "Lịch sử" });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);

    await act(async () => first.reject(new Error("Old version history failed")));
    await act(async () => second.resolve([makeVersion("b", "Latest version")]));
    expect(screen.getByText("Latest version")).toBeInTheDocument();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi lịch sử phiên bản sau khi unmount", async () => {
    const page = render(<CoursesPage />);
    fireEvent.click(screen.getByRole("button", { name: /Môn học/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Lịch sử" }))[0]!);
    page.unmount();
    await act(async () => first.reject(new Error("Unmounted history failed")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
