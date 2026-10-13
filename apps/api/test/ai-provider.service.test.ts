import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Environment } from "../src/config/environment.js";
import { AiProviderService } from "../src/system/ai-provider.service.js";
import { decryptSecret, encryptSecret } from "../src/infrastructure/secret-vault.js";
import { chunkDocument } from "../src/system/ai-document-context.js";

const encryptionSecret = "test-encryption-secret-at-least-32-characters";
const config = { get: (key: string) => key === "AUTH_ENCRYPTION_SECRET" ? encryptionSecret : undefined } as unknown as ConfigService<Environment, true>;

/** Đọc JSON body từ một fetch mock và thất bại rõ ràng nếu test gọi sai payload. */
function readJsonBody(call: unknown[] | undefined): Record<string, unknown> {
  const options = call?.[1];
  const body = typeof options === "object" && options !== null && "body" in options ? options.body : undefined;
  if (typeof body !== "string") throw new Error("Fetch mock không nhận được JSON body dạng chuỗi.");
  return JSON.parse(body) as Record<string, unknown>;
}

/** Đọc RequestInit từ fetch mock để test header mà không dựa vào giá trị any của mock framework. */
function readFetchOptions(call: unknown[] | undefined): RequestInit {
  const options = call?.[1];
  if (!options || typeof options !== "object") throw new Error("Fetch mock không nhận được RequestInit.");
  return options as RequestInit;
}

/** Trả danh sách content đầu tiên trong payload Responses đã được kiểm tra kiểu. */
function readResponseInputContent(payload: Record<string, unknown>): unknown[] {
  const input = Array.isArray(payload.input) ? payload.input as unknown[] : [];
  const first: unknown = input[0];
  if (typeof first !== "object" || first === null) return [];
  const content = (first as Record<string, unknown>).content;
  return Array.isArray(content) ? content as unknown[] : [];
}

