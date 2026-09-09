import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiGradingOperations } from "./ai-grading-operations";

const api = vi.fn();
const session = { roleCode: "SYSTEM_ADMIN", permissions: ["system:configure"], user: { id: "admin" } };
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => api(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session }) }));
const row = { id: "claim-1", ownerId: "teacher-1", submissionId: "submission-1", language: "VI", state: "UNCERTAIN", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T01:00:00Z" };

describe("admin AI grading queue", () => {
  beforeEach(() => { vi.resetAllMocks(); session.roleCode = "SYSTEM_ADMIN"; session.permissions = ["system:configure"]; session.user.id = "admin"; });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it.each(["document-answers", "extractions"])("reads and paginates %s without exposing content or exam controls", async (domain) => {
    const answer = { id: "a".repeat(64), ownerId: "teacher", state: "READY", version: 3, createdAt: row.createdAt, updatedAt: row.updatedAt };
    api.mockResolvedValueOnce({ items: [answer], nextCursor: answer.id }).mockResolvedValueOnce({ items: [{ ...answer, id: "b".repeat(64) }], nextCursor: null });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: domain } });
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: "Phạm vi đối soát sinh đề" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Đã hoàn tất lưu đề" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" }), { target: { value: "READY" } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(await screen.findByText(answer.id)).toHaveAttribute("translate", "no");
    expect(screen.getByText(domain === "extractions" ? "Đã lưu trích xuất" : "Đã lưu câu trả lời", { selector: "p" })).toBeInTheDocument();
    if (domain === "extractions") expect(screen.getByText(/Đã lưu bao gồm cache cũ/)).toBeInTheDocument();
    expect(screen.getByText("Phiên bản tác vụ")).toBeInTheDocument();
    expect(screen.queryByText("Mã tài liệu")).not.toBeInTheDocument();
    expect(api.mock.calls[0]?.[0]).toBe(`/admin/ai-operations/${domain}?limit=20&state=READY`);
    expect(api.mock.calls[0]?.[1]).not.toHaveProperty("method");
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("b".repeat(64));
    expect(api.mock.calls[1]?.[0]).toBe(`/admin/ai-operations/${domain}?limit=20&state=READY&cursor=${answer.id}`);
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Tạo|Xóa|Thử lại/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" }), { target: { value: "UNCERTAIN" } });
    expect(screen.queryByText("b".repeat(64))).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("loads metadata only on request and does not expose mutation actions", async () => {
    api.mockResolvedValue({ items: [row], nextCursor: null });
    render(<AiGradingOperations />);
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(await screen.findByText(row.id)).toHaveAttribute("translate", "no");
    expect(api).toHaveBeenCalledExactlyOnceWith("/admin/ai-operations/grading?limit=20", expect.objectContaining({ roleCode: "SYSTEM_ADMIN" }));
    expect(api.mock.calls[0]?.[1]).not.toHaveProperty("method");
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Tạo|Xóa|Thử lại/ })).not.toBeInTheDocument();
  });

  it("loads study metadata from its own endpoint and resets the prior filter and cursor", async () => {
    api.mockResolvedValueOnce({ items: [row], nextCursor: "grading-cursor" });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" }), { target: { value: "READY" } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText(row.id);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "study" } });
    expect(screen.queryByText(row.id)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" })).toHaveValue("");
    expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValueOnce({ items: [{ id: "study-1", ownerId: "owner-1", materialId: "material-1", sourceVersion: 3, state: "UNCERTAIN", createdAt: row.createdAt, updatedAt: row.updatedAt }], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(await screen.findByText("material-1")).toHaveAttribute("translate", "no");
    expect(screen.getByText("Phiên bản nguồn")).toBeInTheDocument();
    expect(screen.queryByText("Mã bài nộp")).not.toBeInTheDocument();
    expect(api.mock.calls[1]?.[0]).toBe("/admin/ai-operations/study?limit=20");
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
  });

  it.each(["study", "document-answers", "extractions"])("aborts the old queue when switching to %s and discards its late response", async (domain) => {
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<AiGradingOperations />);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    const signal = api.mock.calls[0]?.[1].signal as AbortSignal;
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: domain } });
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ items: [row], nextCursor: "old-cursor" }); });
    expect(screen.queryByText(row.id)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: domain === "study" ? "Đối soát bộ ôn tập AI" : domain === "extractions" ? "Đối soát trích xuất OCR" : "Đối soát hỏi đáp AI" })).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("distinguishes saved AI drafts from completed exams and uses exam-only states", async () => {
    api.mockResolvedValueOnce({ items: [{ id: "exam-request", ownerId: "teacher", version: 3, state: "READY", createdAt: row.createdAt, updatedAt: row.updatedAt }], nextCursor: null });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "exams" } });
    expect(screen.getByRole("option", { name: "Chưa hoàn tất lưu đề" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Đã giữ khóa, chưa bắt đầu sinh" })).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText("exam-request");
    expect(screen.getByText("Đã có bản nháp AI, chưa xác nhận lưu đề", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Phiên bản tác vụ")).toBeInTheDocument();
    expect(screen.queryByText("Phiên bản nguồn")).not.toBeInTheDocument();
    expect(screen.queryByText("Mã bài nộp")).not.toBeInTheDocument();
    expect(api.mock.calls[0]?.[0]).toBe("/admin/ai-operations/exams?limit=20");
    fireEvent.change(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" }), { target: { value: "COMPLETED" } });
    api.mockResolvedValueOnce({ items: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText("Không có tác vụ AI trong trang và bộ lọc này.");
    expect(api.mock.calls[1]?.[0]).toBe("/admin/ai-operations/exams?limit=20&state=COMPLETED");
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "grading" } });
    expect(screen.queryByRole("option", { name: "Đã hoàn tất lưu đề" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" })).toHaveValue("");
  });

  it("reopens an uncertain canonical exam claim only after explicit evidence and confirmation", async () => {
    const exam = { id: "exam-uncertain", ownerId: "teacher", version: 7, state: "UNCERTAIN", createdAt: row.createdAt, updatedAt: row.updatedAt };
    api.mockResolvedValueOnce({ items: [exam], nextCursor: null }).mockResolvedValueOnce({ ...exam, version: 8, state: "CLAIMED", updatedAt: "2026-09-09T02:00:00Z" });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "exams" } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText(exam.id);
    fireEvent.click(screen.getByRole("button", { name: "Mở lại bằng bằng chứng" }));
    expect(screen.getByRole("dialog", { name: "Đối soát tác vụ sinh đề" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghi bằng chứng và mở lại" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Mã bằng chứng hoặc nhật ký" }), { target: { value: "provider-log-001" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Mã yêu cầu provider — nếu có" }), { target: { value: "provider-request-001" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Kết quả kiểm tra" }), { target: { value: "Provider dashboard confirms the request was not accepted or billed." } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ghi bằng chứng và mở lại" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Hệ thống chưa gọi AI");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Đã giữ khóa, chưa bắt đầu sinh", { selector: "p" })).toBeInTheDocument();
    expect(api.mock.calls[1]?.[0]).toBe("/admin/ai-operations/exams/exam-uncertain/reconcile-not-processed");
    expect(api.mock.calls[1]?.[1]).toMatchObject({ roleCode: "SYSTEM_ADMIN", method: "POST" });
    expect(JSON.parse(String(api.mock.calls[1]?.[1].body))).toMatchObject({ expectedVersion: 7, evidenceReference: "provider-log-001", providerRequestId: "provider-request-001", evidenceNote: "Provider dashboard confirms the request was not accepted or billed." });
  });

  it.each([
    ["grading", { ...row }, "expectedUpdatedAt", row.updatedAt],
    ["study", { id: "study-retry", ownerId: "teacher-1", materialId: "material-1", sourceVersion: 2, state: "UNCERTAIN", createdAt: row.createdAt, updatedAt: row.updatedAt }, "expectedUpdatedAt", row.updatedAt],
    ["document-answers", { id: "a".repeat(64), ownerId: "teacher-1", version: 4, state: "UNCERTAIN", createdAt: row.createdAt, updatedAt: row.updatedAt }, "expectedVersion", 4],
    ["extractions", { id: "b".repeat(64), ownerId: "teacher-1", version: 5, state: "GENERATING", createdAt: row.createdAt, updatedAt: row.updatedAt }, "expectedVersion", 5],
  ] as const)("opens %s only with evidence and sends its authoritative CAS token", async (domain, claim, tokenName, tokenValue) => {
    api.mockResolvedValueOnce({ items: [claim], nextCursor: null }).mockResolvedValueOnce({ ...claim, state: "RETRY_AUTHORIZED", updatedAt: "2026-09-09T02:00:00Z" });
    render(<AiGradingOperations />);
    if (domain !== "grading") fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: domain } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText(claim.id);
    fireEvent.click(screen.getByRole("button", { name: "Mở lại bằng bằng chứng" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Mã bằng chứng hoặc nhật ký" }), { target: { value: "provider-log-001" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Kết quả kiểm tra" }), { target: { value: "Provider dashboard confirms the request was not accepted or billed." } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ghi bằng chứng và mở lại" }));
    expect(await screen.findByText("Đã cho phép thử lại", { selector: "p" })).toBeInTheDocument();
    expect(api.mock.calls[1]?.[0]).toBe(`/admin/ai-operations/${domain}/${claim.id}/reconcile-not-processed`);
    const body = JSON.parse(String(api.mock.calls[1]?.[1].body)) as Record<string, unknown>;
    expect(body[tokenName]).toBe(tokenValue);
    expect(body).not.toHaveProperty(tokenName === "expectedVersion" ? "expectedUpdatedAt" : "expectedVersion");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it.each(["unlinked", "broken"])("does not offer evidence recovery outside the canonical scope: %s", async (selectedScope) => {
    api.mockResolvedValueOnce({ items: [{ id: "affected", ownerId: "teacher", version: 2, state: "UNCERTAIN", createdAt: row.createdAt, updatedAt: row.updatedAt }], nextCursor: null });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "exams" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Phạm vi đối soát sinh đề" }), { target: { value: selectedScope } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText("affected");
    expect(screen.queryByRole("button", { name: "Mở lại bằng bằng chứng" })).not.toBeInTheDocument();
  });

  it("navigates cursor pages and resets old results when changing filters", async () => {
    api.mockResolvedValueOnce({ items: [row], nextCursor: "cursor / 1" }).mockResolvedValueOnce({ items: [{ ...row, id: "claim-2" }], nextCursor: null });
    render(<AiGradingOperations />);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText(row.id);
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("claim-2");
    expect(api.mock.calls[1]?.[0]).toBe("/admin/ai-operations/grading?limit=20&cursor=cursor+%2F+1");
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeEnabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Trạng thái tác vụ AI" }), { target: { value: "READY" } });
    expect(screen.queryByText("claim-2")).not.toBeInTheDocument();
    api.mockResolvedValueOnce({ items: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(await screen.findByText("Không có tác vụ AI trong trang và bộ lọc này.")).toHaveAttribute("role", "status");
    expect(api.mock.calls[2]?.[0]).toBe("/admin/ai-operations/grading?limit=20&state=READY");
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
  });

  it.each(["unlinked", "broken"])("reads %s exam claims explicitly and drops cursors when changing scope", async (selectedScope) => {
    const exam = { id: "unlinked-1", ownerId: "teacher", version: 1, state: "CLAIMED", createdAt: row.createdAt, updatedAt: row.updatedAt };
    api.mockResolvedValueOnce({ items: [exam], nextCursor: "unlinked / 1" }).mockResolvedValueOnce({ items: [{ ...exam, id: "unlinked-2" }], nextCursor: null });
    render(<AiGradingOperations />);
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "exams" } });
    const scope = screen.getByRole("combobox", { name: "Phạm vi đối soát sinh đề" });
    fireEvent.change(scope, { target: { value: selectedScope } });
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText(selectedScope === "unlinked" ? /Khóa có thể đang được chuẩn bị/ : /số hàng không phải số lần gọi AI/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(scope).toBeDisabled();
    await screen.findByText("unlinked-1");
    expect(api.mock.calls[0]?.[0]).toBe(`/admin/ai-operations/exams?limit=20&scope=${selectedScope}`);
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await screen.findByText("unlinked-2");
    expect(api.mock.calls[1]?.[0]).toBe(`/admin/ai-operations/exams?limit=20&scope=${selectedScope}&cursor=unlinked+%2F+1`);
    fireEvent.change(scope, { target: { value: "canonical" } });
    expect(screen.queryByText("unlinked-2")).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
    api.mockResolvedValueOnce({ items: [], nextCursor: null });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByRole("status");
    expect(api.mock.calls[2]?.[0]).toBe("/admin/ai-operations/exams?limit=20");
    expect(screen.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    fireEvent.change(scope, { target: { value: "unlinked" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "study" } });
    expect(screen.queryByRole("combobox", { name: "Phạm vi đối soát sinh đề" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Loại tác vụ đối soát" }), { target: { value: "exams" } });
    expect(screen.getByRole("combobox", { name: "Phạm vi đối soát sinh đề" })).toHaveValue("canonical");
  });

  it("clears stale results on an error and permits a fresh first-page read", async () => {
    api.mockResolvedValueOnce({ items: [row], nextCursor: null }).mockRejectedValueOnce(new Error("Database offline"));
    render(<AiGradingOperations />);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await screen.findByText(row.id);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database offline");
    expect(screen.queryByText(row.id)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lại danh sách" })).toBeEnabled();
  });

  it("locks duplicate reads and aborts late responses when the panel closes", async () => {
    let resolve!: (value: unknown) => void;
    api.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = render(<AiGradingOperations />);
    const button = screen.getByRole("button", { name: "Tải lại danh sách" });
    fireEvent.click(button); fireEvent.click(button);
    expect(api).toHaveBeenCalledTimes(1);
    const signal = api.mock.calls[0]?.[1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ items: [row], nextCursor: null }); });
    expect(screen.queryByText(row.id)).not.toBeInTheDocument();
  });

  it("ends a timed-out read with recovery guidance and no automatic retry", async () => {
    vi.useFakeTimers();
    api.mockImplementation((_path: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    render(<AiGradingOperations />);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại danh sách" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("quá thời gian chờ");
    expect(screen.getByRole("button", { name: "Tải lại danh sách" })).toBeEnabled();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it.each(["INSTRUCTOR", "CENTER_MANAGER", "LEARNER"])("hides the queue for %s even with configuration permission", (role) => {
    session.roleCode = role;
    render(<AiGradingOperations />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("hides the queue from administrators without configuration permission", () => {
    session.permissions = [];
    render(<AiGradingOperations />);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});
