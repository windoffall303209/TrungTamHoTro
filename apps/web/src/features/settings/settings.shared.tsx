import {
  Activity,
  Bell,
  BookCheck,
  Bot,
  CloudCog,
  DatabaseBackup,
  HardDrive,
  History,
  ListChecks,
  Settings2,
  ShieldCheck,
} from "lucide-react";

export interface Settings {
  centerName: string;
  timezone: string;
  locale: string;
  retentionDays: number;
  maxFileSizeMb: number;
  storageQuotaMb: number;
  allowedMimeTypes: string[];
  moderationEnabled: boolean;
  examApprovalMode: "AUTO" | "MANUAL";
  questionApprovalMode: "AUTO" | "MANUAL";
  notificationSender: string;
  maintenanceMode: boolean;
  learnerEmailNotificationsEnabled: boolean;
  version: number;
  effectiveAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface Integration {
  id: string;
  provider: "GOOGLE_MEET" | "ZOOM" | "JITSI";
  enabled: boolean;
  isDefault: boolean;
  healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR";
  maskedCredential: string;
  webhookConfigured: boolean;
  lastCheckedAt?: string;
  updatedAt: string;
}

export interface Backup {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  checksum: string;
  sizeMb: number;
}

export interface Health {
  status: string;
  database: string;
  apiLatencyMs: number;
  storageUsagePercent: number;
  queueDepth: number;
  checkedAt: string;
}

export interface StorageOverview {
  quotaBytes: number;
  usedBytes: number;
  usagePercent: number;
  maxFileSizeMb: number;
  allowedMimeTypes: string[];
  byClass: Array<{
    classId: string;
    classCode: string;
    className: string;
    fileCount: number;
    usedBytes: number;
  }>;
}

export type AiProviderType = "GEMINI" | "NVIDIA_NIM" | "OPENAI" | "CUSTOM";

export interface AiProvider {
  id: string;
  provider: AiProviderType;
  name: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  healthStatus: "UNKNOWN" | "HEALTHY" | "ERROR";
  hasApiKey: boolean;
  maskedApiKey: string;
  lastCheckedAt?: string;
  updatedAt: string;
}

export type ModelOption = { value: string; label: string; description: string };

export type ModelCatalog = Record<
  "GEMINI" | "NVIDIA_NIM" | "OPENAI",
  ModelOption[]
>;

export type SettingsSection =
  | "general"
  | "notifications"
  | "exam-approval"
  | "question-approval"
  | "ai-providers"
  | "integrations"
  | "backups"
  | "storage"
  | "health"
  | "history";

export const settingsSections: Array<{
  id: SettingsSection;
  title: string;
  description: string;
  icon: typeof Settings2;
}> = [
  {
    id: "general",
    title: "Quy định vận hành",
    description:
      "Tên trung tâm, vùng thời gian, dữ liệu, kiểm duyệt và bảo trì.",
    icon: ShieldCheck,
  },
  {
    id: "notifications",
    title: "Cài đặt thông báo",
    description:
      "Quản lý gửi thông báo hệ thống và nhắc việc qua email tới học viên.",
    icon: Bell,
  },
  {
    id: "exam-approval",
    title: "Phê duyệt đề thi",
    description: "Chọn tự động phát hành hoặc quản trị viên duyệt thủ công.",
    icon: BookCheck,
  },
  {
    id: "question-approval",
    title: "Phê duyệt câu hỏi",
    description: "Chọn tự động xuất bản hoặc đưa câu hỏi vào hàng chờ duyệt.",
    icon: ListChecks,
  },
  {
    id: "ai-providers",
    title: "AI và quét đề",
    description:
      "Quản lý API key, model và nhà cung cấp dùng để đọc ảnh đề thi.",
    icon: Bot,
  },
  {
    id: "integrations",
    title: "Tích hợp lớp học",
    description:
      "Cấu hình, kiểm tra và chọn nhà cung cấp phòng học trực tuyến.",
    icon: CloudCog,
  },
  {
    id: "backups",
    title: "Sao lưu dữ liệu",
    description: "Chạy sao lưu và theo dõi các bản sao gần nhất.",
    icon: DatabaseBackup,
  },
  {
    id: "storage",
    title: "Phân bổ lưu trữ",
    description: "Theo dõi quota và dung lượng học liệu theo từng lớp.",
    icon: HardDrive,
  },
  {
    id: "health",
    title: "Tình trạng dịch vụ",
    description: "Kiểm tra cơ sở dữ liệu, độ trễ API, lưu trữ và hàng đợi.",
    icon: Activity,
  },
  {
    id: "history",
    title: "Lịch sử cấu hình",
    description: "Tra cứu phiên bản, thời điểm hiệu lực và người cập nhật.",
    icon: History,
  },
];
