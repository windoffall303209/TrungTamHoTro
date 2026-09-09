import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialQuestionHistory } from "./material-question-history";

const api = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => api(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "INSTRUCTOR" } }) }));
const entry = { id: "a".repeat(64), question: "Explain <script>this</script>", language: "EN" as const, state: "READY", createdAt: "2026-09-09T00:00:00Z" };

describe("private question history", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("loads only on request and restores input without a generation request", async () => {
    const onSelect = vi.fn();
    api.mockResolvedValue({ items: [entry], nextCursor: null });
    render(<MaterialQuestionHistory materialId="file / 1" version={2} disabled={false} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Lịch sử câu hỏi của bạn"));
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lịch sử câu hỏi" }));
    expect(await screen.findByText(entry.question)).toHaveAttribute("translate", "no");
    expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chọn câu hỏi này" }));
    expect(onSelect).toHaveBeenCalledWith(entry);
    expect(api).toHaveBeenCalledExactlyOnceWith("/instructor/materials/file%20%2F%201/ai-questions?version=2", expect.objectContaining({ roleCode: "INSTRUCTOR" }));
    expect(api.mock.calls[0]?.[1]).not.toHaveProperty("method");
  });

  it("paginates and clears old rows after a failed read", async () => {
    api.mockResolvedValueOnce({ items: [entry], nextCursor: entry.id }).mockResolvedValueOnce({ items: [], nextCursor: null }).mockRejectedValueOnce(new Error("Access revoked"));
    render(<MaterialQuestionHistory materialId="file" version={2} disabled={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Lịch sử câu hỏi của bạn"));
    fireEvent.click(screen.getByRole("button", { name: "Tải lịch sử câu hỏi" }));
    await screen.findByText(entry.question);
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("Chưa có câu hỏi trong lịch sử phiên bản này.");
    expect(api.mock.calls[1]?.[0]).toBe(`/instructor/materials/file/ai-questions?version=2&cursor=${entry.id}`);
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Trang trước" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Access revoked");
    expect(screen.queryByText(entry.question)).not.toBeInTheDocument();
  });

  it("prevents duplicate reads and aborts pending reads on unmount", async () => {
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<MaterialQuestionHistory materialId="file" version={1} disabled={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Lịch sử câu hỏi của bạn"));
    const button = screen.getByRole("button", { name: "Tải lịch sử câu hỏi" });
    fireEvent.click(button); fireEvent.click(button);
    expect(api).toHaveBeenCalledTimes(1);
    const signal = api.mock.calls[0]?.[1].signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => resolve({ items: [entry], nextCursor: null }));
    expect(screen.queryByText(entry.question)).not.toBeInTheDocument();
  });

  it("times out without automatically retrying", async () => {
    vi.useFakeTimers();
    api.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("Aborted")))));
    render(<MaterialQuestionHistory materialId="file" version={1} disabled={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Lịch sử câu hỏi của bạn"));
    fireEvent.click(screen.getByRole("button", { name: "Tải lịch sử câu hỏi" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("quá thời gian chờ");
    expect(api).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Tải lịch sử câu hỏi" })).toBeEnabled();
  });
});
