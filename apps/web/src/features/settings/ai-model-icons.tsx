"use client";

import type { AiProviderType } from "./settings.shared";

export type AiModelGlyphKind =
  | "gemini-flash"
  | "gemini-pro"
  | "gemini-lite"
  | "openai-flagship"
  | "openai-fast"
  | "openai-omni"
  | "meta-llama"
  | "nvidia-nemotron"
  | "nvidia-cosmos"
  | "inkling"
  | "deepseek"
  | "qwen"
  | "claude"
  | "mistral"
  | "custom-node";

export interface AiProviderVisualMeta {
  provider: AiProviderType;
  shortLabel: string;
  vendorLabel: string;
  protocolLabel: string;
  containerClass: string;
}

export interface AiModelVisualMeta {
  kind: AiModelGlyphKind;
  familyLabel: string;
  tierBadge: string;
  capabilityLabel: string;
  containerClass: string;
  badgeClass: string;
}

/** Trả về thông tin nhận diện trực quan chuẩn hóa cho từng loại nhà cung cấp AI. */
export function resolveAiProviderVisual(provider: AiProviderType | string): AiProviderVisualMeta {
  switch (provider) {
    case "GEMINI":
      return {
        provider: "GEMINI",
        shortLabel: "Gemini",
        vendorLabel: "Google DeepMind",
        protocolLabel: "Generative Language API · Đa phương thức & OCR gốc",
        containerClass:
          "bg-sky-50 text-sky-600 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-400 dark:border-sky-800/70",
      };
    case "NVIDIA_NIM":
      return {
        provider: "NVIDIA_NIM",
        shortLabel: "NVIDIA NIM",
        vendorLabel: "NVIDIA Inference Microservices",
        protocolLabel: "Vision-Language & Document Intelligence",
        containerClass:
          "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/70",
      };
    case "OPENAI":
      return {
        provider: "OPENAI",
        shortLabel: "OpenAI",
        vendorLabel: "OpenAI Platform",
        protocolLabel: "Chat Completions · Suy luận & Cấu trúc JSON",
        containerClass:
          "bg-slate-100 text-slate-900 border-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700",
      };
    default:
      return {
        provider: "CUSTOM",
        shortLabel: "Custom API",
        vendorLabel: "OpenAI-Compatible Endpoint",
        protocolLabel: "Cổng kết nối tùy chỉnh (/v1/chat/completions)",
        containerClass:
          "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800/70",
      };
  }
}

