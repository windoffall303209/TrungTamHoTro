import { ConflictException, HttpException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service.js";
import type { GeneratedExamDraft } from "../system/ai-provider.service.js";
import type { AiGeneratedExamResult } from "./learning.types.js";

type Prepared = { courseId: string; generated: GeneratedExamDraft };
type RecordValue = { owner: string; hash: string; canonicalRequestId?: string; state: "CLAIMED" | "GENERATING" | "READY" | "SAVING" | "COMPLETED" | "UNCERTAIN"; prepared?: Prepared; result?: AiGeneratedExamResult };

/** Chuẩn hóa thứ tự khóa để cùng request không bị coi khác do cách serialize JSON. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

@Injectable()
/** Claim bền vững trước khi gọi AI; không tự gọi lại provider khi kết quả upstream chưa xác định. */
export class AiGenerationRequestService {
  private readonly memory = new Map<string, { version: number; value: RecordValue }>();
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** Giữ một lần gọi provider; retry bước lưu từ bản nháp đã cache và trả lại kết quả hoàn tất. */
  async run(requestId: string, owner: string, payload: unknown, generate: () => Promise<Prepared>, save: (prepared: Prepared, canonicalRequestId: string) => Promise<AiGeneratedExamResult>, recover: (canonicalRequestId: string) => Promise<AiGeneratedExamResult | undefined>): Promise<AiGeneratedExamResult> {
    const requestKey = `ai-generation:${requestId}`;
    const hash = createHash("sha256").update(canonical(payload)).digest("hex");
    const initial: RecordValue = { owner, hash, state: "CLAIMED" };
    await this.claim(requestKey, initial);
    const request = await this.read(requestKey);
    if (!request || request.value.owner !== owner || request.value.hash !== hash) throw new ConflictException("Mã yêu cầu AI đã được dùng cho nội dung hoặc tài khoản khác. Không gửi lại với dữ liệu đã thay đổi.");
    // Unique insert theo người dùng + nội dung bảo vệ cả các tab/thiết bị dùng UUID khác nhau.
    const fingerprint = createHash("sha256").update(canonical({ owner, hash })).digest("hex");
    const fingerprintKey = `ai-generation-content:${fingerprint}`;
    await this.claim(fingerprintKey, { ...initial, canonicalRequestId: requestId });
    const binding = await this.read(fingerprintKey);
    if (!binding?.value.canonicalRequestId || binding.value.owner !== owner || binding.value.hash !== hash) throw new ConflictException("Không xác nhận được mã yêu cầu AI gốc. Hãy thử lại cùng yêu cầu.");
    const canonicalRequestId = binding.value.canonicalRequestId;
    const key = `ai-generation:${canonicalRequestId}`;
    let row = await this.read(key);
    if (!row || row.value.owner !== owner || row.value.hash !== hash) throw new ConflictException("Mã yêu cầu AI đã được dùng cho nội dung hoặc tài khoản khác. Không gửi lại với dữ liệu đã thay đổi.");
    if (row.value.state === "COMPLETED") return row.value.result!;
    const recovered = await recover(canonicalRequestId);
    if (recovered) {
      await this.replace(key, row.version, { ...row.value, state: "COMPLETED", result: recovered });
      return recovered;
    }
    if (row.value.state === "CLAIMED") {
      // Chỉ CAS thắng mới được gọi provider; CLAIMED có thể tiếp tục sau lỗi tra cứu hoặc restart.
      if (!await this.replace(key, row.version, { ...row.value, state: "GENERATING" })) throw new ConflictException("Yêu cầu AI đang xử lý hoặc cần đối soát sau gián đoạn. Thử lại cùng yêu cầu để lấy kết quả; không tạo yêu cầu mới.");
      row = { version: row.version + 1, value: { ...row.value, state: "GENERATING" } };
      let prepared: Prepared;
      try { prepared = await generate(); }
      catch (error) {
        await this.replace(key, row.version, { ...row.value, state: "UNCERTAIN" });
        throw error;
      }
      const written = await this.replace(key, row.version, { ...row.value, state: "READY", prepared });
      if (!written) throw new ConflictException("Không xác nhận được trạng thái lưu kết quả AI. Không tạo yêu cầu mới; hãy thử lấy lại kết quả.");
      row = (await this.read(key))!;
    }
    if (row.value.state === "UNCERTAIN") throw new ConflictException("Lần gọi AI trước chưa có kết quả xác định. Hệ thống không tự gọi lại để tránh tính phí trùng. Liên hệ quản trị viên kiểm tra mã yêu cầu.");
    if (row.value.state !== "READY") throw new HttpException("Yêu cầu AI đang xử lý hoặc cần đối soát sau gián đoạn. Thử lại cùng yêu cầu để lấy kết quả; không tạo yêu cầu mới.", 409);
    if (!await this.replace(key, row.version, { ...row.value, state: "SAVING" })) throw new ConflictException("Yêu cầu AI đang được lưu. Hãy thử lấy lại kết quả.");
    const savingVersion = row.version + 1;
    let result: AiGeneratedExamResult;
    try { result = await save(row.value.prepared!, canonicalRequestId); }
    catch (error) { await this.replace(key, savingVersion, { ...row.value, state: "READY" }); throw error; }
    await this.replace(key, savingVersion, { ...row.value, state: "COMPLETED", result });
    return result;
  }

  /** Tạo khóa duy nhất bằng database, chỉ coi unique conflict là request đã tồn tại. */
  private async claim(key: string, value: RecordValue): Promise<boolean> {
    if (!this.prisma?.isStartupConnectionEnabled()) {
      if (this.memory.has(key)) return false;
      this.memory.set(key, { version: 1, value: structuredClone(value) }); return true;
    }
    try { await this.prisma.systemSetting.create({ data: { key, value: value as unknown as object, updatedBy: value.owner } }); return true; }
    catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "P2002") return false; throw error; }
  }

  /** Đọc trạng thái đã lưu mà không phụ thuộc process đang xử lý request đầu tiên. */
  private async read(key: string): Promise<{ version: number; value: RecordValue } | undefined> {
    if (!this.prisma?.isStartupConnectionEnabled()) return structuredClone(this.memory.get(key));
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    return row ? { version: row.version, value: row.value as unknown as RecordValue } : undefined;
  }

  /** Chuyển trạng thái bằng compare-and-swap để chỉ một worker được tiếp tục. */
  private async replace(key: string, version: number, value: RecordValue): Promise<boolean> {
    if (!this.prisma?.isStartupConnectionEnabled()) {
      if (this.memory.get(key)?.version !== version) return false;
      this.memory.set(key, { version: version + 1, value: structuredClone(value) }); return true;
    }
    return (await this.prisma.systemSetting.updateMany({ where: { key, version }, data: { value: value as unknown as object, version: { increment: 1 } } })).count === 1;
  }
}
