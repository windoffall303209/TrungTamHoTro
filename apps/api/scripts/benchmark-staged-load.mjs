import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import pg from "pg";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const repoDirectory = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: path.join(repoDirectory, ".env"), quiet: true });

const { values } = parseArgs({
  options: {
    database: { type: "string", default: process.env.WIND_TEST_DB_NAME ?? "wind_bench_review_20261123_test" },
    stages: { type: "string", default: "100,500,1000" },
    "hold-seconds": { type: "string", default: "6" },
    "max-5xx-rate": { type: "string", default: "0.05" },
    "max-p95-ms": { type: "string", default: "5000" },
    "max-rss-mb": { type: "string", default: "1536" },
    "pool-max": { type: "string", default: "30" },
    "uv-threadpool-size": { type: "string", default: "12" },
    "scrypt-max-concurrency": { type: "string", default: "6" },
    port: { type: "string", default: "4407" },
    label: { type: "string", default: "f05-b07-staged-load" },
    output: { type: "string" },
    verbose: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
  strict: true,
});

const FIXTURE_CLASS_ID = "f04-class-500";

/** Ghi log JSON có cấu trúc ra stderr theo cờ verbose hoặc debug. */
function logEvent(level, event, details = {}) {
  if (level === "debug" && !values.debug) return;
  if (level === "info" && !values.verbose && !values.debug) return;
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details })}\n`,
  );
}

/** Xác thực mọi tham số dòng lệnh và khóa tuyệt đối mọi chạy thử ngoài database _test. */
function parseAndValidateOptions() {
  const database = values.database.trim();
  if (!/^[a-zA-Z0-9_]+_test$/.test(database) || database === process.env.DB_NAME) {
    throw new Error("Tham số --database phải kết thúc bằng _test và khác DB_NAME ứng dụng.");
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(values.label)) {
    throw new Error("Tham số --label chỉ chấp nhận chữ, số, gạch dưới, gạch nối (1–80 ký tự).");
  }
  if (!process.env.SEED_DEFAULT_PASSWORD) {
    throw new Error("Thiếu biến môi trường SEED_DEFAULT_PASSWORD.");
  }
  const stages = values.stages
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isInteger(num) && num >= 1 && num <= 2000);
  if (!stages.length) {
    throw new Error("--stages phải chứa ít nhất một mức CCU nguyên hợp lệ (1–2000).");
  }
  const holdSeconds = Number(values["hold-seconds"]);
  const max5xxRate = Number(values["max-5xx-rate"]);
  const maxP95Ms = Number(values["max-p95-ms"]);
  const maxRssMb = Number(values["max-rss-mb"]);
  const poolMax = Number(values["pool-max"]);
  const uvThreadpoolSize = Number(values["uv-threadpool-size"]);
  const scryptMaxConcurrency = Number(values["scrypt-max-concurrency"]);
  const port = Number(values.port);
  if (!Number.isFinite(holdSeconds) || holdSeconds < 1 || holdSeconds > 60) {
    throw new Error("--hold-seconds phải từ 1 đến 60.");
  }
  if (!Number.isFinite(max5xxRate) || max5xxRate < 0 || max5xxRate > 1) {
    throw new Error("--max-5xx-rate phải từ 0 đến 1.");
  }
  if (!Number.isFinite(maxP95Ms) || maxP95Ms < 100 || maxP95Ms > 60_000) {
    throw new Error("--max-p95-ms phải từ 100 đến 60000.");
  }
  if (!Number.isFinite(maxRssMb) || maxRssMb < 128 || maxRssMb > 16_384) {
    throw new Error("--max-rss-mb phải từ 128 đến 16384.");
  }
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 200) {
    throw new Error("--pool-max phải từ 1 đến 200.");
  }
  if (!Number.isInteger(uvThreadpoolSize) || uvThreadpoolSize < 2 || uvThreadpoolSize > 128) {
    throw new Error("--uv-threadpool-size phải từ 2 đến 128.");
  }
  if (!Number.isInteger(scryptMaxConcurrency) || scryptMaxConcurrency < 1 || scryptMaxConcurrency > 64) {
    throw new Error("--scrypt-max-concurrency phải từ 1 đến 64.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port phải từ 1024 đến 65535.");
  }
  const outputPath = values.output
    ? path.resolve(repoDirectory, values.output)
    : path.join(apiDirectory, "test", "results", "benchmark", `${values.label}.json`);

  return {
    database,
    stages,
    holdSeconds,
    max5xxRate,
    maxP95Ms,
    maxRssMb,
    poolMax,
    uvThreadpoolSize,
    scryptMaxConcurrency,
    port,
    label: values.label,
    outputPath,
  };
}

/** Đọc commit và nhánh Git hiện tại cho artifact báo cáo. */
function readGitMetadata() {
  try {
    return {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDirectory, encoding: "utf8" }).trim(),
      branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDirectory, encoding: "utf8" }).trim(),
    };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

/** Chờ khoảng thời gian có giới hạn giữa các pha đo. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Xác nhận cổng TCP nội bộ rảnh trước khi khởi chạy API. */
async function assertPortAvailable(port) {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise((resolve) => server.close(resolve));
}

/** Tính phân vị nearest-rank làm tròn 2 chữ số thập phân. */
function percentile(valuesArr, fraction) {
  if (!valuesArr.length) return 0;
  const sorted = [...valuesArr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

/** Gửi lệnh IPC tới preload đo SQL và hàng đợi pool trong tiến trình API. */
async function sendProbeMessage(child, type) {
  const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const expectedType = `${type}-ok`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error(`Timeout chờ IPC ${type}.`));
    }, 10_000);
    /** Khớp đúng phản hồi IPC theo id lệnh đã phát. */
    function onMessage(message) {
      if (!message || message.id !== id || message.type !== expectedType) return;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve(message.data);
    }
    child.on("message", onMessage);
    child.send({ type, id });
  });
}

/** Tải danh sách học viên fixture f04-class-500 và thông số PostgreSQL thực tế từ DB benchmark. */
async function loadStagedFixtureLearners(database) {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const [learnersRes, pgSettings] = await Promise.all([
      client.query(
        `SELECT u.id, u.username
         FROM users u
         JOIN class_enrollments ce ON ce.learner_id = u.id
         WHERE ce.class_id = $1 AND ce.status = 'ACTIVE' AND u.status = 'ACTIVE'
         ORDER BY u.id`,
        [FIXTURE_CLASS_ID],
      ),
      client.query("SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'shared_buffers', 'work_mem')"),
    ]);
    if (learnersRes.rowCount < 100) {
      throw new Error(
        `Fixture ${FIXTURE_CLASS_ID} mới có ${learnersRes.rowCount} học viên ACTIVE; hãy chạy benchmark-exam-500.mjs trước.`,
      );
    }
    const pgConfig = Object.fromEntries(pgSettings.rows.map((row) => [row.name, row.setting]));
    return {
      learners: learnersRes.rows,
      postgres: {
        maxConnections: Number(pgConfig.max_connections ?? 0),
        sharedBuffers: pgConfig.shared_buffers ?? "",
        workMem: pgConfig.work_mem ?? "",
      },
    };
  } finally {
    await client.end();
  }
}

/** Thực thi mảng tác vụ bất đồng bộ với giới hạn đồng thời cố định. */
async function runWithConcurrency(items, limit, workerFn) {
  const results = new Array(items.length);
  let cursor = 0;
  /** Rút lần lượt từng phần tử kế tiếp cho đến hết danh sách. */
  async function runner() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = { ok: true, value: await workerFn(items[idx], idx) };
      } catch (error) {
        results[idx] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return results;
}

/** Đăng nhập một tài khoản và trả về header xác thực đầy đủ. */
async function loginAccount(baseUrl, username, roleCode) {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: process.env.SEED_DEFAULT_PASSWORD,
      rememberMe: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LOGIN_HTTP_${res.status}`);
  const body = await res.json();
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return {
    cookie,
    "x-role-code": roleCode,
    "x-csrf-token": body.data.csrfToken,
  };
}

