import { publicApiUrl } from "./api-client";

export interface RealtimeScope { sessionId: string; userId: string; roleCode: string }
export type RealtimeTopic = { channel: "chat"; key: string } | { channel: "notifications" | "operations" | "chat-list" };
export interface RealtimeObserver { next: (value: unknown) => void; error?: () => void }
interface Entry { scope: string; topic: RealtimeTopic; observer: RealtimeObserver }
type SourceFactory = (url: string) => EventSource;

/** Phân biệt cả phiên, tài khoản và vai trò; không giữ cursor/cache xuyên ranh giới xác thực. */
function scopeKey(scope: RealtimeScope): string { return JSON.stringify([scope.sessionId, scope.userId, scope.roleCode]); }

/** Quản lý một EventSource mỗi tab, ghép topic và tự reconnect với cursor riêng từng hội thoại. */
export class RealtimeClient {
  private scope?: RealtimeScope;
  private entries = new Map<symbol, Entry>();
  private source?: EventSource;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private failures = 0;
  private cursors = new Map<string, string>();
  private seen = new Map<string, Set<string>>();
  /** Dừng socket và retry khi trình duyệt xác nhận mất mạng. */
  private readonly onOffline = (): void => { this.disconnect(); };
  /** Khôi phục subscription cùng cursor ngay khi mạng trở lại. */
  private readonly onOnline = (): void => { this.failures = 0; this.schedule(0); };

  /** Cho phép fake EventSource trong test; production luôn gửi cookie qua cùng API origin. */
  constructor(private readonly factory: SourceFactory = (url) => new EventSource(url, { withCredentials: true })) {}

