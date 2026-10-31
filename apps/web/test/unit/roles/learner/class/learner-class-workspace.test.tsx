import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearnerClassWorkspace } from "../../../../../src/roles/learner/class/learner-class-workspace";
import type { LearningClass, Course, LearnerExamSummary, LearnerResult, LiveSession, Material } from "@/lib/learning-types";
const mockRouterPush = vi.fn();
const mockApiRequest = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  apiRequest: mockApiRequest,
  downloadApiFile: vi.fn(),
  previewApiFile: vi.fn(),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      sessionId: "test-session",
      roleCode: "LEARNER",
      permissions: [],
      availableRoles: [],
      user: {
        id: "learner-1",
        username: "learner",
        name: "Học viên kiểm thử",
        email: "learner@example.test",
        roleName: "Học viên",
      },
    },
    notify: vi.fn(),
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ locale: "vi-VN", t: (value: string) => value }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

/** Dựng workspace với provider giả lập để kiểm tra các tab và thao tác của học viên. */
function renderWorkspace() {
  return render(
    <LearnerClassWorkspace
      item={dummyClass}
      course={dummyCourse}
      teacherName="Thầy Nam"
    />,
  );
}

const dummyClass: LearningClass = {
  id: "cls-1",
  courseId: "crs-1",
  courseVersion: 1,
  code: "TOAN6A",
  name: "Lớp Toán 6",
  term: "2026-2027",
  startAt: "2026-10-01T00:00:00Z",
  endAt: "2026-12-31T00:00:00Z",
  capacity: 40,
  timezone: "Asia/Bangkok",
  allowLateEnrollment: true,
  status: "ACTIVE",
  instructorIds: ["ins-1"],
  learnerIds: ["lrn-1", "lrn-2"],
};

const dummyCourse: Course = {
  id: "crs-1",
  code: "MATH101",
  name: "Toán học cơ bản",
  description: "Khóa học toán nền tảng",
  outcomes: ["Nắm chắc hàm số"],
  version: 1,
  status: "PUBLISHED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const gradedExam: LearnerExamSummary = {
  id: "exam-graded",
  classId: dummyClass.id,
  title: "Kiểm tra phân số",
  questionIds: ["q-1"],
  questionCount: 1,
  durationMinutes: 30,
  totalScore: 10,
  openAt: "2026-10-01T00:00:00Z",
  closeAt: "2027-02-01T00:00:00Z",
  attemptLimit: 2,
  remainingAttempts: 1,
  status: "PUBLISHED",
  availabilityStatus: "AVAILABLE",
  version: 1,
  serverTime: "2026-10-30T00:00:00Z",
};

const pendingExam: LearnerExamSummary = {
  ...gradedExam,
  id: "exam-pending",
  title: "Kiểm tra đại số chưa làm",
  closeAt: "2027-01-15T00:00:00Z",
};

const examResult: LearnerResult = {
  attempt: {
    id: "attempt-graded",
    examId: gradedExam.id,
    learnerId: "learner-1",
    attemptNo: 1,
    answers: { "q-1": ["A"] },
    status: "GRADED",
    startedAt: "2026-10-20T09:00:00Z",
    submittedAt: "2026-10-20T09:12:00Z",
    score: 4,
    feedback: "Cần luyện tập thêm",
  },
  exam: { id: gradedExam.id, title: gradedExam.title, totalScore: 10, closeAt: gradedExam.closeAt },
  answerBreakdown: [{ questionId: "q-1", content: "Một phần hai bằng?", submittedAnswers: ["A"], awardedScore: 4, maxScore: 10 }],
};

const classMaterials: Material[] = [
  {
    id: "lecture-1", classId: dummyClass.id, ownerId: "ins-1", name: "Bài giảng phân số.mp4",
    mimeType: "video/mp4", sizeBytes: 2097152, folder: "Toán 1", tags: ["lecture", "Mô tả: Bài học về phân số"],
    version: 1, visibility: "PUBLISHED", scope: "CLASS", createdAt: "2026-10-20T09:00:00Z",
  },
  {
    id: "material-1", classId: dummyClass.id, ownerId: "ins-1", name: "Tài liệu đại số.pdf",
    mimeType: "application/pdf", sizeBytes: 1048576, folder: "Toán 1", tags: [],
    version: 1, visibility: "PUBLISHED", scope: "CLASS", createdAt: "2026-10-21T09:00:00Z",
  },
];

