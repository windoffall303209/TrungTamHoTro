import { BadRequestException, Controller, ForbiddenException, Get, Header, Injectable, Query, ServiceUnavailableException } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { PrismaService } from "../database/prisma.service.js";

/** Bộ lọc hữu hạn cho hàng đợi đối soát; không nhận nội dung bài làm hoặc thông số provider. */
export class GradingOperationsQueryDto {
  @IsOptional() @IsIn(["GENERATING", "READY", "UNCERTAIN"])
  state?: "GENERATING" | "READY" | "UNCERTAIN";
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191)
  cursor?: string;
  @Transform(({ value }: { value: unknown }) => typeof value === "string" && /^[1-9]\d*$/.test(value) ? Number(value) : value)
  @IsInt() @Min(1) @Max(50)
  limit = 20;
}

const metadata = { id: true, ownerId: true, submissionId: true, language: true, state: true, createdAt: true, updatedAt: true } as const;
type GradingOperation = { id: string; ownerId: string; submissionId: string; language: string; state: "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };

@Injectable()
/** Chỉ đọc metadata claim bền vững; không trả bài làm, điểm, phản hồi, hash hoặc cấu hình bí mật. */
export class AiGradingOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Phân trang keyset theo thời điểm tạo và ID; admin xem trạng thái mà không tác động lần gọi AI. */
  async list(query: GradingOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: GradingOperation[]; nextCursor: string | null }> {
    if (session.roleCode !== "SYSTEM_ADMIN" || !session.permissions.includes("system:configure")) throw new ForbiddenException("Chỉ quản trị viên hệ thống được đối soát tác vụ AI.");
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Đối soát tác vụ AI yêu cầu database bền vững.");
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (query.state !== undefined && !["GENERATING", "READY", "UNCERTAIN"].includes(query.state)) || (query.cursor !== undefined && (typeof query.cursor !== "string" || !query.cursor.length || query.cursor.length > 191))) throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    const anchor = query.cursor ? await this.prisma.aiGradingSuggestion.findUnique({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
    if (query.cursor && !anchor) throw new BadRequestException("Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.");
    const rows = await this.prisma.aiGradingSuggestion.findMany({
      where: {
        state: query.state ?? { in: ["GENERATING", "UNCERTAIN"] },
        ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}),
      },
      select: metadata,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }
}

@Controller("admin/ai-operations")
/** API đối soát read-only; không có route reset, retry hoặc xóa claim. */
export class AiGradingOperationsController {
  constructor(private readonly operations: AiGradingOperationsService) {}

  @Get("grading")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Liệt kê mặc định những yêu cầu đang xử lý hoặc chưa rõ kết quả, chỉ cho admin hệ thống. */
  list(@Query() query: GradingOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["list"]> {
    return this.operations.list(query, session);
  }
}
