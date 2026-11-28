import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client, type Notification } from "pg";
import { Observable, Subject } from "rxjs";
import type { Environment } from "../config/environment.js";
import { buildDatabaseUrl } from "../config/database-connection.js";

export type DatabaseEvent = { kind: "chat" | "chat-list" | "notification" | "job"; key: string } | { kind: "resync" };
export type SnapshotStreamEvent<T> = { data: T } | { comment: string };

@Injectable()
/** Một listener PostgreSQL mỗi process; chỉ phát tín hiệu, không phát dữ liệu được bảo vệ. */
export class DatabaseEventsService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseEventsService.name);
  private readonly events = new Subject<DatabaseEvent>();
  private client?: Client;
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private failures = 0;
  private activeWatchers = 0;
  private reconnectCount = 0;
  private eventsReceived = 0;

  /** Dùng cùng cấu hình PostgreSQL với Prisma nhưng một kết nối LISTEN chuyên biệt. */
  constructor(private readonly config: ConfigService<Environment, true>) {}

  /** Trả số liệu vận hành tức thời của kênh PostgreSQL LISTEN/NOTIFY không chứa khóa người dùng. */
  getMetrics(): {
    listenerConnected: boolean;
    listenerReconnects: number;
    activeBusWatchers: number;
    eventsReceived: number;
  } {
    return {
      listenerConnected: Boolean(this.client) && !this.stopping,
      listenerReconnects: this.reconnectCount,
      activeBusWatchers: this.activeWatchers,
      eventsReceived: this.eventsReceived,
    };
  }

  /** Đăng ký trước khi mở listener để không bỏ lỡ tín hiệu resync đầu tiên. */
  watch(): Observable<DatabaseEvent> {
    return new Observable((subscriber) => {
      this.activeWatchers += 1;
      const subscription = this.events.subscribe(subscriber);
      if (!this.stopping && !this.client && !this.connecting && !this.reconnectTimer) {
        this.connecting = this.connect().finally(() => { this.connecting = undefined; });
      }
      return () => {
        this.activeWatchers = Math.max(0, this.activeWatchers - 1);
        subscription.unsubscribe();
      };
    });
  }

  /** Phát snapshot có kiểm quyền do caller cung cấp; gộp burst, đọc lại sau reconnect, heartbeat không đọc DB. */
  watchSnapshot<T>(kind: "notification" | "job" | "chat-list", key: string, load: () => Promise<T>): Observable<SnapshotStreamEvent<T>> {
    return new Observable((subscriber) => {
      let closed = false;
      let running = false;
      let pending = false;
      let ready = false;
      let previous: string | undefined;
      // Một lượt đọc tại một thời điểm; tín hiệu tới trong lúc chờ chỉ yêu cầu thêm một lượt.
      const drain = async (): Promise<void> => {
        pending = true;
        if (closed || running) return;
        running = true;
        try {
          while (pending && !closed) {
            pending = false;
            const data = await load();
            if (closed) return;
            const serialized = JSON.stringify(data);
            if (!ready || serialized !== previous) {
              previous = serialized;
              ready = true;
              subscriber.next({ data });
            }
          }
        } catch (error) {
          if (!closed) subscriber.error(error);
        } finally { running = false; }
      };
      const signals = this.watch().subscribe({
        next: (event) => {
          if (event.kind === "resync" || (event.kind === kind && event.key === key)) void drain();
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      const heartbeat = setInterval(() => {
        if (!closed && ready) subscriber.next({ comment: "heartbeat" });
      }, 5000);
      void drain();
      return () => { closed = true; signals.unsubscribe(); clearInterval(heartbeat); };
    });
  }

  /** Thiết lập LISTEN trước resync; kết nối lỗi được thay bằng listener mới có backoff. */
  private async connect(): Promise<void> {
    const client = new Client({ connectionString: buildDatabaseUrl({
      DB_HOST: this.config.get("DB_HOST", { infer: true }),
      DB_PORT: this.config.get("DB_PORT", { infer: true }),
      DB_USER: this.config.get("DB_USER", { infer: true }),
      DB_PASSWORD: this.config.get("DB_PASSWORD", { infer: true }),
      DB_NAME: this.config.get("DB_NAME", { infer: true }),
    }), connectionTimeoutMillis: 10000, keepAlive: true, application_name: "wind-events" });
    this.client = client;
    client.on("notification", (notification) => this.receive(notification));
    client.on("error", () => this.disconnected(client));
    client.on("end", () => this.disconnected(client));
    try {
      await client.connect();
      await client.query("LISTEN wind_events");
      if (!this.stopping && this.client === client) {
        this.failures = 0;
        this.events.next({ kind: "resync" });
      }
    } catch {
      this.disconnected(client);
    }
  }

  /** Loại payload không hợp lệ; không ghi payload hoặc thông tin kết nối vào log. */
  private receive(notification: Notification): void {
    if (notification.channel !== "wind_events" || !notification.payload) return;
    try {
      const payload: unknown = JSON.parse(notification.payload);
      if (!payload || typeof payload !== "object") return;
      const value = payload as Record<string, unknown>;
      if ((value.kind === "chat" || value.kind === "chat-list" || value.kind === "notification" || value.kind === "job") &&
        typeof value.key === "string" && value.key.length > 0 && value.key.length <= 191) {
        this.eventsReceived += 1;
        this.events.next({ kind: value.kind, key: value.key });
      }
    } catch { /* Tín hiệu lỗi không được làm chết listener. */ }
  }

  /** Thu hồi kết nối lỗi và thử lại, không tạo nhiều timer cho cùng một lần ngắt. */
  private disconnected(client: Client): void {
    if (this.client !== client) return;
    this.client = undefined;
    void client.end().catch(() => undefined);
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectCount += 1;
    this.logger.warn("Database event listener disconnected; reconnect scheduled.");
    const delay = Math.min(30000, 250 * 2 ** Math.min(this.failures++, 7));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.stopping) this.connecting = this.connect().finally(() => { this.connecting = undefined; });
    }, delay);
    this.reconnectTimer.unref();
  }

  /** Dừng retry, đóng socket và hoàn tất subscriber khi ứng dụng shutdown. */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const client = this.client;
    this.client = undefined;
    await client?.end().catch(() => undefined);
    await this.connecting;
    this.events.complete();
  }
}
