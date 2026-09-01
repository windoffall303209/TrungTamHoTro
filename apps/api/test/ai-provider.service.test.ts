import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigService } from "@nestjs/config";
import type { Environment } from "../src/config/environment.js";
import { AiProviderService } from "../src/system/ai-provider.service.js";
import { decryptSecret, encryptSecret } from "../src/infrastructure/secret-vault.js";

const encryptionSecret = "test-encryption-secret-at-least-32-characters";
const config = { get: (key: string) => key === "AUTH_ENCRYPTION_SECRET" ? encryptionSecret : undefined } as unknown as ConfigService<Environment, true>;

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
});
