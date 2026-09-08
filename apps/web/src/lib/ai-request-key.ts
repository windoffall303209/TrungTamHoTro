/** Giữ mã theo người dùng và nội dung qua reload; Web Locks đồng bộ các tab cùng origin. */
export async function persistentAiRequestId(owner: string, payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const key = `wind-ai-request:${owner}:${fingerprint}`;
  // Chỉ lưu UUID, không lưu đề, tài liệu hoặc đáp án trong localStorage.
  const resolve = () => {
    const current = localStorage.getItem(key);
    if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(current)) return current;
    const requestId = crypto.randomUUID();
    localStorage.setItem(key, requestId);
    return requestId;
  };
  return navigator.locks ? navigator.locks.request(key, resolve) : resolve();
}
