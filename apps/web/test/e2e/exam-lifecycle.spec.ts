import { expect, test, type APIRequestContext } from "@playwright/test";
import type { LearningClass, Question } from "../../src/lib/learning-types";

const apiBase = "http://localhost:4400/api/v1";

/** Đăng nhập fixture và trả CSRF cho thao tác ghi trong database kiểm thử riêng. */
async function authenticate(api: APIRequestContext, username: string) {
  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password) throw new Error("Thiếu mật khẩu seed cho E2E.");
  const response = await api.post(`${apiBase}/auth/login`, { data: { username, password, rememberMe: false } });
  expect(response.ok()).toBe(true);
  return (await response.json()).data.csrfToken as string;
}

test("học viên làm bài, lưu đáp án, nộp và nhận điểm thật", async ({ page, playwright }) => {
  const instructor = await playwright.request.newContext();
  const manager = await playwright.request.newContext();
  try {
    const instructorCsrf = await authenticate(instructor, "instructor@wind.edu.vn");
    const managerCsrf = await authenticate(manager, "manager@wind.edu.vn");
    await authenticate(page.request, "learner@wind.edu.vn");
    const teacherHeaders = { "x-role-code": "INSTRUCTOR", "x-csrf-token": instructorCsrf };
    const classResponse = await instructor.get(`${apiBase}/classes`, { headers: teacherHeaders });
    const learnerResponse = await page.request.get(`${apiBase}/classes`, { headers: { "x-role-code": "LEARNER" } });
    const questionResponse = await instructor.get(`${apiBase}/instructor/question-bank/questions?status=PUBLISHED`, { headers: teacherHeaders });
    expect(classResponse.ok() && learnerResponse.ok() && questionResponse.ok()).toBe(true);
    const classes: LearningClass[] = (await classResponse.json()).data;
    const learnerClasses: LearningClass[] = (await learnerResponse.json()).data;
    const questions: Question[] = (await questionResponse.json()).data;
    const selected = classes.find((item) => item.status === "ACTIVE" && learnerClasses.some((learnerClass) => learnerClass.id === item.id)
      && questions.some((question) => question.courseId === item.courseId && question.type === "SINGLE_CHOICE"));
    expect(selected).toBeDefined();
    const question = questions.find((item) => item.courseId === selected!.courseId && item.type === "SINGLE_CHOICE")!;
    const title = `E2E vòng đời đề ${Date.now()}`;
    const created = await instructor.post(`${apiBase}/instructor/exams`, { headers: teacherHeaders, data: {
      classId: selected!.id, title, questionIds: [question.id], durationMinutes: 30,
      totalScore: 10, attemptLimit: 1, shuffleQuestions: false, randomSeed: "e2e",
      openAt: new Date(Date.now() - 60_000).toISOString(), closeAt: new Date(Date.now() + 3_600_000).toISOString(),
      scoreAllocations: [{ questionId: question.id, score: 10 }],
    } });
    expect(created.ok()).toBe(true);
    const exam = (await created.json()).data;
    const published = await instructor.post(`${apiBase}/instructor/exams/${exam.id}/publish`, {
      headers: teacherHeaders, data: { confirmQuestions: true, expectedVersion: exam.version },
    });
    expect(published.ok()).toBe(true);
    if ((await published.json()).data.status === "PENDING_REVIEW") {
      const approved = await manager.post(`${apiBase}/manager/exams/${exam.id}/approve`, {
        headers: { "x-role-code": "CENTER_MANAGER", "x-csrf-token": managerCsrf }, data: { decision: "APPROVE" },
      });
      expect(approved.ok()).toBe(true);
    }
    await page.goto("/exams");
    const card = page.getByText(title, { exact: true }).locator("xpath=ancestor::*[self::article or self::tr][1]");
    await expect(card).toContainText(title);
    await expect(card.getByRole("button", { name: /Bắt đầu làm bài|Tiếp tục làm bài/, exact: true })).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: /Bắt đầu làm bài|Tiếp tục làm bài/, exact: true }).click();
    const saved = page.waitForResponse((response) => response.url().endsWith("/answers") && response.request().method() === "PATCH");
    await page.getByRole("radio", { name: question.correctAnswers[0], exact: true }).check();
    expect((await saved).ok()).toBe(true);
    const submitted = page.waitForResponse((response) => response.url().endsWith("/submit") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
    const result = await submitted;
    expect(result.ok()).toBe(true);
    expect((await result.json()).data.score).toBe(10);
    await expect(page.getByText(/Biên nhận nộp bài:/)).toBeVisible();
  } finally {
    await instructor.dispose();
    await manager.dispose();
  }
});
