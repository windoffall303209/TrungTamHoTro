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
    const result = await service.generateExamDraft({ providerId: provider.id, courseName: "Lập trình web", courseDescription: "HTTP và REST", focus: "HTTP cơ bản", difficulty: 1, distribution: [{ type: "SHORT_ANSWER", count: 1 }, { type: "SINGLE_CHOICE", count: 1 }], contextMode: "AUTO", sourceFiles: [] });
    expect(result.context.mode).toBe("WEB_SEARCH");
    expect(result.context.sources[0]?.url).toContain("developer.mozilla.org");
    expect(result.questions.map((item) => item.type)).toEqual(["SHORT_ANSWER", "SINGLE_CHOICE"]);
    expect(readJsonBody(fetchMock.mock.calls[0])).toMatchObject({ tools: [{ type: "web_search" }] });
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
