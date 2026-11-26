import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { DatabasePoolMetrics } from "@wind-of-fall/contracts";
import pg from "pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";
import { buildDatabaseUrl } from "../config/database-connection.js";

@Injectable()
/** Prisma Client dùng adapter PostgreSQL kèm pool riêng để đo sức khỏe và đóng kết nối sạch khi shutdown. */
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectOnStart: boolean;
  private readonly poolMax: number;
  private readonly pool: pg.Pool;

  /**
   * Khởi tạo connection pool từ cấu hình đã xác thực và ghi nhớ chế độ kết nối sớm.
   * Pool có trần chờ kết nối và statement_timeout để request không treo vô hạn khi DB quá tải.
   */
  constructor(config: ConfigService<Environment, true>) {
    const statementTimeout = config.get("DB_STATEMENT_TIMEOUT_MS", { infer: true });
    const poolMax = config.get("DB_POOL_MAX", { infer: true });
    const pool = new pg.Pool({
      connectionString: buildDatabaseUrl({
        DB_HOST: config.get("DB_HOST", { infer: true }),
        DB_PORT: config.get("DB_PORT", { infer: true }),
        DB_USER: config.get("DB_USER", { infer: true }),
        DB_PASSWORD: config.get("DB_PASSWORD", { infer: true }),
        DB_NAME: config.get("DB_NAME", { infer: true }),
      }),
      max: poolMax,
      connectionTimeoutMillis: config.get("DB_POOL_CONNECTION_TIMEOUT_MS", { infer: true }),
      idleTimeoutMillis: 30_000,
      // 0 giữ hành vi mặc định của PostgreSQL (không giới hạn) cho môi trường cần chạy tác vụ dài.
      ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
    this.poolMax = poolMax;
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

  /** Đóng Prisma và pool pg khi NestJS shutdown để tiến trình kết thúc sạch không rò socket. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    await this.pool.end().catch(() => undefined);
  }

  /** Cho health endpoint biết database đang chạy ở chế độ eager hay lazy connection. */
  isStartupConnectionEnabled(): boolean {
    return this.connectOnStart;
  }

  /** Trả ảnh chụp tức thời của pg.Pool (active/idle/waiting) không phát sinh truy vấn SQL. */
  getPoolStats(): DatabasePoolMetrics {
    const totalCount = this.pool.totalCount;
    const idleCount = this.pool.idleCount;
    return {
      enabled: this.connectOnStart,
      max: this.poolMax,
      totalCount,
      idleCount,
      activeCount: Math.max(0, totalCount - idleCount),
      waitingCount: this.pool.waitingCount,
    };
  }
}