const classSession: LiveSession = {
  id: "session-1", classId: dummyClass.id, title: "Buổi 01: Ôn tập phân số",
  startsAt: "2026-11-04T09:00:00Z", endsAt: "2026-11-04T10:00:00Z",
  provider: "GOOGLE_MEET", status: "SCHEDULED", hostUrl: "https://meet.example.test/host",
  attendeeUrl: "https://meet.example.test/attend", timezone: "Asia/Bangkok",
};

// Mô phỏng chính xác các endpoint mà workspace sử dụng khi nạp lớp và mở bài thi.
function mockClassEndpoints() {
  mockApiRequest.mockImplementation(async (path: string) => {
    switch (path) {
      case "/learner/classes/cls-1/exams": return [gradedExam, pendingExam];
      case "/academic/assignments?classId=cls-1": return [];
      case "/materials": return classMaterials;
      case "/learner/results": return [examResult];
      case "/sessions": return [classSession];
      case "/learner/exams/exam-graded/attempts":
      case "/learner/exams/exam-pending/attempts":
        return { id: "attempt-active", startedAt: new Date().toISOString(), answers: {} };
      case "/learner/exams/exam-graded/questions":
      case "/learner/exams/exam-pending/questions":
        return [{ id: "q-1", content: "Một phần hai bằng?", options: ["A. 0.5", "B. 2"] }];
      default: throw new Error(`Unexpected API request: ${path}`);
    }
  });
}

// Trả về lịch LIVE và giữ phản hồi tham gia để kiểm tra thao tác mở cửa sổ bất đồng bộ.
function mockLiveSessionEndpoints(joinResponse: Promise<{ attendeeUrl: string }>) {
  const defaultRequest = mockApiRequest.getMockImplementation();
  mockApiRequest.mockImplementation((path: string, options?: unknown) => {
    if (path === "/sessions") return Promise.resolve([{ ...classSession, status: "LIVE" }]);
    if (path === "/learner/sessions/session-1/join") return joinResponse;
    if (!defaultRequest) throw new Error(`Unexpected API request: ${path}`);
    return defaultRequest(path, options);
  });
}

// Bổ sung đề thi đính kèm vào bài giảng trong phản hồi API giả lập.
function mockLectureWithAttachedExam() {
  const defaultRequest = mockApiRequest.getMockImplementation();
  mockApiRequest.mockImplementation((path: string, options?: unknown) => {
    if (path === "/materials") {
      return Promise.resolve([
        { ...classMaterials[0], tags: [...(classMaterials[0]?.tags ?? []), `attachedExamId:${gradedExam.id}`] },
        classMaterials[1],
      ]);
    }
    if (!defaultRequest) throw new Error(`Unexpected API request: ${path}`);
    return defaultRequest(path, options);
  });
}

