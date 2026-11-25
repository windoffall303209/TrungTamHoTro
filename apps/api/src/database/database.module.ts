import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { DatabaseEventsService } from "./database-events.service.js";

@Global()
@Module({
  providers: [PrismaService, DatabaseEventsService],
  exports: [PrismaService, DatabaseEventsService],
})
/** Cung cấp một PrismaService dùng chung cho toàn bộ module nghiệp vụ. */
export class DatabaseModule {}

