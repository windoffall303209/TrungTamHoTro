import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("tải học liệu lên và tải về giữ nguyên tên cùng nội dung", async ({ page }) => {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error("Thiếu mật khẩu seed cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill("instructor@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await page.goto("/materials");
  await page.getByRole("button", { name: "Thêm học liệu", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Tải học liệu từ máy" });
  // PNG 1×1 cố định làm fixture nhị phân; không dùng tài liệu của người dùng.
  const content = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6X8AAAAASUVORK5CYII=", "base64");
  const name = `hoc-lieu-e2e-${Date.now()}.png`;
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: content });
  const uploaded = page.waitForResponse((response) => response.url().endsWith("/material-uploads") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Tải lên và kiểm tra", exact: true }).click();
  expect((await uploaded).ok()).toBe(true);
  await expect(dialog).not.toBeVisible();
  await page.getByRole("textbox", { name: "Tìm học liệu", exact: true }).fill(name);
  const card = page.locator("article").filter({ hasText: name });
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Tải", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(name);
  expect(await file.failure()).toBeNull();
  expect(await readFile((await file.path())!)).toEqual(content);
});