describe("LearnerClassWorkspace", () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
    mockApiRequest.mockReset();
    mockClassEndpoints();
    window.history.replaceState({}, "", "/");
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hiển thị sidebar lớp học với thông tin lớp, giáo viên và 6 danh mục con", () => {
    renderWorkspace();

    expect(screen.getByText("Lớp Toán 6")).toBeInTheDocument();
    expect(screen.getByText("TOAN6A")).toBeInTheDocument();
    expect(screen.getAllByText("Thầy Nam").length).toBeGreaterThan(0);
    expect(screen.getByText("Bảng tin")).toBeInTheDocument();
    expect(screen.getByText("Lịch học")).toBeInTheDocument();
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Bài tập")).toBeInTheDocument();
    expect(screen.getByText("Bài giảng")).toBeInTheDocument();
    expect(screen.getByText("Tài liệu")).toBeInTheDocument();
  });

  it("chuyển sang tab Lịch học và cho phép chuyển đổi chế độ tuần và tháng", async () => {
    renderWorkspace();

    fireEvent.click(screen.getByText("Lịch học"));
    expect(screen.getByText(/Lịch học của Lớp Toán 6/i)).toBeInTheDocument();
    expect(screen.getByText("Dạng tuần (Lưới)")).toBeInTheDocument();

    // Chuyển sang dạng tháng
    fireEvent.click(screen.getByText("Dạng tháng (Danh sách)"));
    expect(await screen.findByText(/Buổi 01:/i)).toBeInTheDocument();
  });

  it("mở tab phòng học ngay khi bấm và chỉ chuyển trang sau khi API cho phép", async () => {
    let approveJoin: ((value: { attendeeUrl: string }) => void) | undefined;
    const joinResponse = new Promise<{ attendeeUrl: string }>((resolve) => { approveJoin = resolve; });
    mockLiveSessionEndpoints(joinResponse);
    const openedWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(openedWindow as unknown as Window);

    renderWorkspace();
    fireEvent.click(screen.getByText("Lịch học"));
    fireEvent.click(screen.getByText("Dạng tháng (Danh sách)"));
    fireEvent.click(await screen.findByText("Vào phòng học"));

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(openedWindow.opener).toBeNull();
    expect(openedWindow.location.replace).not.toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalledWith("/learner/sessions/session-1/join", { method: "POST", roleCode: "LEARNER" });

    approveJoin?.({ attendeeUrl: "https://meet.example.test/attend" });
    await waitFor(() => expect(openedWindow.location.replace).toHaveBeenCalledWith("https://meet.example.test/attend"));
    expect(openedWindow.close).not.toHaveBeenCalled();
  });

  it("đóng tab phòng học nếu API từ chối cho tham gia", async () => {
    let rejectJoin: ((reason: Error) => void) | undefined;
    const joinResponse = new Promise<{ attendeeUrl: string }>((_, reject) => { rejectJoin = reject; });
    mockLiveSessionEndpoints(joinResponse);
    const openedWindow = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(openedWindow as unknown as Window);

    renderWorkspace();
    fireEvent.click(screen.getByText("Lịch học"));
    fireEvent.click(screen.getByText("Dạng tháng (Danh sách)"));
    fireEvent.click(await screen.findByText("Vào phòng học"));

    rejectJoin?.(new Error("Chưa được phép tham gia."));
    await waitFor(() => expect(openedWindow.close).toHaveBeenCalledOnce());
    expect(openedWindow.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Chưa được phép tham gia.")).toBeInTheDocument();
  });

  it("tab Thành viên hiển thị danh sách kèm nút Nhắn tin phát sự kiện open-mini-chat", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    renderWorkspace();

    fireEvent.click(screen.getByText("Thành viên"));
    const chatButtons = screen.getAllByTitle(/Nhắn tin với/i);
    expect(chatButtons.length).toBeGreaterThan(0);

    // Bấm nút Nhắn tin với giáo viên
    fireEvent.click(chatButtons[0]!);
    expect(dispatchSpy).toHaveBeenCalled();
    const eventArg = dispatchSpy.mock.calls[0]?.[0] as CustomEvent;
    expect(eventArg.type).toBe("open-mini-chat");
    dispatchSpy.mockRestore();
  });

  it("tab Bài tập cho phép tìm kiếm và mở ExamTakingModal với Question Palette 3 màu", async () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài tập")[0]!);
    expect(screen.getByPlaceholderText("Tìm kiếm bài tập...")).toBeInTheDocument();

    const startButtons = await screen.findAllByText("Làm bài");
    fireEvent.click(startButtons[0]!);
    fireEvent.click(await screen.findByText("Bắt đầu làm bài"));

    // Question Palette Grid hiển thị 3 màu chú thích
    expect(screen.getAllByText(/Đã làm/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Chưa làm/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Cần xem lại/i)).toBeInTheDocument();
    expect(screen.getByText("Nộp bài")).toBeInTheDocument();
  });

  it("tab Bài tập hiển thị giao diện 3 cột Master-Detail: Thư mục, Danh sách và Bảng chi tiết điểm", async () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài tập")[0]!);

    // Cột 1: Cây thư mục
    expect(screen.getByText("Thư mục")).toBeInTheDocument();
    expect(screen.getByText("Tất cả bài tập")).toBeInTheDocument();
    // Endpoint bài kiểm tra không trả về thông tin thư mục.
    expect((await screen.findAllByText("Kiểm tra phân số")).length).toBeGreaterThanOrEqual(1);

    // Cột 3: Bảng thông số chi tiết
    expect(screen.getByText("Số lần làm bài")).toBeInTheDocument();
    expect(screen.getByText("Lấy điểm")).toBeInTheDocument();
    expect(screen.getByText("Ngày tạo")).toBeInTheDocument();
    expect(screen.getByText("Chi tiết")).toBeInTheDocument();
  });

  it("tab Bài giảng hiển thị giao diện 3 cột với Cột 3 tinh gọn chỉ gồm Tên, Mô tả ngắn gọn, Ngày đăng", async () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài giảng")[0]!);

    expect(screen.getByText("Tất cả bài giảng")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm kiếm bài giảng...")).toBeInTheDocument();
    expect((await screen.findAllByText(/Xem bài giảng/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Ngày đăng")).toBeInTheDocument();
    expect(screen.getByText("Mô tả")).toBeInTheDocument();
  });

  it("cho phép mở Trang chi tiết bài giảng 3 cột đầy đủ khi bấm nút Xem bài giảng", async () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài giảng")[0]!);
    const viewLectureBtn = (await screen.findAllByText("Xem bài giảng"))[0];
    fireEvent.click(viewLectureBtn!);

    // Trang chi tiết bài giảng hiển thị với nút quay lại, khối mô tả, bài tập đính kèm và thư mục
    expect(screen.getByText("Quay lại bài giảng")).toBeInTheDocument();
    expect(screen.getByText(/Bài tập & tài liệu đính kèm/i)).toBeInTheDocument();
    expect(screen.getByText("Thư mục bài giảng")).toBeInTheDocument();
    expect(screen.getByText("Chưa có bài tập đính kèm.")).toBeInTheDocument();
  });

  it("hiển thị và đóng toast khi cửa sổ xem bài giảng bị chặn ở trang chi tiết", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài giảng")[0]!);
    fireEvent.click((await screen.findAllByText("Xem bài giảng"))[0]!);
    fireEvent.click(screen.getByText("Xem học liệu"));

    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(screen.getByRole("status")).toHaveTextContent("Trình duyệt đã chặn cửa sổ xem trước.");
    fireEvent.click(screen.getByRole("button", { name: "Đóng thông báo" }));
    expect(screen.queryByText("Trình duyệt đã chặn cửa sổ xem trước.")).not.toBeInTheDocument();
  });

  it("mở và đóng modal đề thi đính kèm ngay trên trang chi tiết bài giảng", async () => {
    mockLectureWithAttachedExam();
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài giảng")[0]!);
    fireEvent.click((await screen.findAllByText("Xem bài giảng"))[0]!);
    expect(screen.queryByText("Chưa có bài tập đính kèm.")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Kiểm tra phân số" }));

    expect(await screen.findByText("Bắt đầu làm bài")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(screen.queryByText("Bắt đầu làm bài")).not.toBeInTheDocument();
    expect(screen.getByText("Quay lại bài giảng")).toBeInTheDocument();
  });

  it("tab Bài tập áp dụng tông màu điểm số không chứa icon emoji và cho phép mở xem lại bài làm khi bấm Chi tiết", async () => {
    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài tập")[0]!);

    // Khối điểm số không có icon emoji 😐
    expect(screen.queryByText("😐")).toBeNull();
    expect(await screen.findByText("4.0 điểm")).toBeInTheDocument();

    // Bấm Chi tiết mở modal xem lại bài làm khi có 1 lần nộp bài
    fireEvent.click(screen.getByText("Chi tiết"));
    expect(screen.getByText(/Chi tiết bài làm \(Lần 1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Kết quả chấm điểm")).toBeInTheDocument();
    expect(screen.getAllByText("Nhận xét của giáo viên", { exact: true }).length).toBeGreaterThan(0);
  });

  it("tab Tài liệu hiển thị giao diện 3 cột với cấu trúc thư mục học liệu và thông số tài liệu", async () => {
    renderWorkspace();

    fireEvent.click(screen.getByText("Tài liệu"));

    expect(screen.getByText("Tất cả tài liệu")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Tìm kiếm tài liệu...")).toBeInTheDocument();
    expect((await screen.findAllByText(/Xem trước/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Định dạng")).toBeInTheDocument();
    expect(screen.getByText("Dung lượng")).toBeInTheDocument();
  });

  it("chỉ hiển thị tài liệu của lớp và học liệu dùng chung đúng môn học", async () => {
    const originalRequest = mockApiRequest.getMockImplementation();
    mockApiRequest.mockImplementation((path: string, options?: unknown) => {
      if (path === "/materials") return Promise.resolve([
        ...classMaterials,
        { ...classMaterials[1], id: "other-class", classId: "cls-2", name: "Tệp lớp khác.pdf" },
        { ...classMaterials[1], id: "shared-course", classId: null, courseId: "crs-1", scope: "SHARED", name: "Tệp dùng chung.pdf" },
        { ...classMaterials[1], id: "shared-other", classId: null, courseId: "crs-2", scope: "SHARED", name: "Tệp môn khác.pdf" },
      ]);
      if (!originalRequest) throw new Error(`Unexpected API request: ${path}`);
      return originalRequest(path, options);
    });

    renderWorkspace();
    fireEvent.click(screen.getByText("Tài liệu"));
    expect((await screen.findAllByText("Tài liệu đại số.pdf")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tệp dùng chung.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText("Tệp lớp khác.pdf")).not.toBeInTheDocument();
    expect(screen.queryByText("Tệp môn khác.pdf")).not.toBeInTheDocument();
  });

  it("không sử dụng window.alert khi bấm Chi tiết bài tập chưa làm mà hiển thị Toast mềm mại kèm nút Làm bài ngay", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    renderWorkspace();

    fireEvent.click(screen.getAllByText("Bài tập")[0]!);

    // Chọn đề thi chưa có lượt nộp trong dữ liệu trả về từ API.
    const unsubmittedItem = await screen.findByText("Kiểm tra đại số chưa làm");
    fireEvent.click(unsubmittedItem);

    // Bấm nút Chi tiết ở cột 3
    const detailButtons = screen.getAllByText("Chi tiết");
    fireEvent.click(detailButtons[detailButtons.length - 1]!);

    // Tuyệt đối không gọi window.alert popup của trình duyệt
    expect(alertSpy).not.toHaveBeenCalled();

    // Hiển thị Toast thông báo nội bộ
    expect(screen.getByText("Bạn chưa nộp lượt làm bài nào cho bài tập này.")).toBeInTheDocument();
    expect(screen.getByText("Làm bài ngay")).toBeInTheDocument();

    alertSpy.mockRestore();
  });

  it("toast ở trang lớp mở đúng bài thi khi chọn hành động rồi tự đóng", async () => {
    renderWorkspace();
    fireEvent.click(screen.getAllByText("Bài tập")[0]!);
    fireEvent.click(await screen.findByText("Kiểm tra đại số chưa làm"));
    const detailButtons = screen.getAllByText("Chi tiết");
    fireEvent.click(detailButtons[detailButtons.length - 1]!);

    fireEvent.click(screen.getByRole("button", { name: "Làm bài ngay" }));

    expect(screen.queryByText("Bạn chưa nộp lượt làm bài nào cho bài tập này.")).not.toBeInTheDocument();
    expect(await screen.findByText("Bắt đầu làm bài")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Bắt đầu làm bài" })).toHaveLength(1);
  });

  it("không hiển thị dữ liệu lớp cũ khi phản hồi API đến sau lần chuyển lớp", async () => {
    let resolveFirstExams: ((value: LearnerExamSummary[]) => void) | undefined;
    let firstSignal: AbortSignal | undefined;
    const firstExams = new Promise<LearnerExamSummary[]>((resolve) => { resolveFirstExams = resolve; });
    mockApiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/learner/classes/cls-1/exams") {
        firstSignal = options?.signal ?? undefined;
        return firstExams;
      }
      if (path === "/learner/classes/cls-2/exams") return [{ ...gradedExam, id: "exam-new", classId: "cls-2", title: "Đề lớp mới" }];
      if (path.startsWith("/academic/assignments?") || path === "/materials") return [];
      if (path === "/learner/results" || path === "/sessions") return [];
      throw new Error(`Unexpected API request: ${path}`);
    });

    const view = renderWorkspace();
    fireEvent.click(screen.getAllByText("Bài tập")[0]!);
    view.rerender(<LearnerClassWorkspace item={{ ...dummyClass, id: "cls-2", name: "Lớp Toán 7" }} course={dummyCourse} teacherName="Thầy Nam" />);
    expect(firstSignal?.aborted).toBe(true);
    expect((await screen.findAllByText("Đề lớp mới")).length).toBeGreaterThan(0);

    resolveFirstExams?.([gradedExam]);
    expect(screen.queryByText("Kiểm tra phân số")).not.toBeInTheDocument();
  });

  it("hủy toàn bộ request đang tải khi rời trang lớp", () => {
    const view = renderWorkspace();
    const signals = mockApiRequest.mock.calls
      .map((call: unknown[]) => (call[1] as RequestInit | undefined)?.signal)
      .filter((signal: AbortSignal | null | undefined): signal is AbortSignal => signal != null);
    expect(signals).toHaveLength(5);
    expect(signals.every((signal: AbortSignal) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(signals.every((signal: AbortSignal) => signal.aborted)).toBe(true);
  });

  it("báo lỗi nếu API trả về sai cấu trúc và cho phép tải lại", async () => {
    let returnInvalidMaterials = true;
    mockApiRequest.mockImplementation(async (path: string) => {
      if (path === "/learner/classes/cls-1/exams") return [gradedExam];
      if (path === "/academic/assignments?classId=cls-1" || path === "/learner/results" || path === "/sessions") return [];
      if (path === "/materials") return returnInvalidMaterials ? { data: classMaterials } : classMaterials;
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderWorkspace();
    expect(await screen.findByText(/Không tải được 1 nguồn dữ liệu lớp học/)).toBeInTheDocument();
    returnInvalidMaterials = false;
    fireEvent.click(screen.getByText("Tải lại"));
    fireEvent.click(screen.getByText("Tài liệu"));
    expect((await screen.findAllByText("Tài liệu đại số.pdf")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Không tải được 1 nguồn dữ liệu lớp học/)).not.toBeInTheDocument();
  });
});
