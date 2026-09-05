import { BadRequestException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type { Environment } from "../config/environment.js";
import { PrismaService } from "../database/prisma.service.js";
import { decryptSecret, encryptSecret } from "../infrastructure/secret-vault.js";

export type AiProviderType = "GEMINI" | "NVIDIA_NIM" | "OPENAI" | "CUSTOM";
export type AiProviderHealth = "UNKNOWN" | "HEALTHY" | "ERROR";

export interface AiProviderConfig {
  id: string;
  provider: AiProviderType;
  name: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  isDefault: boolean;
  healthStatus: AiProviderHealth;
  hasApiKey: boolean;
  maskedApiKey: string;
  lastCheckedAt?: string;
  updatedAt: string;
}

interface StoredAiProvider extends Omit<AiProviderConfig, "hasApiKey" | "maskedApiKey"> {
  encryptedApiKey: string;
  apiKeySuffix: string;
}

export interface ScannedQuestionDraft {
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY";
  content: string;
  options: string[];
  correctAnswers: string[];
  difficulty: 1 | 2 | 3;
  tags: string[];
  confidence: number;
  warnings: string[];
}

export interface QuestionScanResult {
  providerId: string;
  provider: AiProviderType;
  model: string;
  sourceName: string;
  questions: ScannedQuestionDraft[];
  warnings: string[];
}

const providerCatalog: Record<Exclude<AiProviderType, "CUSTOM">, Array<{ value: string; label: string; description: string }>> = {
  GEMINI: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Mặc định · nhanh, hỗ trợ ảnh và JSON có cấu trúc." },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Suy luận sâu cho đề phức tạp." },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", description: "Chi phí thấp cho ảnh rõ, bố cục đơn giản." },
  ],
  NVIDIA_NIM: [
    { value: "meta/llama-3.2-90b-vision-instruct", label: "Llama 3.2 90B Vision", description: "Mô hình thị giác qua NVIDIA NIM." },
    { value: "nvidia/nemotron-nano-12b-v2-vl", label: "Nemotron Nano 12B VL", description: "Nhẹ hơn cho OCR và hiểu tài liệu." },
  ],
  OPENAI: [
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "Nhanh, hỗ trợ ảnh và đầu ra có cấu trúc." },
    { value: "gpt-5.4", label: "GPT-5.4", description: "Chất lượng cao cho đề nhiều tầng thông tin." },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini", description: "Lựa chọn tương thích, chi phí cân bằng." },
  ],
};

