import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectOnStart: boolean;

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

  async onModuleInit(): Promise<void> {
    if (!this.connectOnStart) {
      this.logger.warn("Bỏ qua kết nối MySQL lúc khởi động; đặt DATABASE_CONNECT_ON_START=true để bật.");
      return;
    }
    await this.$connect();
    this.logger.log("Đã kết nối MySQL.");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }

  isStartupConnectionEnabled(): boolean {
    return this.connectOnStart;
  }
}
