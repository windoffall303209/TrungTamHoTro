import type { Page } from "@playwright/test";

/** Điều hướng route workspace, chấp nhận redirect nội bộ của Next sau khi tài liệu đã được commit. */
export async function gotoWorkspace(page: Page, path: string): Promise<void> {
  try {
    await page.goto(path, { waitUntil: "commit" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("NS_BINDING_ABORTED")) {
      throw error;
    }
  }
}