const defaults: Record<Exclude<AiProviderType, "CUSTOM">, { name: string; model: string; baseUrl: string }> = {
  GEMINI: { name: "Google Gemini", model: "gemini-2.5-flash", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  NVIDIA_NIM: { name: "NVIDIA NIM", model: "meta/llama-3.2-90b-vision-instruct", baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions" },
  OPENAI: { name: "OpenAI", model: "gpt-5.4-mini", baseUrl: "https://api.openai.com/v1/chat/completions" },
};

@Injectable()
/** Quản lý cấu hình AI đã mã hóa và điều phối scan ảnh qua Gemini, NVIDIA NIM, OpenAI hoặc endpoint custom. */
export class AiProviderService {
  private readonly memory = new Map<string, StoredAiProvider>();

  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
  ) {}

  /** Trả bản sao catalog để caller không thể sửa cấu hình model mặc định trong bộ nhớ. */
  getCatalog(): typeof providerCatalog { return structuredClone(providerCatalog); }

  /** Hợp nhất provider built-in và custom đã lưu, chỉ trả trạng thái có key chứ không lộ key. */
  async list(): Promise<AiProviderConfig[]> {
    const stored = await this.readAll();
    const resolved = (["GEMINI", "NVIDIA_NIM", "OPENAI"] as const).map((provider) => {
      const existing = stored.find((item) => item.provider === provider);
      return existing ?? this.emptyBuiltIn(provider);
    });
    resolved.push(...stored.filter((item) => item.provider === "CUSTOM"));
    return resolved.map((item) => this.publicView(item));
  }

  /** Validate model/URL, mã hóa API key mới, xử lý default duy nhất rồi lưu cấu hình và audit. */
  async configure(input: { id?: string; provider: AiProviderType; name?: string; model: string; baseUrl?: string; apiKey?: string; enabled?: boolean; isDefault?: boolean }, actorId: string): Promise<AiProviderConfig> {
    const current = input.id ? await this.findStored(input.id) : (await this.readAll()).find((item) => item.provider === input.provider && input.provider !== "CUSTOM");
    const model = input.model.trim();
    if (!model) throw new BadRequestException("Cần chọn hoặc nhập model AI.");
    if (input.provider !== "CUSTOM" && !providerCatalog[input.provider].some((item) => item.value === model)) throw new BadRequestException("Model không thuộc danh sách được hỗ trợ của nhà cung cấp.");
    const apiKey = input.apiKey?.trim();
    if (!current?.encryptedApiKey && !apiKey) throw new BadRequestException("Cần nhập API key cho nhà cung cấp.");
    const builtIn = input.provider === "CUSTOM" ? undefined : defaults[input.provider];
    const baseUrl = input.provider === "CUSTOM" ? this.validateCustomUrl(input.baseUrl) : builtIn?.baseUrl;
    const now = new Date().toISOString();
    const stored: StoredAiProvider = {
      id: current?.id ?? (input.provider === "CUSTOM" ? `ai-custom-${randomUUID()}` : `ai-${input.provider.toLowerCase()}`),
      provider: input.provider,
      name: input.provider === "CUSTOM" ? input.name?.trim() || "AI tùy chỉnh" : builtIn!.name,
      model,
      baseUrl,
      enabled: input.enabled ?? current?.enabled ?? true,
      isDefault: input.isDefault ?? current?.isDefault ?? false,
      healthStatus: apiKey ? "UNKNOWN" : current?.healthStatus ?? "UNKNOWN",
      encryptedApiKey: apiKey ? encryptSecret(apiKey, this.encryptionSecret()) : current!.encryptedApiKey,
      apiKeySuffix: apiKey ? apiKey.slice(-4) : current!.apiKeySuffix,
      lastCheckedAt: apiKey ? undefined : current?.lastCheckedAt,
      updatedAt: now,
    };
    await this.persist(stored, actorId);
    if (stored.isDefault) await this.clearOtherDefaults(stored.id, actorId);
    return this.publicView(stored);
  }

  /** Xóa cấu hình provider tùy chỉnh và secret; provider built-in được đặt lại rỗng. */
  async remove(id: string): Promise<void> {
    const current = await this.findStored(id);
    if (!current) throw new NotFoundException("Không tìm thấy cấu hình AI.");
    const prisma = this.database();
    if (prisma) await prisma.systemSetting.delete({ where: { key: this.key(id) } });
    else this.memory.delete(id);
  }

  /** Gọi request kiểm tra nhỏ, cập nhật health state và không đưa lỗi chứa secret ra phản hồi. */
  async test(id: string, actorId: string): Promise<AiProviderConfig> {
    const current = await this.requireReady(id, false);
    try {
      await this.invoke(current, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64"), "image/png", "kiem-tra.png", true);
      current.healthStatus = "HEALTHY";
    } catch (error) {
      current.healthStatus = "ERROR";
      await this.persist({ ...current, lastCheckedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, actorId);
      throw error;
    }
    current.lastCheckedAt = new Date().toISOString();
    current.updatedAt = current.lastCheckedAt;
    await this.persist(current, actorId);
    return this.publicView(current);
  }

  /** Chọn provider sẵn sàng, gửi ảnh và chuẩn hóa JSON trả về thành bản nháp câu hỏi. */
  async scanImage(input: { providerId?: string; fileName: string; mimeType: string; buffer: Buffer }): Promise<QuestionScanResult> {
    if (!(["image/png", "image/jpeg", "image/webp"] as string[]).includes(input.mimeType)) throw new BadRequestException("Chỉ hỗ trợ ảnh PNG, JPEG hoặc WebP.");
    if (!input.buffer.length || input.buffer.length > 12 * 1024 * 1024) throw new BadRequestException("Ảnh quét phải có dung lượng từ 1 byte đến 12 MB.");
    const provider = input.providerId ? await this.requireReady(input.providerId, true) : await this.defaultProvider();
    const raw = await this.invoke(provider, input.buffer, input.mimeType, input.fileName, false);
    const questions = this.normalizeQuestions(raw);
    if (!questions.length) throw new BadRequestException("AI không nhận diện được câu hỏi nào. Hãy dùng ảnh rõ hơn hoặc đổi model.");
    return { providerId: provider.id, provider: provider.provider, model: provider.model, sourceName: input.fileName, questions, warnings: questions.some((item) => item.confidence < 0.7) ? ["Một số câu có độ tin cậy thấp và cần được kiểm tra kỹ trước khi lưu."] : [] };
  }

  /** Giải mã key trong bộ nhớ và dispatch request theo giao thức riêng của từng provider. */
  private async invoke(provider: StoredAiProvider, buffer: Buffer, mimeType: string, fileName: string, healthOnly: boolean): Promise<unknown> {
    const prompt = healthOnly ? "Trả về JSON đúng dạng {\"questions\":[]} và không thêm văn bản." : `Đọc toàn bộ ảnh đề thi ${fileName}. Trích xuất mọi câu hỏi theo đúng thứ tự. Giữ chữ đậm bằng Markdown **...**, chữ nghiêng bằng *...*, đổi mọi công thức toán sang LaTeX ($...$ hoặc $$...$$). Không tự bịa đáp án; nếu ảnh không có đáp án thì để correctAnswers rỗng và thêm cảnh báo. Trả về duy nhất JSON: {"questions":[{"type":"SINGLE_CHOICE|MULTIPLE_CHOICE|TRUE_FALSE|SHORT_ANSWER|ESSAY","content":"...","options":["..."],"correctAnswers":["..."],"difficulty":1,"tags":["..."],"confidence":0.0,"warnings":["..."]}]}.`;
    const apiKey = decryptSecret(provider.encryptedApiKey, this.encryptionSecret());
    const response = provider.provider === "GEMINI"
      ? await fetch(`${provider.baseUrl}/models/${encodeURIComponent(provider.model)}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }), signal: AbortSignal.timeout(60_000) })
      : await fetch(provider.baseUrl!, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: provider.model, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } }] }] }), signal: AbortSignal.timeout(60_000) });
    const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok) throw new ServiceUnavailableException(`Nhà cung cấp AI từ chối yêu cầu (${response.status}). Kiểm tra API key, model và hạn mức.`);
    if (provider.provider === "GEMINI") return this.parseJson(((payload?.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content?.parts?.[0]?.text));
    return this.parseJson(((payload?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content));
  }

  /** Trích JSON từ phản hồi thuần hoặc code fence Markdown và báo lỗi định dạng rõ ràng. */
  private parseJson(value: unknown): unknown {
    if (typeof value !== "string") throw new ServiceUnavailableException("Nhà cung cấp AI không trả về nội dung hợp lệ.");
    try { return JSON.parse(value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
    catch { throw new ServiceUnavailableException("Không đọc được JSON do nhà cung cấp AI trả về."); }
  }

  /** Thu hẹp dữ liệu AI không tin cậy thành câu hỏi, options, đáp án và độ khó hợp lệ. */
  private normalizeQuestions(raw: unknown): ScannedQuestionDraft[] {
    const values = typeof raw === "object" && raw !== null && Array.isArray((raw as { questions?: unknown }).questions) ? (raw as { questions: unknown[] }).questions : [];
    const types = new Set(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"]);
    return values.slice(0, 100).flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const item = value as Record<string, unknown>;
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if (content.length < 5) return [];
      const type = types.has(String(item.type)) ? String(item.type) as ScannedQuestionDraft["type"] : "SHORT_ANSWER";
      const options = Array.isArray(item.options) ? item.options.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 20) : [];
      const correctAnswers = Array.isArray(item.correctAnswers) ? item.correctAnswers.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 20) : [];
      const warnings = Array.isArray(item.warnings) ? item.warnings.filter((entry): entry is string => typeof entry === "string").slice(0, 10) : [];
      if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE"].includes(type) && options.length < 2) warnings.push("Chưa nhận diện đủ lựa chọn trả lời.");
      if (!correctAnswers.length) warnings.push("Ảnh không cung cấp hoặc AI chưa xác định được đáp án đúng.");
      return [{ type, content, options, correctAnswers, difficulty: [1, 2, 3].includes(Number(item.difficulty)) ? Number(item.difficulty) as 1 | 2 | 3 : 2, tags: Array.isArray(item.tags) ? item.tags.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 20) : [], confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0.5)), warnings: [...new Set(warnings)] }];
    });
  }

  /** Chọn provider mặc định đang bật/có key hoặc provider sẵn sàng đầu tiên. */
  private async defaultProvider(): Promise<StoredAiProvider> {
    const providers = await this.readAll();
    const provider = providers.find((item) => item.enabled && item.isDefault) ?? providers.find((item) => item.enabled);
    if (!provider) throw new BadRequestException("Chưa có nhà cung cấp AI đang bật. Hãy cấu hình trong Quản trị hệ thống.");
    return provider;
  }

  /** Tải provider và bắt buộc có API key, đồng thời kiểm tra enabled khi được yêu cầu. */
  private async requireReady(id: string, requireEnabled: boolean): Promise<StoredAiProvider> {
    const provider = await this.findStored(id);
    if (!provider) throw new NotFoundException("Không tìm thấy cấu hình AI.");
    if (requireEnabled && !provider.enabled) throw new BadRequestException("Nhà cung cấp AI đang bị tắt.");
    return provider;
  }

  /** Tạo cấu hình mặc định chưa có secret cho provider tích hợp sẵn. */
  private emptyBuiltIn(provider: Exclude<AiProviderType, "CUSTOM">): StoredAiProvider {
    return { id: `ai-${provider.toLowerCase()}`, provider, ...defaults[provider], enabled: false, isDefault: false, healthStatus: "UNKNOWN", encryptedApiKey: "", apiKeySuffix: "", updatedAt: new Date(0).toISOString() };
  }

  /** Loại ciphertext khỏi cấu hình trước khi trả qua API. */
  private publicView(item: StoredAiProvider): AiProviderConfig {
    const { encryptedApiKey, apiKeySuffix, ...safe } = item;
    return { ...safe, hasApiKey: Boolean(encryptedApiKey), maskedApiKey: encryptedApiKey ? `••••••••${apiKeySuffix}` : "Chưa cấu hình" };
  }

  /** Tạo khóa namespace ổn định cho SecretVault. */
  private key(id: string): string { return `ai-provider:${id}`; }
  /** Đọc mọi secret trong namespace AI và giải mã cấu hình JSON hợp lệ. */
  private async readAll(): Promise<StoredAiProvider[]> {
    const prisma = this.database();
    if (prisma) {
      const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: "ai-provider:" } }, orderBy: { updatedAt: "desc" } });
      return rows.map((row) => row.value as unknown as StoredAiProvider);
    }
    return [...this.memory.values()].map((item) => structuredClone(item));
  }
  /** Tìm cấu hình đã lưu theo id sau khi giải mã vault. */
  private async findStored(id: string): Promise<StoredAiProvider | undefined> { return (await this.readAll()).find((item) => item.id === id); }
  /** Mã hóa toàn bộ cấu hình provider và ghi audit không chứa API key. */
  private async persist(item: StoredAiProvider, actorId: string): Promise<void> {
    const prisma = this.database();
    if (prisma) await prisma.systemSetting.upsert({ where: { key: this.key(item.id) }, update: { value: item as unknown as object, version: { increment: 1 }, effectiveAt: new Date(), updatedBy: actorId }, create: { key: this.key(item.id), value: item as unknown as object, updatedBy: actorId } });
    else this.memory.set(item.id, structuredClone(item));
  }
  /** Bỏ cờ mặc định ở provider khác để duy trì invariant một default. */
  private async clearOtherDefaults(id: string, actorId: string): Promise<void> {
    for (const item of await this.readAll()) if (item.id !== id && item.isDefault) await this.persist({ ...item, isDefault: false, updatedAt: new Date().toISOString() }, actorId);
  }
  /** Chỉ cho endpoint custom HTTP(S), chặn URL thiếu hoặc không hợp lệ. */
  private validateCustomUrl(value?: string): string {
    if (!value?.trim()) throw new BadRequestException("Nhà cung cấp tùy chỉnh cần endpoint chat completions.");
    let parsed: URL;
    try { parsed = new URL(value.trim()); } catch { throw new BadRequestException("Endpoint tùy chỉnh không hợp lệ."); }
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new BadRequestException("Endpoint tùy chỉnh phải dùng HTTPS; chỉ localhost được dùng HTTP.");
    return parsed.toString();
  }
  /** Lấy khóa mã hóa vault; fallback chỉ phục vụ chế độ phát triển không DI config. */
  private encryptionSecret(): string { return this.config?.get("AUTH_ENCRYPTION_SECRET", { infer: true }) ?? "development-auth-encryption-key-change-me"; }
  /** Chọn Prisma khi DB được cấu hình, nếu không dùng vault in-memory. */
  private database(): PrismaService | undefined { return this.prisma?.isStartupConnectionEnabled() ? this.prisma : undefined; }
}
