import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

export interface HealthStatus {
  status: "ok";
  service: string;
  database: "connect-on-start" | "lazy";
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  getStatus(): HealthStatus {
    return {
      status: "ok",
      service: "teaching-support-api",
      database: this.prisma.isStartupConnectionEnabled() ? "connect-on-start" : "lazy",
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

