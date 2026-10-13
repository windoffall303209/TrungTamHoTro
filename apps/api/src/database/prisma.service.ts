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

  /** Khởi tạo connection pool từ cấu hình đã xác thực và ghi nhớ chế độ kết nối sớm. */
  constructor(config: ConfigService<Environment, true>) {
    const adapter = new PrismaPg({
      connectionString: buildDatabaseUrl({
        DB_HOST: config.get("DB_HOST", { infer: true }),
        DB_PORT: config.get("DB_PORT", { infer: true }),
        DB_USER: config.get("DB_USER", { infer: true }),
        DB_PASSWORD: config.get("DB_PASSWORD", { infer: true }),
        DB_NAME: config.get("DB_NAME", { infer: true }),
      }),
      max: 10,
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
