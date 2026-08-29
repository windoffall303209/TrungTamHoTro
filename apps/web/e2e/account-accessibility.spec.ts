import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("đăng ký, mở hồ sơ tài khoản và không có lỗi accessibility nghiêm trọng", async ({ page }) => {
  const email = `e2e+${Date.now()}@windoffall3k32k9.online`;
  const password = "WindE2e!2026";
  await page.goto("/register");
  await page.getByLabel("Họ và tên").fill("Học viên E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByLabel("Xác nhận mật khẩu").fill(password);
  await page.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const dashboardAudit = await new AxeBuilder({ page }).exclude("[data-nextjs-dev-tools-button]").analyze();
  expect(dashboardAudit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Hồ sơ & bảo mật" })).toBeVisible();
  await expect(page.getByLabel("Email đăng nhập")).toHaveValue(email);
  const accountAudit = await new AxeBuilder({ page }).exclude("[data-nextjs-dev-tools-button]").analyze();
  expect(accountAudit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
});
