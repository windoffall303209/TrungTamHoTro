import { expect, test } from "@playwright/test";

test("tải học liệu lên và tải về giữ nguyên tên cùng nội dung", async ({ page }) => {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error("Thiếu mật khẩu seed cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill("instructor@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|courses)$/, { timeout: 20_000 });
  await page.goto("/materials");
  await page.getByRole("button", { name: /Tải lên tài liệu \/ bài giảng/ }).first().click();
  const dialog = page.locator(".fixed.inset-0.z-50").filter({ hasText: /Tải lên tài liệu học tập|Chọn loại học liệu cần thêm/ });
  await dialog.getByText("1. Tải tài liệu", { exact: true }).click();
  // PNG 1×1 cố định làm fixture nhị phân; không dùng tài liệu của người dùng.
  const content = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6X8AAAAASUVORK5CYII=", "base64");
  const name = `hoc-lieu-e2e-${Date.now()}.png`;
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: content });
  await dialog.getByRole("button", { name: /Hoàn tất & Lưu vào kho/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(dialog).not.toBeVisible();
});