  /** AppProvider là nguồn phiên có thẩm quyền; subscription cũ không thể đổi phiên hiện hành. */
  setSession(scope?: RealtimeScope): void {
    if ((this.scope && scope && scopeKey(this.scope) === scopeKey(scope)) || (!this.scope && !scope)) return;
    this.disconnect();
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this.onOffline);
      window.removeEventListener("online", this.onOnline);
      if (scope) {
        window.addEventListener("offline", this.onOffline);
        window.addEventListener("online", this.onOnline);
      }
    }
    this.scope = scope;
    this.cursors.clear();
    this.seen.clear();
    this.failures = 0;
    this.schedule(0);
  }

  /** Nhiều component cùng topic dùng chung stream; trả hàm cleanup độc lập cho từng component. */
  subscribe(scope: RealtimeScope, topic: RealtimeTopic, observer: RealtimeObserver): () => void {
    if (topic.channel === "chat" && !/^[A-Za-z0-9_-]{1,191}$/.test(topic.key)) throw new Error("Invalid conversation ID");
    const token = Symbol();
    const previous = this.topology();
    this.entries.set(token, { scope: scopeKey(scope), topic, observer });
    if (this.topology() !== previous) this.schedule(25);
    return () => {
      const before = this.topology();
      this.entries.delete(token);
      if (!this.active().length) this.disconnect();
      else if (before !== this.topology()) this.schedule(25);
    };
  }

  /** Chỉ lấy observer thuộc đúng phiên hiện tại. */
  private active(): Entry[] {
    if (!this.scope) return [];
    const key = scopeKey(this.scope);
    return [...this.entries.values()].filter((entry) => entry.scope === key);
  }

  /** Khóa cấu hình ổn định tránh reconnect khi component thứ hai đăng ký cùng hội thoại. */
  private topology(): string {
    return JSON.stringify([...new Set(this.active().map(({ topic }) => topic.channel === "chat" ? `chat:${topic.key}` : topic.channel))].sort());
  }

  /** Gộp thay đổi topic trong cùng lượt render và giữ duy nhất một timer reconnect. */
  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.scope || !this.active().length || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, delay);
  }

  /** Đóng socket cũ trước socket mới; callback muộn của socket cũ bị chặn bằng generation. */
  private connect(): void {
    this.closeSource();
    const scope = this.scope;
    const entries = this.active();
    if (!scope || !entries.length) return;
    const conversations = [...new Set(entries.flatMap(({ topic }) => topic.channel === "chat" ? [topic.key] : []))].sort();
    if (conversations.length > 16) { entries.forEach(({ observer }) => observer.error?.()); return; }
    const query = new URLSearchParams({ roleCode: scope.roleCode, conversations: JSON.stringify(conversations.map((id) => ({
      id, ...(this.cursors.has(id) ? { cursor: this.cursors.get(id)! } : {}),
    }))) });
    if (entries.some(({ topic }) => topic.channel === "operations")) query.set("operations", "true");
    const generation = this.generation;
    try {
      const source = this.factory(publicApiUrl(`/realtime/events?${query}`));
      this.source = source;
      source.onopen = () => { if (generation === this.generation) this.failures = 0; };
      source.onmessage = (event) => {
        if (generation !== this.generation) return;
        this.receive(event.data);
      };
      source.onerror = () => {
        if (generation !== this.generation) return;
        this.closeSource();
        this.active().forEach(({ observer }) => observer.error?.());
        this.schedule(Math.min(30000, 500 * 2 ** Math.min(this.failures++, 6)));
      };
    } catch {
      this.active().forEach(({ observer }) => observer.error?.());
      this.schedule(Math.min(30000, 500 * 2 ** Math.min(this.failures++, 6)));
    }
  }

  /** Kiểm tra envelope rồi phân phối, bỏ bản tin trùng do reconnect và mọi payload khác người nhận. */
  private receive(raw: string): void {
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || typeof payload !== "object") return;
    const value = payload as Record<string, unknown>;
    const entries = this.active();
    if (value.channel === "error" && typeof value.key === "string") {
      entries.filter(({ topic }) => topic.channel === value.key || (topic.channel === "chat" && topic.key === value.key))
        .forEach(({ observer }) => observer.error?.());
      return;
    }
    if (value.channel === "chat") {
      if (typeof value.key !== "string" || typeof value.cursor !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value.cursor) ||
        !value.value || typeof value.value !== "object") return;
      const message = value.value as Record<string, unknown>;
      if (message.id !== value.cursor || message.conversationId !== value.key) return;
      const listeners = entries.filter(({ topic }) => topic.channel === "chat" && topic.key === value.key);
      if (!listeners.length) return;
      const seen = this.seen.get(value.key) ?? new Set<string>();
      if (seen.has(value.cursor)) return;
      seen.add(value.cursor);
      if (seen.size > 500) seen.delete(seen.values().next().value!);
      this.seen.set(value.key, seen);
      this.cursors.delete(value.key);
      this.cursors.set(value.key, value.cursor);
      if (this.cursors.size > 128) {
        const oldest = this.cursors.keys().next().value!;
        this.cursors.delete(oldest);
        this.seen.delete(oldest);
      }
      listeners.forEach(({ observer }) => observer.next(value.value));
    } else if (value.channel === "notifications") {
      if (!Array.isArray(value.value) || !value.value.every((item: unknown) => item && typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" && (item as Record<string, unknown>).recipientId === this.scope?.userId)) return;
      entries.filter(({ topic }) => topic.channel === "notifications").forEach(({ observer }) => observer.next(value.value));
    } else if ((value.channel === "operations" || value.channel === "chat-list") && value.value && typeof value.value === "object" &&
      typeof (value.value as Record<string, unknown>).revision === "number") {
      entries.filter(({ topic }) => topic.channel === value.channel).forEach(({ observer }) => observer.next(value.value));
    }
  }

  /** Invalide callback cũ trước khi close để cả event đã xếp hàng cũng không lọt qua. */
  private closeSource(): void { this.generation++; this.source?.close(); this.source = undefined; }

  /** Dừng socket và timer khi không còn subscriber hoặc khi logout. */
  private disconnect(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeSource();
  }
}

export const realtimeClient = new RealtimeClient();
