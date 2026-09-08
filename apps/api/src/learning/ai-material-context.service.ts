import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { LearningService } from "./learning.service.js";
import { AiProviderService } from "../system/ai-provider.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { chunkDocument, type ContextChunk, type DocumentPage, retrieveDocumentContext } from "../system/ai-document-context.js";

@Injectable()
/** Trích xuất bản tài liệu được phép xem và cache theo bytes, phiên bản, provider/model. */
export class AiMaterialContextService {
  private readonly memory = new Map<string, DocumentPage[]>();
  private readonly pending = new Map<string, Promise<DocumentPage[]>>();
  constructor(private readonly learning: LearningService, private readonly ai: AiProviderService, @Optional() private readonly prisma?: PrismaService) {}

  /** Nạp ngữ cảnh server-side, trả lời có nguồn rồi xác nhận người hỏi vẫn được truy cập phiên bản đó. */
  async ask(materialId: string, actorId: string, role: string, question: string, language: "VI" | "EN" | "BILINGUAL"): Promise<Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number }> {
    const text = typeof question === "string" ? question.trim() : "";
    if (text.length < 2 || text.length > 2000) throw new BadRequestException("Câu hỏi cần từ 2 đến 2.000 ký tự.");
    if (!["VI", "EN", "BILINGUAL"].includes(language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
    const context = await this.prepare(materialId, actorId, role, text, true);
    const result = await this.ai.answerDocument(text, context.chunks, language);
    await this.learning.createMaterialVersionAccess(materialId, context.version, role, "PREVIEW", actorId);
    return { ...result, warning: context.warning, version: context.version };
  }

  /** Kiểm tra quyền mỗi lần, kể cả cache hit; không nhận object key hoặc nguồn ngoài từ client. */
  async prepare(materialId: string, actorId: string, role: string, query?: string, requireAnswerModel = false): Promise<{ materialId: string; version: number; checksum: string; chunks: ContextChunk[]; cached: boolean; warning: string }> {
    const material = (await this.learning.listMaterials(role, undefined, actorId)).find((item) => item.id === materialId);
    if (!material || material.quarantinedAt) throw new NotFoundException("Không tìm thấy tài liệu được phép sử dụng cho AI.");
    // Xác nhận đủ model trước khi trích xuất có phí, nhưng không tiết lộ cấu hình trước kiểm tra quyền.
    if (requireAnswerModel) await this.ai.resolveTask("DOCUMENT_QA");
    const access = await this.learning.createMaterialVersionAccess(material.id, material.version, role, "PREVIEW", actorId);
    const url = new URL(access.url, "http://internal.invalid");
    const file = await this.learning.readMaterialVersionDownload(material.id, material.version, Number(url.searchParams.get("expires")), url.searchParams.get("signature") ?? "", role, "PREVIEW", actorId);
    const selected = await this.ai.resolveTask("DOCUMENT_CONTEXT");
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const key = `ai-doc:${createHash("sha256").update(JSON.stringify(["v1", material.id, material.version, checksum, selected])).digest("hex")}`;
    const database = this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined;
    const stored = database ? (await database.systemSetting.findUnique({ where: { key } }))?.value as DocumentPage[] | undefined : this.memory.get(key);
    const cached = Boolean(stored);
    let pages = stored;
    if (!pages) {
      let job = this.pending.get(key);
      if (!job) {
        job = this.extractAndSave(key, { name: file.fileName, mimeType: file.mimeType, buffer: file.buffer }, selected, actorId);
        this.pending.set(key, job);
      }
      try { pages = await job; } finally { if (this.pending.get(key) === job) this.pending.delete(key); }
    }
    // Quyền có thể bị thu hồi hoặc tài liệu bị ẩn trong lúc chờ provider.
    await this.learning.createMaterialVersionAccess(material.id, material.version, role, "PREVIEW", actorId);
    const chunks = chunkDocument({ materialId, version: material.version, checksum, name: material.name }, pages);
    return { materialId, version: material.version, checksum, chunks: query ? retrieveDocumentContext(query, chunks) : chunks, cached, warning: "Nội dung được AI trích xuất, cần đối chiếu tài liệu gốc; số trang và độ chính xác chưa được xác minh độc lập." };
  }

  /** Chỉ lưu khi provider trả đủ dữ liệu; lỗi không trở thành cache rỗng. */
  private async extractAndSave(key: string, file: { name: string; mimeType: string; buffer: Buffer }, selected: Awaited<ReturnType<AiProviderService["resolveTask"]>>, actorId: string): Promise<DocumentPage[]> {
    const pages = await this.ai.extractDocumentPages(file, selected);
    if (this.prisma?.isStartupConnectionEnabled()) await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value: pages, updatedBy: actorId }, update: { value: pages, updatedBy: actorId, version: { increment: 1 } } });
    else this.memory.set(key, structuredClone(pages));
    return pages;
  }
}
