import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Injectable, Param, Post, Query, ServiceUnavailableException } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsISO8601, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
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

/** Bằng chứng vận hành bắt buộc trước khi mở lại một claim có kết quả chưa xác định. */
export class ReconcileExamNotProcessedDto {
  @IsInt() @Min(1)
  expectedVersion!: number;
  @IsString() @MinLength(8) @MaxLength(191)
  evidenceReference!: string;
  @IsString() @MinLength(20) @MaxLength(2_000)
  evidenceNote!: string;
  @IsISO8601({ strict: true })
  checkedAt!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191)
  providerRequestId?: string;
}

/** Bằng chứng cùng mốc cập nhật cho claim AI lưu trong bảng có updatedAt làm khóa CAS. */
export class ReconcileAiOperationNotProcessedDto {
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
  @IsString() @MinLength(8) @MaxLength(191)
  evidenceReference!: string;
  @IsString() @MinLength(20) @MaxLength(2_000)
  evidenceNote!: string;
  @IsISO8601({ strict: true })
  checkedAt!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(191)
  providerRequestId?: string;
}

const metadata = { id: true, ownerId: true, submissionId: true, language: true, state: true, createdAt: true, updatedAt: true } as const;
type GradingOperation = { id: string; ownerId: string; submissionId: string; language: string; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };
type StudyOperation = { id: string; ownerId: string; materialId: string; sourceVersion: number; state: "RETRY_AUTHORIZED" | "GENERATING" | "READY" | "UNCERTAIN"; createdAt: Date; updatedAt: Date };
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

  /** Mở lại đúng một claim chấm AI bằng CAS updatedAt sau khi admin xác nhận provider chưa xử lý. */
  async reconcileGradingNotProcessed(id: string, input: ReconcileAiOperationNotProcessedDto, session: AuthenticatedSession): Promise<GradingOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 191 || !/^[A-Za-z0-9._:-]+$/.test(id)) throw new BadRequestException("Mã tác vụ chấm AI không hợp lệ.");
    const evidenceReference = input.evidenceReference.trim();
    const evidenceNote = input.evidenceNote.trim();
    const providerRequestId = input.providerRequestId?.trim() || undefined;
    if (evidenceReference.length < 8 || evidenceNote.length < 20) throw new BadRequestException("Bằng chứng đối soát AI chưa đầy đủ.");
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    const checkedAt = new Date(input.checkedAt);
    const now = new Date();
    if (!Number.isFinite(expectedUpdatedAt.getTime()) || !Number.isFinite(checkedAt.getTime()) || checkedAt.getTime() > now.getTime() + 5 * 60_000) throw new BadRequestException("Thời điểm kiểm tra bằng chứng AI không hợp lệ.");
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.aiGradingSuggestion.findUnique({ where: { id }, select: metadata });
      if (!row) throw new BadRequestException("Không tìm thấy tác vụ chấm AI cần đối soát.");
      if (row.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException("Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.");
      if (row.state !== "GENERATING" && row.state !== "UNCERTAIN") throw new ConflictException("Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.");
      if (checkedAt < row.updatedAt) throw new BadRequestException("Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.");
      const updated = await transaction.aiGradingSuggestion.updateMany({ where: { id, state: row.state, updatedAt: row.updatedAt }, data: { state: "RETRY_AUTHORIZED", result: Prisma.JsonNull } });
      if (updated.count !== 1) throw new ConflictException("Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.");
      await transaction.auditLog.create({ data: {
        actorId: session.user.id,
        action: "AI_GRADING_RETRY_AUTHORIZED",
        entityType: "ai_grading_suggestion",
        entityId: id,
        context: { previousState: row.state, previousUpdatedAt: row.updatedAt.toISOString(), evidenceReference, evidenceNote, checkedAt: checkedAt.toISOString(), ...(providerRequestId ? { providerRequestId } : {}) },
      } });
      return { ...row, state: "RETRY_AUTHORIZED", updatedAt: now };
    });
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

  /** Mở lại claim chỉ sau xác nhận có bằng chứng rằng provider chưa xử lý yêu cầu, đồng thời ghi audit nguyên tử. */
  async reconcileExamNotProcessed(id: string, input: ReconcileExamNotProcessedDto, session: AuthenticatedSession): Promise<ExamOperation> {
    this.validateQuery({ limit: 1 }, session);
    if (!id || id.length > 86 || !/^[A-Za-z0-9._:-]+$/.test(id)) throw new BadRequestException("Mã tác vụ sinh đề AI không hợp lệ.");
    const evidenceReference = input.evidenceReference.trim();
    const evidenceNote = input.evidenceNote.trim();
    const providerRequestId = input.providerRequestId?.trim() || undefined;
    if (evidenceReference.length < 8 || evidenceNote.length < 20) throw new BadRequestException("Bằng chứng đối soát AI chưa đầy đủ.");
    const checkedAt = new Date(input.checkedAt);
    const now = new Date();
    if (!Number.isFinite(checkedAt.getTime()) || checkedAt.getTime() > now.getTime() + 5 * 60_000) throw new BadRequestException("Thời điểm kiểm tra bằng chứng AI không hợp lệ.");
    const key = `ai-generation:${id}`;
    return this.prisma.$transaction(async (transaction) => {
      const row = await transaction.systemSetting.findUnique({ where: { key } });
      if (!row) throw new BadRequestException("Không tìm thấy tác vụ sinh đề AI cần đối soát.");
      if (row.version !== input.expectedVersion) throw new ConflictException("Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.");
      if (!row.value || typeof row.value !== "object" || Array.isArray(row.value)) throw new ConflictException("Dữ liệu khóa sinh đề AI không hợp lệ. Không thể mở lại tự động.");
      const value = row.value as Record<string, unknown>;
      const owner = typeof value.owner === "string" ? value.owner : "";
      const hash = typeof value.hash === "string" ? value.hash : "";
      const state = typeof value.state === "string" ? value.state : "";
      if (!owner || !/^[a-f0-9]{64}$/.test(hash) || !["GENERATING", "UNCERTAIN"].includes(state)) throw new ConflictException("Chỉ tác vụ đang xử lý hoặc chưa rõ kết quả mới được mở lại bằng bằng chứng.");
      if (checkedAt < row.updatedAt) throw new BadRequestException("Bằng chứng phải được kiểm tra sau lần cập nhật gần nhất của tác vụ.");
      const bindings = await transaction.$queryRaw<Array<{ present: number }>>(Prisma.sql`
        SELECT 1 AS present
        FROM system_settings b
        WHERE b.\`key\` LIKE 'ai-generation-content:%'
          AND JSON_TYPE(JSON_EXTRACT(b.value, '$.canonicalRequestId')) = 'STRING'
          AND JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId')) = ${id}
          AND JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.owner')) = ${owner}
          AND JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.hash')) = ${hash}
        LIMIT 1
      `);
      if (!bindings.length) throw new ConflictException("Tác vụ không có liên kết nội dung hợp lệ; chưa thể mở lại để tránh tạo trùng.");
      const updated = await transaction.systemSetting.updateMany({
        where: { key, version: input.expectedVersion },
        data: { value: { owner, hash, state: "CLAIMED" }, version: { increment: 1 }, updatedBy: session.user.id },
      });
      if (updated.count !== 1) throw new ConflictException("Tác vụ AI đã thay đổi. Tải lại danh sách trước khi đối soát.");
      await transaction.auditLog.create({ data: {
        actorId: session.user.id,
        action: "AI_EXAM_RETRY_AUTHORIZED",
        entityType: "ai_generation_request",
        entityId: id,
        context: { previousState: state, previousVersion: row.version, evidenceReference, evidenceNote, checkedAt: checkedAt.toISOString(), ...(providerRequestId ? { providerRequestId } : {}) },
      } });
      return { id, ownerId: owner, state: "CLAIMED", version: row.version + 1, createdAt: row.effectiveAt, updatedAt: now };
    });
  }

  /** Chiếu metadata ngay trong SQL: không tải prepared/result hoặc giá trị cấu hình hệ thống vào API. */
  private examRows(filter: Prisma.Sql, limit: number, scope: typeof examScopes[number]): Promise<ExamOperation[]> {
    if (scope === "canonical") return this.canonicalExamRows(filter, limit);
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

  /** Start canonical reconciliation from bindings, then perform one primary-key lookup per target claim. */
  private canonicalExamRows(filter: Prisma.Sql, limit: number): Promise<ExamOperation[]> {
    return this.prisma.$queryRaw<ExamOperation[]>(Prisma.sql`
      SELECT DISTINCT SUBSTRING(r.\`key\`, 15) AS id,
        JSON_UNQUOTE(JSON_EXTRACT(r.value, '$.owner')) AS ownerId,
        JSON_UNQUOTE(JSON_EXTRACT(r.value, '$.state')) AS state,
        r.version, r.effective_at AS createdAt, r.updated_at AS updatedAt
      FROM system_settings b
      JOIN system_settings r
        ON r.\`key\` = CONCAT('ai-generation:', JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId')))
        AND JSON_EXTRACT(b.value, '$.owner') = JSON_EXTRACT(r.value, '$.owner')
        AND JSON_EXTRACT(b.value, '$.hash') = JSON_EXTRACT(r.value, '$.hash')
      WHERE b.\`key\` LIKE 'ai-generation-content:%'
        AND JSON_TYPE(JSON_EXTRACT(b.value, '$.canonicalRequestId')) = 'STRING'
        AND CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(b.value, '$.canonicalRequestId'))) > 0
        AND ${filter}
      ORDER BY createdAt DESC, id DESC
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
/** API đối soát metadata và mở lại claim bằng bằng chứng; không xóa claim hoặc tự gọi provider. */
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

  @Post("grading/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Ghi bằng chứng rồi cho phép đúng một yêu cầu cùng fingerprint thử lại chấm AI. */
  reconcileGradingNotProcessed(@Param("id") id: string, @Body() input: ReconcileAiOperationNotProcessedDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["reconcileGradingNotProcessed"]> {
    return this.operations.reconcileGradingNotProcessed(id, input, session);
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

  @Post("exams/:id/reconcile-not-processed")
  @RequirePermissions("system:configure")
  @Header("Cache-Control", "no-store")
  /** Ghi nhận bằng chứng provider chưa xử lý rồi mở lại claim; lần gọi AI kế tiếp vẫn do người tạo chủ động thực hiện. */
  reconcileExamNotProcessed(@Param("id") id: string, @Body() input: ReconcileExamNotProcessedDto, @CurrentSession() session: AuthenticatedSession): ReturnType<AiGradingOperationsService["reconcileExamNotProcessed"]> {
    return this.operations.reconcileExamNotProcessed(id, input, session);
  }
}