/** Phân tích mã định danh model để gán đúng biểu tượng dòng mô hình, cấp độ và nhãn năng lực. */
export function resolveAiModelVisual(
  modelId: string,
  provider?: AiProviderType | string,
): AiModelVisualMeta {
  const normalized = modelId.trim().toLowerCase();

  if (normalized.includes("gemini") || provider === "GEMINI") {
    if (normalized.includes("pro")) {
      return {
        kind: "gemini-pro",
        familyLabel: "Gemini Pro",
        tierBadge: "Pro · Suy luận",
        capabilityLabel: "Phân tích đề phức tạp & đa phương thức",
        containerClass:
          "bg-sky-100/80 text-sky-700 border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-800/70",
        badgeClass:
          "bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300",
      };
    }
    if (normalized.includes("lite")) {
      return {
        kind: "gemini-lite",
        familyLabel: "Gemini Flash-Lite",
        tierBadge: "Lite · Tiết kiệm",
        capabilityLabel: "Độ trễ thấp, tối ưu khối lượng lớn",
        containerClass:
          "bg-teal-50 text-teal-700 border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70",
        badgeClass:
          "bg-teal-50 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300",
      };
    }
    return {
      kind: "gemini-flash",
      familyLabel: "Gemini Flash",
      tierBadge: "Flash · Đa năng",
      capabilityLabel: "Quét ảnh đề OCR & phản hồi tức thời",
      containerClass:
        "bg-sky-50 text-sky-600 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-400 dark:border-sky-800/70",
      badgeClass:
        "bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300",
    };
  }

  if (normalized.includes("llama")) {
    const isVision = normalized.includes("vision") || normalized.includes("vl");
    return {
      kind: "meta-llama",
      familyLabel: "Meta Llama",
      tierBadge: isVision ? "Vision · OCR" : "Llama Instruct",
      capabilityLabel: isVision ? "Đọc ảnh đề & suy luận thị giác" : "Mô hình ngôn ngữ mở hiệu năng cao",
      containerClass:
        "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70",
      badgeClass:
        "bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300",
    };
  }

  if (normalized.includes("nemotron")) {
    return {
      kind: "nvidia-nemotron",
      familyLabel: "NVIDIA Nemotron",
      tierBadge: "VL · Tài liệu",
      capabilityLabel: "Nhận diện cấu trúc trang & OCR chuyên sâu",
      containerClass:
        "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/70",
      badgeClass:
        "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
    };
  }

  if (normalized.includes("cosmos")) {
    return {
      kind: "nvidia-cosmos",
      familyLabel: "NVIDIA Cosmos",
      tierBadge: "Reason · Thị giác",
      capabilityLabel: "Suy luận có cấu trúc trên ảnh & phương tiện",
      containerClass:
        "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/70",
      badgeClass:
        "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
    };
  }

  if (normalized.includes("inkling") || normalized.includes("thinkingmachines")) {
    return {
      kind: "inkling",
      familyLabel: "ThinkingMachines",
      tierBadge: "Reasoning",
      capabilityLabel: "Đa phương thức có kiểm soát suy luận",
      containerClass:
        "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
      badgeClass:
        "bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
    };
  }

  if (normalized.includes("deepseek")) {
    return {
      kind: "deepseek",
      familyLabel: "DeepSeek",
      tierBadge: normalized.includes("r1") ? "R1 · Suy luận" : "DeepSeek",
      capabilityLabel: "Suy luận toán học & giải thích từng bước",
      containerClass:
        "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70",
      badgeClass:
        "bg-sky-50 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300",
    };
  }

  if (normalized.includes("qwen")) {
    return {
      kind: "qwen",
      familyLabel: "Qwen",
      tierBadge: normalized.includes("vl") ? "Qwen VL" : "Qwen",
      capabilityLabel: "Đa ngôn ngữ Việt–Anh & trích xuất cấu trúc",
      containerClass:
        "bg-teal-50 text-teal-700 border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70",
      badgeClass:
        "bg-teal-50 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300",
    };
  }

  if (normalized.includes("claude")) {
    return {
      kind: "claude",
      familyLabel: "Anthropic Claude",
      tierBadge: normalized.includes("opus") ? "Opus" : normalized.includes("haiku") ? "Haiku" : "Sonnet",
      capabilityLabel: "Phân tích văn bản tự luận & phản hồi sư phạm",
      containerClass:
        "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
      badgeClass:
        "bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
    };
  }

  if (normalized.includes("mistral") || normalized.includes("pixtral")) {
    return {
      kind: "mistral",
      familyLabel: "Mistral AI",
      tierBadge: normalized.includes("pixtral") ? "Pixtral VL" : "Mistral",
      capabilityLabel: "Tốc độ phản hồi nhanh & tuân thủ định dạng",
      containerClass:
        "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70",
      badgeClass:
        "bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
    };
  }

  if (
    normalized.startsWith("gpt-") ||
    /^o[134]\b/.test(normalized) ||
    provider === "OPENAI"
  ) {
    if (
      normalized.includes("mini") ||
      normalized.includes("nano") ||
      normalized.includes("luna")
    ) {
      return {
        kind: "openai-fast",
        familyLabel: "OpenAI Fast",
        tierBadge: normalized.includes("nano") ? "Nano · Tức thời" : "Mini · Tối ưu",
        capabilityLabel: "Phản hồi nhanh, chi phí thấp, hỗ trợ JSON chuẩn",
        containerClass:
          "bg-teal-50 text-teal-700 border-teal-200/80 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70",
        badgeClass:
          "bg-teal-50 text-teal-800 dark:bg-teal-950/70 dark:text-teal-300",
      };
    }
    if (normalized.includes("4o") || normalized.includes("4.1")) {
      return {
        kind: "openai-omni",
        familyLabel: "OpenAI Omni",
        tierBadge: "Omni · Đa phương thức",
        capabilityLabel: "Nhận diện ảnh đề & sinh cấu trúc câu hỏi ổn định",
        containerClass:
          "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/70",
        badgeClass:
          "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
      };
    }
    return {
      kind: "openai-flagship",
      familyLabel: "OpenAI Flagship",
      tierBadge: "Flagship · Suy luận",
      capabilityLabel: "Suy luận chuyên sâu cho đề nhiều tầng kiến thức",
      containerClass:
        "bg-slate-100 text-slate-900 border-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700",
      badgeClass:
        "bg-slate-200/80 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    };
  }

  if (provider === "NVIDIA_NIM") {
    return {
      kind: "nvidia-nemotron",
      familyLabel: "NVIDIA NIM",
      tierBadge: "NIM · Inference",
      capabilityLabel: "Mô hình chạy trên hạ tầng tăng tốc NVIDIA",
      containerClass:
        "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/70",
      badgeClass:
        "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
    };
  }

  return {
    kind: "custom-node",
    familyLabel: "Custom Model",
    tierBadge: "Tùy chỉnh",
    capabilityLabel: "Mô hình kết nối qua cổng OpenAI-compatible",
    containerClass:
      "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800/70",
    badgeClass:
      "bg-amber-50 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
  };
}

/** Vẽ biểu tượng vector sắc nét đại diện cho từng nhà cung cấp AI (Gemini, NVIDIA NIM, OpenAI, Custom). */
export function AiProviderGlyph({
  provider,
  size = "md",
  className = "",
}: {
  provider: AiProviderType | string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const meta = resolveAiProviderVisual(provider);
  const boxClass =
    size === "xs"
      ? "size-5 rounded-md"
      : size === "sm"
        ? "size-7 rounded-lg"
        : size === "lg"
          ? "size-11 rounded-xl"
          : "size-9 rounded-xl";
  const svgSize = size === "xs" ? 12 : size === "sm" ? 15 : size === "lg" ? 22 : 18;

  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center border ${boxClass} ${meta.containerClass} ${className}`}
    >
      {meta.provider === "GEMINI" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.5C12.5 7.6 16.4 11.5 21.5 12C16.4 12.5 12.5 16.4 12 21.5C11.5 16.4 7.6 12.5 2.5 12C7.6 11.5 11.5 7.6 12 2.5Z"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      ) : meta.provider === "NVIDIA_NIM" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M3.5 12C5.8 7.6 9.2 5.5 13 5.5C16.8 5.5 19.6 7.6 21 12C19.6 16.4 16.8 18.5 13 18.5C9.2 18.5 5.8 16.4 3.5 12Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M8.5 12L12.5 8.5L16.5 12L12.5 15.5L8.5 12Z"
            fill="currentColor"
            fillOpacity="0.22"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ) : meta.provider === "OPENAI" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <polygon
            points="12,3 19.8,7.5 19.8,16.5 12,21 4.2,16.5 4.2,7.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <polygon
            points="12,7.2 16.2,9.6 16.2,14.4 12,16.8 7.8,14.4 7.8,9.6"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="4"
            width="6.5"
            height="6.5"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <rect
            x="13.5"
            y="13.5"
            width="6.5"
            height="6.5"
            rx="1.5"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M10.5 7.25H15C16.1 7.25 17 8.15 17 9.25V13.5M7.25 10.5V14.75C7.25 15.85 8.15 16.75 9.25 16.75H13.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

/** Vẽ biểu tượng vector chuyên biệt cho từng họ và phân khúc model AI để nhận diện ngay trong danh sách. */
export function AiModelGlyph({
  model,
  provider,
  size = "sm",
  className = "",
}: {
  model: string;
  provider?: AiProviderType | string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const meta = resolveAiModelVisual(model, provider);
  const boxClass =
    size === "xs"
      ? "size-5 rounded-md"
      : size === "md"
        ? "size-9 rounded-xl"
        : "size-7 rounded-lg";
  const svgSize = size === "xs" ? 12 : size === "md" ? 18 : 15;

  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center border ${boxClass} ${meta.containerClass} ${className}`}
    >
      {meta.kind === "gemini-pro" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2.5C12.6 7.4 16.6 11.4 21.5 12C16.6 12.6 12.6 16.6 12 21.5C11.4 16.6 7.4 12.6 2.5 12C7.4 11.4 11.4 7.4 12 2.5Z"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M12 8L15.2 12L12 16L8.8 12L12 8Z"
            fill="currentColor"
          />
        </svg>
      ) : meta.kind === "gemini-lite" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M13 3L6.5 13H12L11 21L17.5 11H12L13 3Z"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      ) : meta.kind === "gemini-flash" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M10.5 3C11 7.2 14.3 10.5 18.5 11C14.3 11.5 11 14.8 10.5 19C10 14.8 6.7 11.5 2.5 11C6.7 10.5 10 7.2 10.5 3Z"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M18.5 14.5L16.5 18H19.5L17.5 21.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : meta.kind === "meta-llama" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M7.5 8.5C4.8 8.5 3 10.3 3 12.8C3 15.2 4.7 16.8 6.9 16.8C9.3 16.8 10.8 14.5 12 12.2C13.2 9.9 14.7 8.5 16.8 8.5C19.3 8.5 21 10.3 21 12.8C21 15.2 19.3 16.8 17.1 16.8C14.7 16.8 13.2 14.5 12 12.2C10.8 9.9 9.5 8.5 7.5 8.5Z"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : meta.kind === "nvidia-nemotron" || meta.kind === "nvidia-cosmos" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <rect
            x="5"
            y="5"
            width="14"
            height="14"
            rx="3"
            fill="currentColor"
            fillOpacity="0.15"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M9 2.5V5M15 2.5V5M9 19V21.5M15 19V21.5M2.5 9H5M2.5 15H5M19 9H21.5M19 15H21.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      ) : meta.kind === "openai-fast" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <polygon
            points="12,2.8 19.8,7.3 19.8,16.7 12,21.2 4.2,16.7 4.2,7.3"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M13 7.5L9.5 12.5H12.5L11 16.5L14.8 11.5H11.8L13 7.5Z"
            fill="currentColor"
          />
        </svg>
      ) : meta.kind === "openai-omni" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="8.5"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <circle
            cx="12"
            cy="12"
            r="4"
            fill="currentColor"
            fillOpacity="0.22"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" />
        </svg>
      ) : meta.kind === "openai-flagship" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <polygon
            points="12,2.8 19.8,7.3 19.8,16.7 12,21.2 4.2,16.7 4.2,7.3"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M12 7V17M7.7 9.5L16.3 14.5M16.3 9.5L7.7 14.5"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
          />
        </svg>
      ) : meta.kind === "claude" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3.5V20.5M3.5 12H20.5M6 6L18 18M18 6L6 18"
            stroke="currentColor"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="2.6" fill="currentColor" />
        </svg>
      ) : meta.kind === "deepseek" || meta.kind === "qwen" || meta.kind === "mistral" || meta.kind === "inkling" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3.5L19.5 12L12 20.5L4.5 12L12 3.5Z"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="2.2" fill="currentColor" />
        </svg>
      ) : (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <circle cx="6.5" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.75" />
          <circle cx="17.5" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.75" />
          <circle
            cx="12"
            cy="17"
            r="2.8"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.75"
          />
          <path
            d="M8.5 8.5L10.8 14.5M15.5 8.5L13.2 14.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

/** Huy hiệu hiển thị trực quan icon model kèm tên model và phân khúc năng lực. */
export function AiModelIdentityBadge({
  model,
  provider,
  showTier = true,
}: {
  model: string;
  provider?: AiProviderType | string;
  showTier?: boolean;
}) {
  if (!model.trim()) return null;
  const meta = resolveAiModelVisual(model, provider);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/70 px-2 py-1 text-xs">
      <AiModelGlyph model={model} provider={provider} size="xs" />
      <span translate="no" className="truncate font-mono font-semibold text-slate-800 dark:text-slate-100">
        {model}
      </span>
      {showTier ? (
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${meta.badgeClass}`}>
          {meta.tierBadge}
        </span>
      ) : null}
    </span>
  );
}