describe("AI provider configuration and image scanning", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["GEMINI", "OPENAI", "NVIDIA_NIM", "CUSTOM"] as const)("uses separate admin grading routing for %s without tools or grade writes", async (providerType) => {
    const service = new AiProviderService(undefined, config);
    const model = providerType === "CUSTOM" ? "grading-model" : service.getCatalog()[providerType][0]!.value;
    const provider = await service.configure({ provider: providerType, model, baseUrl: "https://router.example/v1/chat/completions", apiKey: "test-grading-secret", enabled: true }, "usr-admin");
    const input = { instructions: "Explain HTTP.", answer: "HTTP is an application-layer protocol.", language: "BILINGUAL", rubric: [{ id: "r1", title: "Accuracy", description: "Correct layer.", maxPoints: 5 }] };
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(service.suggestGrading(input)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    await service.configureTask("GRADING_ASSIST", { providerId: provider.id, model }, "usr-admin");
    const output = JSON.stringify({ insufficientEvidence: false, feedback: "Correct layer.", criteria: [{ criterionId: "r1", suggestedPoints: 5, reasoning: "Names the application layer.", evidence: [input.answer] }] });
    fetchMock.mockResolvedValue(new Response(JSON.stringify(providerType === "GEMINI" ? { candidates: [{ content: { parts: [{ text: output }] } }] } : { choices: [{ message: { content: output } }] })));
    expect(await service.suggestGrading(input)).toMatchObject({ suggestedTotal: 5, requiresHumanReview: true, model });
    const body = readJsonBody(fetchMock.mock.calls[0]);
    expect(body).not.toHaveProperty("tools");
    expect(JSON.stringify(body)).toContain("untrusted DATA");
    expect(JSON.stringify(body)).toContain("never a final grade");
    expect(JSON.stringify(body)).toContain("Vietnamese followed by English");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["GEMINI", "OPENAI", "NVIDIA_NIM", "CUSTOM"] as const)("generates cited study guides through the admin-selected %s provider", async (providerType) => {
    const service = new AiProviderService(undefined, config);
    const model = providerType === "CUSTOM" ? "study-model" : service.getCatalog()[providerType][0]!.value;
    const provider = await service.configure({ provider: providerType, model, baseUrl: "https://router.example/v1/chat/completions", apiKey: "study-provider-test-secret", enabled: true }, "usr-admin");
    await service.configureTask("DOCUMENT_QA", { providerId: provider.id, model }, "usr-admin");
    const chunks = chunkDocument({ materialId: "m", version: 3, checksum: "checked", name: "HTTP.pdf" }, [{ page: 1, text: "HTTP transfers representations. It is an application-layer protocol." }]);
    const guide = { insufficientContext: false, summary: [{ text: "HTTP transfers representations.", citationIds: [chunks[0]!.id] }], flashcards: [{ front: "At which layer does HTTP operate?", back: "Application layer.", citationIds: [chunks[0]!.id] }] };
    const output = JSON.stringify(guide);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(providerType === "GEMINI" ? { candidates: [{ content: { parts: [{ text: output }] } }] } : { choices: [{ message: { content: output } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service.createStudyGuide(chunks, { cardCount: 1, language: "BILINGUAL" });
    expect(result.model).toBe(model);
    expect(result.flashcards[0]?.citations).toEqual(chunks);
    const body = readJsonBody(fetchMock.mock.calls[0]);
    expect(JSON.stringify(body)).toContain("Vietnamese followed by English in every field");
    expect(JSON.stringify(body)).toContain("untrusted DATA");
    expect(body).not.toHaveProperty("tools");
    if (providerType !== "GEMINI") {
      expect(body).toMatchObject({ model, stream: false });
      expect(body).not.toHaveProperty("response_format");
      expect(JSON.stringify(body)).not.toContain("image_url");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not invoke study providers without source or with an invalid count", async () => {
    const service = new AiProviderService(undefined, config);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await service.createStudyGuide([], { cardCount: 5, language: "EN" })).toMatchObject({ insufficientContext: true, summary: [], flashcards: [] });
    await expect(service.createStudyGuide([], { cardCount: 21, language: "VI" })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers through Custom using supplied citations and rejects invented source IDs", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "CUSTOM", name: "Text AI", model: "text-model", baseUrl: "https://router.example/v1/chat/completions", apiKey: "qa-provider-secret", enabled: true }, "usr-admin");
    await service.configureTask("DOCUMENT_QA", { providerId: provider.id, model: "text-model" }, "usr-admin");
    const chunks = chunkDocument({ materialId: "material-1", version: 2, checksum: "verified", name: "HTTP.pdf" }, [{ page: 1, text: "HTTP transfers representations between clients and servers." }]);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "HTTP transfers representations.", insufficientContext: false, citationIds: [chunks[0]!.id] }) } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: "Invented answer", insufficientContext: false, citationIds: ["another-material"] }) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service.answerDocument("What is HTTP?", chunks, "EN");
    expect(result.citations).toEqual(chunks);
    expect(result.answer).toBe("HTTP transfers representations.");
    const body = JSON.stringify(readJsonBody(fetchMock.mock.calls[0]));
    expect(body).toContain("untrusted DATA");
    expect(body).toContain("English");
    expect(readJsonBody(fetchMock.mock.calls[0])).not.toHaveProperty("tools");
    await expect(service.answerDocument("What is HTTP?", chunks)).rejects.toThrow("ngoài ngữ cảnh");
  });

  it("does not call a model without relevant context or expose unsupported answers", async () => {
    const service = new AiProviderService(undefined, config);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await service.answerDocument("Unrelated question", [], "EN")).insufficientContext).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "qa-provider-secret", enabled: true }, "usr-admin");
    await service.configureTask("DOCUMENT_QA", { providerId: provider.id, model: provider.model }, "usr-admin");
    const chunks = chunkDocument({ materialId: "m", version: 1, checksum: "hash", name: "notes" }, [{ page: 1, text: "A short source." }]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: "Unsupported claim must not be shown", insufficientContext: true, citationIds: [] }) }] } }] })));
    const result = await service.answerDocument("Missing details?", chunks);
    expect(result.insufficientContext).toBe(true);
    expect(result.answer).not.toContain("Unsupported claim");
    expect(result.citations).toEqual([]);
  });

  it("extracts pages with configured model and rejects partial or malformed documents", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "extract-test-secret", enabled: true }, "usr-admin");
    const selected = await service.configureTask("DOCUMENT_CONTEXT", { providerId: provider.id, model: "gemini-2.5-pro" }, "usr-admin");
    const file = { name: "source.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") };
    for (const content of [{ complete: false, pages: [{ page: 1, text: "partial" }] }, { complete: true, pages: [{ page: 2, text: "missing page 1" }] }, { complete: true, pages: [{ page: 1, text: "" }] }]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(content) }] } }] }))));
      await expect(service.extractDocumentPages(file, selected)).rejects.toMatchObject({ status: 503 });
    }
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ complete: true, pages: [{ page: 1, text: "HTTP reference" }] }) }] } }] })));
    vi.stubGlobal("fetch", mock);
    expect(await service.extractDocumentPages(file, selected)).toEqual([{ page: 1, text: "HTTP reference" }]);
    expect(mock.mock.calls[0]?.[0]).toContain("gemini-2.5-pro");
    await expect(service.extractDocumentPages({ ...file, mimeType: "application/msword" }, selected)).rejects.toMatchObject({ status: 400 });
  });

  it.each(["VI", "EN", "BILINGUAL"] as const)("passes %s language instructions through Gemini generation", async (language) => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "language-test-secret", enabled: true }, "usr-admin");
    const question = { type: "SHORT_ANSWER", content: "What does HTTP stand for?", options: [], correctAnswers: ["Hypertext Transfer Protocol"], difficulty: 1, tags: [], confidence: 0.9, warnings: [] };
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [question] }) }] } }] })));
    vi.stubGlobal("fetch", mock);
    await service.generateExamDraft({ providerId: provider.id, language, courseName: "Web", courseDescription: "HTTP", focus: "HTTP basics", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "COURSE_MATERIALS", sourceFiles: [{ id: "file-1", name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("fixture") }] });
    const body = JSON.stringify(readJsonBody(mock.mock.calls[0]));
    expect(body).toContain(language === "EN" ? "in English" : language === "BILINGUAL" ? "song ngữ Việt–Anh" : "Tạo câu hỏi tiếng Việt");
    if (language !== "VI") expect(body).not.toContain("Tạo câu hỏi tiếng Việt");
  });

  it("generates Custom exams from grounded text without sending unsupported tools or images", async () => {
    const service = new AiProviderService(undefined, config);
    const helper = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "helper-test-secret", enabled: true }, "usr-admin");
    const custom = await service.configure({ provider: "CUSTOM", name: "Router", model: "text-model", baseUrl: "https://router.example/v1/chat/completions", apiKey: "custom-test-secret", enabled: true }, "usr-admin");
    await expect(service.configureTask("GENERATE_EXAM", { providerId: custom.id, model: "text-model" }, "usr-admin")).rejects.toThrow("cần chọn Gemini");
    const selected = await service.configureTask("GENERATE_EXAM", { providerId: custom.id, model: "text-model", contextProviderId: helper.id }, "usr-admin");
    const questions = [{ type: "SHORT_ANSWER", content: "HTTP stands for?", options: [], correctAnswers: ["Hypertext Transfer Protocol"], difficulty: 1, tags: [], confidence: 0.9, warnings: [] }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "HTTP means Hypertext Transfer Protocol." }] }, groundingMetadata: { groundingChunks: [{ web: { title: "HTTP", uri: "https://developer.mozilla.org/en-US/docs/Web/HTTP" } }] } }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ questions }) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service.generateExamDraft({ ...selected, courseName: "Web", courseDescription: "HTTP", focus: "HTTP basics", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "WEB_SEARCH", sourceFiles: [] });
    expect(result.provider).toBe("CUSTOM");
    expect(result.context.sources).toHaveLength(1);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://router.example/v1/chat/completions");
    expect(readJsonBody(fetchMock.mock.calls[1])).toMatchObject({ model: "text-model", stream: false });
    expect(readJsonBody(fetchMock.mock.calls[1])).not.toHaveProperty("tools");
    expect(readJsonBody(fetchMock.mock.calls[1])).not.toHaveProperty("response_format");
  });

  it("requires admin routing and keeps task models independent", async () => {
    const service = new AiProviderService(undefined, config);
    await expect(service.resolveTask("SCAN_IMAGE")).rejects.toThrow("chưa cấu hình");
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "test-task-secret", enabled: true }, "usr-admin");
    await service.configureTask("SCAN_IMAGE", { providerId: provider.id, model: "gemini-2.5-flash" }, "usr-admin");
    await service.configureTask("GENERATE_EXAM", { providerId: provider.id, model: "gemini-2.5-pro" }, "usr-admin");
    expect((await service.resolveTask("SCAN_IMAGE")).model).toBe("gemini-2.5-flash");
    expect((await service.resolveTask("GENERATE_EXAM")).model).toBe("gemini-2.5-pro");
    await expect(service.configureTask("GENERATE_EXAM", { providerId: provider.id, model: "invalid model" }, "usr-admin")).rejects.toThrow();
    await service.configure({ id: provider.id, provider: "GEMINI", model: provider.model, enabled: false }, "usr-admin");
    await expect(service.resolveTask("SCAN_IMAGE")).rejects.toThrow("bị tắt");
  });

  it.each(["GEMINI", "OPENAI"] as const)("preserves actionable HTTP errors during %s exam generation", async (providerType) => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: providerType, model: providerType === "GEMINI" ? "gemini-2.5-flash" : "gpt-4o-mini", apiKey: "test-provider-secret", enabled: true }, "usr-admin");
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      await expect(service.generateExamDraft({ providerId: provider.id, courseName: "HTTP", courseDescription: "Web", focus: "HTTP basics", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "WEB_SEARCH", sourceFiles: [] })).rejects.toMatchObject({ status: status === 429 ? 429 : status >= 500 ? 503 : 400 });
    }
  });

  it("publishes expanded current multimodal model catalogs", () => {
    const catalog = new AiProviderService(undefined, config).getCatalog();

    expect(catalog.GEMINI.map((item) => item.value)).toEqual(expect.arrayContaining(["gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-2.5-pro"]));
    expect(catalog.NVIDIA_NIM.map((item) => item.value)).toEqual(expect.arrayContaining(["meta/muse-glimmer-30b", "nvidia/nemotron-nano-12b-v2-vl", "meta/llama-3.2-90b-vision-instruct"]));
    expect(catalog.OPENAI.map((item) => item.value)).toEqual(expect.arrayContaining(["gpt-6-astra", "gpt-5.6-terra", "gpt-4o-mini"]));
    expect(catalog.GEMINI.length).toBeGreaterThanOrEqual(10);
    expect(catalog.NVIDIA_NIM.length).toBeGreaterThanOrEqual(7);
    expect(catalog.OPENAI.length).toBeGreaterThanOrEqual(15);
  });

  it("encrypts API keys with authenticated encryption", async () => {
    const encrypted = await encryptSecret("secret-api-key", encryptionSecret);
    expect(encrypted).not.toContain("secret-api-key");
    expect(await decryptSecret(encrypted, encryptionSecret)).toBe("secret-api-key");
  });

  it("never returns the API key and normalizes scan output", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-secret-1234", enabled: true, isDefault: true }, "usr-admin");
    expect(provider.maskedApiKey).toBe("••••••••1234");
    expect(JSON.stringify(provider)).not.toContain("gemini-secret-1234");

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [{ type: "SINGLE_CHOICE", content: "**Câu hỏi:** $2+2$ bằng bao nhiêu?", options: ["3", "4"], correctAnswers: ["4"], difficulty: 1, tags: ["toán"], confidence: 0.94, warnings: [] }] }) }] } }] }), { status: 200, headers: { "content-type": "application/json" } }))));
    const result = await service.scanImage({ providerId: provider.id, fileName: "de-toan.png", mimeType: "image/png", buffer: Buffer.from("image") });
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]?.content).toContain("$2+2$");
    expect(result.questions[0]?.correctAnswers).toEqual(["4"]);
  });

  it("requires HTTPS for remote custom endpoints", async () => {
    const service = new AiProviderService(undefined, config);
    await expect(service.configure({ provider: "CUSTOM", name: "Unsafe", model: "vision", baseUrl: "http://example.com/v1/chat/completions", apiKey: "custom-secret" }, "usr-admin")).rejects.toThrow("HTTPS");
  });

  it("tests Custom providers with text only instead of the invalid one-pixel image", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "CUSTOM", name: "Router", model: "cx/gpt-5.6-terra", baseUrl: "https://router.example/v1/chat/completions", apiKey: "custom-secret-1234", enabled: true }, "usr-admin");
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.test(provider.id, "usr-admin");

    const body = readJsonBody(fetchMock.mock.calls[0]);
    expect(result.healthStatus).toBe("HEALTHY");
    expect(body).toMatchObject({ model: "cx/gpt-5.6-terra", stream: false, messages: [{ role: "user", content: "Reply with exactly OK." }] });
    expect(JSON.stringify(body)).not.toContain("image_url");
    expect(body).not.toHaveProperty("response_format");
  });

  it("discovers and normalizes multiple models from a Custom endpoint", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "CUSTOM", name: "Router", model: "model-b", baseUrl: "https://router.example/v1/chat/completions", apiKey: "custom-secret-5678", enabled: true }, "usr-admin");
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      void url;
      void options;
      return Promise.resolve(new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-b" }] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await service.discoverModels(provider.id);

    expect(models.map((item) => item.value)).toEqual(["model-a", "model-b"]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://router.example/v1/models");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer custom-secret-5678" });
  });

  it("discovers only generateContent models from Gemini with official authentication and metadata", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-model-list-secret", enabled: true }, "usr-admin");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: "models/text-embedding-004", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-live-new", displayName: "Gemini Live New", description: "Available to this key.", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-live-new", supportedGenerationMethods: ["generateContent"] },
      { name: "models/bad model", supportedGenerationMethods: ["generateContent"] },
    ] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const models = await service.listModels(provider.id);

    expect(models.map((item) => item.value)).toEqual(["gemini-2.5-flash", "gemini-live-new"]);
    expect(models[0]?.label).toBe("Gemini 2.5 Flash");
    expect(models[0]?.description).toContain("JSON");
    expect(models[1]).toEqual({ value: "gemini-live-new", label: "Gemini Live New", description: "Available to this key." });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
    expect(Object.fromEntries(new Headers(readFetchOptions(fetchMock.mock.calls[0]).headers))).toEqual({ accept: "application/json", "x-goog-api-key": "gemini-model-list-secret" });
  });

  it.each([
    ["OPENAI", "gpt-live-account-model", "https://api.openai.com/v1/models"],
    ["NVIDIA_NIM", "nvidia/account-model", "https://integrate.api.nvidia.com/v1/models"],
  ] as const)("discovers account-visible %s models from its OpenAI-compatible endpoint", async (providerType, discoveredModel, expectedUrl) => {
    const service = new AiProviderService(undefined, config);
    const configuredModel = service.getCatalog()[providerType][0]!.value;
    const provider = await service.configure({ provider: providerType, model: configuredModel, apiKey: "compatible-model-list-secret", enabled: true }, "usr-admin");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: discoveredModel, owned_by: "account-owner" }, { id: discoveredModel }, { id: "bad model" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await service.listModels(provider.id)).toEqual([{ value: discoveredModel, label: discoveredModel, description: "Provider owner: account-owner" }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expectedUrl);
    expect(Object.fromEntries(new Headers(readFetchOptions(fetchMock.mock.calls[0]).headers))).toEqual({ accept: "application/json", authorization: "Bearer compatible-model-list-secret" });
  });

  it.each([
    ["GEMINI", "gemini-account-visible-new"],
    ["OPENAI", "gpt-account-visible-new"],
    ["NVIDIA_NIM", "organization/account-visible-new"],
  ] as const)("accepts a newly discovered %s model without requiring a catalog release", async (providerType, model) => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: providerType, model, apiKey: "new-model-secret", enabled: true }, "usr-admin");
    expect(provider.model).toBe(model);
    expect(await service.configureTask("GRADING_ASSIST", { providerId: provider.id, model }, "usr-admin")).toEqual({ providerId: provider.id, model });
  });

  it.each([
    ["OPENAI", "bad model"],
    ["OPENAI", "../escape"],
    ["OPENAI", "a".repeat(201)],
    ["GEMINI", "gpt-4o-mini"],
  ] as const)("rejects unsafe or clearly cross-provider model identifiers for %s", async (providerType, model) => {
    const service = new AiProviderService(undefined, config);
    await expect(service.configure({ provider: providerType, model, apiKey: "invalid-model-secret", enabled: true }, "usr-admin")).rejects.toThrow("Định danh model");
  });

  it("fails explicitly when a provider model endpoint is unreachable or returns no usable IDs", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "OPENAI", model: "gpt-4o-mini", apiKey: "openai-model-list-secret", enabled: true }, "usr-admin");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(service.listModels(provider.id)).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "bad model" }] }), { status: 200 })));
    await expect(service.listModels(provider.id)).rejects.toMatchObject({ status: 503 });
  });

  it.each(["declared", "streamed"] as const)("rejects %s oversized provider model responses", async (responseMode) => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "OPENAI", model: "gpt-4o-mini", apiKey: "oversized-model-list-secret", enabled: true }, "usr-admin");
    const oversizedPayload = JSON.stringify({ data: [{ id: "gpt-account-model", description: "x".repeat(2 * 1024 * 1024) }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(oversizedPayload, {
      status: 200,
      headers: responseMode === "declared" ? { "content-length": String(Buffer.byteLength(oversizedPayload)) } : undefined,
    })));

    await expect(service.listModels(provider.id)).rejects.toMatchObject({
      status: 503,
      message: "Danh sách model từ nhà cung cấp vượt giới hạn an toàn.",
    });
  });

  it("keeps provider validation errors as actionable 400 responses", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "CUSTOM", name: "Router", model: "vision", baseUrl: "https://router.example/v1/chat/completions", apiKey: "custom-secret-9012", enabled: true }, "usr-admin");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: { message: "invalid image" } }), { status: 400 }))));

    await expect(service.test(provider.id, "usr-admin")).rejects.toMatchObject({ status: 400 });
  });

  it("uses Web Search when the course has no usable material", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "OPENAI", model: "gpt-5.4-mini", apiKey: "openai-secret-1234", enabled: true, isDefault: true }, "usr-admin");
    const questions = [
      { type: "SHORT_ANSWER", content: "HTTP là chữ viết tắt của cụm từ nào?", options: [], correctAnswers: ["Hypertext Transfer Protocol"], difficulty: 1, tags: ["http"], confidence: 0.9, warnings: [] },
      { type: "SINGLE_CHOICE", content: "Phương thức nào thường dùng để đọc tài nguyên?", options: ["GET", "POST", "PATCH", "DELETE"], correctAnswers: ["GET"], difficulty: 1, tags: ["http"], confidence: 0.9, warnings: [] },
    ];
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ output: [
      { type: "web_search_call", action: { sources: [{ title: "MDN HTTP", url: "https://developer.mozilla.org/docs/Web/HTTP" }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify({ questions }) }] },
    ] }), { status: 200, headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await service.generateExamDraft({ providerId: provider.id, model: "gpt-4o-mini", courseName: "Lập trình web", courseDescription: "HTTP và REST", focus: "HTTP cơ bản", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }, { type: "SINGLE_CHOICE", count: 1 }], contextMode: "AUTO", sourceFiles: [] });
    expect(result.context.mode).toBe("WEB_SEARCH");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.context.sources[0]?.url).toContain("developer.mozilla.org");
    expect(result.questions.map((item) => item.type)).toEqual(["SHORT_ANSWER", "SINGLE_CHOICE"]);
    expect(readJsonBody(fetchMock.mock.calls[0])).toMatchObject({ model: "gpt-4o-mini", tools: [{ type: "web_search" }] });
  });

  it("rejects an obvious OpenAI model override for a Gemini provider", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-secret-invalid-model", enabled: true }, "usr-admin");

    await expect(service.generateExamDraft({ providerId: provider.id, model: "gpt-4o-mini", courseName: "Lập trình web", courseDescription: "HTTP", focus: "Khái niệm HTTP cơ bản", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "WEB_SEARCH", sourceFiles: [] })).rejects.toThrow("Định danh model");
  });

  it("uses Gemini Google Search before requesting structured questions", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-secret-5678", enabled: true, isDefault: true }, "usr-admin");
    const question = { type: "SHORT_ANSWER", content: "HTTP là chữ viết tắt của cụm từ nào?", options: [], correctAnswers: ["Hypertext Transfer Protocol"], difficulty: 1, tags: ["http"], confidence: 0.92, warnings: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "HTTP là giao thức tầng ứng dụng cho web." }] }, groundingMetadata: { groundingChunks: [{ web: { title: "MDN HTTP", uri: "https://developer.mozilla.org/docs/Web/HTTP" } }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [question] }) }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.generateExamDraft({ providerId: provider.id, courseName: "Lập trình web", courseDescription: "HTTP", focus: "Khái niệm HTTP", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "WEB_SEARCH", sourceFiles: [] });

    expect(result.provider).toBe("GEMINI");
    expect(result.context.sources).toEqual([{ title: "MDN HTTP", url: "https://developer.mozilla.org/docs/Web/HTTP" }]);
    expect(readJsonBody(fetchMock.mock.calls[0])).toMatchObject({ tools: [{ google_search: {} }] });
    expect(readJsonBody(fetchMock.mock.calls[1])).toMatchObject({ generationConfig: { responseMimeType: "application/json", responseJsonSchema: { type: "object" } } });
  });

  it("sends course materials inline to Gemini without Google Search", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-secret-9012", enabled: true, isDefault: true }, "usr-admin");
    const question = { type: "MULTIPLE_CHOICE", content: "Chọn các đặc điểm đúng của REST.", options: ["Stateless", "Cacheable", "Luôn dùng SOAP", "Client-server"], correctAnswers: ["Stateless", "Cacheable", "Client-server"], difficulty: 2, tags: ["rest"], confidence: 0.96, warnings: [] };
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ questions: [question] }) }] } }] }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.generateExamDraft({ providerId: provider.id, courseName: "Lập trình web", courseDescription: "REST API", focus: "Ràng buộc REST", difficulty: 2, distribution: [{ type: "MULTIPLE_CHOICE", count: 1 }], contextMode: "COURSE_MATERIALS", sourceFiles: [{ id: "mat-gemini", name: "rest.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") }] });

    const body = readJsonBody(fetchMock.mock.calls[0]);
    expect(result.context).toMatchObject({ mode: "COURSE_MATERIALS", materialIds: ["mat-gemini"] });
    expect(JSON.stringify(body)).toContain('"inline_data":{"mime_type":"application/pdf"');
    expect(body).not.toHaveProperty("tools");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uploads course files temporarily and does not enable Web Search", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "OPENAI", model: "gpt-5.4-mini", apiKey: "openai-secret-5678", enabled: true, isDefault: true }, "usr-admin");
    const question = { type: "MULTIPLE_CHOICE", content: "Chọn các đặc điểm đúng của REST.", options: ["Stateless", "Cacheable", "Luôn dùng SOAP", "Client-server"], correctAnswers: ["Stateless", "Cacheable", "Client-server"], difficulty: 2, tags: ["rest"], confidence: 0.96, warnings: [] };
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith("/files") && options?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ id: "file-course-1" }), { status: 200 }));
      if (url.includes("/files/file-course-1") && options?.method === "DELETE") return Promise.resolve(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ questions: [question] }) }] }] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await service.generateExamDraft({ providerId: provider.id, courseName: "Lập trình web", courseDescription: "REST API", focus: "Ràng buộc REST", difficulty: 2, distribution: [{ type: "MULTIPLE_CHOICE", count: 1 }], contextMode: "AUTO", sourceFiles: [{ id: "mat-1", name: "rest.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") }] });
    expect(result.context).toMatchObject({ mode: "COURSE_MATERIALS", materialIds: ["mat-1"], materialNames: ["rest.pdf"] });
    const responseCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/responses"));
    const responseBody = readJsonBody(responseCall);
    expect(readResponseInputContent(responseBody)).toContainEqual({ type: "input_file", file_id: "file-course-1" });
    expect(responseBody).not.toHaveProperty("tools");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/files/file-course-1"), expect.objectContaining({ method: "DELETE" }));
  });
});
