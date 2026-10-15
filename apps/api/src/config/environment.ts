import { z } from "zod";

const booleanFromString = z.preprocess(
  (value) => value === true || value === "true",
  z.boolean(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PREFIX: z.string().trim().min(1).default("api"),
  API_VERSION: z.string().trim().min(1).default("1"),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  DB_HOST: z.string().trim().min(1),
  DB_USER: z.string().trim().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DATABASE_CONNECT_ON_START: booleanFromString.default(false),
  DB_BACKUP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  PG_DUMP_PATH: z.string().trim().min(1).default("pg_dump"),
  PG_RESTORE_PATH: z.string().trim().min(1).default("pg_restore"),
  STORAGE_ROOT: z.string().trim().min(1).default("../TestDoAn-data"),
  STORAGE_SIGNING_SECRET: z.string().min(32).default("development-storage-signing-key-change-me"),
  STORAGE_PROVIDER: z.enum(["local", "cloudinary"]).default("local"),
  CLOUDINARY_CLOUD_NAME: z.string().trim().default(""),
  CLOUDINARY_API_KEY: z.string().trim().default(""),
  CLOUDINARY_API_SECRET: z.string().trim().default(""),
  CLOUDINARY_FOLDER: z.string().trim().regex(/^[a-zA-Z0-9/_-]+$/).default("wind-edu"),
  ANTIVIRUS_PROVIDER: z.enum(["disabled", "clamav"]).default("disabled"),
  CLAMAV_HOST: z.string().trim().min(1).default("127.0.0.1"),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  RESEND_API_KEY: z.string().trim().default(""),
  RESEND_FROM: z.string().trim().default(""),
  AUTH_ENCRYPTION_SECRET: z.string().min(32).default("development-auth-encryption-key-change-me"),
  MFA_ISSUER: z.string().trim().min(2).max(80).default("Wind EDU"),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LIVE_PROVIDER_RETRY_LIMIT: z.coerce.number().int().min(1).max(3).default(2),
  LIVE_PROVIDER_FALLBACK_ORDER: z.string().trim().default("GOOGLE_MEET,ZOOM,JITSI"),
  LIVE_PROVIDER_SIMULATED_FAILURES: z.string().default(""),
});

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Chuẩn hóa và xác thực toàn bộ biến môi trường trước khi ứng dụng khởi động.
 * Ngoài schema cơ bản, hàm kiểm tra các nhóm cấu hình phải xuất hiện đồng thời và
 * tăng yêu cầu bảo mật khi chạy production để tránh khởi động với mặc định phát triển.
 */
export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${details}`);
  }

  const environment = result.data;
  if (environment.NODE_ENV === "production") {
    const missing: string[] = [];
    if (environment.STORAGE_PROVIDER === "cloudinary") {
      if (!environment.CLOUDINARY_CLOUD_NAME) missing.push("CLOUDINARY_CLOUD_NAME");
      if (!environment.CLOUDINARY_API_KEY) missing.push("CLOUDINARY_API_KEY");
      if (!environment.CLOUDINARY_API_SECRET) missing.push("CLOUDINARY_API_SECRET");
    }
    if (!environment.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!environment.RESEND_FROM) missing.push("RESEND_FROM");
    if (environment.STORAGE_SIGNING_SECRET === "development-storage-signing-key-change-me") missing.push("STORAGE_SIGNING_SECRET");
    if (environment.AUTH_ENCRYPTION_SECRET === "development-auth-encryption-key-change-me") missing.push("AUTH_ENCRYPTION_SECRET");
    if (environment.ANTIVIRUS_PROVIDER !== "clamav") missing.push("ANTIVIRUS_PROVIDER=clamav");
    if (missing.length) throw new Error(`Thiếu cấu hình production bắt buộc: ${missing.join(", ")}`);
    if (/@resend\.dev[>\s]*$/i.test(environment.RESEND_FROM)) {
      throw new Error("RESEND_FROM production phải dùng domain đã xác minh, không dùng resend.dev.");
    }
  }

  return environment;
}
