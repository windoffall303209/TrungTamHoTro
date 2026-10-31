import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiTaskSettings } from "../../../../src/roles/admin/ai-task-settings";

const apiRequest = vi.fn();
const notify = vi.fn();
vi.mock("@/lib/api-client", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@/providers/app-provider", () => ({ useApp: () => ({ session: { roleCode: "SYSTEM_ADMIN" }, notify }) }));
vi.mock("@/shared/ui/searchable-select", () => ({
  /** Dùng control HTML để kiểm tra chính sách provider, không lặp test hành vi dropdown riêng. */
  SearchableSelect: ({ options, onChange, ...props }: { options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) => <select {...props} onChange={(event) => onChange(event.target.value)}><option value="">Select</option>{options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
}));
const providers = [
  { id: "gemini", name: "Gemini", provider: "GEMINI", enabled: true, hasApiKey: true, model: "flash" },
  { id: "nim", name: "NIM", provider: "NVIDIA_NIM", enabled: true, hasApiKey: true, model: "llama" },
  { id: "custom", name: "Custom", provider: "CUSTOM", enabled: true, hasApiKey: true, model: "custom-model" },
  { id: "off", name: "Disabled", provider: "OPENAI", enabled: false, hasApiKey: true, model: "off" },
];

describe("AI task routing UI", () => {
  beforeEach(() => { vi.clearAllMocks(); apiRequest.mockResolvedValue({}); });
  afterEach(cleanup);

  it("configures an independent NIM grading model without a context provider", async () => {
    render(<AiTaskSettings providers={providers} catalog={{ NVIDIA_NIM: [{ value: "llama", label: "Llama", description: "" }] }} />);
    const selector = await screen.findByLabelText("Nhà cung cấp Gợi ý chấm bài");
    expect(within(selector).getByRole("option", { name: "NIM" })).toBeInTheDocument();
    expect(within(selector).getByRole("option", { name: "Custom" })).toBeInTheDocument();
    expect(within(selector).queryByRole("option", { name: "Disabled" })).not.toBeInTheDocument();
    expect(screen.getByText(/DOCX được đọc cục bộ/)).toBeInTheDocument();
    expect(screen.getByText(/Giảng viên phải kiểm tra bản trích xuất và gợi ý trước khi lưu điểm/)).toBeInTheDocument();
    fireEvent.change(selector, { target: { value: "nim" } });
    fireEvent.change(screen.getByLabelText("Model Gợi ý chấm bài"), { target: { value: "llama" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu gợi ý chấm bài" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/system/ai-tasks", expect.objectContaining({ method: "POST", body: JSON.stringify({ task: "GRADING_ASSIST", providerId: "nim", model: "llama" }) })));
    expect(screen.queryByLabelText("Gemini hỗ trợ ngữ cảnh")).not.toBeInTheDocument();
  });

  it("restores Custom grading settings, preserves input after errors and clears model on provider change", async () => {
    apiRequest.mockResolvedValueOnce({ GRADING_ASSIST: { providerId: "custom", model: "grading-custom" } });
    render(<AiTaskSettings providers={providers} catalog={{}} />);
    expect(await screen.findByLabelText("Model Gợi ý chấm bài")).toHaveValue("grading-custom");
    apiRequest.mockRejectedValueOnce(new Error("Model unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Lưu gợi ý chấm bài" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Model unavailable", "error"));
    expect(screen.getByLabelText("Model Gợi ý chấm bài")).toHaveValue("grading-custom");
    fireEvent.change(screen.getByLabelText("Nhà cung cấp Gợi ý chấm bài"), { target: { value: "gemini" } });
    expect(screen.getByLabelText("Model Gợi ý chấm bài")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Lưu gợi ý chấm bài" })).toBeDisabled();
  });

  it("allows NIM and Custom for document Q&A but keeps Gemini-only extraction", async () => {
    render(<AiTaskSettings providers={providers} catalog={{ NVIDIA_NIM: [{ value: "llama", label: "Llama", description: "" }] }} />);
    const qa = await screen.findByLabelText("Nhà cung cấp Hỏi đáp tài liệu");
    expect(within(qa).getByRole("option", { name: "NIM" })).toBeInTheDocument();
    expect(within(qa).getByRole("option", { name: "Custom" })).toBeInTheDocument();
    expect(within(qa).queryByRole("option", { name: "Disabled" })).not.toBeInTheDocument();
    const extraction = screen.getByLabelText("Nhà cung cấp Trích xuất tài liệu");
    expect(within(extraction).queryByRole("option", { name: "NIM" })).not.toBeInTheDocument();
    fireEvent.change(qa, { target: { value: "nim" } });
    fireEvent.change(screen.getByLabelText("Model Hỏi đáp tài liệu"), { target: { value: "llama" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu hỏi đáp tài liệu" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/system/ai-tasks", expect.objectContaining({ method: "POST", body: JSON.stringify({ task: "DOCUMENT_QA", providerId: "nim", model: "llama" }) })));
  });

  it("restores a Custom Q&A model without requiring a second context provider", async () => {
    apiRequest.mockResolvedValueOnce({ DOCUMENT_QA: { providerId: "custom", model: "my-model" } });
    render(<AiTaskSettings providers={providers} catalog={{}} />);
    expect(await screen.findByLabelText("Model Hỏi đáp tài liệu")).toHaveValue("my-model");
    expect(screen.queryByLabelText("Gemini hỗ trợ ngữ cảnh")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu hỏi đáp tài liệu" })).toBeEnabled();
  });
});
