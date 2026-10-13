import { expect, test, type Page } from "@playwright/test";
import { eligibleExamQuestions } from "../src/lib/exam-question-selection";
import type { LearningClass, Question } from "../src/lib/learning-types";

test("chuyển trang đề bằng API và mở liên kết đến đúng trang", async ({ page }) => {
  await login(page, "manager");
  const initial = page.waitForResponse((response) => response.url().includes("/exams/page?"));
  await page.goto("/exams");
  const first = (await (await initial).json()).data;
  expect(first.total).toBeGreaterThan(10);
  expect(first.items).toHaveLength(10);
  const next = page.waitForResponse((response) => response.url().includes("/exams/page?") && new URL(response.url()).searchParams.get("page") === "2");
  await page.getByRole("button", { name: "Trang 2", exact: true }).click();
  const second = (await (await next).json()).data;
  expect(second.page).toBe(2);
  expect(second.items.some((item: { id: string }) => first.items.some((prior: { id: string }) => prior.id === item.id))).toBe(false);
  const target = second.items[0].id;
  await expect(page.locator(`[id="exam-${target}"]`)).toBeVisible();
  await page.goto(`/exams?examId=${encodeURIComponent(target)}`);
  await expect(page.locator(`[id="exam-${target}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Trang 2", exact: true })).toHaveAttribute("aria-current", "page");
});

test("vận hành chỉ tải dữ liệu của nhóm đang xem", async ({ page }) => {
  await login(page, "admin");
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Dashboard có thể hoàn tất request sau điều hướng; không tính nguồn riêng của dashboard vào màn vận hành.
    if (url.pathname.startsWith("/api/v1/system/") && url.pathname !== "/api/v1/system/health-overview") paths.push(url.pathname);
  });
  await page.goto("/admin/operations");
  await expect.poll(() => paths.length).toBe(2);
  expect(paths.sort()).toEqual(["/api/v1/system/alerts", "/api/v1/system/audit"]);
  paths.length = 0;
  await page.getByRole("button", { name: /Nội dung.*Mẫu thông báo/ }).click();
  await expect.poll(() => paths.length).toBe(2);
  expect(paths.sort()).toEqual(["/api/v1/system/moderation-policy", "/api/v1/system/notification-templates"]);
});

/** Đăng nhập tài khoản seed trên backend/database kiểm thử riêng của Playwright. */
async function login(page: Page, account: string) {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password)
    throw new Error("SEED_DEFAULT_PASSWORD chưa được cấu hình cho E2E.");
  await page.goto("/login");
  await page
    .getByPlaceholder("admin@wind.edu.vn")
    .fill(account + "@wind.edu.vn");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

for (const [account, routes] of Object.entries({
  admin: ["/admin/users", "/admin/settings", "/admin/operations"],
  manager: ["/courses", "/class-operations", "/reports"],
  instructor: ["/exams", "/academic", "/materials"],
  learner: ["/exams", "/academic", "/courses"],
})) {
  test(`giao diện có dữ liệu thật theo vai trò ${account}`, async ({
    page,
  }, testInfo) => {
    await login(page, account);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect
        .poll(() => page.locator('[aria-label="Đang đồng bộ dữ liệu"]').count())
        .toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(route.replaceAll("/", "-") + ".png"),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}

test("phục hồi bản nháp sau chuyển trang/tải lại và tạo đề thật", async ({
  page,
}) => {
  await login(page, "instructor");
  await page.goto("/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  const title = `Kiểm thử phục hồi ${Date.now()}`;
  await page.getByRole("textbox", { name: "Tên đề", exact: true }).fill(title);
  await page.goto("/academic");
  await page.reload();
  await page.goto("/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Tên đề", exact: true }),
  ).toHaveValue(title);

  const classResponse = await page.request.get(
    "http://localhost:4400/api/v1/classes",
    { headers: { "x-role-code": "INSTRUCTOR" } },
  );
  const questionResponse = await page.request.get(
    "http://localhost:4400/api/v1/instructor/question-bank/questions?status=PUBLISHED",
    { headers: { "x-role-code": "INSTRUCTOR" } },
  );
  expect(classResponse.ok()).toBe(true);
  expect(questionResponse.ok()).toBe(true);
  const classes: LearningClass[] = (await classResponse.json()).data;
  const questions: Question[] = (await questionResponse.json()).data;
  const selected = classes.find(
    (item) =>
      item.status === "ACTIVE" &&
      eligibleExamQuestions(questions, classes, item.id).length > 0,
  );
  expect(selected).toBeDefined();
  await page
    .getByRole("combobox", { name: "Tìm và chọn lớp ra đề" })
    .fill(selected!.code);
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.getByRole("checkbox").first().check();
  const start = new Date(Date.now() + 3_600_000);
  const end = new Date(Date.now() + 7_200_000);
  await page
    .getByLabel("Mở đề", { exact: true })
    .fill(
      new Date(start.getTime() - start.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16),
    );
  await page
    .getByLabel("Đóng đề", { exact: true })
    .fill(
      new Date(end.getTime() - end.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16),
    );
  const response = page.waitForResponse(
    (item) =>
      item.url().endsWith("/instructor/exams") &&
      item.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Tạo đề thi", exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect(
    page.getByRole("dialog", { name: "Tạo đề thủ công" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Tên đề", exact: true }),
  ).toHaveValue("");
});
