import { describe, expect, it } from "vitest";
import { buildDatabaseUrl, readDatabaseConnection } from "../src/config/database-connection.js";
import { validateEnvironment } from "../src/config/environment.js";

describe("validateEnvironment", () => {
  it("chuẩn hóa cấu hình hợp lệ", () => {
    const config = validateEnvironment({
      DB_HOST: "localhost",
      DB_USER: "root",
      DB_PASSWORD: "secret",
      DB_NAME: "trung_tam_giang_day",
      DB_PORT: "3306",
      API_PORT: "4100",
      DATABASE_CONNECT_ON_START: "true",
    });

    expect(config.API_PORT).toBe(4100);
    expect(config.DATABASE_CONNECT_ON_START).toBe(true);
  });

  it("từ chối tên database không an toàn", () => {
    expect(() => validateEnvironment({
      DB_HOST: "localhost",
      DB_USER: "root",
      DB_PASSWORD: "secret",
      DB_NAME: "database;DROP TABLE users",
    })).toThrow(
      "Cấu hình môi trường không hợp lệ",
    );
  });

  it("tạo URL Prisma an toàn từ bộ biến DB_*", () => {
    const source = {
      DB_HOST: "localhost",
      DB_USER: "root@example",
      DB_PASSWORD: "p@ss:/word",
      DB_NAME: "trung_tam_giang_day",
      DB_PORT: "3306",
    };

    expect(readDatabaseConnection(source)).toEqual({
      host: "localhost",
      user: "root@example",
      password: "p@ss:/word",
      database: "trung_tam_giang_day",
      port: 3306,
    });
    expect(buildDatabaseUrl(source)).toBe(
      "mysql://root%40example:p%40ss%3A%2Fword@localhost:3306/trung_tam_giang_day",
    );
  });
});
