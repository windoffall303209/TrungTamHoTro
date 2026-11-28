import type { ConfigService } from "@nestjs/config";
import { Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Environment } from "../../src/config/environment.js";
import { DatabaseEventsService, type DatabaseEvent } from "../../src/database/database-events.service.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("notification snapshots", () => {
  it("does not poll idle, scopes events, deduplicates snapshots and cleans up", async () => {
    vi.useFakeTimers();
    const signals = new Subject<DatabaseEvent>();
    const bus = new DatabaseEventsService({} as ConfigService<Environment, true>);
    vi.spyOn(bus, "watch").mockReturnValue(signals.asObservable());
    const load = vi.fn().mockResolvedValue(["initial"]);
    const snapshots: unknown[] = [];
    let heartbeats = 0;
    const subscription = bus.watchSnapshot("notification", "user-a", load).subscribe((event) => {
      if ("data" in event) snapshots.push(event.data); else heartbeats++;
    });
    try {
      await vi.advanceTimersByTimeAsync(60000);
      expect(load).toHaveBeenCalledTimes(1);
      expect(heartbeats).toBe(12);
      signals.next({ kind: "notification", key: "user-b" });
      signals.next({ kind: "job", key: "user-a" });
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 100; i++) signals.next({ kind: "notification", key: "user-a" });
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(3);
      expect(snapshots).toEqual([["initial"]]);
      load.mockResolvedValue(["changed"]);
      signals.next({ kind: "resync" });
      await vi.advanceTimersByTimeAsync(1);
      expect(snapshots).toEqual([["initial"], ["changed"]]);
      subscription.unsubscribe();
      signals.next({ kind: "notification", key: "user-a" });
      await vi.advanceTimersByTimeAsync(60000);
      expect(load).toHaveBeenCalledTimes(4);
      expect(heartbeats).toBe(12);
    } finally { subscription.unsubscribe(); }
  });

  it("terminates on read errors and does not leak subscriptions", async () => {
    const signals = new Subject<DatabaseEvent>();
    const bus = new DatabaseEventsService({} as ConfigService<Environment, true>);
    vi.spyOn(bus, "watch").mockReturnValue(signals.asObservable());
    const error = new Error("read denied");
    const load = vi.fn().mockRejectedValue(error);
    const received: unknown[] = [];
    const subscription = bus.watchSnapshot("notification", "user", load).subscribe({ error: (value: unknown) => received.push(value) });
    await vi.waitFor(() => expect(received).toEqual([error]));
    expect(subscription.closed).toBe(true);
    expect(signals.observed).toBe(false);
  });
});
