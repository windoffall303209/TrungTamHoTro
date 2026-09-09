import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";

@Injectable()
/** Prisma Client dùng adapter MariaDB và tham gia lifecycle của NestJS. */
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectOnStart: boolean;

  /** Khởi tạo connection pool từ cấu hình đã xác thực và ghi nhớ chế độ kết nối sớm. */
  constructor(config: ConfigService<Environment, true>) {
    const adapter = new PrismaMariaDb({
      host: config.get("DB_HOST", { infer: true }),
      port: config.get("DB_PORT", { infer: true }),
      user: config.get("DB_USER", { infer: true }),
      password: config.get("DB_PASSWORD", { infer: true }),
      database: config.get("DB_NAME", { infer: true }),
      connectionLimit: 10,
      allowPublicKeyRetrieval: true,
    });
    super({ adapter });
    this.connectOnStart = config.get("DATABASE_CONNECT_ON_START", { infer: true });
  }

  /** Kết nối MySQL lúc bootstrap khi được bật; chế độ lazy để Prisma tự nối ở query đầu. */
  async onModuleInit(): Promise<void> {
    if (!this.connectOnStart) {
      this.logger.warn("Bỏ qua kết nối MySQL lúc khởi động; đặt DATABASE_CONNECT_ON_START=true để bật.");
      return;
    }
    await this.$connect();
    this.logger.log("Đã kết nối MySQL.");
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
