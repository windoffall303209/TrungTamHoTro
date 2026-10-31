import { expect, test } from "@playwright/test";
import { gotoWorkspace, loginAsSeed } from "./navigation";

test("lỗi tải đề có thông báo và thử lại lấy được dữ liệu thật", async ({ page }) => {
  await loginAsSeed(page, "instructor");
  await page.route("**/api/v1/exams/page?*", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { message: "Dịch vụ tạm thời không khả dụng" } }),
  }));
  await gotoWorkspace(page, "/exams");
  const retry = page.getByRole("button", { name: "Thử lại", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText("Dịch vụ tạm thời không khả dụng").first()).toBeVisible();
  await page.unroute("**/api/v1/exams/page?*");
  const response = page.waitForResponse((item) => item.url().includes("/api/v1/exams/page?") && item.status() === 200);
  await retry.click();
  await response;
  await expect(retry).not.toBeVisible();
});

test("mất cookie phiên không làm mất bản nháp sau đăng nhập lại", async ({ page, context }) => {
  await loginAsSeed(page, "instructor");
  await gotoWorkspace(page, "/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await page.getByRole("textbox", { name: "Tên đề", exact: true }).fill("Đề sau hết phiên");
  await context.clearCookies();
  await gotoWorkspace(page, "/exams");
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await loginAsSeed(page, "instructor");
  await gotoWorkspace(page, "/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tên đề", exact: true })).toHaveValue("Đề sau hết phiên");
});

test("giới hạn tần suất kiểm tra phiên không chuyển nhầm về đăng nhập", async ({ page }) => {
  await loginAsSeed(page, "instructor");
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "Too many requests" } }),
  }));
  await gotoWorkspace(page, "/exams");
  await expect(page.getByText("Chưa kiểm tra được phiên làm việc. Vui lòng thử lại.")).toBeVisible();
  await expect(page).toHaveURL(/\/exams$/);
  await page.unroute("**/api/v1/auth/session");
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạo thủ công", exact: true })).toBeVisible();
});
