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
const txt = { id: "file", originalName: "answer.txt", mimeType: "text/plain", sizeBytes: 100, createdAt: "2026-09-08", canPreview: false };
const pdf = { ...txt, originalName: "answer.pdf", mimeType: "application/pdf", sizeBytes: 1024 };
const docx = { ...txt, originalName: "answer.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 2048 };
const source = { attachmentId: "file", name: "answer.txt", checksum: `sha256:${"a".repeat(64)}`, text: submission.content };

describe("instructor AI grading review", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("reviews attachment-only TXT sources and copies scores only after confirmation", async () => {
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, sources: [source] } });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: "", attachments: [txt] }} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    await screen.findByText("Nguồn dùng để chấm");
    expect(screen.getByText(source.text, { selector: "p" })).toHaveAttribute("translate", "no");
    expect(screen.getAllByText("answer.txt")).toHaveLength(2);
    expect(screen.getByText(/Bản văn bản đã được máy chủ đối chiếu/)).toBeInTheDocument();
    expect(screen.queryByText(/OCR chưa được xác minh độc lập/)).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Đưa gợi ý vào biểu mẫu" }));
    expect(onUse).toHaveBeenCalledExactlyOnceWith({ r1: 4.5 }, result.feedback);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined, [], [source, source], [{ ...source, attachmentId: "other" }],
    [{ ...source, checksum: "missing" }], [{ ...source, name: "different.txt" }],
    [{ ...source, text: "not the quoted answer" }],
  ])("rejects missing, mismatched or duplicate TXT sources %#", async (sources) => {
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, sources } });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: "", attachments: [txt] }} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không khớp");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it("requires both inline content and TXT sources, including for insufficient-evidence results", async () => {
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, insufficientEvidence: true, sources: [source] } });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, attachments: [txt] }} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không khớp");
  });

  it("creates a TXT suggestion without uploading source text or choosing a model in the request", async () => {
    api.mockResolvedValueOnce({ state: "NOT_REQUESTED" }).mockResolvedValueOnce({ ...result, sources: [source] });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: "", attachments: [{ ...txt, sizeBytes: 80000 }] }} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo gợi ý chấm AI" }));
    await screen.findByText("Nguồn dùng để chấm");
    expect(api).toHaveBeenCalledTimes(2);
    expect(api).toHaveBeenLastCalledWith("/instructor/assignment-submissions/submission/ai-suggestion", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedSubmissionRevision: 2, language: "VI" }) }));
    expect(onUse).not.toHaveBeenCalled();
  });

  it("creates a PDF suggestion only after status inspection and requires OCR review", async () => {
    const pdfSource = { ...source, name: pdf.originalName, text: "Text transcribed from the submitted PDF." };
    api.mockResolvedValueOnce({ state: "NOT_REQUESTED" }).mockResolvedValueOnce({ ...result, criteria: [{ ...result.criteria[0], evidence: [pdfSource.text] }], sources: [pdfSource] });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: "", attachments: [pdf] }} onUse={onUse} />);
    expect(screen.getByText(/cả phí OCR và phí chấm/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByRole("button", { name: "Tạo gợi ý chấm AI" })).toBeEnabled();
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Tạo gợi ý chấm AI" }));
    expect((await screen.findAllByText(pdfSource.text))[0]).toHaveAttribute("translate", "no");
    expect(screen.getByText(/OCR chưa được xác minh độc lập/)).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith("/instructor/assignment-submissions/submission/ai-suggestion", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedSubmissionRevision: 2, language: "VI" }) }));
    expect(onUse).not.toHaveBeenCalled();
  });

  it("creates a DOCX suggestion with local-extraction guidance and no OCR fee warning", async () => {
    const docxSource = { ...source, name: docx.originalName, text: "Text extracted locally from the submitted DOCX." };
    api.mockResolvedValueOnce({ state: "NOT_REQUESTED" }).mockResolvedValueOnce({ ...result, criteria: [{ ...result.criteria[0], evidence: [docxSource.text] }], sources: [docxSource] });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: "", attachments: [docx] }} onUse={onUse} />);
    expect(screen.getByText(/DOCX được đọc thành văn bản tại máy chủ/)).toBeInTheDocument();
    expect(screen.queryByText(/cả phí OCR và phí chấm/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo gợi ý chấm AI" }));
    expect((await screen.findAllByText(docxSource.text))[0]).toHaveAttribute("translate", "no");
    expect(screen.getByText(/Văn bản DOCX là bản trích xuất cục bộ/)).toBeInTheDocument();
    expect(api).toHaveBeenLastCalledWith("/instructor/assignment-submissions/submission/ai-suggestion", expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedSubmissionRevision: 2, language: "VI" }) }));
  });

  it.each([{ ...pdf, sizeBytes: 12 * 1024 * 1024 + 1 }, { ...docx, sizeBytes: 12 * 1024 * 1024 + 1 }, { ...pdf, mimeType: "application/msword", originalName: "answer.doc" }])("blocks unsupported or oversized extracted sources %#", (file) => {
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, attachments: [file] }} onUse={onUse} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Word DOC cũ và bài vượt giới hạn/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("shows inline and file sources without permitting quotes across their boundary", async () => {
    const inline = { attachmentId: null, name: "Inline", checksum: null, text: "Inline answer." };
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, sources: [inline, source] } });
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, content: inline.text, attachments: [txt] }} onUse={onUse} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    await screen.findByText("Nguồn dùng để chấm");
    expect(screen.getByText("Nội dung nhập trực tiếp")).toBeInTheDocument();
    expect(screen.getByText(inline.text)).toHaveAttribute("translate", "no");
    api.mockResolvedValueOnce({ state: "READY", result: { ...result, sources: [inline, source], criteria: [{ ...result.criteria[0], evidence: [`${inline.text}\n\n${source.text}`] }] } });
    fireEvent.click(screen.getByRole("button", { name: "Kiểm tra gợi ý đã lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không khớp");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(onUse).not.toHaveBeenCalled();
  });

  it.each([{ ...txt, mimeType: "application/pdf" }, { ...txt, originalName: "answer.pdf" }, { ...txt, sizeBytes: 80001 }, { ...txt, sizeBytes: 0 }])("blocks unsupported or oversized attachments before requesting AI %#", (file) => {
    render(<AssignmentAiGrading assignment={assignment} submission={{ ...submission, attachments: [txt, file] }} onUse={onUse} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/Word DOC cũ và bài vượt giới hạn cần chấm thủ công/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

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
