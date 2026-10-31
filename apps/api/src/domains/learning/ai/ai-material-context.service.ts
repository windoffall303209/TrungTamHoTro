import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { LearningService } from "../core/learning.service.js";
import { AiProviderService } from "../../system/ai/ai-provider.service.js";
import { PrismaService } from "../../../database/prisma.service.js";
import { chunkDocument, type ContextChunk, retrieveDocumentContext } from "../../system/ai/ai-document-context.js";
import { selectStudyContext, validateStudyGuideOptions, type StudyGuideOptions } from "../../system/ai/ai-study-guide.js";
import { AiStudyDraftService, type SavedStudyGuide, type PublishStudyDraft } from "./ai-study-draft.service.js";
import type { LearningMaterial } from "../core/learning.types.js";
import { AiDocumentAnswerStore } from "./ai-document-answer-store.js";
import { AiDocumentExtractionStore } from "./ai-document-extraction-store.js";

@Injectable()
/** Trích xuất bản tài liệu được phép xem và cache theo bytes, phiên bản, provider/model. */
export class AiMaterialContextService {
  constructor(private readonly learning: LearningService, private readonly ai: AiProviderService, @Optional() prisma?: PrismaService, @Optional() private readonly drafts: AiStudyDraftService = new AiStudyDraftService(prisma), @Optional() private readonly answers: AiDocumentAnswerStore = new AiDocumentAnswerStore(prisma), @Optional() private readonly extractions: AiDocumentExtractionStore = new AiDocumentExtractionStore(prisma)) {}

  /** Chỉ đọc lịch sử riêng khi vẫn có quyền truy cập học liệu và phiên bản nguồn được yêu cầu. */
  async questionHistory(materialId: string, version: number, actorId: string, role: string, cursor?: string): ReturnType<AiDocumentAnswerStore["list"]> {
    if (!Number.isSafeInteger(version) || version < 1) throw new BadRequestException("Phiên bản tài liệu không hợp lệ.");
    await this.requireMaterial(materialId, actorId, role);
    await this.learning.createMaterialVersionAccess(materialId, version, role, "PREVIEW", actorId);
    const page = await this.answers.list({ ownerId: actorId, materialId, version }, cursor);
    await this.learning.createMaterialVersionAccess(materialId, version, role, "PREVIEW", actorId);
    return page;
  }

  /** Đọc trạng thái đã lưu mà không gọi nhà cung cấp; kiểm tra quyền nguồn trước và sau khi tra cứu. */
  async questionStatus(materialId: string, actorId: string, role: string, question: string, language: "VI" | "EN" | "BILINGUAL", sourceVersion?: number): ReturnType<AiDocumentAnswerStore["status"]> {
    const text = this.questionText(question, language);
    if (sourceVersion !== undefined && (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1 || sourceVersion > 2147483647)) throw new BadRequestException("Phiên bản tài liệu không hợp lệ.");
    const material = await this.requireMaterial(materialId, actorId, role);
    const version = sourceVersion ?? material.version;
    await this.learning.createMaterialVersionAccess(materialId, version, role, "PREVIEW", actorId);
    const status = await this.answers.status({ ownerId: actorId, materialId, version, question: text, language });
    await this.learning.createMaterialVersionAccess(materialId, version, role, "PREVIEW", actorId);
    return status;
  }

  /** Chuẩn hóa và kiểm tra định danh câu hỏi chung cho cả đường đọc và đường sinh nội dung. */
  private questionText(question: string, language: string): string {
    const text = typeof question === "string" ? question.trim() : "";
    if (text.length < 2 || text.length > 2000) throw new BadRequestException("Câu hỏi cần từ 2 đến 2.000 ký tự.");
    if (!["VI", "EN", "BILINGUAL"].includes(language)) throw new BadRequestException("Ngôn ngữ AI không hợp lệ.");
    return text;
  }

  /** Sinh hoặc trả lại câu trả lời đã lưu; kiểm tra lại quyền truy cập nguồn hiện tại trước khi trả kết quả. */
  async ask(materialId: string, actorId: string, role: string, question: string, language: "VI" | "EN" | "BILINGUAL"): Promise<Awaited<ReturnType<AiProviderService["answerDocument"]>> & { warning: string; version: number }> {
    const text = this.questionText(question, language);
    const material = await this.requireMaterial(materialId, actorId, role);
    await this.learning.createMaterialVersionAccess(materialId, material.version, role, "PREVIEW", actorId);
    const identity = { ownerId: actorId, materialId, version: material.version, question: text, language };
    const previous = await this.answers.status(identity);
    if (previous.state === "READY") {
      await this.learning.createMaterialVersionAccess(materialId, previous.result.version, role, "PREVIEW", actorId);
      return previous.result;
    }
    if (previous.state !== "NOT_REQUESTED") throw new ConflictException("Câu hỏi AI đang xử lý hoặc chưa rõ kết quả. Không gửi lại để tránh phí trùng; liên hệ quản trị viên đối soát.");
    // Hoàn tất bước OCR có quyền xử lý độc lập trước khi giữ quyền sinh câu trả lời.
    const context = await this.prepare(materialId, actorId, role, text, true, material.version);
    const result = await this.answers.generate(identity, async () => {
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
    const identity = { ownerId: actorId, materialId, sourceVersion, options };
    const previous = await this.drafts.find(identity);
    if (previous) {
      if (previous.state !== "READY" || !previous.result) throw new ConflictException("Bộ ôn tập đang xử lý hoặc bị gián đoạn. Hãy mở lịch sử bản nháp để kiểm tra, không tạo yêu cầu mới.");
      await this.learning.createMaterialVersionAccess(materialId, previous.result.version, role, "PREVIEW", actorId);
      return { ...previous.result, draftId: previous.id };
    }
    // Hoàn tất OCR và kiểm tra phạm vi trang đã chọn trước khi giữ quyền sinh bộ ôn tập có phí.
    const context = await this.prepare(materialId, actorId, role, undefined, true, sourceVersion);
    const selected = selectStudyContext(context.chunks, options);
    const result = await this.drafts.generate(identity, async () => {
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
    const { pages, cached } = await this.extractions.generate(key, actorId, () => this.ai.extractDocumentPages({ name: file.fileName, mimeType: file.mimeType, buffer: file.buffer }, selected));
    // Quyền có thể bị thu hồi hoặc tài liệu bị ẩn trong lúc chờ provider.
    await this.learning.createMaterialVersionAccess(material.id, material.version, role, "PREVIEW", actorId);
    const chunks = chunkDocument({ materialId, version: material.version, checksum, name: material.name }, pages);
    return { materialId, version: material.version, checksum, chunks: query ? retrieveDocumentContext(query, chunks) : chunks, cached, warning: "Nội dung được AI trích xuất, cần đối chiếu tài liệu gốc; số trang và độ chính xác chưa được xác minh độc lập." };
  }

  /** Xác nhận quyền hiện tại và trạng thái cách ly trước khi đọc cache hoặc metadata bản nháp. */
  private async requireMaterial(materialId: string, actorId: string, role: string): Promise<LearningMaterial> {
    // Lọc theo mã thay vì duyệt trang đầu: học viên thấy cả học liệu chung nên danh sách có thể vượt một trang.
    const material = (await this.learning.listMaterials(role, undefined, actorId, 1, materialId)).find((item) => item.id === materialId);
    if (!material || material.quarantinedAt) throw new NotFoundException("Không tìm thấy tài liệu được phép sử dụng cho AI.");
    return material;
  }

}
