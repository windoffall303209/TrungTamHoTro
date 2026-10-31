import { expect, test } from "@playwright/test";
import { gotoWorkspace, loginAsSeed } from "./navigation";

test("tải học liệu lên và tải về đúng dữ liệu nhị phân", async ({ page }) => {
  await loginAsSeed(page, "instructor");
  await gotoWorkspace(page, "/materials");
  await page.getByRole("button", { name: /Tải lên tài liệu \/ bài giảng/ }).first().click();
  const dialog = page.locator(".fixed.inset-0.z-50").filter({ hasText: /Tải lên tài liệu học tập|Chọn loại học liệu cần thêm/ });
  await dialog.getByText("1. Tải tài liệu", { exact: true }).click();
  // PNG 1×1 cố định làm fixture nhị phân; không dùng tài liệu của người dùng.
  const content = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6X8AAAAASUVORK5CYII=", "base64");
  const name = `hoc-lieu-e2e-${Date.now()}.png`;
  await dialog.locator('input[type="file"]').setInputFiles({ name, mimeType: "image/png", buffer: content });
  const uploaded = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/material-uploads"));
  await dialog.getByRole("button", { name: /Hoàn tất & Lưu vào kho/ }).click();
  await expect(dialog).not.toBeVisible();
  const uploadResponse = await uploaded;
  expect(uploadResponse.ok()).toBe(true);
  const materialId = (await uploadResponse.json()).data?.id as string | undefined;
  expect(materialId).toBeTruthy();

  const headers = { "x-role-code": "INSTRUCTOR" };
  const accessResponse = await page.request.get(`http://localhost:4400/api/v1/materials/${encodeURIComponent(materialId!)}/access?action=DOWNLOAD`, { headers });
  expect(accessResponse.ok()).toBe(true);
  const access = (await accessResponse.json()).data as { url: string };
  expect(access.url).toContain(`/materials/${materialId}/download?`);

  const downloadResponse = await page.request.get(`http://localhost:4400/api/v1${access.url}`, { headers });
  expect(downloadResponse.ok()).toBe(true);
  expect(downloadResponse.headers()["content-type"]).toContain("image/png");
  expect(await downloadResponse.body()).toEqual(content);
});
