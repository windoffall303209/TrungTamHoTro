import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Environment } from "../src/config/environment.js";
import { AiProviderService } from "../src/system/ai-provider.service.js";
import { decryptSecret, encryptSecret } from "../src/infrastructure/secret-vault.js";

const encryptionSecret = "test-encryption-secret-at-least-32-characters";
const config = { get: (key: string) => key === "AUTH_ENCRYPTION_SECRET" ? encryptionSecret : undefined } as unknown as ConfigService<Environment, true>;

/** Đọc JSON body từ một fetch mock và thất bại rõ ràng nếu test gọi sai payload. */
function readJsonBody(call: unknown[] | undefined): Record<string, unknown> {
  const options = call?.[1];
  const body = typeof options === "object" && options !== null && "body" in options ? options.body : undefined;
  if (typeof body !== "string") throw new Error("Fetch mock không nhận được JSON body dạng chuỗi.");
  return JSON.parse(body) as Record<string, unknown>;
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
    await expect(service.configureTask("GENERATE_EXAM", { providerId: provider.id, model: "invalid" }, "usr-admin")).rejects.toThrow();
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

  it("encrypts API keys with authenticated encryption", () => {
    const encrypted = encryptSecret("secret-api-key", encryptionSecret);
    expect(encrypted).not.toContain("secret-api-key");
    expect(decryptSecret(encrypted, encryptionSecret)).toBe("secret-api-key");
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

  it("rejects a model that does not belong to the selected provider", async () => {
    const service = new AiProviderService(undefined, config);
    const provider = await service.configure({ provider: "GEMINI", model: "gemini-2.5-flash", apiKey: "gemini-secret-invalid-model", enabled: true }, "usr-admin");

    await expect(service.generateExamDraft({ providerId: provider.id, model: "gpt-4o-mini", courseName: "Lập trình web", courseDescription: "HTTP", focus: "Khái niệm HTTP cơ bản", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }], contextMode: "WEB_SEARCH", sourceFiles: [] })).rejects.toThrow("không thuộc nhà cung cấp");
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
