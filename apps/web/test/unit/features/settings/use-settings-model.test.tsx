import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, ModelOption, Settings } from "../../../../src/features/settings/settings.shared";
import { useSettingsModel } from "../../../../src/features/settings/use-settings-model";

const mocks = vi.hoisted(() => ({ request: vi.fn(), notify: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/access-control", () => ({ hasPermission: () => true }));
vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({ session: { roleCode: "SYSTEM_ADMIN" }, notify: mocks.notify }),
}));

// Tạo cấu hình đầy đủ để xác nhận thứ tự phản hồi không thay đổi bản được hiển thị.
function makeSettings(centerName: string): Settings {
  return {
    centerName, timezone: "Asia/Bangkok", locale: "vi", retentionDays: 30,
    maxFileSizeMb: 10, storageQuotaMb: 100, allowedMimeTypes: [],
    moderationEnabled: true, examApprovalMode: "MANUAL", questionApprovalMode: "MANUAL",
    notificationSender: "support@example.com", maintenanceMode: false,
    learnerEmailNotificationsEnabled: false, version: 1,
    effectiveAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z", updatedBy: "admin",
  };
}

// Giữ yêu cầu GET đầu tiên để kiểm tra các phản hồi API đến sai thứ tự.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

// Tạo cấu hình nhà cung cấp đầy đủ để mô phỏng việc đổi AI editor.
function makeProvider(id: string): AiProvider {
  return {
    id, provider: "GEMINI", name: id, model: "gemini-model", enabled: true,
    isDefault: false, healthStatus: "UNKNOWN", hasApiKey: true,
    maskedApiKey: "***", updatedAt: "2026-10-31T00:00:00Z",
  };
}

describe("useSettingsModel request lifecycle", () => {
  let initial: ReturnType<typeof deferred<Settings>>;
  let settingsReads: number;
  const modelRequests = new Map<string, ReturnType<typeof deferred<ModelOption[]>>>();

  beforeEach(() => {
    initial = deferred<Settings>();
    settingsReads = 0;
    modelRequests.clear();
    mocks.request.mockReset();
    mocks.notify.mockReset();
    mocks.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/system/settings" && !options?.method) {
        settingsReads += 1;
        return settingsReads === 1 ? initial.promise : Promise.resolve(makeSettings("New center"));
      }
      if (path === "/system/backups" && options?.method === "POST") return Promise.resolve({});
      if (path.endsWith("/models")) {
        const pending = deferred<ModelOption[]>();
        modelRequests.set(path, pending);
        return pending.promise;
      }
      if (path === "/system/ai-providers/catalog") {
        return Promise.resolve({ GEMINI: [], NVIDIA_NIM: [], OPENAI: [] });
      }
      if (["/system/integrations", "/system/backups", "/system/settings/history", "/system/ai-providers"].includes(path)) {
        return Promise.resolve([]);
      }
      if (["/system/health-overview", "/system/storage-overview"].includes(path)) return Promise.resolve({});
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => cleanup());

  it("giữ cấu hình mới hơn khi GET đầu tiên trả về sau lần tải lại", async () => {
    const { result } = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    await act(async () => result.current.backup());
    await waitFor(() => expect(result.current.settings?.centerName).toBe("New center"));

    await act(async () => initial.resolve(makeSettings("Old center")));
    expect(result.current.settings?.centerName).toBe("New center");
  });

  it("không thông báo lỗi của lượt tải cấu hình đã lỗi thời", async () => {
    const { result } = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    await act(async () => result.current.backup());
    await act(async () => initial.reject(new Error("Obsolete settings error")));
    expect(mocks.notify).not.toHaveBeenCalledWith("Obsolete settings error", "error");
  });

  it("không thông báo lỗi nếu GET bị từ chối sau khi unmount", async () => {
    const hook = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    hook.unmount();
    await act(async () => initial.reject(new Error("Unmounted settings error")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không để model của provider cũ ghi đè editor mới", async () => {
    const { result } = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    act(() => result.current.openAiEditor(makeProvider("first")));
    act(() => { void result.current.loadProviderModels(); });
    await waitFor(() => expect(modelRequests.has("/system/ai-providers/first/models")).toBe(true));

    act(() => result.current.openAiEditor(makeProvider("second")));
    act(() => { void result.current.loadProviderModels(); });
    await waitFor(() => expect(modelRequests.has("/system/ai-providers/second/models")).toBe(true));

    const latest = [{ value: "latest-model", label: "Latest", description: "" }];
    await act(async () => modelRequests.get("/system/ai-providers/second/models")!.resolve(latest));
    expect(result.current.discoveredModels).toEqual(latest);
    await act(async () => modelRequests.get("/system/ai-providers/first/models")!.resolve([
      { value: "old-model", label: "Old", description: "" },
    ]));
    expect(result.current.discoveredModels).toEqual(latest);
    expect(result.current.loadingModels).toBe(false);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it("không thông báo lỗi từ yêu cầu model khi editor đã đóng", async () => {
    const { result } = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    act(() => result.current.openAiEditor(makeProvider("first")));
    act(() => { void result.current.loadProviderModels(); });
    await waitFor(() => expect(modelRequests.has("/system/ai-providers/first/models")).toBe(true));
    act(() => result.current.setAiEditorOpen(false));
    await act(async () => modelRequests.get("/system/ai-providers/first/models")!.reject(new Error("Closed editor")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("không thông báo lỗi từ yêu cầu model sau khi unmount", async () => {
    const hook = renderHook(() => useSettingsModel());
    await waitFor(() => expect(settingsReads).toBe(1));
    act(() => hook.result.current.openAiEditor(makeProvider("first")));
    act(() => { void hook.result.current.loadProviderModels(); });
    await waitFor(() => expect(modelRequests.has("/system/ai-providers/first/models")).toBe(true));
    hook.unmount();
    await act(async () => modelRequests.get("/system/ai-providers/first/models")!.reject(new Error("Unmounted editor")));
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
