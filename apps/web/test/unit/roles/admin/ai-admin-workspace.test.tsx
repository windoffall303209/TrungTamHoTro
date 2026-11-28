import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveAiModelVisual,
  resolveAiProviderVisual,
} from "../../../../src/features/settings/ai-model-icons";
import SettingsScreen from "../../../../src/features/settings/settings-screen";
import type {
  AiProvider,
  ModelCatalog,
  Settings,
} from "../../../../src/features/settings/settings.shared";
import { AiAdminWorkspace } from "../../../../src/roles/admin/ai-admin-workspace";

const apiRequest = vi.fn();
const notify = vi.fn();
const push = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

vi.mock("@/providers/app-provider", () => ({
  useApp: () => ({
    session: {
      roleCode: "SYSTEM_ADMIN",
      permissions: ["system:configure"],
      user: { id: "admin-1" },
    },
    notify,
  }),
}));

const sampleSettings: Settings = {
  centerName: "Wind EDU",
  timezone: "Asia/Bangkok",
  locale: "vi-VN",
  maxFileSizeMb: 25,
  storageQuotaMb: 5000,
  allowedMimeTypes: ["application/pdf"],
  notificationSender: "Wind EDU",
  maintenanceMode: false,
  learnerEmailNotificationsEnabled: false,
  aiTutorMaxPerQuestion: 3,
  aiTutorMaxPerExam: 15,
  version: 2,
  updatedBy: "admin",
  updatedAt: "2026-11-28T10:00:00.000Z",
};

const sampleProviders: AiProvider[] = [
  {
    id: "prov-gemini",
    provider: "GEMINI",
    name: "Google Gemini",
    model: "gemini-2.5-flash",
    enabled: true,
    isDefault: true,
    healthStatus: "HEALTHY",
    hasApiKey: true,
    maskedApiKey: "••••••••9012",
    apiKeyCount: 2,
    apiKeySlots: [
      { id: "k1", label: "Key chính", maskedKey: "••••••••9012" },
      { id: "k2", label: "Key phụ", maskedKey: "••••••••5678" },
    ],
    lastCheckedAt: "2026-11-28T12:00:00.000Z",
    updatedAt: "2026-11-28T12:00:00.000Z",
  },
  {
    id: "prov-nim",
    provider: "NVIDIA_NIM",
    name: "NVIDIA NIM",
    model: "meta/llama-3.2-11b-vision-instruct",
    enabled: true,
    isDefault: false,
    healthStatus: "UNKNOWN",
    hasApiKey: true,
    maskedApiKey: "••••••••3456",
    apiKeyCount: 1,
    apiKeySlots: [{ id: "k-nim", label: "Key 1", maskedKey: "••••••••3456" }],
    updatedAt: "2026-11-28T12:00:00.000Z",
  },
  {
    id: "prov-custom",
    provider: "CUSTOM",
    name: "Cổng vLLM nội bộ",
    model: "deepseek/deepseek-r1",
    baseUrl: "https://ai.internal.edu/v1/chat/completions",
    enabled: false,
    isDefault: false,
    healthStatus: "UNKNOWN",
    hasApiKey: true,
    maskedApiKey: "••••••••7890",
    apiKeyCount: 1,
    apiKeySlots: [{ id: "k-cus", label: "Key 1", maskedKey: "••••••••7890" }],
    updatedAt: "2026-11-28T12:00:00.000Z",
  },
];

const sampleCatalog: ModelCatalog = {
  GEMINI: [
    {
      value: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      description: "Nhanh, hỗ trợ ảnh đề.",
    },
    {
      value: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      description: "Suy luận sâu.",
    },
  ],
  NVIDIA_NIM: [
    {
      value: "meta/llama-3.2-11b-vision-instruct",
      label: "Llama 3.2 11B Vision",
      description: "Đọc ảnh đề.",
    },
  ],
  OPENAI: [
    {
      value: "gpt-4o-mini",
      label: "GPT-4o mini",
      description: "Nhanh và tiết kiệm.",
    },
  ],
};

describe("AI model & provider visual recognition", () => {
  it("nhận diện chính xác biểu tượng nhà phát hành chính thức và từng dòng model", () => {
    expect(resolveAiProviderVisual("GEMINI").shortLabel).toBe("Google Gemini");
    expect(resolveAiProviderVisual("NVIDIA_NIM").shortLabel).toBe("NVIDIA");
    expect(resolveAiProviderVisual("OPENAI").shortLabel).toBe("OpenAI");
    expect(resolveAiProviderVisual("CUSTOM").shortLabel).toBe("Custom");

    expect(resolveAiModelVisual("gemini-2.5-pro", "GEMINI").kind).toBe("gemini-pro");
    expect(resolveAiModelVisual("gemini-3.5-flash-lite", "GEMINI").kind).toBe("gemini-lite");
    expect(resolveAiModelVisual("gemini-2.5-flash", "GEMINI").kind).toBe("gemini-flash");
    expect(resolveAiModelVisual("meta/llama-3.2-90b-vision-instruct", "NVIDIA_NIM").kind).toBe("meta-llama");
    expect(resolveAiModelVisual("nvidia/nemotron-nano-12b-v2-vl", "NVIDIA_NIM").kind).toBe("nvidia-nemotron");
    expect(resolveAiModelVisual("gpt-5.4-mini", "OPENAI").kind).toBe("openai-fast");
    expect(resolveAiModelVisual("gpt-4o", "OPENAI").kind).toBe("openai-omni");
    expect(resolveAiModelVisual("gpt-6-astra", "OPENAI").kind).toBe("openai-flagship");
    expect(resolveAiModelVisual("deepseek/deepseek-r1", "CUSTOM").kind).toBe("deepseek");
    expect(resolveAiModelVisual("claude-3-7-sonnet", "CUSTOM").kind).toBe("claude");
  });
});

