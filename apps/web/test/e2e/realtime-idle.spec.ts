import { expect, test } from "@playwright/test";
import { gotoWorkspace, loginAsSeed } from "./navigation";

test("three tabs stay idle for five minutes with one live SSE each", async ({ context, page }, testInfo) => {
  test.setTimeout(420000);
  await context.addInitScript(() => {
    const Native = window.EventSource;
    const probe = { active: 0, peak: 0, opens: 0, errors: 0, snapshots: 0 };
    Object.assign(window, { idleProbe: probe });
    window.EventSource = class extends Native {
      private counted = true;
      // Giữ transport thật và đo vòng đời các socket trong mỗi tab.
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        probe.active++;
        probe.peak = Math.max(probe.peak, probe.active);
        this.addEventListener("open", () => probe.opens++);
        this.addEventListener("error", () => probe.errors++);
        this.addEventListener("message", () => probe.snapshots++);
      }
      // Dọn bộ đếm đúng một lần cho mỗi instance đã đóng.
      override close(): void {
        if (this.counted) { this.counted = false; probe.active--; }
        super.close();
      }
    };
  });
  await loginAsSeed(page, "learner");
  const tabs = [page, await context.newPage(), await context.newPage()];
  const reads: Array<{ tab: number; path: string }> = [];
  for (const [index, tab] of tabs.entries()) {
    tab.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET" && ["/api/v1/chat/conversations", "/api/v1/chat/directory", "/api/v1/notifications"].includes(path)) reads.push({ tab: index, path });
    });
    await gotoWorkspace(tab, "/messages");
    await expect.poll(() => tab.evaluate(() => (window as unknown as { idleProbe: { snapshots: number } }).idleProbe.snapshots)).toBeGreaterThan(0);
  }
  await page.waitForTimeout(3000);
  reads.length = 0;
  const start = Date.now();
  const samples: unknown[] = [];
  for (let minute = 1; minute <= 5; minute++) {
    await page.waitForTimeout(60000);
    const probes = await Promise.all(tabs.map((tab) => tab.evaluate(() => (window as unknown as {
      idleProbe: { active: number; peak: number; opens: number; errors: number; snapshots: number };
    }).idleProbe)));
    samples.push({ elapsedMs: Date.now() - start, probes, reads: [...reads] });
    for (const probe of probes) { expect(probe.active).toBe(1); expect(probe.peak).toBe(1); expect(probe.errors).toBe(0); }
    expect(reads).toEqual([]);
    console.log(`Realtime idle: minute ${minute}/5, 3 live tabs, ${reads.length} background list GETs`);
  }
  await testInfo.attach("realtime-idle-five-minutes.json", { body: JSON.stringify({ samples }, null, 2), contentType: "application/json" });
  await tabs[2]!.close();
  await tabs[1]!.close();
  expect(await page.evaluate(() => (window as unknown as { idleProbe: { active: number } }).idleProbe.active)).toBe(1);
});
