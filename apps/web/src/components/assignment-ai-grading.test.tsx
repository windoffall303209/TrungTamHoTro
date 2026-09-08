import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignmentAiGrading } from "./assignment-ai-grading";
import type { Assignment, AssignmentSubmission } from "@/lib/learning-types";

const api = vi.fn();
const onUse = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => api(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { user: { id: "teacher" }, roleCode: "INSTRUCTOR", permissions: ["exam:manage"] } }) }));
const assignment = { id: "assignment", version: 3, maxScore: 5, rubric: [{ id: "r1", title: "Accuracy", description: "Correct layer", maxPoints: 5 }] } as Assignment;
const submission = { id: "submission", revision: 2, content: "HTTP is an application-layer protocol.", attachments: [] } as unknown as AssignmentSubmission;
const result = { insufficientEvidence: false, feedback: "Good explanation", suggestedTotal: 4.5, requiresHumanReview: true, model: "admin-model", submissionRevision: 2, assignmentVersion: 3, criteria: [{ criterionId: "r1", suggestedPoints: 4.5, reasoning: "The correct layer is identified.", evidence: [submission.content] }] };

describe("instructor AI grading review", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("does not fetch automatically and requires review before changing the manual form", async () => {
    api.mockResolvedValueOnce({ state: "READY", result });
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByText(result.feedback)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đưa gợi ý vào biểu mẫu" })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Đưa gợi ý vào biểu mẫu" }));
    expect(onUse).toHaveBeenCalledExactlyOnceWith({ r1: 4.5 }, result.feedback);
    expect(screen.getByRole("status")).toHaveTextContent("chưa lưu điểm");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0]?.[1]).not.toHaveProperty("method");
  });

  it("creates only after a missing-result check and sends no caller-selected model or content", async () => {
    api.mockResolvedValueOnce({ state: "NOT_REQUESTED" }).mockResolvedValueOnce(result);
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo gợi ý chấm AI" }));
    await screen.findByText(result.feedback);
    expect(api).toHaveBeenLastCalledWith("/instructor/assignment-submissions/submission/ai-suggestion", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedSubmissionRevision: 2, language: "VI" }) }));
    expect(onUse).not.toHaveBeenCalled();
  });

  it.each(["GENERATING", "UNCERTAIN"])("never exposes regeneration for %s", async (state) => {
    api.mockResolvedValue({ state });
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    await screen.findByText(/Yêu cầu đang xử lý hoặc chưa rõ kết quả/);
    expect(screen.queryByRole("button", { name: "Tạo gợi ý chấm AI" })).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it.each([{ ...result, submissionRevision: 3 }, { ...result, assignmentVersion: 4 }, { ...result, criteria: [{ ...result.criteria[0], evidence: ["invented quote"] }] }])("rejects stale or mismatched results", async (value) => {
    api.mockResolvedValue({ state: "READY", result: value });
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không khớp");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("does not create for unsupported attachments or apply insufficient evidence", async () => {
    const view = render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, attachments: [{ id: "file" }] as AssignmentSubmission["attachments"] }} onUse={onUse} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.unmount();
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, insufficientEvidence: true, criteria: [], suggestedTotal: null } });
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    await screen.findByText("Chưa đủ bằng chứng để gợi ý điểm");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("clears results on language changes and ignores a response after changing submissions", async () => {
    api.mockResolvedValueOnce({ state: "READY", result });
    const view = render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    await screen.findByText(result.feedback);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "EN" } });
    expect(screen.queryByText(result.feedback)).not.toBeInTheDocument();
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    const signal = api.mock.lastCall?.[1].signal as AbortSignal;
    view.rerender(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, id: "other" }} onUse={onUse} />);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ state: "READY", result }); });
    expect(screen.queryByText(result.feedback)).not.toBeInTheDocument();
  });

  it("locks duplicate requests and leaves timeout recovery read-only", async () => {
    vi.useFakeTimers();
    api.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("aborted"))); }));
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    const button = screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" });
    fireEvent.click(button); fireEvent.click(button);
    expect(api).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("không gửi lại yêu cầu tạo");
    expect(screen.queryByRole("button", { name: "Tạo gợi ý chấm AI" })).not.toBeInTheDocument();
  });

  it("requires a status read after a paid generation times out", async () => {
    api.mockResolvedValueOnce({ state: "NOT_REQUESTED" });
    render(<AssignmentAiGrading assignment={assignment} submission={submission} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    const create = await screen.findByRole("button", { name: "Tạo gợi ý chấm AI" });
    vi.useFakeTimers();
    api.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("aborted"))); }));
    fireEvent.click(create);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Máy chủ có thể vẫn đang xử lý");
    expect(api).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Tạo gợi ý chấm AI" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" })).toBeEnabled();
  });
});
