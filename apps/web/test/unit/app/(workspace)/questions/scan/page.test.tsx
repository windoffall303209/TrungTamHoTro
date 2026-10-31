import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScanQuestionsPage from "../../../../../../src/app/(workspace)/questions/scan/page";

const { apiMock, notifyMock } = vi.hoisted(() => ({ apiMock: vi.fn(), notifyMock: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: apiMock }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "INSTRUCTOR", permissions: ["question:manage"] }, notify: notifyMock }),
}));

beforeEach(() => {
  vi.stubGlobal("URL", class extends URL {
    static override createObjectURL = vi.fn(() => "blob:test-image");
    static override revokeObjectURL = vi.fn();
  });
  notifyMock.mockReset();
  apiMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScanQuestionsPage", () => {
  it("ignores an initialization error after leaving the page", async () => {
    let rejectProviders!: (reason: Error) => void;
    apiMock.mockImplementation((path: string) => {
      if (path === "/manager/courses") return Promise.resolve([]);
      if (path === "/instructor/question-bank/ai-providers") {
        return new Promise((_resolve, reject) => { rejectProviders = reject; });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const page = render(<ScanQuestionsPage />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/instructor/question-bank/ai-providers", expect.anything()));
    page.unmount();
    await act(async () => rejectProviders(new Error("Obsolete provider request")));
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("ignores a delayed scan result after a different image is selected", async () => {
    let resolveScan!: (value: unknown) => void;
    apiMock.mockImplementation((path: string) => {
      if (path === "/manager/courses") return Promise.resolve([]);
      if (path === "/instructor/question-bank/ai-providers") {
        return Promise.resolve([{ id: "ai-1", provider: "openai", name: "AI", model: "test", isDefault: true, healthStatus: "OK" }]);
      }
      if (path === "/instructor/question-bank/scan-image") {
        return new Promise((resolve) => { resolveScan = resolve; });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { container } = render(<ScanQuestionsPage />);
    const upload = container.querySelector('input[type="file"]')!;
    fireEvent.change(upload, { target: { files: [new File(["first"], "first.png", { type: "image/png" })] } });
    await waitFor(() => expect(screen.getByRole("button", { name: /Quét và nhận diện/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Quét và nhận diện/ }));
    expect(apiMock).toHaveBeenCalledWith("/instructor/question-bank/scan-image", expect.anything());

    fireEvent.change(upload, { target: { files: [new File(["second"], "second.png", { type: "image/png" })] } });
    await act(async () => {
      resolveScan({ model: "test", questions: [{ content: "Stale question", options: [], correctAnswers: [], warnings: [], confidence: 1, difficulty: 1, type: "ESSAY" }] });
    });
    expect(screen.getByText("Chưa có dữ liệu quét.")).toBeInTheDocument();
    expect(screen.queryByText("Stale question")).not.toBeInTheDocument();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("rejects invalid image formats and files larger than 12 MB", () => {
    apiMock.mockImplementation((path: string) => path === "/manager/courses" ? Promise.resolve([]) : Promise.resolve([]));
    const { container } = render(<ScanQuestionsPage />);
    const upload = container.querySelector('input[type="file"]')!;
    fireEvent.change(upload, { target: { files: [new File(["text"], "wrong.txt", { type: "text/plain" })] } });
    const oversized = new File(["image"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 12 * 1024 * 1024 + 1 });
    fireEvent.change(upload, { target: { files: [oversized] } });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Chọn ảnh đề thi")).toBeInTheDocument();
  });
});
