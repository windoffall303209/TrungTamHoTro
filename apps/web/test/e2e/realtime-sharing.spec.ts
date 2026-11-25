import { expect, test } from "@playwright/test";
import { gotoWorkspace, loginAsSeed } from "./navigation";

test("delivers messages between independent instructor and learner sessions", async ({ page, browser }) => {
  test.setTimeout(90000);
  const senderContext = await browser.newContext({ baseURL: "http://localhost:3300" });
  try {
    const sender = await senderContext.newPage();
    await loginAsSeed(page, "learner");
    await loginAsSeed(sender, "instructor");
    const base = "http://localhost:4400/api/v1";
    const learnerResponse = await page.request.get(`${base}/auth/session`);
    const instructorResponse = await sender.request.get(`${base}/auth/session`);
    expect(learnerResponse.ok()).toBe(true);
    expect(instructorResponse.ok()).toBe(true);
    const learner = (await learnerResponse.json()).data as { user: { id: string }; sessionId: string };
    const instructor = (await instructorResponse.json()).data as { user: { id: string }; sessionId: string; csrfToken: string };
    expect(instructor.user.id).not.toBe(learner.user.id);
    expect(instructor.sessionId).not.toBe(learner.sessionId);
    const headers = { "x-csrf-token": instructor.csrfToken, origin: "http://localhost:3300" };
    const opened = await sender.request.post(`${base}/chat/conversations/direct`, { headers, data: { userId: learner.user.id } });
    expect(opened.ok()).toBe(true);
    const conversation = (await opened.json()).data as { id: string };
    const streamReady = page.waitForResponse((response) => {
      if (!response.url().includes("/realtime/events?")) return false;
      return new URL(response.url()).searchParams.get("conversations")?.includes(conversation.id) === true && response.status() === 200;
    });
    await gotoWorkspace(page, `/messages?conversationId=${encodeURIComponent(conversation.id)}`);
    await expect.poll(async () => {
      const rows = await page.request.get(`${base}/chat/conversations`);
      return ((await rows.json()).data as Array<{ id: string }>).some((row) => row.id === conversation.id);
    }).toBe(true);
    // Đợi stream của hội thoại được mở trước khi tạo tin, tránh chỉ kiểm GET lịch sử ban đầu.
    await streamReady;
    const text = `Realtime E2E instructor ${Date.now()}`;
    const created = await sender.request.post(`${base}/chat/conversations/${conversation.id}/messages`, {
      headers, data: { clientMessageId: crypto.randomUUID(), content: text },
    });
    expect(created.ok()).toBe(true);
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  } finally { await senderContext.close(); }
});

test("workspace and chat share one SSE and do not poll while idle", async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const state = { active: 0, peak: 0, opens: 0, channels: [] as string[], urls: [] as string[] };
    Object.assign(window, { realtimeProbe: state });
    window.EventSource = class extends Native {
      private counted = true;
      // Theo dõi socket thật mà vẫn giữ nguyên cookie, sự kiện và reconnect của trình duyệt.
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        state.active++;
        state.peak = Math.max(state.peak, state.active);
        state.urls.push(String(url));
        this.addEventListener("open", () => state.opens++);
        this.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data) as { channel: string };
          state.channels.push(payload.channel);
        });
      }
      // Đếm close một lần kể cả cleanup lặp trong React StrictMode.
      override close(): void {
        if (this.counted) { this.counted = false; state.active--; }
        super.close();
      }
    };
  });
  await loginAsSeed(page, "learner");
  const base = "http://localhost:4400/api/v1";
  const sessionResponse = await page.request.get(`${base}/auth/session`);
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()).data as { csrfToken: string };
  const directoryResponse = await page.request.get(`${base}/chat/directory`);
  expect(directoryResponse.ok()).toBe(true);
  const directory = (await directoryResponse.json()).data as Array<{ id: string }>;
  expect(directory.length).toBeGreaterThan(0);
  const headers = { "x-csrf-token": session.csrfToken, origin: "http://localhost:3300" };
  const directResponse = await page.request.post(`${base}/chat/conversations/direct`, { headers, data: { userId: directory[0]!.id } });
  expect(directResponse.ok()).toBe(true);
  const conversation = (await directResponse.json()).data as { id: string };
  await gotoWorkspace(page, `/messages?conversationId=${encodeURIComponent(conversation.id)}`);
  await expect.poll(() => page.evaluate(() => (window as unknown as { realtimeProbe: { active: number } }).realtimeProbe.active)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { realtimeProbe: { channels: string[] } }).realtimeProbe.channels)).toEqual(expect.arrayContaining(["notifications", "chat-list"]));
  const eventResponse = await page.request.get("http://localhost:4400/api/v1/chat/conversations");
  expect(eventResponse.ok()).toBe(true);
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && ["/api/v1/chat/conversations", "/api/v1/chat/directory", "/api/v1/notifications"].includes(path)) requests.push(path);
  });
  // Cho tải ban đầu/debounce hoàn tất trước cửa sổ đo lớn hơn chu kỳ poll cũ.
  await page.waitForTimeout(2000);
  requests.length = 0;
  await page.waitForTimeout(15000);
  expect(requests).toEqual([]);
  const probe = await page.evaluate(() => (window as unknown as { realtimeProbe: { active: number; peak: number; urls: string[] } }).realtimeProbe);
  expect(probe.active).toBe(1);
  expect(probe.peak).toBe(1);
  expect(probe.urls.length).toBeGreaterThan(0);
  expect(probe.urls.every((url) => url.includes("/realtime/events?"))).toBe(true);
  const liveText = `Realtime E2E live ${Date.now()}`;
  const live = await page.request.post(`${base}/chat/conversations/${conversation.id}/messages`, {
    headers, data: { clientMessageId: crypto.randomUUID(), content: liveText },
  });
  expect(live.ok()).toBe(true);
  await expect(page.getByText(liveText, { exact: true }).first()).toBeVisible();
  const before = await page.evaluate(() => (window as unknown as { realtimeProbe: { opens: number } }).realtimeProbe.opens);
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { realtimeProbe: { active: number } }).realtimeProbe.active), { timeout: 15000 }).toBe(0);
  await page.evaluate(() => { (window as unknown as { realtimeProbe: { channels: string[] } }).realtimeProbe.channels = []; });
  const missedText = `Realtime E2E offline ${Date.now()}`;
  const missed = await page.request.post(`${base}/chat/conversations/${conversation.id}/messages`, {
    headers, data: { clientMessageId: crypto.randomUUID(), content: missedText },
  });
  expect(missed.ok()).toBe(true);
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { realtimeProbe: { opens: number } }).realtimeProbe.opens), { timeout: 15000 }).toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => (window as unknown as { realtimeProbe: { channels: string[] } }).realtimeProbe.channels)).toEqual(expect.arrayContaining(["notifications", "chat-list"]));
  expect(await page.evaluate(() => (window as unknown as { realtimeProbe: { peak: number } }).realtimeProbe.peak)).toBe(1);
  await expect(page.getByText(missedText, { exact: true }).first()).toBeVisible();
});
