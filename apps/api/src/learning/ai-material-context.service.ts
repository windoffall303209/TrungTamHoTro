import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { LearningService } from "./learning.service.js";
import { AiProviderService } from "../system/ai-provider.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { chunkDocument, type ContextChunk, type DocumentPage, retrieveDocumentContext } from "../system/ai-document-context.js";
import { selectStudyContext, validateStudyGuideOptions, type StudyGuideOptions } from "../system/ai-study-guide.js";
import { AiStudyDraftService, type SavedStudyGuide, type PublishStudyDraft } from "./ai-study-draft.service.js";
import type { LearningMaterial } from "./learning.types.js";
import { AiDocumentAnswerStore } from "./ai-document-answer-store.js";

@Injectable()
/** Trích xuất bản tài liệu được phép xem và cache theo bytes, phiên bản, provider/model. */
export class AiMaterialContextService {
  private readonly memory = new Map<string, DocumentPage[]>();
  private readonly pending = new Map<string, Promise<DocumentPage[]>>();
  constructor(private readonly learning: LearningService, private readonly ai: AiProviderService, @Optional() private readonly prisma?: PrismaService, @Optional() private readonly drafts: AiStudyDraftService = new AiStudyDraftService(prisma), @Optional() private readonly answers: AiDocumentAnswerStore = new AiDocumentAnswerStore(prisma)) {}

