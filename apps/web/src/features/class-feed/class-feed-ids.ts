let fallbackSequence = 0;

/** Tạo ID duy nhất cho bài viết và bình luận kể cả khi phát sinh cùng mili-giây. */
export function createClassFeedId(prefix: "post" | "cmt" | "reply"): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid ?? `${Date.now()}-${++fallbackSequence}`}`;
}
