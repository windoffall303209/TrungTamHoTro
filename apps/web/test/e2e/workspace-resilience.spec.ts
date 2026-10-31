import { expect, test } from "@playwright/test";
import { gotoWorkspace, loginAsSeed } from "./navigation";
import { eligibleExamQuestions } from "../../src/lib/exam-question-selection";
import type { LearningClass, Question } from "../../src/lib/learning-types";

test("chuyển trang đề bằng API và mở liên kết đến đúng trang", async ({ page }) => {
  await loginAsSeed(page, "manager");
  const initial = page.waitForResponse((response) => response.url().includes("/exams/page?"));
  await gotoWorkspace(page, "/exams");
  const first = (await (await initial).json()).data;
  expect(first.total).toBeGreaterThan(10);
  expect(first.items).toHaveLength(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const next = page.waitForResponse((response) => response.url().includes("/exams/page?") && new URL(response.url()).searchParams.get("page") === "2");
  const secondPageButton = page.getByRole("button", { name: "Trang 2", exact: true });
  await secondPageButton.click();
  const second = (await (await next).json()).data;
  expect(second.page).toBe(2);
  expect(second.items.some((item: { id: string }) => first.items.some((prior: { id: string }) => prior.id === item.id))).toBe(false);
  const target = second.items[0].id;
  await expect(page.locator(`[id="exam-${target}"]`)).toBeVisible();
  await gotoWorkspace(page, `/exams?examId=${encodeURIComponent(target)}`);
  await expect(page.locator(`[id="exam-${target}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Trang 2", exact: true })).toHaveAttribute("aria-current", "page");
});

test("vận hành chỉ tải dữ liệu của nhóm đang xem", async ({ page }) => {
  await loginAsSeed(page, "admin");
  const paths: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Dashboard có thể hoàn tất request sau điều hướng; không tính nguồn riêng của dashboard vào màn vận hành.
    if (url.pathname.startsWith("/api/v1/system/") && url.pathname !== "/api/v1/system/health-overview") paths.push(url.pathname);
  });
  await gotoWorkspace(page, "/admin/operations");
  await expect.poll(() => paths.length).toBe(2);
  expect(paths.sort()).toEqual(["/api/v1/system/alerts", "/api/v1/system/audit"]);
  paths.length = 0;
  await page.getByRole("button", { name: /Nội dung.*Mẫu thông báo/ }).click();
  await expect.poll(() => paths.length).toBe(2);
  expect(paths.sort()).toEqual(["/api/v1/system/moderation-policy", "/api/v1/system/notification-templates"]);
});

for (const [account, routes] of Object.entries({
  admin: ["/admin/users", "/admin/settings", "/admin/operations"],
  manager: ["/courses", "/class-operations", "/reports"],
  instructor: ["/exams", "/academic", "/materials"],
  learner: ["/exams", "/academic", "/courses"],
})) {
  test(`giao diện có dữ liệu thật theo vai trò ${account}`, async ({
    page,
  }, testInfo) => {
    await loginAsSeed(page, account);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      await gotoWorkspace(page, route);
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
  await loginAsSeed(page, "instructor");
  await gotoWorkspace(page, "/exams");
  await page.getByRole("button", { name: "Tạo thủ công", exact: true }).click();
  const title = `Kiểm thử phục hồi ${Date.now()}`;
  await page.getByRole("textbox", { name: "Tên đề", exact: true }).fill(title);
  await gotoWorkspace(page, "/academic");
  await page.reload();
  await gotoWorkspace(page, "/exams");
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