/** Mở một kết nối SSE hợp nhất /realtime/events, đếm heartbeat và tin chat đẩy tới theo thời gian thực. */
async function openRealtimeSseClient(baseUrl, headers, conversationId, broadcastMarker, controller) {
  const url = `${baseUrl}/realtime/events?conversations=${encodeURIComponent(
    JSON.stringify([{ id: conversationId }]),
  )}&roleCode=LEARNER`;
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { cookie: headers.cookie, accept: "text/event-stream" },
    signal: controller.signal,
  });
  const openMs = performance.now() - startedAt;
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error(`SSE_OPEN_HTTP_${response.status}`);
  }
  const state = {
    openMs,
    heartbeats: 0,
    receivedBroadcast: false,
    streamError: null,
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (line === ": heartbeat") state.heartbeats += 1;
          else if (broadcastMarker && line.includes(broadcastMarker)) state.receivedBroadcast = true;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        state.streamError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      reader.releaseLock();
    }
  })();
  return { state, pump };
}

/** Đọc snapshot metrics nội bộ (/observability/metrics) từ API bằng phiên quản trị viên. */
async function fetchApiMetrics(baseUrl, adminHeaders) {
  const res = await fetch(`${baseUrl}/observability/metrics`, {
    headers: adminHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.data;
}

/** Chạy một nấc tải CCU hoàn chỉnh: mở SSE → đo idle heartbeat/SQL → bắn chat+đọc hỗn hợp → đóng và kiểm tra leak. */
async function runLoadStage(child, baseUrl, ccu, sessionsPool, classConversationId, instructorHeaders, adminHeaders, options) {
  logEvent("info", "stage_start", { ccu });
  const stageController = new AbortController();
  const broadcastMarker = `F05-B07-CCU${ccu}-${randomUUID().slice(0, 8)}`;

  // Gán mỗi CCU một phiên thực (<=500: mỗi CCU một tài khoản riêng; 1000 CCU: 500 tài khoản × 2 tab đồng thời).
  const virtualUsers = Array.from({ length: ccu }, (_, index) => ({
    index,
    headers: sessionsPool[index % sessionsPool.length].headers,
  }));

  // Pha A: Mở đồng loạt `ccu` kết nối SSE hợp nhất /realtime/events.
  const openStart = performance.now();
  const openedClients = await runWithConcurrency(virtualUsers, Math.min(100, ccu), (vu) =>
    openRealtimeSseClient(baseUrl, vu.headers, classConversationId, broadcastMarker, stageController),
  );
  const sseOpenDurationSeconds = Math.round(((performance.now() - openStart) / 1000) * 1000) / 1000;
  const activeSse = openedClients.filter((r) => r.ok).map((r) => r.value);
  const sseOpenErrors = openedClients.filter((r) => !r.ok).map((r) => r.error);

  try {
    // Chờ catch-up ban đầu hoàn tất rồi mới reset probe để đo thuần idle heartbeat vs DB query.
    await sleep(1500);
    await sendProbeMessage(child, "probe-reset");
    const idleMetricsBefore = await fetchApiMetrics(baseUrl, adminHeaders);
    await sleep(options.holdSeconds * 1000);
    const idleProbe = await sendProbeMessage(child, "probe-snapshot");
    const idleMetricsPeak = await fetchApiMetrics(baseUrl, adminHeaders);
    const totalHeartbeats = activeSse.reduce((sum, c) => sum + c.state.heartbeats, 0);

    // Pha B: Giữ toàn bộ kết nối SSE mở trong khi giảng viên gửi tin chat thật và CCU đọc hỗn hợp.
    await sendProbeMessage(child, "probe-reset");
    const broadcastStarted = performance.now();
    const broadcastRes = await fetch(
      `${baseUrl}/chat/conversations/${encodeURIComponent(classConversationId)}/messages`,
      {
        method: "POST",
        headers: { ...instructorHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          clientMessageId: broadcastMarker,
          content: `Kiểm thử tải realtime ${broadcastMarker}`,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const broadcastOk = broadcastRes.ok;
    const broadcastSendMs = Math.round((performance.now() - broadcastStarted) * 100) / 100;

    // Mỗi CCU chạy 1 vòng đọc hỗn hợp (class-detail, exams/page, notifications, chat-list) trong khi SSE vẫn mở.
    const mixedStart = performance.now();
    const readLatencies = [];
    const perOpLatencies = new Map();
    const statusBuckets = {};
    let http2xx = 0;
    let http4xx = 0;
    let http5xx = 0;
    let networkErrors = 0;

    /** Gửi một request đọc trong pha tải hỗn hợp và cập nhật đủ phân bố mã trạng thái lẫn độ trễ. */
    async function timedGet(opName, endpoint, headers) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${baseUrl}${endpoint}`, {
          headers,
          signal: AbortSignal.timeout(20_000),
        });
        await res.text();
        const ms = performance.now() - t0;
        readLatencies.push(ms);
        const list = perOpLatencies.get(opName) ?? [];
        list.push(ms);
        perOpLatencies.set(opName, list);
        const key = String(res.status);
        statusBuckets[key] = (statusBuckets[key] ?? 0) + 1;
        if (res.status >= 500) http5xx += 1;
        else if (res.status >= 400) http4xx += 1;
        else http2xx += 1;
      } catch {
        const ms = performance.now() - t0;
        readLatencies.push(ms);
        networkErrors += 1;
      }
    }

    const mixedResults = await runWithConcurrency(virtualUsers, ccu, async (vu) => {
      await timedGet("class-detail", `/classes/${encodeURIComponent(FIXTURE_CLASS_ID)}`, vu.headers);
      await timedGet("exams-page", "/exams/page?page=1&pageSize=20", vu.headers);
      await timedGet("notifications", "/notifications", vu.headers);
      await timedGet("chat-list", "/chat/conversations", vu.headers);
    });
    const mixedDurationSeconds = Math.round(((performance.now() - mixedStart) / 1000) * 1000) / 1000;
    // Chờ ngắn để mọi kết nối SSE kịp nhận gói đẩy chat fan-out.
    await sleep(1000);
    const mixedProbe = await sendProbeMessage(child, "probe-snapshot");
    const peakMetrics = await fetchApiMetrics(baseUrl, adminHeaders);
    const broadcastDeliveredCount = activeSse.filter((c) => c.state.receivedBroadcast).length;

    // Pha C: Đóng đồng loạt toàn bộ SSE và kiểm tra giải phóng sạch không rò rỉ watcher/socket.
    stageController.abort();
    await Promise.allSettled(activeSse.map((c) => c.pump));
    await sleep(1500);
    const afterDisconnectMetrics = await fetchApiMetrics(baseUrl, adminHeaders);

    const totalHttpRequests = http2xx + http4xx + http5xx + networkErrors;
    const error5xxRate = totalHttpRequests ? http5xx / totalHttpRequests : 0;
    const networkErrorRate = totalHttpRequests ? networkErrors / totalHttpRequests : 0;
    const sseOpenFailRate = ccu ? sseOpenErrors.length / ccu : 0;
    const overallP50Ms = percentile(readLatencies, 0.5);
    const overallP95Ms = percentile(readLatencies, 0.95);
    const overallP99Ms = percentile(readLatencies, 0.99);
    const rssMb = mixedProbe.process.rssMb;

    const stopReasons = [];
    if (error5xxRate > options.max5xxRate) {
      stopReasons.push(`Tỷ lệ HTTP 5xx (${(error5xxRate * 100).toFixed(2)}%) vượt ngưỡng ${(options.max5xxRate * 100).toFixed(1)}%.`);
    }
    if (networkErrorRate > options.max5xxRate) {
      stopReasons.push(`Tỷ lệ lỗi mạng/timeout (${(networkErrorRate * 100).toFixed(2)}%) vượt ngưỡng ${(options.max5xxRate * 100).toFixed(1)}%.`);
    }
    if (sseOpenFailRate > options.max5xxRate) {
      stopReasons.push(`Tỷ lệ mở SSE thất bại (${(sseOpenFailRate * 100).toFixed(2)}%) vượt ngưỡng ${(options.max5xxRate * 100).toFixed(1)}%.`);
    }
    if (overallP95Ms > options.maxP95Ms) {
      stopReasons.push(`Độ trễ p95 (${overallP95Ms} ms) vượt ngưỡng dừng ${options.maxP95Ms} ms.`);
    }
    if (rssMb > options.maxRssMb) {
      stopReasons.push(`RAM tiến trình (${rssMb} MB) vượt ngưỡng dừng ${options.maxRssMb} MB.`);
    }

    const operations = Object.fromEntries(
      [...perOpLatencies.entries()].map(([name, list]) => [
        name,
        {
          requests: list.length,
          p50Ms: percentile(list, 0.5),
          p95Ms: percentile(list, 0.95),
          p99Ms: percentile(list, 0.99),
        },
      ]),
    );

    const stageReport = {
      ccu,
      uniqueAccounts: Math.min(ccu, sessionsPool.length),
      tabsPerAccount: Math.ceil(ccu / sessionsPool.length),
      sseIdleHold: {
        holdSeconds: options.holdSeconds,
        sseOpened: activeSse.length,
        sseOpenFailed: sseOpenErrors.length,
        sampleOpenErrors: sseOpenErrors.slice(0, 5),
        sseOpenDurationSeconds,
        sseOpenP95Ms: percentile(activeSse.map((c) => c.state.openMs), 0.95),
        heartbeatsReceived: totalHeartbeats,
        idleSqlQueriesTotal: idleProbe.sql.totalQueries,
        idleBackgroundSqlNote: "Bao gồm 1 request admin GET /observability/metrics và worker định kỳ nếu trùng nhịp; heartbeat SSE không truy vấn DB.",
        peakActiveSseReported: idleMetricsPeak?.sse?.activeConnections ?? null,
        peakBusWatchersReported: idleMetricsPeak?.sse?.activeBusWatchers ?? null,
        listenerConnected: idleMetricsPeak?.sse?.listenerConnected ?? null,
        eventsReceivedBefore: idleMetricsBefore?.sse?.eventsReceived ?? null,
        eventsReceivedAfterIdle: idleMetricsPeak?.sse?.eventsReceived ?? null,
      },
      mixedLoadWithOpenSse: {
        durationSeconds: mixedDurationSeconds,
        totalHttpRequests,
        requestsPerSecond:
          mixedDurationSeconds > 0 ? Math.round((totalHttpRequests / mixedDurationSeconds) * 100) / 100 : 0,
        http2xx,
        http4xx,
        http5xx,
        networkErrors,
        statusBuckets,
        failedWorkers: mixedResults.filter((r) => !r.ok).length,
        p50Ms: overallP50Ms,
        p95Ms: overallP95Ms,
        p99Ms: overallP99Ms,
        operations,
        chatBroadcast: {
          sentOk: broadcastOk,
          sendMs: broadcastSendMs,
          deliveredToOpenSseCount: broadcastDeliveredCount,
          openSseCount: activeSse.length,
        },
        sql: {
          totalQueries: mixedProbe.sql.totalQueries,
          queriesPerHttpRequest: totalHttpRequests
            ? Math.round((mixedProbe.sql.totalQueries / totalHttpRequests) * 100) / 100
            : 0,
          totalDurationMs: mixedProbe.sql.totalDurationMs,
          topFingerprints: mixedProbe.sql.topFingerprints.slice(0, 8),
        },
        pool: mixedProbe.pool,
        apiReportedPool: peakMetrics?.databasePool ?? null,
        process: mixedProbe.process,
      },
      leakCheckAfterDisconnect: {
        activeSseConnections: afterDisconnectMetrics?.sse?.activeConnections ?? null,
        activeBusWatchers: afterDisconnectMetrics?.sse?.activeBusWatchers ?? null,
        poolWaitingCount: afterDisconnectMetrics?.databasePool?.waitingCount ?? null,
        leakFree:
          (afterDisconnectMetrics?.sse?.activeConnections ?? -1) === 0 &&
          (afterDisconnectMetrics?.sse?.activeBusWatchers ?? -1) === 0,
      },
      stopThresholdTriggered: stopReasons.length > 0,
      stopReasons,
    };

    logEvent("info", "stage_done", {
      ccu,
      sseOpened: activeSse.length,
      heartbeats: totalHeartbeats,
      idleSql: idleProbe.sql.totalQueries,
      p95Ms: overallP95Ms,
      http5xx,
      networkErrors,
      rssMb,
      leakFree: stageReport.leakCheckAfterDisconnect.leakFree,
      stopped: stageReport.stopThresholdTriggered,
    });
    return stageReport;
  } finally {
    stageController.abort();
    await Promise.allSettled(activeSse.map((c) => c.pump));
  }
}

/** Chạy kiểm thử tải phân tầng 100 -> 500 -> 1000 CCU có ngưỡng dừng tự động và kiểm tra rò rỉ SSE. */
async function main() {
  const options = parseAndValidateOptions();
  const git = readGitMetadata();
  const { learners, postgres } = await loadStagedFixtureLearners(options.database);
  await assertPortAvailable(options.port);
  const baseUrl = `http://127.0.0.1:${options.port}/api/v1`;

  const child = spawn(
    process.execPath,
    ["--import", "./scripts/benchmark-probe-preload.mjs", "dist/src/main.js"],
    {
      cwd: apiDirectory,
      windowsHide: true,
      env: {
        ...process.env,
        DB_NAME: options.database,
        DB_POOL_MAX: String(options.poolMax),
        UV_THREADPOOL_SIZE: String(options.uvThreadpoolSize),
        SCRYPT_MAX_CONCURRENCY: String(options.scryptMaxConcurrency),
        API_PORT: String(options.port),
        NODE_ENV: "test",
        DATABASE_CONNECT_ON_START: "true",
        RATE_LIMIT_MAX: "1000000",
        RATE_LIMIT_IP_MAX: "1000000",
        AUTH_RATE_LIMIT_MAX: "1000000",
        RESEND_API_KEY: "",
        RESEND_FROM: "",
        STORAGE_PROVIDER: "local",
        STORAGE_ROOT: path.join(apiDirectory, "test", "results", "benchmark", "storage"),
      },
      stdio: ["ignore", values.verbose ? "inherit" : "ignore", values.verbose ? "inherit" : "ignore", "ipc"],
    },
  );
  const exited = once(child, "exit");

  const authenticatedSessions = [];
  let instructorHeaders;
  let adminHeaders;

  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) throw new Error("API dừng sớm trước khi sẵn sàng.");
      ready = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    if (!ready) throw new Error("API chưa sẵn sàng sau 30 giây.");

    adminHeaders = await loginAccount(baseUrl, "admin@wind.edu.vn", "SYSTEM_ADMIN");
    instructorHeaders = await loginAccount(baseUrl, "instructor@wind.edu.vn", "INSTRUCTOR");
    const openChatRes = await fetch(`${baseUrl}/chat/conversations/class`, {
      method: "POST",
      headers: { ...instructorHeaders, "content-type": "application/json" },
      body: JSON.stringify({ classId: FIXTURE_CLASS_ID }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!openChatRes.ok) throw new Error(`Không mở được hội thoại lớp ${FIXTURE_CLASS_ID}: HTTP ${openChatRes.status}`);
    const classConversationId = (await openChatRes.json()).data.id;

    // Đăng nhập trước số lượng học viên tối đa cần cho các nấc tải (tối đa 500 tài khoản duy nhất).
    const maxUniqueNeeded = Math.min(Math.max(...options.stages), learners.length);
    const loginStarted = performance.now();
    const loginWave = await runWithConcurrency(learners.slice(0, maxUniqueNeeded), 50, async (learner) => ({
      id: learner.id,
      headers: await loginAccount(baseUrl, learner.username, "LEARNER"),
    }));
    const loginWaveSeconds = Math.round(((performance.now() - loginStarted) / 1000) * 100) / 100;
    const loginFailures = loginWave.filter((r) => !r.ok);
    if (loginFailures.length) {
      throw new Error(`Chuẩn bị phiên đăng nhập thất bại ${loginFailures.length}/${maxUniqueNeeded}: ${loginFailures[0].error}`);
    }
    for (const item of loginWave) authenticatedSessions.push(item.value);
    logEvent("info", "sessions_ready", { uniqueSessions: authenticatedSessions.length, loginWaveSeconds });

    const stageReports = [];
    let stoppedAtStage = null;
    let stopReasons = [];

    for (const ccu of options.stages) {
      if (child.exitCode !== null) {
        stoppedAtStage = ccu;
        stopReasons = ["Tiến trình API thoát đột ngột trước khi bắt đầu nấc tải."];
        break;
      }
      const report = await runLoadStage(
        child,
        baseUrl,
        ccu,
        authenticatedSessions,
        classConversationId,
        instructorHeaders,
        adminHeaders,
        options,
      );
      stageReports.push(report);
      if (report.stopThresholdTriggered) {
        stoppedAtStage = ccu;
        stopReasons = report.stopReasons;
        break;
      }
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      label: options.label,
      git,
      environment: {
        nodeVersion: process.version,
        platform: `${os.platform()} ${os.release()}`,
        cpuModel: os.cpus()[0]?.model ?? "unknown",
        cpuCores: os.cpus().length,
        totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
      },
      config: {
        database: options.database,
        classId: FIXTURE_CLASS_ID,
        stages: options.stages,
        holdSeconds: options.holdSeconds,
        stopThresholds: {
          max5xxRate: options.max5xxRate,
          maxP95Ms: options.maxP95Ms,
          maxRssMb: options.maxRssMb,
        },
        poolMax: options.poolMax,
        uvThreadpoolSize: options.uvThreadpoolSize,
        scryptMaxConcurrency: options.scryptMaxConcurrency,
      },
      postgres,
      sessionWarmup: {
        uniqueLearnersLoggedIn: authenticatedSessions.length,
        durationSeconds: loginWaveSeconds,
      },
      stages: stageReports,
      stoppedAtStage,
      stopReasons,
      limitsNote:
        "Đo trên 1 máy Windows cục bộ chạy đồng thời API Node.js + PostgreSQL (max_connections=100) + tiến trình sinh tải. Nấc 1000 CCU dùng 500 tài khoản × 2 tab đồng thời. Kết quả phản ánh giới hạn thực tế của môi trường cục bộ, không phải bảo chứng năng lực hạ tầng production đa node.",
    };

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const compact = {
      outputPath: options.outputPath,
      stoppedAtStage,
      stopReasons,
      stages: stageReports.map((s) => ({
        ccu: s.ccu,
        sseOpened: s.sseIdleHold.sseOpened,
        heartbeatsReceived: s.sseIdleHold.heartbeatsReceived,
        idleSqlQueriesTotal: s.sseIdleHold.idleSqlQueriesTotal,
        totalHttpRequests: s.mixedLoadWithOpenSse.totalHttpRequests,
        rps: s.mixedLoadWithOpenSse.requestsPerSecond,
        p50Ms: s.mixedLoadWithOpenSse.p50Ms,
        p95Ms: s.mixedLoadWithOpenSse.p95Ms,
        p99Ms: s.mixedLoadWithOpenSse.p99Ms,
        http5xx: s.mixedLoadWithOpenSse.http5xx,
        networkErrors: s.mixedLoadWithOpenSse.networkErrors,
        sqlTotal: s.mixedLoadWithOpenSse.sql.totalQueries,
        sqlPerHttp: s.mixedLoadWithOpenSse.sql.queriesPerHttpRequest,
        poolPeakQueue: s.mixedLoadWithOpenSse.pool.peakQueue,
        rssMb: s.mixedLoadWithOpenSse.process.rssMb,
        broadcastDelivered: `${s.mixedLoadWithOpenSse.chatBroadcast.deliveredToOpenSseCount}/${s.mixedLoadWithOpenSse.chatBroadcast.openSseCount}`,
        leakFree: s.leakCheckAfterDisconnect.leakFree,
      })),
    };
    process.stdout.write(`${JSON.stringify(compact, null, 2)}\n`);
  } finally {
    // Dọn phiên đăng nhập gọn trước khi tắt tiến trình API.
    await runWithConcurrency(authenticatedSessions, 50, async (s) => {
      await fetch(`${baseUrl}/auth/logout`, {
        method: "POST",
        headers: s.headers,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    }).catch(() => undefined);
    if (instructorHeaders) {
      await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: instructorHeaders }).catch(() => undefined);
    }
    if (adminHeaders) {
      await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: adminHeaders }).catch(() => undefined);
    }
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
