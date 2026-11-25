import { ConflictException, HttpException, Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../../../database/prisma.service.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { AI_CLAIM_LEASE_OPTIONS, canReopenAiClaimAfterFailure, createAiClaimLease, currentAiClaimTime, isAiLeaseExpired, type AiClaimLeaseOptions } from "../../system/ai/ai-claim-policy.js";
import type { GeneratedExamDraft } from "../../system/ai/ai-provider.service.js";
import type { AiGeneratedExamResult } from "../core/learning.types.js";

type Prepared = { courseId: string; generated: GeneratedExamDraft };
type ExamRequestState = "CLAIMED" | "GENERATING" | "READY" | "SAVING" | "COMPLETED" | "UNCERTAIN";

type StoredRequestRow = {
  id: string;
  ownerId: string;
  payloadHash: string;
  state: ExamRequestState;
  version: number;
  prepared: Prepared | null;
  result: AiGeneratedExamResult | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
};

type StoredBindingRow = {
  fingerprint: string;
  ownerId: string;
  payloadHash: string;
  canonicalRequestId: string | null;
  malformed: boolean;
};

const VALID_STATES = new Set<string>(["CLAIMED", "GENERATING", "READY", "SAVING", "COMPLETED", "UNCERTAIN"]);

/** Từ chối bản ghi yêu cầu sinh đề bị hỏng trước khi nó cho phép gọi nhà cung cấp hoặc trả kết quả rỗng. */
function isValidRequestRow(row: {
  ownerId: unknown;
  payloadHash: unknown;
  state: unknown;
  version: unknown;
  prepared: unknown;
  result: unknown;
  leaseToken: unknown;
  leaseExpiresAt: unknown;
}): row is StoredRequestRow {
  if (typeof row.ownerId !== "string" || !row.ownerId.length) return false;
  if (typeof row.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(row.payloadHash)) return false;
  if (typeof row.state !== "string" || !VALID_STATES.has(row.state)) return false;
  if (typeof row.version !== "number" || !Number.isSafeInteger(row.version) || row.version < 1) return false;
  if (row.leaseToken !== null && row.leaseToken !== undefined && (typeof row.leaseToken !== "string" || !row.leaseToken.trim() || row.leaseToken.length > 64)) return false;
  if (row.leaseExpiresAt !== null && row.leaseExpiresAt !== undefined && !(row.leaseExpiresAt instanceof Date && Number.isFinite(row.leaseExpiresAt.getTime()))) return false;
  if (row.state === "READY" || row.state === "SAVING") {
    const prepared = row.prepared as Partial<Prepared> | null | undefined;
    if (!prepared || typeof prepared !== "object" || typeof prepared.courseId !== "string" || !prepared.courseId.length || !prepared.generated || typeof prepared.generated !== "object" || Array.isArray(prepared.generated)) return false;
  }
  if (row.state === "COMPLETED") {
    const result = row.result as Partial<AiGeneratedExamResult> | null | undefined;
    if (!result || typeof result !== "object" || !result.exam || typeof result.exam.id !== "string" || !result.exam.id.length) return false;
  }
  return true;
}

/** Xác nhận bản ghi liên kết fingerprint -> canonicalRequestId đầy đủ và không bị đánh dấu hỏng. */
function isValidBindingRow(row: StoredBindingRow | null | undefined): row is StoredBindingRow & { canonicalRequestId: string } {
  return Boolean(
    row
    && !row.malformed
    && typeof row.ownerId === "string"
    && row.ownerId.length > 0
    && typeof row.payloadHash === "string"
    && /^[a-f0-9]{64}$/.test(row.payloadHash)
    && typeof row.canonicalRequestId === "string"
    && row.canonicalRequestId.trim().length > 0
    && row.canonicalRequestId.length <= 177,
  );
}

/** Chuẩn hóa thứ tự khóa để cùng request không bị coi khác do cách serialize JSON. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

@Injectable()
/** Claim bền vững kèm lease trong bảng ai_generation_requests và ai_generation_bindings; không tự gọi lại khi mơ hồ. */
export class AiGenerationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(AI_CLAIM_LEASE_OPTIONS) private readonly leaseOptions: AiClaimLeaseOptions = {},
  ) {}

  /** Giữ một lần gọi provider có lease; retry bước lưu từ bản nháp đã cache và trả lại kết quả hoàn tất. */
  async run(
    requestId: string,
    owner: string,
    payload: unknown,
    generate: () => Promise<Prepared>,
    save: (prepared: Prepared, canonicalRequestId: string) => Promise<AiGeneratedExamResult>,
    recover: (canonicalRequestId: string) => Promise<AiGeneratedExamResult | undefined>,
    options: { idempotentSave?: boolean } = {},
  ): Promise<AiGeneratedExamResult> {
    if (!this.prisma?.isStartupConnectionEnabled()) {
      throw new ServiceUnavailableException("Sinh đề AI yêu cầu database bền vững để chống tạo trùng. Liên hệ quản trị viên kiểm tra kết nối.");
    }
    const payloadHash = createHash("sha256").update(canonical(payload)).digest("hex");
    await this.claimRequest(requestId, owner, payloadHash);
    const request = await this.readRequest(requestId);
    if (!request || request.ownerId !== owner || request.payloadHash !== payloadHash) {
      throw new ConflictException("Mã yêu cầu AI đã được dùng cho nội dung hoặc tài khoản khác. Không gửi lại với dữ liệu đã thay đổi.");
    }

    // Unique insert theo người dùng + nội dung bảo vệ cả các tab/thiết bị dùng UUID khác nhau.
    const fingerprint = createHash("sha256").update(canonical({ owner, hash: payloadHash })).digest("hex");
    await this.claimBinding(fingerprint, owner, payloadHash, requestId);
    const binding = await this.prisma.aiGenerationBinding.findUnique({ where: { fingerprint } }) as StoredBindingRow | null;
    if (!isValidBindingRow(binding) || binding.ownerId !== owner || binding.payloadHash !== payloadHash) {
      throw new ConflictException("Không xác nhận được mã yêu cầu AI gốc. Hãy thử lại cùng yêu cầu.");
    }

    const canonicalRequestId = binding.canonicalRequestId;
    let row = await this.readRequest(canonicalRequestId);
    if (!row || row.ownerId !== owner || row.payloadHash !== payloadHash) {
      throw new ConflictException("Mã yêu cầu AI đã được dùng cho nội dung hoặc tài khoản khác. Không gửi lại với dữ liệu đã thay đổi.");
    }
    if (row.state === "COMPLETED") return row.result!;

    const recovered = await recover(canonicalRequestId);
    if (recovered) {
      await this.transition(canonicalRequestId, row.version, {
        state: "COMPLETED",
        result: recovered as unknown as Prisma.InputJsonValue,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      return recovered;
    }

    if (row.state === "GENERATING" && isAiLeaseExpired(row.leaseExpiresAt, currentAiClaimTime(this.leaseOptions))) {
      // Hết hạn lease sinh đề sau crash/restart -> chuyển UNCERTAIN chờ đối soát, tuyệt đối không tự gọi lại AI.
      await this.transition(canonicalRequestId, row.version, {
        state: "UNCERTAIN",
        leaseToken: null,
        leaseExpiresAt: null,
      });
      throw new ConflictException("Lần gọi AI trước đã hết thời hạn xử lý và chưa có kết quả xác định. Hệ thống không tự gọi lại để tránh tính phí trùng. Liên hệ quản trị viên kiểm tra mã yêu cầu.");
    }

    if (row.state === "CLAIMED") {
      // Chỉ CAS thắng mới được giữ lease và gọi provider; CLAIMED có thể tiếp tục sau lỗi tra cứu hoặc restart.
      const lease = createAiClaimLease(this.leaseOptions);
      if (!await this.transition(canonicalRequestId, row.version, {
        state: "GENERATING",
        leaseToken: lease.leaseToken,
        leaseExpiresAt: lease.leaseExpiresAt,
      })) {
        throw new ConflictException("Yêu cầu AI đang xử lý hoặc cần đối soát sau gián đoạn. Thử lại cùng yêu cầu để lấy kết quả; không tạo yêu cầu mới.");
      }
      row = { ...row, state: "GENERATING", leaseToken: lease.leaseToken, leaseExpiresAt: lease.leaseExpiresAt, version: row.version + 1 };
      let prepared: Prepared;
      try { prepared = await generate(); }
      catch (error) {
        // Chỉ trả về CLAIMED cho lần gọi chủ động kế tiếp khi lỗi chắc chắn chưa phát sinh phí từ provider.
        const nextState = canReopenAiClaimAfterFailure(error) ? "CLAIMED" : "UNCERTAIN";
        await this.transition(canonicalRequestId, row.version, {
          state: nextState,
          leaseToken: null,
          leaseExpiresAt: null,
        });
        throw error;
      }
      const written = await this.transition(canonicalRequestId, row.version, {
        state: "READY",
        prepared: prepared as unknown as Prisma.InputJsonValue,
        leaseToken: null,
        leaseExpiresAt: null,
      });
      if (!written) throw new ConflictException("Không xác nhận được trạng thái lưu kết quả AI. Không tạo yêu cầu mới; hãy thử lấy lại kết quả.");
      row = (await this.readRequest(canonicalRequestId))!;
    }

    if (row.state === "UNCERTAIN") {
      throw new ConflictException("Lần gọi AI trước chưa có kết quả xác định. Hệ thống không tự gọi lại để tránh tính phí trùng. Liên hệ quản trị viên kiểm tra mã yêu cầu.");
    }

    // Chỉ bật khi lưu trong giao dịch với mã yêu cầu chính thức duy nhất: lượt lưu trước có thể vẫn đang chạy.
    const resumableSave = row.state === "SAVING" && options.idempotentSave === true;
    if (row.state !== "READY" && !resumableSave) {
      throw new HttpException("Yêu cầu AI đang xử lý hoặc cần đối soát sau gián đoạn. Thử lại cùng yêu cầu để lấy kết quả; không tạo yêu cầu mới.", 409);
    }
    if (!await this.transition(canonicalRequestId, row.version, { state: "SAVING", leaseToken: null, leaseExpiresAt: null })) {
      throw new ConflictException("Yêu cầu AI đang được lưu. Hãy thử lấy lại kết quả.");
    }
    const savingVersion = row.version + 1;
    let result: AiGeneratedExamResult;
    try { result = await save(row.prepared!, canonicalRequestId); }
    catch (error) {
      await this.transition(canonicalRequestId, savingVersion, { state: "READY", leaseToken: null, leaseExpiresAt: null });
      throw error;
    }
    await this.transition(canonicalRequestId, savingVersion, {
      state: "COMPLETED",
      result: result as unknown as Prisma.InputJsonValue,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    return result;
  }

  /** Tạo bản ghi yêu cầu sinh đề duy nhất trong bảng ai_generation_requests; chỉ coi P2002 là đã tồn tại. */
  private async claimRequest(id: string, ownerId: string, payloadHash: string): Promise<boolean> {
    try {
      await this.prisma.aiGenerationRequest.create({ data: { id, ownerId, payloadHash, state: "CLAIMED" } });
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return false;
      throw error;
    }
  }

  /** Tạo liên kết fingerprint duy nhất tới canonicalRequestId trong bảng ai_generation_bindings. */
  private async claimBinding(fingerprint: string, ownerId: string, payloadHash: string, canonicalRequestId: string): Promise<boolean> {
    try {
      await this.prisma.aiGenerationBinding.create({ data: { fingerprint, ownerId, payloadHash, canonicalRequestId, malformed: false } });
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return false;
      throw error;
    }
  }

  /** Đọc và kiểm tra toàn vẹn bản ghi sinh đề từ database mà không phụ thuộc tiến trình gốc. */
  private async readRequest(id: string): Promise<StoredRequestRow | undefined> {
    const row = await this.prisma.aiGenerationRequest.findUnique({ where: { id } });
    if (!row) return undefined;
    if (!isValidRequestRow(row)) {
      throw new ConflictException("Dữ liệu khóa sinh đề AI không hợp lệ. Giữ mã yêu cầu và liên hệ quản trị viên đối soát; không tạo yêu cầu mới.");
    }
    return row;
  }

  /** Chuyển trạng thái nguyên tử bằng CAS theo cột version để chỉ một worker được tiếp tục. */
  private async transition(id: string, version: number, data: Prisma.AiGenerationRequestUpdateManyMutationInput): Promise<boolean> {
    const updated = await this.prisma.aiGenerationRequest.updateMany({
      where: { id, version },
      data: { ...data, version: { increment: 1 } },
    });
    return updated.count === 1;
  }
}
