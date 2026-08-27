import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("mật khẩu xác thực", () => {
  it("băm mật khẩu với salt riêng và xác minh đúng", async () => {
    const first = await hashPassword("WindEdu@2026!");
    const second = await hashPassword("WindEdu@2026!");
    expect(first).not.toBe(second);
    await expect(verifyPassword("WindEdu@2026!", first)).resolves.toBe(true);
    await expect(verifyPassword("sai-mat-khau", first)).resolves.toBe(false);
  });

  it("từ chối định dạng hash cũ hoặc bị hỏng", async () => {
    await expect(verifyPassword("WindEdu@2026!", "not-a-valid-hash")).resolves.toBe(false);
  });
});
