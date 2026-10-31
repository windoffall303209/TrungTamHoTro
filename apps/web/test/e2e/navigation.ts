import { expect, type Page } from "@playwright/test";

/** Đăng nhập tài khoản seed và đợi chuyển hướng dashboard về trang lớp học hoàn tất. */
export async function loginAsSeed(page: Page, account: string): Promise<void> {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error("SEED_DEFAULT_PASSWORD chưa được cấu hình cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill(`${account}@wind.edu.vn`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/, { timeout: 20_000 });
}

/** Điều hướng workspace và xác nhận route đích đã thực sự được mở. */
export async function gotoWorkspace(page: Page, path: string): Promise<void> {
  const expected = new URL(path, "http://localhost:3300");
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForURL((url) => url.pathname === expected.pathname && url.search === expected.search);
}