describe("AiAdminWorkspace 4-icon launcher & multi-API-key detail view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    apiRequest.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("chỉ hiển thị 4 biểu tượng nhà cung cấp ban đầu, bấm vào mới bung trang chi tiết và cho phép điền nhiều API key", async () => {
    const testAiProvider = vi.fn().mockResolvedValue(undefined);
    const removeAiProvider = vi.fn().mockResolvedValue(undefined);
    const saveAiTutorQuota = vi.fn().mockResolvedValue(undefined);
    const setSettings = vi.fn();
    const reload = vi.fn().mockResolvedValue(undefined);

    render(
      <AiAdminWorkspace
        settings={sampleSettings}
        setSettings={setSettings}
        aiProviders={sampleProviders}
        modelCatalog={sampleCatalog}
        saving={false}
        saveAiTutorQuota={saveAiTutorQuota}
        testAiProvider={testAiProvider}
        removeAiProvider={removeAiProvider}
        reload={reload}
      />,
    );

    // Ban đầu chỉ hiển thị 4 ô biểu tượng: Google Gemini, NVIDIA, OpenAI và Custom (chưa hiện form chi tiết)
    expect(screen.getByRole("button", { name: "Google Gemini" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "NVIDIA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OpenAI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
    expect(screen.queryByText(/Danh sách API key/)).not.toBeInTheDocument();

    // Bấm vào biểu tượng Google Gemini -> hiển thị chi tiết của Gemini kèm 2 API key đã lưu
    fireEvent.click(screen.getByRole("button", { name: "Google Gemini" }));
    expect(screen.getByText("Danh sách API key (2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Nhãn API key 1")).toHaveValue("Key chính");
    expect(screen.getByLabelText("Nhãn API key 2")).toHaveValue("Key phụ");

    // Bấm "+ Thêm API key" để điền thêm API key thứ 3 và đổi sang model Gemini 2.5 Pro
    fireEvent.click(screen.getByRole("button", { name: /Thêm API key/ }));
    expect(screen.getByText("Danh sách API key (3)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Nhãn API key 3"), {
      target: { value: "Key dự phòng 2" },
    });
    fireEvent.change(screen.getByLabelText("Giá trị API key 3"), {
      target: { value: "AIzaSyNewBackupKey9999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gemini 2.5 Pro" }));

    apiRequest.mockResolvedValueOnce({
      ...sampleProviders[0]!,
      model: "gemini-2.5-pro",
      apiKeyCount: 3,
      apiKeySlots: [
        { id: "k1", label: "Key chính", maskedKey: "••••••••9012" },
        { id: "k2", label: "Key phụ", maskedKey: "••••••••5678" },
        { id: "k3", label: "Key dự phòng 2", maskedKey: "••••••••9999" },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Lưu cấu hình" }));
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/system/ai-providers",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            id: "prov-gemini",
            provider: "GEMINI",
            model: "gemini-2.5-pro",
            enabled: true,
            isDefault: true,
            apiKeys: [
              { id: "k1", label: "Key chính" },
              { id: "k2", label: "Key phụ" },
              { label: "Key dự phòng 2", apiKey: "AIzaSyNewBackupKey9999" },
            ],
          }),
        }),
      ),
    );
    expect(reload).toHaveBeenCalledOnce();

    // Quay lại màn hình 4 biểu tượng rồi bấm vào Custom ở dưới
    fireEvent.click(screen.getByRole("button", { name: "Quay lại danh sách nhà cung cấp" }));
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Xóa Cổng vLLM nội bộ" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa Cổng vLLM nội bộ" }));
    expect(removeAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prov-custom" }),
    );
  });

  it("chỉ hiển thị nút mũi tên quay lại cạnh tên chức năng và ẩn toàn bộ dòng mô tả trên trang Cấu hình", () => {
    currentSearchParams = new URLSearchParams();
    const { unmount } = render(<SettingsScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Cấu hình hệ thống" })).toBeInTheDocument();
    expect(screen.getByText("AI và quét đề")).toBeInTheDocument();
    expect(
      screen.queryByText("Quản lý API key, model và nhà cung cấp dùng để đọc ảnh đề thi."),
    ).not.toBeInTheDocument();
    unmount();

    currentSearchParams = new URLSearchParams("section=ai-providers");
    render(<SettingsScreen />);
    const backBtn = screen.getByRole("button", { name: "Quay lại Cấu hình" });
    expect(backBtn).toHaveTextContent("");
    expect(screen.getByRole("heading", { level: 1, name: "AI và quét đề" })).toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(push).toHaveBeenCalledWith("/admin/settings");
  });
});
