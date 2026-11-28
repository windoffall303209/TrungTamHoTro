import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";

describe("mật khẩu xác thực", () => {
  it("băm mật khẩu với salt riêng và xác minh đúng", async () => {
    const first = await hashPassword("WindEdu@2026!");
    const second = await hashPassword("WindEdu@2026!");
    expect(first).not.toBe(second);
    await expect(verifyPassword("WindEdu@2026!", first)).resolves.toBe(true);
    await expect(verifyPassword("sai-mat-khau", first)).resolves.toBe(false);
  });

  it("xếp hàng các lượt băm đồng thời mà vẫn trả đúng kết quả cho từng lượt", async () => {
    const stored = await hashPassword("WindEdu@2026!");
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => verifyPassword(index % 2 ? "WindEdu@2026!" : "sai", stored)));
    expect(results).toEqual(Array.from({ length: 12 }, (_, index) => index % 2 === 1));
  });

  it("từ chối định dạng hash cũ hoặc bị hỏng", async () => {
    await expect(verifyPassword("WindEdu@2026!", "not-a-valid-hash")).resolves.toBe(false);
  });
});
