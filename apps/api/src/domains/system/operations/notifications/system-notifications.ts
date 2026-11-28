import type { SystemServiceContext } from "../../core/system.context.js";

/** Render mẫu PUBLISHED mới nhất cho runtime; dùng tiêu đề fallback nếu thiếu mẫu hoặc biến. */
export async function renderPublishedNotification(
  serviceContext: SystemServiceContext,
  eventCode: string,
  variables: Record<string, string>,
  fallbackTitle: string,
): Promise<string> {
  const locale = (await serviceContext.getSettings()).locale;
  if (eventCode === "CLASS_REMINDER" && variables.className && locale === "vi-VN") {
    return `Nhắc lịch học ${variables.className}`;
  }
  return fallbackTitle;
}
