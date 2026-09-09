import { BadRequestException, Controller, ForbiddenException, Get, Header, Injectable, Query, ServiceUnavailableException } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { RequirePermissions } from "../auth/require-permissions.decorator.js";
import type { AuthenticatedSession } from "../auth/auth.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { OmitType } from "@nestjs/swagger";

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

const examStates = ["CLAIMED", "GENERATING", "READY", "SAVING", "COMPLETED", "UNCERTAIN"] as const;
const examScopes = ["canonical", "unlinked", "broken"] as const;
/** Sinh đề có bước giữ khóa, lưu nháp và hoàn tất riêng; không đồng nhất READY với đề đã lưu. */
export class ExamOperationsQueryDto extends OmitType(GradingOperationsQueryDto, ["state"] as const) {
  @IsOptional() @IsIn(examStates)
  state?: typeof examStates[number];
  @IsOptional() @IsIn(examScopes)
  scope?: typeof examScopes[number];
}

const metadata = { id: true, ownerId: true, submissionId: true, language: true, state: true, createdAt: true, updatedAt: true } as const;
type GradingOperation = { id: string; ownerId: string; submissionId: string; language: string; state: "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };
type StudyOperation = { id: string; ownerId: string; materialId: string; sourceVersion: number; state: "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };
type ExamOperation = { id: string; ownerId: string; state: typeof examStates[number]; version: number; createdAt: Date; updatedAt: Date };
type DocumentAnswerOperation = Omit<ExamOperation, "state"> & { state: "GENERATING" | "READY" | "UNCERTAIN" };

@Injectable()
/** Chỉ đọc metadata claim bền vững; không trả bài làm, điểm, phản hồi, hash hoặc cấu hình bí mật. */
export class AiGradingOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List OCR metadata only; READY is a storage label, not an independent assessment of transcription accuracy. */
  async listExtractions(query: GradingOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor ? (await this.extractionRows(Prisma.sql`r.\`key\` = ${`ai-doc:${query.cursor}`}`, 1))[0] : undefined;
    if (query.cursor && !anchor) throw new BadRequestException("Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.");
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const position = anchor ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r.\`key\` < ${`ai-doc:${anchor.id}`}))` : Prisma.empty;
    const rows = await this.extractionRows(Prisma.sql`claim_state IN (${Prisma.join(states)}) ${position}`, limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Project claim metadata without loading pages; legacy array snapshots are listed under READY. */
  private extractionRows(filter: Prisma.Sql, limit: number): Promise<DocumentAnswerOperation[]> {
    return this.prisma.$queryRaw<DocumentAnswerOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r.\`key\`, 8) AS id, r.updated_by AS ownerId,
        r.claim_state AS state, r.version, r.effective_at AS createdAt, r.updated_at AS updatedAt
      FROM (
        SELECT \`key\`, updated_by, version, effective_at, updated_at,
          CASE WHEN JSON_TYPE(value) = 'ARRAY' THEN 'READY'
            WHEN JSON_UNQUOTE(JSON_EXTRACT(value, '$.state')) IN ('GENERATING', 'READY')
            THEN JSON_UNQUOTE(JSON_EXTRACT(value, '$.state')) ELSE 'UNCERTAIN' END AS claim_state
        FROM system_settings WHERE \`key\` LIKE 'ai-doc:%'
      ) r
      WHERE ${filter}
      ORDER BY r.effective_at DESC, r.\`key\` DESC
      LIMIT ${limit}
    `);
  }

  /** Inspect private answer claims without loading questions, answers, citations or provider configuration. */
  async listDocumentAnswers(query: GradingOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: DocumentAnswerOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor ? (await this.documentAnswerRows(Prisma.sql`r.\`key\` = ${`ai-doc-answer:${query.cursor}`}`, 1))[0] : undefined;
    if (query.cursor && !anchor) throw new BadRequestException("Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.");
    const states = query.state ? [query.state] : ["GENERATING", "UNCERTAIN"];
    const position = anchor ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r.\`key\` < ${`ai-doc-answer:${anchor.id}`}))` : Prisma.empty;
    const rows = await this.documentAnswerRows(Prisma.sql`claim_state IN (${Prisma.join(states)}) ${position}`, limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Project only operational metadata in SQL; malformed states remain visible as uncertain, never retried. */
  private documentAnswerRows(filter: Prisma.Sql, limit: number): Promise<DocumentAnswerOperation[]> {
    return this.prisma.$queryRaw<DocumentAnswerOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r.\`key\`, 15) AS id, r.updated_by AS ownerId,
        r.claim_state AS state, r.version, r.effective_at AS createdAt, r.updated_at AS updatedAt
      FROM (
        SELECT \`key\`, updated_by, version, effective_at, updated_at,
          CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(value, '$.state')) IN ('GENERATING', 'READY')
            THEN JSON_UNQUOTE(JSON_EXTRACT(value, '$.state')) ELSE 'UNCERTAIN' END AS claim_state
        FROM system_settings WHERE \`key\` LIKE 'ai-doc-answer:%'
      ) r
      WHERE ${filter}
      ORDER BY r.effective_at DESC, r.\`key\` DESC
      LIMIT ${limit}
    `);
  }

  /** Phân trang keyset theo thời điểm tạo và ID; admin xem trạng thái mà không tác động lần gọi AI. */
  async list(query: GradingOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: GradingOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
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

  /** Đọc metadata bộ ôn tập, tuyệt đối không select options/result hoặc nội dung đã sửa/phát hành. */
  async listStudy(query: GradingOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: StudyOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery(query, session);
    const anchor = query.cursor ? await this.prisma.aiStudyDraft.findUnique({ where: { id: query.cursor }, select: { id: true, createdAt: true } }) : null;
    if (query.cursor && !anchor) throw new BadRequestException("Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.");
    const rows = await this.prisma.aiStudyDraft.findMany({
      where: {
        state: query.state ?? { in: ["GENERATING", "UNCERTAIN"] },
        ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}),
      },
      select: { id: true, ownerId: true, materialId: true, sourceVersion: true, state: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Đọc request gốc hoặc request bị ảnh hưởng bởi liên kết thiếu/hỏng; không đọc nội dung đề. */
  async listExams(query: ExamOperationsQueryDto, session: AuthenticatedSession): Promise<{ items: ExamOperation[]; nextCursor: string | null }> {
    const limit = this.validateQuery({ ...query, state: undefined }, session);
    if (query.state !== undefined && !examStates.includes(query.state)) throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    if (query.scope !== undefined && !examScopes.includes(query.scope)) throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    const scope = query.scope ?? "canonical";
    const anchor = query.cursor ? (await this.examRows(Prisma.sql`r.\`key\` = ${`ai-generation:${query.cursor}`}`, 1, scope))[0] : undefined;
    if (query.cursor && !anchor) throw new BadRequestException("Mốc phân trang AI không còn tồn tại. Hãy tải lại danh sách.");
    const states = query.state ? [query.state] : examStates.filter((state) => state !== "COMPLETED");
    const stateFilter = Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(r.value, '$.state')) IN (${Prisma.join(states)})`;
    const position = anchor ? Prisma.sql`AND (r.effective_at < ${anchor.createdAt} OR (r.effective_at = ${anchor.createdAt} AND r.\`key\` < ${`ai-generation:${anchor.id}`}))` : Prisma.empty;
    const rows = await this.examRows(Prisma.sql`${stateFilter} ${position}`, limit + 1, scope);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  /** Chiếu metadata ngay trong SQL: không tải prepared/result hoặc giá trị cấu hình hệ thống vào API. */
  private examRows(filter: Prisma.Sql, limit: number, scope: typeof examScopes[number]): Promise<ExamOperation[]> {
    // Broken bindings can affect several retry IDs; this scope reports affected requests, not distinct jobs.
    const brokenTarget = Prisma.sql`AND NOT EXISTS (
      SELECT 1 FROM system_settings target
      WHERE JSON_TYPE(JSON_EXTRACT(b.value, '$.canonicalRequestId')) = 'STRING'
        AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId'))) > 0
        AND target.\`key\` = CONCAT('ai-generation:', JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId')))
        AND JSON_EXTRACT(target.value, '$.owner') = JSON_EXTRACT(b.value, '$.owner')
        AND JSON_EXTRACT(target.value, '$.hash') = JSON_EXTRACT(b.value, '$.hash')
        AND JSON_UNQUOTE(JSON_EXTRACT(target.value, '$.state')) IN (${Prisma.join(examStates)})
    )`;
    // Retry aliases share an owner/hash binding and must not be reported as unlinked claims.
    const binding = Prisma.sql`EXISTS (
      SELECT 1 FROM system_settings b
      WHERE b.\`key\` LIKE 'ai-generation-content:%'
        AND JSON_EXTRACT(b.value, '$.owner') = JSON_EXTRACT(r.value, '$.owner')
        AND JSON_EXTRACT(b.value, '$.hash') = JSON_EXTRACT(r.value, '$.hash')
        ${scope === "canonical" ? Prisma.sql`AND JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId')) = SUBSTRING(r.\`key\`, 15)` : Prisma.empty}
        ${scope === "broken" ? brokenTarget : Prisma.empty}
    )`;
    const relationship = scope === "unlinked" ? Prisma.sql`NOT ${binding}` : binding;
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT SUBSTRING(r.\`key\`, 15) AS id,
        JSON_UNQUOTE(JSON_EXTRACT(r.value, '$.owner')) AS ownerId,
        JSON_UNQUOTE(JSON_EXTRACT(r.value, '$.state')) AS state,
        r.version, r.effective_at AS createdAt, r.updated_at AS updatedAt
      FROM system_settings r
      WHERE r.\`key\` LIKE 'ai-generation:%'
        AND ${relationship}
        AND ${filter}
      ORDER BY r.effective_at DESC, r.\`key\` DESC
      LIMIT ${limit}
    `);
  }

  /** Dùng chung quyền và quy tắc đầu vào cho mọi hàng đợi trước khi truy cập database. */
  private validateQuery(query: GradingOperationsQueryDto, session: AuthenticatedSession): number {
    if (session.roleCode !== "SYSTEM_ADMIN" || !session.permissions.includes("system:configure")) throw new ForbiddenException("Chỉ quản trị viên hệ thống được đối soát tác vụ AI.");
    if (!this.prisma.isStartupConnectionEnabled()) throw new ServiceUnavailableException("Đối soát tác vụ AI yêu cầu database bền vững.");
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (query.state !== undefined && !["GENERATING", "READY", "UNCERTAIN"].includes(query.state)) || (query.cursor !== undefined && (typeof query.cursor !== "string" || !query.cursor.length || query.cursor.length > 191))) throw new BadRequestException("Bộ lọc đối soát AI không hợp lệ.");
    return limit;
  }
}

@Controller("admin/ai-operations")
/** API đối soát read-only; không có route reset, retry hoặc xóa claim. */
export class AiGradingOperationsController {
  constructor(private readonly operations: AiGradingOperationsService) {}

  @Get("extractions")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Expose read-only OCR reconciliation to system administrators without document text. */
  extractions(@Query() query: GradingOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["listExtractions"]> {
    return this.operations.listExtractions(query, session);
  }

  @Get("document-answers")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Expose answer claim metadata to system administrators without replaying or resetting AI work. */
  documentAnswers(@Query() query: GradingOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["listDocumentAnswers"]> {
    return this.operations.listDocumentAnswers(query, session);
  }

  @Get("grading")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Liệt kê mặc định những yêu cầu đang xử lý hoặc chưa rõ kết quả, chỉ cho admin hệ thống. */
  list(@Query() query: GradingOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["list"]> {
    return this.operations.list(query, session);
  }

  @Get("study")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Liệt kê trạng thái sinh tóm tắt/flashcard mà không đọc nội dung riêng của người tạo. */
  study(@Query() query: GradingOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["listStudy"]> {
    return this.operations.listStudy(query, session);
  }

  @Get("exams")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Đọc request sinh đề theo phạm vi đối soát, không trả câu hỏi/đáp án và không gọi provider. */
  exams(@Query() query: ExamOperationsQueryDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["listExams"]> {
    return this.operations.listExams(query, session);
  }
}
