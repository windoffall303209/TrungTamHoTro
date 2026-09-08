import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "@/lib/learning-types";
import { MaterialAiDialog } from "./material-ai-dialog";

const apiRequest = vi.fn();
const previewApiFile = vi.fn();
const notify = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args), previewApiFile: (...args: unknown[]) => previewApiFile(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "INSTRUCTOR" }, notify }) }));
const material = { id: "material-1", name: "Lesson.pdf", version: 4 } as Material;
const response = { answer: "Answer <script>unsafe()</script>", warning: "Verify original", version: 3, insufficientContext: false, citations: [{ id: "chunk-1", materialId: "material-1", version: 3, name: "Lesson.pdf", page: 2, text: "Source passage" }] };

describe("MaterialAiDialog", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("opens study mode without charging and prevents switching tools during generation", async () => {
    let resolve!: (value: unknown) => void;
    apiRequest.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<MaterialAiDialog material={material} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Bộ ôn tập" }));
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tạo bộ ôn tập" }));
    expect(screen.getByRole("button", { name: "Hỏi đáp" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolve({ insufficientContext: true, summary: [], flashcards: [], version: 3, warning: "Check source", coverage: { partial: false, selectedChunks: 1, totalChunks: 1, selectedPages: [1] } });
    await screen.findByText("Chưa đủ ngữ cảnh");
    expect(screen.getByRole("button", { name: "Hỏi đáp" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not request on open, trims input, sends language, and opens the cited version", async () => {
    apiRequest.mockResolvedValueOnce(response).mockResolvedValueOnce({ url: "/signed-source" });
    render(<MaterialAiDialog material={material} onClose={vi.fn()} />);
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Explain this lesson  " } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "BILINGUAL" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));
    expect(await screen.findByText(response.answer)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(apiRequest).toHaveBeenCalledWith("/instructor/materials/material-1/ai-question", expect.objectContaining({ method: "POST", body: JSON.stringify({ question: "Explain this lesson", language: "BILINGUAL" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Mở bản nguồn" }));
    await waitFor(() => expect(previewApiFile).toHaveBeenCalledWith("/signed-source", "INSTRUCTOR", "Lesson.pdf"));
    expect(apiRequest).toHaveBeenLastCalledWith("/materials/material-1/versions/3/access?action=PREVIEW", expect.anything());
  });

  it("locks concurrent submissions and closing until the request finishes", async () => {
    let resolve!: (value: typeof response) => void;
    apiRequest.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const onClose = vi.fn();
    render(<MaterialAiDialog material={material} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain" } });
    const form = screen.getByRole("textbox").closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    resolve(response);
    await screen.findByText(response.answer);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates whitespace, keeps input after errors, and never retries automatically", async () => {
    apiRequest.mockRejectedValueOnce(new Error("Provider unavailable"));
    render(<MaterialAiDialog material={material} onClose={vi.fn()} />);
    const textbox = screen.getByRole("textbox");
    fireEvent.change(textbox, { target: { value: "  " } });
    fireEvent.submit(textbox.closest("form")!);
    expect(apiRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("2.000");
    fireEvent.change(textbox, { target: { value: "Explain" } });
    fireEvent.submit(textbox.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
    expect(textbox).toHaveValue("Explain");
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it("shows insufficient context without inventing a source link", async () => {
    apiRequest.mockResolvedValueOnce({ ...response, answer: "Not enough information", insufficientContext: true, citations: [] });
    render(<MaterialAiDialog material={material} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unrelated topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));
    expect(await screen.findByText("Chưa đủ ngữ cảnh")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở bản nguồn" })).not.toBeInTheDocument();
  });

  it("unlocks after a bounded wait and warns against chargeable retries", async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const onClose = vi.fn();
    render(<MaterialAiDialog material={material} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain this" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("phát sinh phí mới");
    expect(screen.getByRole("textbox")).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
