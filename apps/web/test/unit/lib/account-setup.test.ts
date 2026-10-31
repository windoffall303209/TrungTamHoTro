import { afterEach, describe, expect, it } from "vitest";
import { clearAccountSetup, readAccountSetup, saveAccountSetup } from "../../../src/lib/account-setup";

const storageKey = "wind-edu:account-setup";

describe("account setup session storage", () => {
  afterEach(() => clearAccountSetup());

  it("khôi phục đầy đủ dữ liệu phiên xác thực hợp lệ", () => {
    const setup = { setupToken: "session-1", username: "learner", email: "learner@example.com", challengeId: "challenge-1", resendAvailableAt: 1000 };
    saveAccountSetup(setup);
    expect(readAccountSetup()).toEqual(setup);
  });

  it.each([
    "null",
    "[]",
    "{",
    '{"setupToken":"s","username":42}',
    '{"setupToken":"s","username":"u","email":42}',
    '{"setupToken":"s","username":"u","challengeId":{}}',
    '{"setupToken":"s","username":"u","resendAvailableAt":"soon"}',
    '{"setupToken":"s","username":"u","resendAvailableAt":null}',
  ])("bỏ qua trạng thái phiên bị hỏng: %s", (raw) => {
    window.sessionStorage.setItem(storageKey, raw);
    expect(readAccountSetup()).toBeNull();
  });
});
