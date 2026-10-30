import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("mở hồ sơ tài khoản và không có lỗi accessibility nghiêm trọng", async ({ page }) => {
  const seedPassword = process.env.SEED_DEFAULT_PASSWORD;
  if (!seedPassword) throw new Error("SEED_DEFAULT_PASSWORD chưa được cấu hình cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill("learner@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(seedPassword);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/(dashboard|courses)$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const dashboardAudit = await new AxeBuilder({ page }).exclude("[data-nextjs-dev-tools-button]").analyze();
  expect(dashboardAudit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: /Thông tin cá nhân|Bảo mật tài khoản/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Email/ })).toHaveValue("learner@wind.edu.vn");
  const accountAudit = await new AxeBuilder({ page }).exclude("[data-nextjs-dev-tools-button]").analyze();
  expect(accountAudit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
});

test("dữ liệu rỗng hiển thị đúng và điều hướng dùng được bằng bàn phím trên mobile", async ({ page }, testInfo) => {
  const seedPassword = process.env.SEED_DEFAULT_PASSWORD;
  if (!seedPassword) throw new Error("SEED_DEFAULT_PASSWORD chưa được cấu hình cho E2E.");
  await page.goto("/login");
  await page.getByPlaceholder("admin@wind.edu.vn").fill("empty.learner@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(seedPassword);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/(dashboard|courses)$/, { timeout: 20_000 });
  await page.goto("/courses");
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
  await expect(page.getByText("Chưa có dữ liệu phù hợp")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).not.toHaveJSProperty("tagName", "BODY");

  if (testInfo.project.name === "chromium-mobile") {
    await expect(page.getByRole("button", { name: "Mở menu điều hướng", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const menuButton = page.getByRole("button", { name: "Mở menu điều hướng", exact: true });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".fixed.inset-0.z-50 nav")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".fixed.inset-0.z-50 nav")).not.toBeVisible();
  }

  const emptyStateAudit = await new AxeBuilder({ page }).exclude("[data-nextjs-dev-tools-button]").analyze();
  expect(emptyStateAudit.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);
});
