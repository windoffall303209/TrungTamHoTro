import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import { buildDatabaseUrl } from "../config/database-connection.js";

@Injectable()
/** Prisma Client dùng adapter PostgreSQL và tham gia lifecycle của NestJS. */
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectOnStart: boolean;

  /**
   * Khởi tạo connection pool từ cấu hình đã xác thực và ghi nhớ chế độ kết nối sớm.
   * Pool có trần chờ kết nối và statement_timeout để request không treo vô hạn khi DB quá tải.
   */
  constructor(config: ConfigService<Environment, true>) {
    const statementTimeout = config.get("DB_STATEMENT_TIMEOUT_MS", { infer: true });
    const adapter = new PrismaPg({
      connectionString: buildDatabaseUrl({
        DB_HOST: config.get("DB_HOST", { infer: true }),
        DB_PORT: config.get("DB_PORT", { infer: true }),
        DB_USER: config.get("DB_USER", { infer: true }),
        DB_PASSWORD: config.get("DB_PASSWORD", { infer: true }),
        DB_NAME: config.get("DB_NAME", { infer: true }),
      }),
      max: config.get("DB_POOL_MAX", { infer: true }),
      connectionTimeoutMillis: config.get("DB_POOL_CONNECTION_TIMEOUT_MS", { infer: true }),
      idleTimeoutMillis: 30_000,
      // 0 giữ hành vi mặc định của PostgreSQL (không giới hạn) cho môi trường cần chạy tác vụ dài.
      ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
    });
    super({ adapter });
    this.connectOnStart = config.get("DATABASE_CONNECT_ON_START", { infer: true });
  }

  /** Kết nối PostgreSQL lúc bootstrap khi được bật; chế độ lazy để Prisma tự nối ở query đầu. */
  async onModuleInit(): Promise<void> {
    if (!this.connectOnStart) {
      this.logger.warn("Bỏ qua kết nối PostgreSQL lúc khởi động; đặt DATABASE_CONNECT_ON_START=true để bật.");
      return;
    }
    await this.$connect();
    this.logger.log("Đã kết nối PostgreSQL.");
  }

  /** Đóng pool khi NestJS shutdown để tiến trình kết thúc sạch. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }

  /** Cho health endpoint biết database đang chạy ở chế độ eager hay lazy connection. */
  isStartupConnectionEnabled(): boolean {
    return this.connectOnStart;
  }
}
