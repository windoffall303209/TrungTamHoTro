import { expect, test, type Page } from "@playwright/test";

/** Đăng nhập bằng tài khoản seed của database test, không dùng tài khoản production. */
async function login(page: Page) {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error("Thiếu SEED_DEFAULT_PASSWORD cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill("instructor@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

test("lỗi tải đề có thông báo và thử lại lấy được dữ liệu thật", async ({ page }) => {
  await login(page);
  await page.route("**/api/v1/exams", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ error: { message: "Dịch vụ tạm thời không khả dụng" } }),
  }));
  await page.goto("/exams");
  const retry = page.getByRole("button", { name: "Thử lại", exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText("Dịch vụ tạm thời không khả dụng").first()).toBeVisible();
  await page.unroute("**/api/v1/exams");
  const response = page.waitForResponse((item) => item.url().endsWith("/api/v1/exams") && item.status() === 200);
  await retry.click();
  await response;
  await expect(retry).not.toBeVisible();
});

test("mất cookie phiên không làm mất bản nháp sau đăng nhập lại", async ({ page, context }) => {
  await login(page);
  await page.goto("/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await page.getByRole("textbox", { name: "Tên đề", exact: true }).fill("Đề sau hết phiên");
  await context.clearCookies();
  await page.goto("/exams");
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await login(page);
  await page.goto("/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tên đề", exact: true })).toHaveValue("Đề sau hết phiên");
});

test("giới hạn tần suất kiểm tra phiên không chuyển nhầm về đăng nhập", async ({ page }) => {
  await login(page);
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 429, contentType: "application/json", body: JSON.stringify({ error: { message: "Too many requests" } }),
  }));
  await page.goto("/exams");
  await expect(page.getByText("Chưa kiểm tra được phiên làm việc. Vui lòng thử lại.")).toBeVisible();
  await expect(page).toHaveURL(/\/exams$/);
  await page.unroute("**/api/v1/auth/session");
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tạo thủ công", exact: true })).toBeVisible();
});
