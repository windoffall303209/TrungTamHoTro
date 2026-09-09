import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
/** Cung cấp một PrismaService dùng chung cho toàn bộ module nghiệp vụ. */
export class DatabaseModule {}

