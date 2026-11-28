import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    maskedApiKey: "AIza••••••••9012",
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
    maskedApiKey: "nvapi•••••••3456",
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
    maskedApiKey: "sk-••••••••7890",
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
  it("nhận diện chính xác biểu tượng dòng model và phân khúc cho từng nhà cung cấp", () => {
    expect(resolveAiProviderVisual("GEMINI").shortLabel).toBe("Gemini");
    expect(resolveAiProviderVisual("NVIDIA_NIM").shortLabel).toBe("NVIDIA NIM");
    expect(resolveAiProviderVisual("OPENAI").shortLabel).toBe("OpenAI");
    expect(resolveAiProviderVisual("CUSTOM").shortLabel).toBe("Custom API");

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

describe("AiAdminWorkspace compact UI without AI operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    apiRequest.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("ẩn hoàn toàn khối Trung tâm điều phối và Đối soát AI, chỉ giữ 3 phân khu gọn nhẹ kèm kệ chọn nhanh model có icon", async () => {
    const openAiEditor = vi.fn();
    const testAiProvider = vi.fn().mockResolvedValue(undefined);
    const removeAiProvider = vi.fn().mockResolvedValue(undefined);
    const saveAiTutorQuota = vi.fn().mockResolvedValue(undefined);
    const setSettings = vi.fn();

    render(
      <AiAdminWorkspace
        settings={sampleSettings}
        setSettings={setSettings}
        aiProviders={sampleProviders}
        modelCatalog={sampleCatalog}
        saving={false}
        saveAiTutorQuota={saveAiTutorQuota}
        openAiEditor={openAiEditor}
        testAiProvider={testAiProvider}
        removeAiProvider={removeAiProvider}
      />,
    );

    expect(screen.queryByText("Trung tâm điều phối AI & Quét đề")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Đối soát/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);

    // Bấm vào một chip model gợi ý (Gemini 2.5 Pro) mở ngay editor với đúng model đó
    fireEvent.click(screen.getByRole("button", { name: /Gemini 2\.5 Pro/ }));
    expect(openAiEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "prov-gemini",
        model: "gemini-2.5-pro",
      }),
    );

    // Xóa provider custom
    fireEvent.click(screen.getByRole("button", { name: "Xóa Cổng vLLM nội bộ" }));
    expect(removeAiProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prov-custom" }),
    );

    // Chuyển sang tab Phân công tác vụ & Quét đề
    fireEvent.click(screen.getByRole("tab", { name: /Phân công tác vụ & Quét đề/ }));
    expect(await screen.findByText("AI theo chức năng")).toBeInTheDocument();

    // Chuyển sang tab Hạn mức hỏi đáp AI và chọn mức thiết lập nhanh "Ôn luyện sâu"
    fireEvent.click(screen.getByRole("tab", { name: "Hạn mức hỏi đáp AI" }));
    fireEvent.click(screen.getByRole("button", { name: /Ôn luyện sâu/ }));
    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiTutorMaxPerQuestion: 5,
        aiTutorMaxPerExam: 30,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Lưu hạn mức hỏi đáp" }));
    expect(saveAiTutorQuota).toHaveBeenCalledOnce();
  });

  it("chỉ hiển thị nút mũi tên quay lại cạnh tên chức năng và ẩn toàn bộ dòng mô tả trên trang Cấu hình", () => {
    currentSearchParams = new URLSearchParams();
    const { unmount } = render(<SettingsScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Cấu hình hệ thống" })).toBeInTheDocument();
    expect(screen.getByText("AI và quét đề")).toBeInTheDocument();
    expect(
      screen.queryByText("Quản lý API key, model và nhà cung cấp dùng để đọc ảnh đề thi."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Cấu hình, kiểm tra và chọn nhà cung cấp phòng học trực tuyến."),
    ).not.toBeInTheDocument();
    unmount();

    currentSearchParams = new URLSearchParams("section=ai-providers");
    render(<SettingsScreen />);
    const backBtn = screen.getByRole("button", { name: "Quay lại Cấu hình" });
    expect(backBtn).toHaveTextContent("");
    expect(screen.getByRole("heading", { level: 1, name: "AI và quét đề" })).toBeInTheDocument();
    expect(
      screen.queryByText("Quản lý API key, model và nhà cung cấp dùng để đọc ảnh đề thi."),
    ).not.toBeInTheDocument();
    fireEvent.click(backBtn);
    expect(push).toHaveBeenCalledWith("/admin/settings");
  });
});
