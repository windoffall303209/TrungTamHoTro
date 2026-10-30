import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudyDraftEditor } from "./study-draft-editor";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "INSTRUCTOR" } }) }));
const source = { id: "chunk", materialId: "material", version: 1, name: "Lesson", page: 1, text: "Evidence" };
const guide = { draftId: "draft", editRevision: 3, insufficientContext: false, summary: [{ text: "Original summary", citations: [source] }], flashcards: [{ front: "Original question", back: "Original answer", citations: [source] }], version: 1, warning: "Check source", coverage: { totalChunks: 1, selectedChunks: 1, selectedPages: [1], partial: false, fromPage: null, toPage: null } };

describe("StudyDraftEditor", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("saves edited text with the loaded revision and source IDs, without generating AI", async () => {
    const onSaved = vi.fn();
    apiRequest.mockResolvedValue({ editedResult: { ...guide, summary: [{ text: "Revised", citations: [source] }] }, editRevision: 4 });
    render(<StudyDraftEditor materialId="material" guide={guide} onSaved={onSaved} onCancel={vi.fn()} />);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("heading")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Ý chính 1"), { target: { value: " Revised " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chỉnh sửa" }));
    await act(async () => {});
    expect(apiRequest).toHaveBeenCalledWith("/instructor/materials/material/ai-study-guides/draft", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ expectedRevision: 3, summary: [{ text: "Revised", citationIds: ["chunk"] }], flashcards: [{ front: "Original question", back: "Original answer", citationIds: ["chunk"] }] }) }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ editRevision: 4, draftId: "draft" }));
  });

  it("requires explicit discard and rejects blank fields locally", () => {
    const onCancel = vi.fn();
    render(<StudyDraftEditor materialId="material" guide={guide} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText("Đáp án 1"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chỉnh sửa" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Kiểm tra các ô");
    expect(screen.getByLabelText(/Đáp án 1/)).toHaveAttribute("aria-invalid", "true");
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục sửa" }));
    expect(screen.queryByText("Bỏ các thay đổi chưa lưu?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("retains edits and the original revision after a conflicting save", async () => {
    apiRequest.mockRejectedValue(new Error("Bản ôn tập đã được sửa ở nơi khác. Hãy tải lại trước khi lưu."));
    render(<StudyDraftEditor materialId="material" guide={guide} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Câu hỏi 1"), { target: { value: "My question" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu chỉnh sửa" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("đã được sửa ở nơi khác");
    expect(screen.getByLabelText("Câu hỏi 1")).toHaveValue("My question");
    expect(screen.getByRole("button", { name: "Hủy chỉnh sửa" })).toBeEnabled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("bounds pending saves and never retries automatically", async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout")))));
    render(<StudyDraftEditor materialId="material" guide={guide} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const field = screen.getByLabelText("Ý chính 1");
    fireEvent.change(field, { target: { value: "Changed" } });
    fireEvent.submit(field.closest("form")!); fireEvent.submit(field.closest("form")!);
    expect(screen.getByRole("button", { name: "Hủy chỉnh sửa" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa xác nhận được việc lưu");
    expect(field).toHaveValue("Changed");
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
