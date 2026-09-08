import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialStudyGuide } from "./material-study-guide";

const apiRequest = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "INSTRUCTOR" } }) }));
const source = { id: "chunk-1", materialId: "material-1", name: "Lesson.pdf", version: 3, page: 2, text: "The source evidence." };
const response = { insufficientContext: false, summary: [{ text: "A key concept.", citations: [source] }], flashcards: [{ front: "What is the concept?", back: "The supported answer.", citations: [source] }], version: 3, warning: "Verify the source.", coverage: { partial: true, selectedChunks: 7, totalChunks: 30, selectedPages: [1, 5, 10], fromPage: null, toPage: null } };

describe("MaterialStudyGuide", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("requires explicit generation and sends selected count, language and page range", async () => {
    apiRequest.mockResolvedValueOnce(response);
    const openSource = vi.fn().mockResolvedValue(undefined);
    render(<MaterialStudyGuide materialId="material-1" onBusyChange={vi.fn()} openSource={openSource} />);
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Số thẻ ôn tập"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Ngôn ngữ bộ ôn tập"), { target: { value: "BILINGUAL" } });
    fireEvent.change(screen.getByLabelText("Từ trang — tùy chọn"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Đến trang — tùy chọn"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo bộ ôn tập" }));
    expect(await screen.findByText("A key concept.")).toBeVisible();
    expect(apiRequest).toHaveBeenCalledWith("/instructor/materials/material-1/ai-study-guide", expect.objectContaining({ body: JSON.stringify({ cardCount: 1, language: "BILINGUAL", fromPage: 2, toPage: 4 }) }));
    expect(screen.getByText(/Chỉ bao phủ một phần/)).toBeVisible();
    const card = screen.getByText("What is the concept?").closest("details")!;
    expect(card).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("What is the concept?"));
    expect(card).toHaveAttribute("open");
    fireEvent.click(screen.getAllByText("Đối chiếu nguồn")[0]!);
    fireEvent.click(within(screen.getByText("A key concept.").closest("li")!).getByRole("button", { name: "Mở bản nguồn" }));
    expect(openSource).toHaveBeenCalledWith(source);
  });

  it("rejects partial and reversed page ranges without invoking AI", () => {
    render(<MaterialStudyGuide materialId="material-1" onBusyChange={vi.fn()} openSource={vi.fn()} />);
    const start = screen.getByLabelText("Từ trang — tùy chọn");
    fireEvent.change(start, { target: { value: "4" } });
    fireEvent.submit(start.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Cần chọn cả");
    fireEvent.change(screen.getByLabelText("Đến trang — tùy chọn"), { target: { value: "2" } });
    fireEvent.submit(start.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("trang kết thúc không trước");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows an actionable no-context state without fake cards", async () => {
    apiRequest.mockResolvedValueOnce({ ...response, insufficientContext: true, summary: [], flashcards: [] });
    render(<MaterialStudyGuide materialId="material-1" onBusyChange={vi.fn()} openSource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo bộ ôn tập" }));
    expect(await screen.findByText("Chưa đủ ngữ cảnh")).toBeVisible();
    expect(screen.getByText(/Hãy giảm số thẻ/)).toBeVisible();
    expect(screen.queryByText("Thẻ tự ôn tập")).not.toBeInTheDocument();
  });

  it("locks concurrent requests, unlocks on timeout, preserves inputs and never retries automatically", async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const onBusyChange = vi.fn();
    render(<MaterialStudyGuide materialId="material-1" onBusyChange={onBusyChange} openSource={vi.fn()} />);
    const count = screen.getByLabelText("Số thẻ ôn tập");
    fireEvent.change(count, { target: { value: "8" } });
    fireEvent.submit(count.closest("form")!); fireEvent.submit(count.closest("form")!);
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenCalledWith(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("phát sinh phí mới");
    expect(count).toHaveValue(8);
    expect(count).toBeEnabled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
