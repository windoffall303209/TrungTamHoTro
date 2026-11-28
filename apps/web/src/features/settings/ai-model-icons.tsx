"use client";

import { useId } from "react";
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
        shortLabel: "Google Gemini",
        vendorLabel: "Google",
        protocolLabel: "Generative Language API",
        containerClass:
          "bg-white border-slate-200/90 dark:bg-slate-900 dark:border-slate-800",
      };
    case "NVIDIA_NIM":
      return {
        provider: "NVIDIA_NIM",
        shortLabel: "NVIDIA",
        vendorLabel: "NVIDIA NIM",
        protocolLabel: "Inference Microservices",
        containerClass:
          "bg-white border-slate-200/90 dark:bg-slate-900 dark:border-slate-800",
      };
    case "OPENAI":
      return {
        provider: "OPENAI",
        shortLabel: "OpenAI",
        vendorLabel: "OpenAI",
        protocolLabel: "Responses & Chat Completions",
        containerClass:
          "bg-white border-slate-200/90 dark:bg-slate-900 dark:border-slate-800",
      };
    default:
      return {
        provider: "CUSTOM",
        shortLabel: "Custom",
        vendorLabel: "Custom Endpoint",
        protocolLabel: "OpenAI-Compatible Gateway",
        containerClass:
          "bg-white border-slate-200/90 dark:bg-slate-900 dark:border-slate-800",
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

const OPENAI_OFFICIAL_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

const NVIDIA_OFFICIAL_PATH =
  "M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.104-.097v1.325c.292.035.592.062.892.062 3.851 0 6.643-1.961 9.346-4.275.45.362 2.297 1.245 2.677 1.634-2.588 2.164-8.622 3.913-11.96 3.913-.336 0-.654-.018-.955-.053v1.864H24V4.063zm0 10.52v1.281c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237h-.009c-1.528-.186-2.73 1.245-2.73 1.245s.672 2.412 2.739 2.96M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936Z";

/** Vẽ SVG logo nhà phát hành chính thức của Google Gemini, NVIDIA, OpenAI và biểu tượng cổng Custom thiết kế riêng. */
export function AiOfficialProviderLogo({
  provider,
  pixelSize = 64,
}: {
  provider: AiProviderType | string;
  pixelSize?: number;
}) {
  const uid = useId().replace(/:/g, "");

  if (provider === "GEMINI") {
    const gradId = `gemini-official-${uid}`;
    return (
      <svg
        aria-hidden="true"
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 64 64"
        fill="none"
      >
        <defs>
          <linearGradient id={gradId} x1="8" y1="56" x2="56" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1C7EFF" />
            <stop offset="42%" stopColor="#5783F7" />
            <stop offset="74%" stopColor="#A16EE8" />
            <stop offset="100%" stopColor="#E46373" />
          </linearGradient>
        </defs>
        <path
          d="M32 4C33.15 19.65 44.35 30.85 60 32C44.35 33.15 33.15 44.35 32 60C30.85 44.35 19.65 33.15 4 32C19.65 30.85 30.85 19.65 32 4Z"
          fill={`url(#${gradId})`}
        />
      </svg>
    );
  }

  if (provider === "NVIDIA_NIM") {
    return (
      <svg
        aria-hidden="true"
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path d={NVIDIA_OFFICIAL_PATH} fill="#76B900" />
      </svg>
    );
  }

  if (provider === "OPENAI") {
    return (
      <svg
        aria-hidden="true"
        width={pixelSize}
        height={pixelSize}
        viewBox="0 0 24 24"
        fill="none"
        className="text-slate-950 dark:text-white"
      >
        <path d={OPENAI_OFFICIAL_PATH} fill="currentColor" />
      </svg>
    );
  }

  const customGradId = `custom-gateway-${uid}`;
  return (
    <svg
      aria-hidden="true"
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 64 64"
      fill="none"
    >
      <defs>
        <linearGradient id={customGradId} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="15" fill={`url(#${customGradId})`} />
      <polygon
        points="32,16 45.8,24 45.8,40 32,48 18.2,40 18.2,24"
        fill="#38BDF8"
        fillOpacity="0.16"
        stroke="#38BDF8"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="32" r="5.5" fill="#F8FAFC" />
      <path
        d="M32 9.5V16M32 48V54.5M12.5 20.8L18.2 24M45.8 40L51.5 43.2M51.5 20.8L45.8 24M18.2 40L12.5 43.2"
        stroke="#7DD3FC"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="32" cy="9.5" r="2.3" fill="#38BDF8" />
      <circle cx="12.5" cy="43.2" r="2.3" fill="#38BDF8" />
      <circle cx="51.5" cy="43.2" r="2.3" fill="#38BDF8" />
    </svg>
  );
}

/** Khung biểu tượng nhà cung cấp dùng chung ở nhiều kích cỡ từ combobox nhỏ đến tiêu đề trang. */
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
  const svgSize = size === "xs" ? 15 : size === "sm" ? 20 : size === "lg" ? 32 : 24;

  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center border ${boxClass} ${meta.containerClass} ${className}`}
    >
      <AiOfficialProviderLogo provider={meta.provider} pixelSize={svgSize} />
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
          <path d="M12 8L15.2 12L12 16L8.8 12L12 8Z" fill="currentColor" />
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
      ) : meta.kind === "openai-fast" || meta.kind === "openai-omni" || meta.kind === "openai-flagship" ? (
        <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none">
          <path d={OPENAI_OFFICIAL_PATH} fill="currentColor" />
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
