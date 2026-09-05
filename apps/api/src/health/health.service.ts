import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

export interface HealthStatus {
  status: "ok";
  service: string;
  database: "connect-on-start" | "lazy";
  uptimeSeconds: number;
}

@Injectable()
/** Tổng hợp trạng thái sống của tiến trình mà không phụ thuộc kết nối ngoài. */
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** Trả uptime và chế độ kết nối database để hệ thống vận hành đọc nhanh. */
  getStatus(): HealthStatus {
    return {
      status: "ok",
      service: "teaching-support-api",
      database: this.prisma.isStartupConnectionEnabled() ? "connect-on-start" : "lazy",
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

