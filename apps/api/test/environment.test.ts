import { describe, expect, it } from "vitest";
import { buildDatabaseUrl, readDatabaseConnection } from "../src/config/database-connection.js";
import { validateEnvironment } from "../src/config/environment.js";

describe("validateEnvironment", () => {
  it("chuẩn hóa cấu hình hợp lệ", () => {
    const config = validateEnvironment({
      DB_HOST: "localhost",
      DB_USER: "postgres",
      DB_PASSWORD: "secret",
      DB_NAME: "trung_tam_giang_day",
      DB_PORT: "5432",
      API_PORT: "4100",
      DATABASE_CONNECT_ON_START: "true",
    });

    expect(config.API_PORT).toBe(4100);
    expect(config.DATABASE_CONNECT_ON_START).toBe(true);
  });

  it("từ chối tên database không an toàn", () => {
    expect(() => validateEnvironment({
      DB_HOST: "localhost",
      DB_USER: "postgres",
      DB_PASSWORD: "secret",
      DB_NAME: "database;DROP TABLE users",
    })).toThrow(
      "Cấu hình môi trường không hợp lệ",
    );
  });

  it("bắt buộc credential dịch vụ ngoài và domain Resend đã xác minh ở production", () => {
    const base = {
      NODE_ENV: "production",
      DB_HOST: "localhost",
      DB_USER: "root",
      DB_PASSWORD: "secret",
      DB_NAME: "trung_tam_giang_day",
      STORAGE_PROVIDER: "cloudinary",
      STORAGE_SIGNING_SECRET: "production-signing-secret-at-least-32-characters",
      AUTH_ENCRYPTION_SECRET: "production-auth-encryption-secret-at-least-32-characters",
      ANTIVIRUS_PROVIDER: "clamav",
    };
    expect(() => validateEnvironment(base)).toThrow("CLOUDINARY_CLOUD_NAME");
    expect(() => validateEnvironment({
      ...base,
      CLOUDINARY_CLOUD_NAME: "wind-edu",
      CLOUDINARY_API_KEY: "cloudinary-key",
      CLOUDINARY_API_SECRET: "cloudinary-secret",
      RESEND_API_KEY: "resend-key",
      RESEND_FROM: "Wind EDU <onboarding@resend.dev>",
    })).toThrow("domain đã xác minh");
  });

  it("tạo URL Prisma an toàn từ bộ biến DB_*", () => {
    const source = {
      DB_HOST: "localhost",
      DB_USER: "postgres@example",
      DB_PASSWORD: "p@ss:/word",
      DB_NAME: "trung_tam_giang_day",
      DB_PORT: "5432",
    };

    expect(readDatabaseConnection(source)).toEqual({
      host: "localhost",
      user: "postgres@example",
      password: "p@ss:/word",
      database: "trung_tam_giang_day",
      port: 5432,
    });
    expect(buildDatabaseUrl(source)).toBe(
      "postgresql://postgres%40example:p%40ss%3A%2Fword@localhost:5432/trung_tam_giang_day?schema=public",
    );
  });
});
