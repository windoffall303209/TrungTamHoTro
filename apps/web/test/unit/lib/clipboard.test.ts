import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../../../src/lib/clipboard";

afterEach(() => vi.unstubAllGlobals());

describe("copyTextToClipboard", () => {
  it("chỉ xác nhận thành công sau khi trình duyệt ghi xong", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyTextToClipboard("https://example.test/forum?topicId=1")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://example.test/forum?topicId=1");
  });

  it("báo lỗi khi clipboard không được hỗ trợ hoặc quyền ghi bị từ chối", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyTextToClipboard("link")).rejects.toThrow("không hỗ trợ");

    const rejection = new Error("NotAllowedError");
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(rejection) } });
    await expect(copyTextToClipboard("link")).rejects.toBe(rejection);
  });
});
