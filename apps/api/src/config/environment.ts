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
  DATABASE_URL: z.string().startsWith("mysql://"),
  DATABASE_CONNECT_ON_START: booleanFromString.default(false),
  STORAGE_ROOT: z.string().trim().min(1).default("../TestDoAn-data"),
  STORAGE_SIGNING_SECRET: z.string().min(32).default("development-storage-signing-key-change-me"),
  RATE_LIMIT_TTL_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LIVE_PROVIDER_RETRY_LIMIT: z.coerce.number().int().min(1).max(3).default(2),
  LIVE_PROVIDER_FALLBACK_ORDER: z.string().trim().default("GOOGLE_MEET,ZOOM,JITSI"),
  LIVE_PROVIDER_SIMULATED_FAILURES: z.string().default(""),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Cấu hình môi trường không hợp lệ: ${details}`);
  }

  return result.data;
}
