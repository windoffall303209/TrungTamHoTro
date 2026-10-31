import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineChatImage, loadStoredDrafts } from "../../../../src/features/messages/messages.shared";

describe("loadStoredDrafts", () => {
  afterEach(() => window.localStorage.removeItem("wind-chat-drafts:draft-test"));

  it("giữ nguyên bản nháp hợp lệ và loại bỏ giá trị không phải chuỗi", () => {
    window.localStorage.setItem("wind-chat-drafts:draft-test", JSON.stringify({ a: "tin nhắn", b: 42, c: null, d: "" }));
    expect(loadStoredDrafts("draft-test")).toEqual({ a: "tin nhắn", d: "" });
  });

  it.each(["null", "[]", "false", "broken-json"])("bỏ qua dữ liệu bản nháp sai cấu trúc: %s", (stored) => {
    window.localStorage.setItem("wind-chat-drafts:draft-test", stored);
    expect(loadStoredDrafts("draft-test")).toEqual({});
  });
});

describe("InlineChatImage blob lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("không cấp phát object URL nếu phản hồi blob đến sau khi unmount", async () => {
    let resolveBlob!: (value: Blob) => void;
    const pending = new Promise<Blob>((resolve) => { resolveBlob = resolve; });
    const createObjectURL = vi.fn(() => "blob:chat-image");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: () => pending }));
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = vi.fn();
    });

    const view = render(<InlineChatImage alt="ảnh hội thoại" mine={false} onOpen={vi.fn()} path="/chat/image" roleCode="LEARNER" />);
    await act(async () => { await Promise.resolve(); });
    view.unmount();
    await act(async () => { resolveBlob(new Blob(["image"], { type: "image/png" })); await pending; });
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("thu hồi đúng object URL đã tạo khi ảnh rời màn hình", async () => {
    const createObjectURL = vi.fn(() => "blob:chat-image");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }));
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    });

    const view = render(<InlineChatImage alt="ảnh hội thoại" mine={false} onOpen={vi.fn()} path="/chat/image" roleCode="LEARNER" />);
    await act(async () => { await Promise.resolve(); });
    expect(createObjectURL).toHaveBeenCalledOnce();
    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:chat-image");
  });
});
