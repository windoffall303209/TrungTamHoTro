import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExamsModel } from "../../../../src/features/exams/use-exams-model";

const api = vi.hoisted(() => vi.fn());
const notify = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ current: "INSTRUCTOR" }));
const params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => params }));
vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => api(...args),
}));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      user: { id: "instructor-test" },
      roleCode: role.current,
      permissions: ["exam:manage"],
    },
    notify,
  }),
}));
vi.mock("@/providers/i18n-provider", () => ({
  useI18n: () => ({ t: (text: string) => text }),
}));
vi.mock("@/features/materials/material-search", () => ({
  useMaterialSearch: () => ({ items: [] }),
}));

describe("Bản nháp trình tạo đề", () => {
  it("chuyển trang chỉ tải đề, thao tác thử lại làm mới cả dữ liệu hỗ trợ", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.mockClear();
    act(() => result.current.pagination.setPage(2));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(api.mock.calls[0]![0]).toContain("/exams/page?page=2");
    await waitFor(() => expect(result.current.loading).toBe(false));
    api.mockClear();
    await act(async () => { await result.current.reload(); });
    expect(api.mock.calls.some(([path]) => path === "/classes")).toBe(true);
    expect(api.mock.calls.some(([path]) => path.startsWith("/instructor/question-bank/questions"))).toBe(true);
  });

  it("chuyển trang hủy request danh sách đang chờ", async () => {
    let firstSignal: AbortSignal | undefined;
    api.mockImplementation(async (path: string, options: { signal?: AbortSignal }) => {
      if (path.startsWith("/exams/page?page=1")) {
        firstSignal = options.signal;
        return new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }
      return path.startsWith("/exams/page?") ? { items: [], total: 0, page: 2 } : [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(firstSignal).toBeDefined());
    act(() => result.current.pagination.setPage(2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.pagination.page).toBe(2);
    expect(result.current.loadError).toBe("");
  });
  it("không phục hồi cache trong bộ nhớ khi đã hết 24 giờ", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() => result.current.setForm((form) => ({ ...form, title: "Đề cũ" })));
    act(() => result.current.closeEditor());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60 * 1000);
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("");
  });
  beforeEach(() => {
    window.sessionStorage.clear();
    params.delete("create");
    role.current = "INSTRUCTOR";
    notify.mockReset();
    api.mockReset();
    api.mockImplementation(async (path: string) => path.startsWith("/exams/page?") ? { items: [], total: 0, page: 1 } : []);
  });

  it("chỉ hiển thị câu hỏi của đề xem trước được chọn sau cùng", async () => {
    let resolveFirst!: (questions: { id: string }[]) => void;
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/instructor/exams/exam-1/preview") {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      if (path === "/instructor/exams/exam-2/preview") return [{ id: "question-2" }];
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstExam = { id: "exam-1", title: "Đề 1" } as Parameters<typeof result.current.preview>[0];
    const secondExam = { id: "exam-2", title: "Đề 2" } as Parameters<typeof result.current.preview>[0];
    let first!: Promise<void>;
    act(() => { first = result.current.preview(firstExam); });
    await act(async () => { await result.current.preview(secondExam); });
    expect(result.current.previewExam?.id).toBe("exam-2");
    expect(result.current.previewQuestions.map((question) => question.id)).toEqual(["question-2"]);
    await act(async () => {
      resolveFirst([{ id: "question-1" }]);
      await first;
    });
    expect(result.current.previewExam?.id).toBe("exam-2");
    expect(result.current.previewQuestions.map((question) => question.id)).toEqual(["question-2"]);
    expect(result.current.previewLoading).toBe(false);
  });

  it("bỏ qua lỗi của yêu cầu xem trước đã bị thay thế", async () => {
    let rejectFirst!: (error: Error) => void;
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/instructor/exams/exam-1/preview") {
        return new Promise((_, reject) => { rejectFirst = reject; });
      }
      if (path === "/instructor/exams/exam-2/preview") return [{ id: "question-2" }];
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: Promise<void>;
    act(() => {
      first = result.current.preview({ id: "exam-1" } as Parameters<typeof result.current.preview>[0]);
    });
    await act(async () => {
      await result.current.preview({ id: "exam-2" } as Parameters<typeof result.current.preview>[0]);
    });
    await act(async () => {
      rejectFirst(new Error("Lỗi mạng của đề cũ"));
      await first;
    });
    expect(result.current.previewExam?.id).toBe("exam-2");
    expect(result.current.previewQuestions.map((question) => question.id)).toEqual(["question-2"]);
    expect(notify).not.toHaveBeenCalledWith("Lỗi mạng của đề cũ", "error");
  });

  it("không đưa câu hỏi cũ trở lại sau khi đóng xem trước", async () => {
    let resolvePreview!: (questions: { id: string }[]) => void;
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/instructor/exams/exam-1/preview") {
        return new Promise((resolve) => { resolvePreview = resolve; });
      }
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.preview({ id: "exam-1" } as Parameters<typeof result.current.preview>[0]);
    });
    act(() => result.current.closePreview());
    await act(async () => {
      resolvePreview([{ id: "question-1" }]);
      await pending;
    });
    expect(result.current.previewExam).toBeNull();
    expect(result.current.previewQuestions).toEqual([]);
    expect(result.current.previewLoading).toBe(false);
  });

  it.each(["{invalid", "null", "{}", '["question-1", 12]']) (
    "bỏ dữ liệu quét không hợp lệ (%s) mà vẫn tải đề bình thường",
    async (storedIds) => {
      params.set("create", "scan");
      window.sessionStorage.setItem("wind-scan-question-ids", storedIds);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      api.mockImplementation(async (path: string) => {
        if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
        if (path === "/classes") return [{ id: "class-1", courseId: "course-1" }];
        if (path.startsWith("/instructor/question-bank/questions?")) return [{ id: "question-1", courseId: "course-1" }];
        return [];
      });

      const { result } = renderHook(useExamsModel);
      await waitFor(() => expect(result.current.loading).toBe(false));
      await waitFor(() => expect(window.sessionStorage.getItem("wind-scan-question-ids")).toBeNull());
      expect(result.current.open).toBe(false);
      expect(notify).toHaveBeenCalledWith("Không thể khôi phục danh sách câu hỏi vừa quét.", "error");
      expect(warning).toHaveBeenCalled();
    },
  );

  it("khôi phục danh sách câu hỏi quét hợp lệ vào đề mới", async () => {
    params.set("create", "scan");
    window.sessionStorage.setItem("wind-scan-question-ids", '["question-1"]');
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/classes") return [{ id: "class-1", courseId: "course-1" }];
      if (path.startsWith("/instructor/question-bank/questions?")) return [{ id: "question-1", courseId: "course-1" }];
      return [];
    });

    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.open).toBe(true));
    expect(result.current.form.classId).toBe("class-1");
    expect(result.current.form.questionIds).toEqual(["question-1"]);
    expect(window.sessionStorage.getItem("wind-scan-question-ids")).toBeNull();
  });

  it("phục hồi sau khi rời trang mà không cần tạm đóng trước", async () => {
    const first = renderHook(useExamsModel);
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    act(() => first.result.current.openCreate("MANUAL"));
    act(() => first.result.current.setForm((form) => ({ ...form, title: "Qua trang khác vẫn còn" })));
    first.unmount();
    const second = renderHook(useExamsModel);
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    act(() => second.result.current.openCreate("MANUAL"));
    expect(second.result.current.form.title).toBe("Qua trang khác vẫn còn");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("giữ nội dung khi tạm đóng và tách nháp thủ công với AI", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({ ...form, title: "Đề đang soạn" })),
    );
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("AI"));
    expect(result.current.form.title).toBe("");
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("Đề đang soạn");
  });

  it("chỉ bỏ nội dung khi đồng ý và không giữ lại nháp đã bỏ", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({ ...form, title: "Giữ lại" })),
    );
    act(() => result.current.discardEditor());
    expect(result.current.form.title).toBe("Giữ lại");
    confirm.mockReturnValue(true);
    act(() => result.current.discardEditor());
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("");
  });

  it("không cho đóng hoặc bỏ form khi đang gửi và giữ nội dung khi API lỗi", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({
        ...form,
        title: "Đề lỗi",
        openAt: "2026-09-16T08:00",
        closeAt: "2026-09-17T08:00",
      })),
    );
    let rejectRequest!: (error: Error) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    let request!: Promise<void>;
    act(() => {
      request = result.current.create({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });
    act(() => result.current.closeEditor());
    expect(result.current.open).toBe(true);
    await act(async () => {
      rejectRequest(new Error("Mất kết nối"));
      await request;
    });
    expect(result.current.form.title).toBe("Đề lỗi");
    expect(result.current.open).toBe(true);
  });

  it("xóa nháp sau khi lưu thành công", async () => {
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.openCreate("MANUAL"));
    act(() =>
      result.current.setForm((form) => ({
        ...form,
        title: "Đề đã lưu",
        openAt: "2026-09-16T08:00",
        closeAt: "2026-09-17T08:00",
      })),
    );
    act(() => result.current.closeEditor());
    act(() => result.current.openCreate("MANUAL"));
    await act(async () => {
      await result.current.create({
        preventDefault: vi.fn(),
      } as unknown as React.FormEvent);
    });
    act(() => result.current.openCreate("MANUAL"));
    expect(result.current.form.title).toBe("");
  });

  it("lưu tuần tự nhiều câu và giữ đáp án mới khi phản hồi cũ quay về", async () => {
    role.current = "LEARNER";
    const startedAt = new Date().toISOString();
    const attempt = {
      id: "attempt-1", examId: "exam-1", learnerId: "instructor-test",
      status: "IN_PROGRESS" as const, startedAt, answers: {},
    };
    const exam = {
      id: "exam-1", durationMinutes: 60,
      closeAt: new Date(Date.now() + 60_000 * 60).toISOString(),
    };
    let resolveFirst!: (value: typeof attempt) => void;
    const firstSave = new Promise<typeof attempt>((resolve) => { resolveFirst = resolve; });
    api.mockImplementation(async (path: string, options?: { body?: string }) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/learner/exams/exam-1/attempts") return attempt;
      if (path === "/learner/exams/exam-1/questions") return [];
      if (path === "/learner/exam-attempts/attempt-1/answers") {
        const body = JSON.parse(options?.body ?? "{}");
        if (body.questionId === "q1") return firstSave;
        return { ...attempt, answers: { q1: ["A"], q2: ["B"] } };
      }
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.start(exam as Parameters<typeof result.current.start>[0]); });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.answer("q1", ["A"]);
      second = result.current.answer("q2", ["B"]);
    });
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path.endsWith("/answers"))).toHaveLength(1));
    expect(result.current.attempt?.answers).toEqual({ q1: ["A"], q2: ["B"] });
    await act(async () => {
      resolveFirst({ ...attempt, answers: { q1: ["A"] } });
      await Promise.all([first, second]);
    });
    expect(api.mock.calls.filter(([path]) => path.endsWith("/answers"))).toHaveLength(2);
    expect(result.current.attempt?.answers).toEqual({ q1: ["A"], q2: ["B"] });
    expect(result.current.autosaveStatus).toBe("SAVED");
  });

  it("đợi autosave hoàn tất trước khi gửi lệnh nộp bài", async () => {
    role.current = "LEARNER";
    const attempt = {
      id: "attempt-1", examId: "exam-1", learnerId: "instructor-test",
      status: "IN_PROGRESS" as const, startedAt: new Date().toISOString(), answers: {},
    };
    const exam = {
      id: "exam-1", durationMinutes: 60,
      closeAt: new Date(Date.now() + 60_000 * 60).toISOString(),
    };
    let resolveSave!: (value: typeof attempt) => void;
    const pendingSave = new Promise<typeof attempt>((resolve) => { resolveSave = resolve; });
    api.mockImplementation(async (path: string) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/learner/exams/exam-1/attempts") return attempt;
      if (path === "/learner/exams/exam-1/questions") return [];
      if (path.endsWith("/answers")) return pendingSave;
      if (path.endsWith("/submit")) return { ...attempt, status: "GRADED", score: 10 };
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.start(exam as Parameters<typeof result.current.start>[0]); });

    let saving!: Promise<void>;
    let submitting!: Promise<void>;
    act(() => {
      saving = result.current.answer("q1", ["A"]);
      submitting = result.current.submit();
    });
    await waitFor(() => expect(api.mock.calls.filter(([path]) => path.endsWith("/answers"))).toHaveLength(1));
    expect(api.mock.calls.some(([path]) => path.endsWith("/submit"))).toBe(false);
    await act(async () => {
      resolveSave({ ...attempt, answers: { q1: ["A"] } });
      await Promise.all([saving, submitting]);
    });
    expect(result.current.attempt?.status).toBe("GRADED");
    expect(api.mock.calls.filter(([path]) => path.endsWith("/submit"))).toHaveLength(1);
  });

  it("khôi phục đáp án đã lưu khi sửa lại cùng câu nhưng hai lần retry đều lỗi", async () => {
    role.current = "LEARNER";
    const attempt = {
      id: "attempt-1", examId: "exam-1", learnerId: "instructor-test",
      status: "IN_PROGRESS" as const, startedAt: new Date().toISOString(), answers: {},
    };
    const exam = {
      id: "exam-1", durationMinutes: 60,
      closeAt: new Date(Date.now() + 60_000 * 60).toISOString(),
    };
    api.mockImplementation(async (path: string, options?: { body?: string }) => {
      if (path.startsWith("/exams/page?")) return { items: [], total: 0, page: 1 };
      if (path === "/learner/exams/exam-1/attempts") return attempt;
      if (path === "/learner/exams/exam-1/questions") return [];
      if (path.endsWith("/answers")) {
        const { answers } = JSON.parse(options?.body ?? "{}");
        if (answers[0] === "B") throw new Error("Không kết nối được");
        return { ...attempt, answers: { q1: ["A"] } };
      }
      return [];
    });
    const { result } = renderHook(useExamsModel);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.start(exam as Parameters<typeof result.current.start>[0]); });
    await act(async () => { await result.current.answer("q1", ["A"]); });
    await act(async () => { await result.current.answer("q1", ["B"]); });
    expect(result.current.attempt?.answers).toEqual({ q1: ["A"] });
    expect(result.current.autosaveStatus).toBe("ERROR");
    expect(notify).toHaveBeenCalledWith("Không kết nối được", "error");
  });
});