  /** Nạp ngữ cảnh server-side, trả lời có nguồn rồi xác nhận người hỏi vẫn được truy cập phiên bản đó. */
  async ask(materialId: string, actorId: string, role: string, question: string, language: "VI" | "EN" | "BILINGUAL"): Promise<Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number }> {
    const text = typeof question === "string" ? question.trim() : "";
    if (text.length < 2 || text.length > 2000) throw new BadRequestException("Câu hỏi cần từ 2 đến 2.000 ký tự.");
    if (!["VI", "EN", "BILINGUAL"].includes(language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
    const material = await this.requireMaterial(materialId, actorId, role);
    await this.learning.createMaterialVersionAccess(materialId, material.version, role, "PREVIEW", actorId);
    const result = await this.answers.generate({ ownerId: actorId, materialId, version: material.version, question: text, language }, async () => {
      const context = await this.prepare(materialId, actorId, role, text, true, material.version);
      const answer = await this.ai.answerDocument(text, context.chunks, language);
      return { ...answer, warning: context.warning, version: context.version };
    });
    await this.learning.createMaterialVersionAccess(materialId, result.version, role, "PREVIEW", actorId);
    return result;
  }

  /** Tạo bộ ôn tập có độ bao phủ rõ ràng; kiểm tra quyền lần cuối trước khi trả nội dung. */
  async study(materialId: string, actorId: string, role: string, options: StudyGuideOptions): Promise<SavedStudyGuide & { draftId: string }> {
    validateStudyGuideOptions(options);
    const material = await this.requireMaterial(materialId, actorId, role);
    const sourceVersion = material.version;
    await this.ai.resolveTask("DOCUMENT_QA");
    await this.ai.resolveTask("DOCUMENT_CONTEXT");
    const result = await this.drafts.generate({ ownerId: actorId, materialId, sourceVersion, options }, async () => {
      const context = await this.prepare(materialId, actorId, role, undefined, true, sourceVersion);
      const selected = selectStudyContext(context.chunks, options);
      const guide = await this.ai.createStudyGuide(selected.chunks, options);
      return { ...guide, coverage: selected.coverage, version: context.version, warning: context.warning };
    });
    await this.learning.createMaterialVersionAccess(materialId, result.version, role, "PREVIEW", actorId);
    return result;
  }

  /** Đọc lịch sử bản nháp riêng, không gọi provider hoặc trích xuất lại tài liệu. */
  async listStudyDrafts(materialId: string, actorId: string, role: string, cursor?: string): ReturnType<AiStudyDraftService["list"]> {
    await this.requireMaterial(materialId, actorId, role);
    return this.drafts.list(actorId, materialId, cursor);
  }

  /** Mở bản đã lưu chỉ khi người tạo vẫn được xem đúng phiên bản nguồn. */
  async getStudyDraft(materialId: string, draftId: string, actorId: string, role: string): ReturnType<AiStudyDraftService["get"]> {
    await this.requireMaterial(materialId, actorId, role);
    const draft = await this.drafts.get(draftId, actorId, materialId);
    await this.learning.createMaterialVersionAccess(materialId, draft.sourceVersion, role, "PREVIEW", actorId);
    return draft;
  }

  /** Chỉnh sửa chỉ sau khi xác nhận chủ bản nháp và quyền với đúng phiên bản học liệu. */
  async editStudyDraft(materialId: string, draftId: string, actorId: string, role: string, input: unknown): ReturnType<AiStudyDraftService["edit"]> {
    await this.getStudyDraft(materialId, draftId, actorId, role);
    return this.drafts.edit(draftId, actorId, materialId, input);
  }

  /** Chỉ phát hành bản đã duyệt từ phiên bản hiện tại của học liệu đang công khai cho lớp. */
  async publishStudyDraft(materialId: string, draftId: string, actorId: string, role: string, input: PublishStudyDraft): ReturnType<AiStudyDraftService["publish"]> {
    const material = await this.requireMaterial(materialId, actorId, role);
    const draft = await this.getStudyDraft(materialId, draftId, actorId, role);
    if (material.visibility !== "PUBLISHED" || material.version !== draft.sourceVersion) throw new ConflictException("Cần phát hành phiên bản học liệu hiện tại trước khi phát hành bộ ôn tập tương ứng.");
    return this.drafts.publish(draftId, actorId, materialId, input);
  }

  /** Chủ bản nháp có thể thu hồi ngay cả khi học liệu đã ẩn hoặc phiên bản nguồn không còn tải được. */
  async unpublishStudyDraft(materialId: string, draftId: string, actorId: string, role: string, revision: number): ReturnType<AiStudyDraftService["unpublish"]> {
    await this.requireMaterial(materialId, actorId, role);
    return this.drafts.unpublish(draftId, actorId, materialId, revision);
  }

  /** Lọc từng phiên bản nguồn trước khi trả metadata, giữ cursor để đi tiếp qua trang có nguồn bị ẩn. */
  async listPublishedStudyDrafts(materialId: string, actorId: string, role: string, cursor?: string): ReturnType<AiStudyDraftService["listPublished"]> {
    const material = await this.requireMaterial(materialId, actorId, role);
    if (material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy bộ ôn tập đã phát hành.");
    const page = await this.drafts.listPublished(materialId, cursor);
    const allowed = new Set<number>();
    await Promise.all([...new Set(page.items.map((item) => item.sourceVersion))].map(async (version) => {
      try { await this.learning.createMaterialVersionAccess(materialId, version, role, "PREVIEW", actorId); allowed.add(version); }
      catch (error) { if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error; }
    }));
    return { ...page, items: page.items.filter((item) => allowed.has(item.sourceVersion)) };
  }

  /** Học viên chỉ nhận snapshot đã phát hành khi còn quyền theo lớp và đúng phiên bản nguồn. */
  async getPublishedStudyDraft(materialId: string, draftId: string, actorId: string, role: string): ReturnType<AiStudyDraftService["getPublished"]> {
    const material = await this.requireMaterial(materialId, actorId, role);
    if (material.visibility !== "PUBLISHED") throw new NotFoundException("Không tìm thấy bộ ôn tập đã phát hành.");
    const published = await this.drafts.getPublished(draftId, materialId);
    await this.learning.createMaterialVersionAccess(materialId, published.sourceVersion, role, "PREVIEW", actorId);
    return published;
  }

  /** Kiểm tra quyền mỗi lần, kể cả cache hit; không nhận object key hoặc nguồn ngoài từ client. */
  async prepare(materialId: string, actorId: string, role: string, query?: string, requireAnswerModel = false, expectedVersion?: number): Promise<{ materialId: string; version: number; checksum: string; chunks: ContextChunk[]; cached: boolean; warning: string }> {
    const material = await this.requireMaterial(materialId, actorId, role);
    if (expectedVersion !== undefined && material.version !== expectedVersion) throw new ConflictException("Phiên bản tài liệu đã thay đổi. Hãy tải lại tài liệu trước khi tạo bộ ôn tập.");
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

  /** Xác nhận quyền hiện tại và trạng thái cách ly trước khi đọc cache hoặc metadata bản nháp. */
  private async requireMaterial(materialId: string, actorId: string, role: string): Promise<LearningMaterial> {
    const material = (await this.learning.listMaterials(role, undefined, actorId)).find((item) => item.id === materialId);
    if (!material || material.quarantinedAt) throw new NotFoundException("Không tìm thấy tài liệu được phép sử dụng cho AI.");
    return material;
  }

  /** Chỉ lưu khi provider trả đủ dữ liệu; lỗi không trở thành cache rỗng. */
  private async extractAndSave(key: string, file: { name: string; mimeType: string; buffer: Buffer }, selected: Awaited<ReturnType<AiProviderService["resolveTask"]>>, actorId: string): Promise<DocumentPage[]> {
    const pages = await this.ai.extractDocumentPages(file, selected);
    if (this.prisma?.isStartupConnectionEnabled()) await this.prisma.systemSetting.upsert({ where: { key }, create: { key, value: pages, updatedBy: actorId }, update: { value: pages, updatedBy: actorId, version: { increment: 1 } } });
    else this.memory.set(key, structuredClone(pages));
    return pages;
  }
}
