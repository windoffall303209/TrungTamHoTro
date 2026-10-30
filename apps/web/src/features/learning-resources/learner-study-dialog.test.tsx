import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearnerStudyDialog } from "./learner-study-dialog";

const apiRequest = vi.fn();
const preview = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args), previewApiFile: (...args: unknown[]) => preview(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "LEARNER" }, notify: vi.fn() }) }));
const item = { id: "guide", sourceVersion: 2, publishedAt: "2026-09-08T08:00:00Z", publicationRevision: 3, language: "EN" };
const source = { id: "source", materialId: "material", version: 2, page: 4, name: "Lesson.pdf", text: "Source evidence" };
const detail = { ...item, result: { summary: [{ text: "Published summary", citations: [source] }], flashcards: [{ front: "Published question", back: "Published answer", citations: [source] }], warning: "Review source", coverage: { partial: true } } };

describe("LearnerStudyDialog", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("reads only published endpoints, reveals answers on demand and checks the exact source version", async () => {
    apiRequest.mockResolvedValueOnce({ items: [item], nextCursor: null }).mockResolvedValueOnce(detail).mockResolvedValueOnce({ url: "/signed-source" });
    render(<LearnerStudyDialog material={{ id: "material", name: "Lesson" }} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Mở bộ ôn tập" }));
    expect(await screen.findByText("Published summary")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tóm tắt và thẻ ôn tập" })).toHaveFocus();
    const card = screen.getByText("Published question").closest("details")!;
    expect(card).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Published question"));
    expect(screen.getByText("Published answer")).toBeVisible();
    fireEvent.click(within(card).getByText("Đối chiếu nguồn"));
    fireEvent.click(within(card).getByRole("button", { name: "Mở bản nguồn" }));
    await act(async () => {});
    expect(apiRequest.mock.calls.map((call) => call[0])).toEqual(["/learner/materials/material/study-guides", "/learner/materials/material/study-guides/guide", "/materials/material/versions/2/access?action=PREVIEW"]);
    expect(apiRequest.mock.calls.every((call) => !call[1].method && !call[1].body)).toBe(true);
    expect(preview).toHaveBeenCalledWith("/signed-source", "LEARNER", "Lesson.pdf");
  });

  it("loads through an empty filtered page and handles withdrawal without keeping stale content", async () => {
    apiRequest.mockResolvedValueOnce({ items: [], nextCursor: "hidden-guide" }).mockResolvedValueOnce({ items: [item], nextCursor: null }).mockResolvedValueOnce(detail).mockRejectedValueOnce(new Error("Không tìm thấy bộ ôn tập đã phát hành."));
    render(<LearnerStudyDialog material={{ id: "material", name: "Lesson" }} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tải thêm bộ ôn tập" }));
    expect(apiRequest.mock.calls[1]?.[0]).toBe("/learner/materials/material/study-guides?cursor=hidden-guide");
    fireEvent.click(await screen.findByRole("button", { name: "Mở bộ ôn tập" }));
    await screen.findByText("Published summary");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại bản đang xem" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tìm thấy");
    expect(screen.queryByText("Published summary")).not.toBeInTheDocument();
  });

  it("aborts pending reads on unmount and reloads correctly in StrictMode", async () => {
    const signals: AbortSignal[] = [];
    apiRequest.mockImplementation((_path: string, options: { signal: AbortSignal }) => { signals.push(options.signal); return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))); });
    const view = render(<StrictMode><LearnerStudyDialog material={{ id: "material", name: "Lesson" }} onClose={vi.fn()} /></StrictMode>);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    view.unmount();
    expect(signals[1]?.aborted).toBe(true);
    await act(async () => {});
  });

  it("bounds read time and permits manual retry without generating AI", async () => {
    vi.useFakeTimers();
    apiRequest.mockImplementationOnce((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("timeout"))))).mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<LearnerStudyDialog material={{ id: "material", name: "Lesson" }} onClose={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("quá thời gian chờ");
    fireEvent.click(screen.getByRole("button", { name: "Làm mới bộ ôn tập" }));
    await act(async () => {});
    expect(screen.getByText(/Chưa có bộ ôn tập được phép xem/)).toBeVisible();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });
});
