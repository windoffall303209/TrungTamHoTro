import { execFileSync, spawn } from "node:child_process";
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
    mode: { type: "string", default: "all" },
    database: { type: "string", default: process.env.WIND_TEST_DB_NAME ?? "wind_bench_review_20261123_test" },
    concurrency: { type: "string", default: "20" },
    iterations: { type: "string", default: "5" },
    runs: { type: "string", default: "3" },
    warmup: { type: "string", default: "1" },
    port: { type: "string", default: "4402" },
    label: { type: "string", default: "a02-standardized" },
    output: { type: "string" },
    "pool-max": { type: "string" },
    "uv-threadpool-size": { type: "string" },
    "scrypt-max-concurrency": { type: "string" },
    "scrypt-max-waiting": { type: "string" },
    "profile-login-concurrency": { type: "string", default: "20" },
    verbose: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
  strict: true,
});

const VALID_MODES = new Set(["all", "suite", "profile"]);

/** Ghi log có cấu trúc JSON ra stderr khi cần theo dõi chi tiết hoặc chế độ debug. */
function logEvent(level, event, details = {}) {
  if (level === "debug" && !values.debug) return;
  if (level === "info" && !values.verbose && !values.debug) return;
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details })}\n`,
  );
}

/** Kiểm tra và chuẩn hóa toàn bộ tham số dòng lệnh trước khi khởi chạy benchmark. */
function parseAndValidateOptions() {
  if (!VALID_MODES.has(values.mode)) {
    throw new Error(`Tham số --mode phải thuộc ${[...VALID_MODES].join(", ")}.`);
  }
  const database = values.database.trim();
  if (!/^[a-zA-Z0-9_]+_test$/.test(database) || database === process.env.DB_NAME) {
    throw new Error("Tham số --database phải kết thúc bằng _test và khác hoàn toàn DB_NAME ứng dụng.");
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(values.label)) {
    throw new Error("Tham số --label chỉ chấp nhận chữ, số, gạch dưới, gạch nối (1–80 ký tự).");
  }
  if (!process.env.SEED_DEFAULT_PASSWORD) {
    throw new Error("Thiếu biến môi trường SEED_DEFAULT_PASSWORD.");
  }
  const concurrency = Number(values.concurrency);
  const iterations = Number(values.iterations);
  const runs = Number(values.runs);
  const warmup = Number(values.warmup);
  const port = Number(values.port);
  const profileLoginConcurrency = Number(values["profile-login-concurrency"]);
  const poolMax = values["pool-max"] ? Number(values["pool-max"]) : Number(process.env.DB_POOL_MAX ?? 30);
  const uvThreadpoolSize = values["uv-threadpool-size"]
    ? Number(values["uv-threadpool-size"])
    : Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  const scryptMaxConcurrency = values["scrypt-max-concurrency"]
    ? Number(values["scrypt-max-concurrency"])
    : undefined;
  const scryptMaxWaiting = values["scrypt-max-waiting"]
    ? Number(values["scrypt-max-waiting"])
    : undefined;

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1000) {
    throw new Error("--concurrency phải là số nguyên từ 1 đến 1000.");
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100) {
    throw new Error("--iterations phải là số nguyên từ 1 đến 100.");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    throw new Error("--runs phải là số nguyên từ 1 đến 10.");
  }
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 5) {
    throw new Error("--warmup phải là số nguyên từ 0 đến 5.");
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("--port phải là số nguyên từ 1024 đến 65535.");
  }
  if (!Number.isInteger(profileLoginConcurrency) || profileLoginConcurrency < 1 || profileLoginConcurrency > 200) {
    throw new Error("--profile-login-concurrency phải từ 1 đến 200.");
  }
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 200) {
    throw new Error("--pool-max phải từ 1 đến 200.");
  }
  if (!Number.isInteger(uvThreadpoolSize) || uvThreadpoolSize < 2 || uvThreadpoolSize > 128) {
    throw new Error("--uv-threadpool-size phải từ 2 đến 128.");
  }
  if (scryptMaxConcurrency !== undefined && (!Number.isInteger(scryptMaxConcurrency) || scryptMaxConcurrency < 1 || scryptMaxConcurrency > 64)) {
    throw new Error("--scrypt-max-concurrency phải từ 1 đến 64.");
  }
  if (scryptMaxWaiting !== undefined && (!Number.isInteger(scryptMaxWaiting) || scryptMaxWaiting < 1 || scryptMaxWaiting > 2000)) {
    throw new Error("--scrypt-max-waiting phải từ 1 đến 2000.");
  }

  const outputPath = values.output
    ? path.resolve(repoDirectory, values.output)
    : path.join(apiDirectory, "test", "results", "benchmark", `${values.label}.json`);

  return {
    mode: values.mode,
    database,
    concurrency,
    iterations,
    runs,
    warmup,
    port,
    label: values.label,
    outputPath,
    poolMax,
    uvThreadpoolSize,
    scryptMaxConcurrency,
    scryptMaxWaiting,
    profileLoginConcurrency,
  };
}

/** Đọc thông tin commit và nhánh Git hiện tại để gắn vào artifact benchmark. */
function readGitMetadata() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDirectory, encoding: "utf8" }).trim();
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDirectory, encoding: "utf8" }).trim();
    return { commit, branch };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

/** Chờ khoảng thời gian ngắn có giới hạn khi khởi động hoặc giãn cách giữa các lượt đo. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Xác nhận cổng TCP nội bộ rảnh trước khi bật tiến trình API benchmark. */
async function assertPortAvailable(port) {
  const probe = createServer();
  probe.listen(port, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((resolve) => probe.close(resolve));
}

/** Thu thập kích thước fixture, cấu hình PostgreSQL và các ID mẫu từ database benchmark. */
async function inspectBenchmarkDatabase(database) {
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
    const [pgSettings, countsResult, classResult, directTargetResult] = await Promise.all([
      client.query("SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'shared_buffers', 'work_mem')"),
      client.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM learning_classes) AS classes,
        (SELECT count(*)::int FROM class_enrollments WHERE status = 'ACTIVE') AS active_enrollments,
        (SELECT count(*)::int FROM exams) AS exams,
        (SELECT count(*)::int FROM questions) AS questions,
        (SELECT count(*)::int FROM assignments) AS assignments,
        (SELECT count(*)::int FROM chat_conversations) AS chat_conversations,
        (SELECT count(*)::int FROM chat_messages) AS chat_messages,
        (SELECT count(*)::int FROM notifications) AS notifications`),
      client.query(`SELECT c.id, c.code, c.name
        FROM learning_classes c
        JOIN class_instructors ci ON ci.class_id = c.id AND ci.instructor_id = 'usr-instructor'
        JOIN class_enrollments ce ON ce.class_id = c.id AND ce.learner_id = 'usr-learner' AND ce.status = 'ACTIVE'
        WHERE c.status = 'ACTIVE'
        ORDER BY c.id LIMIT 1`),
      client.query(`SELECT id, username FROM users WHERE id = 'usr-instructor' AND status = 'ACTIVE' LIMIT 1`),
    ]);
    if (!classResult.rowCount) {
      throw new Error("Database benchmark chưa có lớp ACTIVE chung giữa usr-instructor và usr-learner.");
    }
    const pgConfig = Object.fromEntries(pgSettings.rows.map((row) => [row.name, row.setting]));
    return {
      postgres: {
        maxConnections: Number(pgConfig.max_connections ?? 0),
        sharedBuffers: pgConfig.shared_buffers ?? "",
        workMem: pgConfig.work_mem ?? "",
      },
      fixture: countsResult.rows[0],
      sampleClassId: classResult.rows[0].id,
      sampleDirectTargetId: directTargetResult.rows[0]?.id ?? "usr-instructor",
    };
  } finally {
    await client.end();
  }
}

/** Gửi thông điệp IPC tới tiến trình API benchmark có preload đo SQL và chờ phản hồi có timeout. */
async function sendProbeMessage(child, type) {
  const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const expectedType = `${type}-ok`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error(`Quá thời gian chờ phản hồi IPC ${type} từ tiến trình API.`));
    }, 10_000);
    /** Khớp đúng phản hồi IPC theo mã yêu cầu để tránh lẫn giữa các lệnh liên tiếp. */
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

/** Tính phân vị nearest-rank làm tròn 2 chữ số thập phân. */
function percentile(sortedNumbers, fraction) {
  if (!sortedNumbers.length) return 0;
  const idx = Math.max(0, Math.min(sortedNumbers.length - 1, Math.ceil(sortedNumbers.length * fraction) - 1));
  return Math.round(sortedNumbers[idx] * 100) / 100;
}

/** Tổng hợp danh sách mẫu độ trễ HTTP, phân tách rõ số lỗi theo mã trạng thái và dung lượng. */
function summarizeSamples(samples) {
  const times = samples.map((item) => item.ms).sort((a, b) => a - b);
  const statusCounts = {};
  let httpErrors = 0;
  let networkErrors = 0;
  for (const sample of samples) {
    const codeKey = String(sample.statusCode ?? "ERR");
    statusCounts[codeKey] = (statusCounts[codeKey] ?? 0) + 1;
    if (sample.networkError) networkErrors += 1;
    else if (!sample.ok) httpErrors += 1;
  }
  const avgBytes = samples.length
    ? Math.round(samples.reduce((sum, item) => sum + item.bytes, 0) / samples.length)
    : 0;
  const avgMs = samples.length
    ? Math.round((samples.reduce((sum, item) => sum + item.ms, 0) / samples.length) * 100) / 100
    : 0;
  return {
    requests: samples.length,
    httpErrors,
    networkErrors,
    statusCounts,
    avgMs,
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95),
    p99Ms: percentile(times, 0.99),
    maxMs: times.length ? Math.round(times[times.length - 1] * 100) / 100 : 0,
    averageBytes: avgBytes,
  };
}

/** Tạo bộ đếm mẫu cho một lượt đo và gửi HTTP request có timeout cùng phân loại lỗi rõ ràng. */
function createHttpClient(baseUrl) {
  const buckets = new Map();

  /** Thực thi một request HTTP, ghi độ trễ, kích thước và phân tách lỗi mạng với lỗi HTTP. */
  async function request(name, endpoint, options = {}) {
    const startedAt = performance.now();
    let statusCode = 0;
    let ok = false;
    let bytes = 0;
    let networkError = false;
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        signal: AbortSignal.timeout(20_000),
      });
      statusCode = response.status;
      const bodyText = await response.text();
      bytes = Buffer.byteLength(bodyText);
      ok = response.ok;
      if (!ok) {
        throw new Error(`HTTP_${statusCode}:${name}`);
      }
      const parsed = bodyText ? JSON.parse(bodyText) : {};
      return { response, data: parsed.data, statusCode, ms: performance.now() - startedAt };
    } catch (error) {
      if (statusCode === 0) networkError = true;
      throw error;
    } finally {
      const list = buckets.get(name) ?? [];
      list.push({ ms: performance.now() - startedAt, bytes, ok, statusCode, networkError });
      buckets.set(name, list);
    }
  }

  /** Đăng nhập tài khoản seed và trả về cặp header Cookie/CSRF/Role sẵn sàng dùng. */
  async function loginSession(username, roleCode, metricName = "login") {
    const { response, data, ms } = await request(metricName, "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username,
        password: process.env.SEED_DEFAULT_PASSWORD,
        rememberMe: false,
      }),
    });
    const cookie = response.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; ");
    if (!cookie || !data?.csrfToken) {
      throw new Error("Không nhận được cookie phiên hoặc csrfToken hợp lệ.");
    }
    return {
      headers: {
        cookie,
        "x-role-code": roleCode,
        "x-csrf-token": data.csrfToken,
      },
      loginMs: ms,
    };
  }

  /** Đóng phiên an toàn sau khi hoàn tất lượt đo. */
  async function logoutSession(headers) {
    await fetch(`${baseUrl}/auth/logout`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  /** Xuất báo cáo tóm tắt cho mọi thao tác đã ghi trong bộ đếm hiện tại. */
  function summary() {
    const operations = Object.fromEntries(
      [...buckets.entries()].map(([name, samples]) => [name, summarizeSamples(samples)]),
    );
    let totalRequests = 0;
    let totalHttpErrors = 0;
    let totalNetworkErrors = 0;
    for (const op of Object.values(operations)) {
      totalRequests += op.requests;
      totalHttpErrors += op.httpErrors;
      totalNetworkErrors += op.networkErrors;
    }
    return { totalRequests, totalHttpErrors, totalNetworkErrors, operations };
  }

  return { request, loginSession, logoutSession, summary };
}

/** Chạy pha A03: profile từng endpoint riêng lẻ để đếm đúng số SQL, độ trễ DB và độ trễ ứng dụng/scrypt. */
async function runEndpointProfiles(child, baseUrl, dbInfo, options) {
  logEvent("info", "profile_start");
  const setupClient = createHttpClient(baseUrl);
  const learner = await setupClient.loginSession("learner@wind.edu.vn", "LEARNER", "setup-login");
  const instructor = await setupClient.loginSession("instructor@wind.edu.vn", "INSTRUCTOR", "setup-login");
  const admin = await setupClient.loginSession("admin@wind.edu.vn", "SYSTEM_ADMIN", "setup-login");

  // Đảm bảo có sẵn hội thoại lớp để đo listMessages.
  const openedClass = await setupClient.request("setup-open-class", "/chat/conversations/class", {
    method: "POST",
    headers: { ...learner.headers, "content-type": "application/json" },
    body: JSON.stringify({ classId: dbInfo.sampleClassId }),
  });
  const classConversationId = openedClass.data.id;

  const profiles = {};

  /** Chạy một phép profile cô lập với N lượt lặp và đếm chính xác SQL thực cho từng request. */
  async function profileEndpoint(key, repeatCount, fn) {
    await sendProbeMessage(child, "probe-reset");
    const startedAt = performance.now();
    const durations = [];
    for (let i = 0; i < repeatCount; i += 1) {
      const t0 = performance.now();
      await fn(i);
      durations.push(performance.now() - t0);
    }
    const totalWallMs = performance.now() - startedAt;
    const probe = await sendProbeMessage(child, "probe-snapshot");
    durations.sort((a, b) => a - b);
    profiles[key] = {
      requests: repeatCount,
      avgHttpMs: Math.round((durations.reduce((a, b) => a + b, 0) / repeatCount) * 100) / 100,
      p95HttpMs: percentile(durations, 0.95),
      wallMs: Math.round(totalWallMs * 100) / 100,
      sqlQueriesTotal: probe.sql.totalQueries,
      sqlQueriesPerRequest: Math.round((probe.sql.totalQueries / repeatCount) * 100) / 100,
      sqlMsPerRequest: Math.round((probe.sql.totalDurationMs / repeatCount) * 100) / 100,
      nonSqlMsPerRequest: Math.round(
        (Math.max(0, totalWallMs - probe.sql.totalDurationMs) / repeatCount) * 100,
      ) / 100,
      poolQueued: probe.pool.queued,
      poolPeakQueue: probe.pool.peakQueue,
      topSql: probe.sql.topFingerprints.slice(0, 10),
    };
    logEvent("debug", "profile_endpoint_done", {
      endpoint: key,
      sqlPerReq: profiles[key].sqlQueriesPerRequest,
      avgMs: profiles[key].avgHttpMs,
    });
  }

  try {
    // 1. Login đơn lẻ: tách rõ thời gian SQL và thời gian scrypt/CPU.
    const singleLoginSessions = [];
    await profileEndpoint("POST /auth/login (single)", 5, async () => {
      const s = await setupClient.loginSession("learner@wind.edu.vn", "LEARNER", "profile-login-single");
      singleLoginSessions.push(s.headers);
    });
    for (const h of singleLoginSessions) await setupClient.logoutSession(h);

    // 2. Login đồng thời (A03/A05): đo tắc scrypt + hàng đợi pool khi nhiều người đăng nhập cùng lúc.
    await sendProbeMessage(child, "probe-reset");
    const concurrentStart = performance.now();
    const loginClient = createHttpClient(baseUrl);
    const loginWorkers = await Promise.allSettled(
      Array.from({ length: options.profileLoginConcurrency }, async (_, idx) => {
        const username = idx % 2 === 0 ? "learner@wind.edu.vn" : "instructor@wind.edu.vn";
        const role = idx % 2 === 0 ? "LEARNER" : "INSTRUCTOR";
        const session = await loginClient.loginSession(username, role, "profile-login-concurrent");
        return session.headers;
      }),
    );
    const concurrentWallMs = performance.now() - concurrentStart;
    const concurrentProbe = await sendProbeMessage(child, "probe-snapshot");
    const loginSummary = loginClient.summary();
    profiles[`POST /auth/login (${options.profileLoginConcurrency} concurrent)`] = {
      concurrency: options.profileLoginConcurrency,
      wallMs: Math.round(concurrentWallMs * 100) / 100,
      failedWorkers: loginWorkers.filter((r) => r.status === "rejected").map((r) => r.reason?.message ?? String(r.reason)),
      http: loginSummary.operations["profile-login-concurrent"],
      sqlQueriesTotal: concurrentProbe.sql.totalQueries,
      sqlQueriesPerRequest: Math.round((concurrentProbe.sql.totalQueries / options.profileLoginConcurrency) * 100) / 100,
      sqlDurationTotalMs: concurrentProbe.sql.totalDurationMs,
      pool: concurrentProbe.pool,
      topSql: concurrentProbe.sql.topFingerprints.slice(0, 8),
    };
    for (const result of loginWorkers) {
      if (result.status === "fulfilled") await setupClient.logoutSession(result.value);
    }

    // 3. Các endpoint đọc nóng và chat (A03 + A06).
    await profileEndpoint("GET /auth/session", 5, () =>
      setupClient.request("p-session", "/auth/session", { headers: learner.headers }),
    );
    await profileEndpoint("GET /classes (learner)", 5, () =>
      setupClient.request("p-classes-learner", "/classes", { headers: learner.headers }),
    );
    await profileEndpoint("GET /classes (instructor)", 5, () =>
      setupClient.request("p-classes-instructor", "/classes", { headers: instructor.headers }),
    );
    await profileEndpoint("GET /classes/:id (learner)", 5, () =>
      setupClient.request("p-class-detail", `/classes/${encodeURIComponent(dbInfo.sampleClassId)}`, {
        headers: learner.headers,
      }),
    );
    await profileEndpoint("GET /exams/page (learner)", 5, () =>
      setupClient.request("p-exams-learner", "/exams/page?page=1&pageSize=20", { headers: learner.headers }),
    );
    await profileEndpoint("GET /exams/page (instructor)", 5, () =>
      setupClient.request("p-exams-instructor", "/exams/page?page=1&pageSize=20", { headers: instructor.headers }),
    );
    await profileEndpoint("GET /notifications (learner)", 5, () =>
      setupClient.request("p-notifications", "/notifications", { headers: learner.headers }),
    );
    await profileEndpoint("GET /academic/classes/:id/gradebook (instructor)", 5, () =>
      setupClient.request(
        "p-gradebook",
        `/academic/classes/${encodeURIComponent(dbInfo.sampleClassId)}/gradebook`,
        { headers: instructor.headers },
      ),
    );
    await profileEndpoint("GET /chat/conversations (chat-list)", 5, () =>
      setupClient.request("p-chat-list", "/chat/conversations", { headers: learner.headers }),
    );
    await profileEndpoint("POST /chat/conversations/class (chat-open-class)", 5, () =>
      setupClient.request("p-chat-open-class", "/chat/conversations/class", {
        method: "POST",
        headers: { ...learner.headers, "content-type": "application/json" },
        body: JSON.stringify({ classId: dbInfo.sampleClassId }),
      }),
    );
    await profileEndpoint("POST /chat/conversations/direct (chat-open-direct)", 5, () =>
      setupClient.request("p-chat-open-direct", "/chat/conversations/direct", {
        method: "POST",
        headers: { ...learner.headers, "content-type": "application/json" },
        body: JSON.stringify({ userId: dbInfo.sampleDirectTargetId }),
      }),
    );
    await profileEndpoint("GET /chat/conversations/:id/messages", 5, () =>
      setupClient.request(
        "p-chat-messages",
        `/chat/conversations/${encodeURIComponent(classConversationId)}/messages?limit=40`,
        { headers: learner.headers },
      ),
    );
    await profileEndpoint("GET /system/dashboard-summary (admin)", 3, () =>
      setupClient.request("p-dashboard", "/system/dashboard-summary", { headers: admin.headers }),
    );

    return profiles;
  } finally {
    await Promise.all([
      setupClient.logoutSession(learner.headers),
      setupClient.logoutSession(instructor.headers),
      setupClient.logoutSession(admin.headers),
    ]);
  }
}

/** Chạy một lượt workload chuẩn A02 gồm login, đọc lớp/đề/thông báo, mở/liệt kê chat và đăng xuất. */
async function runStandardizedWorkload(child, baseUrl, dbInfo, options, phaseLabel) {
  await sendProbeMessage(child, "probe-reset");
  const client = createHttpClient(baseUrl);
  const startedAt = performance.now();

  const workerResults = await Promise.allSettled(
    Array.from({ length: options.concurrency }, async (_, index) => {
      const isLearner = index % 2 === 0;
      const username = isLearner ? "learner@wind.edu.vn" : "instructor@wind.edu.vn";
      const roleCode = isLearner ? "LEARNER" : "INSTRUCTOR";
      const { headers } = await client.loginSession(username, roleCode, "login");
      try {
        for (let iter = 0; iter < options.iterations; iter += 1) {
          await client.request("class-detail", `/classes/${encodeURIComponent(dbInfo.sampleClassId)}`, { headers });
          await client.request(
            isLearner ? "learner-exams-page" : "instructor-exams-page",
            "/exams/page?page=1&pageSize=20",
            { headers },
          );
          await client.request("notifications", "/notifications", { headers });
          await client.request("chat-list", "/chat/conversations", { headers });
        }
        const openedClass = await client.request("chat-open-class", "/chat/conversations/class", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ classId: dbInfo.sampleClassId }),
        });
        if (isLearner) {
          await client.request("chat-open-direct", "/chat/conversations/direct", {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ userId: dbInfo.sampleDirectTargetId }),
          });
        }
        await client.request(
          "chat-messages",
          `/chat/conversations/${encodeURIComponent(openedClass.data.id)}/messages?limit=40`,
          { headers },
        );
      } finally {
        await client.logoutSession(headers);
      }
    }),
  );

  const durationSeconds = Math.round(((performance.now() - startedAt) / 1000) * 1000) / 1000;
  const probe = await sendProbeMessage(child, "probe-snapshot");
  const httpSummary = client.summary();
  const failedWorkers = workerResults
    .filter((item) => item.status === "rejected")
    .map((item) => (item.reason instanceof Error ? item.reason.message : String(item.reason)));

  const result = {
    phase: phaseLabel,
    durationSeconds,
    requestsPerSecond: durationSeconds > 0 ? Math.round((httpSummary.totalRequests / durationSeconds) * 100) / 100 : 0,
    totalHttpRequests: httpSummary.totalRequests,
    totalHttpErrors: httpSummary.totalHttpErrors,
    totalNetworkErrors: httpSummary.totalNetworkErrors,
    failedWorkerCount: failedWorkers.length,
    failedWorkers: failedWorkers.slice(0, 20),
    sqlQueriesTotal: probe.sql.totalQueries,
    sqlQueriesPerHttpRequest: httpSummary.totalRequests
      ? Math.round((probe.sql.totalQueries / httpSummary.totalRequests) * 100) / 100
      : 0,
    sqlTotalDurationMs: probe.sql.totalDurationMs,
    sqlQueryErrors: probe.sql.queryErrors,
    pool: probe.pool,
    process: probe.process,
    operations: httpSummary.operations,
    topSql: probe.sql.topFingerprints.slice(0, 15),
  };
  logEvent("info", "workload_phase_done", {
    phase: phaseLabel,
    durationSeconds,
    totalHttpRequests: result.totalHttpRequests,
    sqlQueriesTotal: result.sqlQueriesTotal,
    sqlPerHttp: result.sqlQueriesPerHttpRequest,
    httpErrors: result.totalHttpErrors,
    failedWorkers: result.failedWorkerCount,
  });
  return result;
}

/** Tổng hợp giá trị trung bình và trung vị qua nhiều lượt đo liên tiếp của A02. */
function aggregateSuiteRuns(runs) {
  if (!runs.length) return undefined;
  /** Lấy giá trị trung bình làm tròn 2 chữ số thập phân trên mảng số. */
  const mean = (nums) => Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  const opNames = [...new Set(runs.flatMap((run) => Object.keys(run.operations)))];
  const operations = Object.fromEntries(
    opNames.map((name) => {
      const items = runs.map((run) => run.operations[name]).filter(Boolean);
      return [
        name,
        {
          avgP50Ms: mean(items.map((x) => x.p50Ms)),
          avgP95Ms: mean(items.map((x) => x.p95Ms)),
          avgP99Ms: mean(items.map((x) => x.p99Ms)),
          totalHttpErrors: items.reduce((s, x) => s + x.httpErrors, 0),
          totalNetworkErrors: items.reduce((s, x) => s + x.networkErrors, 0),
        },
      ];
    }),
  );
  return {
    runCount: runs.length,
    meanDurationSeconds: mean(runs.map((r) => r.durationSeconds)),
    meanRequestsPerSecond: mean(runs.map((r) => r.requestsPerSecond)),
    meanSqlQueriesTotal: mean(runs.map((r) => r.sqlQueriesTotal)),
    meanSqlQueriesPerHttpRequest: mean(runs.map((r) => r.sqlQueriesPerHttpRequest)),
    meanPoolQueued: mean(runs.map((r) => r.pool.queued)),
    maxPoolPeakQueue: Math.max(...runs.map((r) => r.pool.peakQueue)),
    maxRssMb: Math.max(...runs.map((r) => r.process.rssMb)),
    totalHttpErrors: runs.reduce((s, r) => s + r.totalHttpErrors, 0),
    totalNetworkErrors: runs.reduce((s, r) => s + r.totalNetworkErrors, 0),
    totalFailedWorkers: runs.reduce((s, r) => s + r.failedWorkerCount, 0),
    operations,
  };
}

/** Khởi động API build cục bộ gắn preload đếm SQL thực, chạy đủ pha đo và lưu artifact JSON. */
async function main() {
  const options = parseAndValidateOptions();
  const git = readGitMetadata();
  const dbInfo = await inspectBenchmarkDatabase(options.database);
  await assertPortAvailable(options.port);
  const baseUrl = `http://127.0.0.1:${options.port}/api/v1`;

  const childEnv = {
    ...process.env,
    DB_NAME: options.database,
    DB_POOL_MAX: String(options.poolMax),
    UV_THREADPOOL_SIZE: String(options.uvThreadpoolSize),
    ...(options.scryptMaxConcurrency !== undefined
      ? { SCRYPT_MAX_CONCURRENCY: String(options.scryptMaxConcurrency) }
      : {}),
    ...(options.scryptMaxWaiting !== undefined
      ? { SCRYPT_MAX_WAITING: String(options.scryptMaxWaiting) }
      : {}),
    API_PORT: String(options.port),
    NODE_ENV: "test",
    DATABASE_CONNECT_ON_START: "true",
    RATE_LIMIT_MAX: "100000",
    RATE_LIMIT_IP_MAX: "100000",
    AUTH_RATE_LIMIT_MAX: "100000",
    RESEND_API_KEY: "",
    RESEND_FROM: "",
    STORAGE_PROVIDER: "local",
    STORAGE_ROOT: path.join(apiDirectory, "test", "results", "benchmark", "storage"),
  };

  logEvent("info", "api_spawn", { port: options.port, database: options.database, poolMax: options.poolMax });
  const child = spawn(
    process.execPath,
    ["--import", "./scripts/benchmark-probe-preload.mjs", "dist/src/main.js"],
    {
      cwd: apiDirectory,
      windowsHide: true,
      env: childEnv,
      stdio: ["ignore", values.verbose ? "inherit" : "ignore", values.verbose ? "inherit" : "ignore", "ipc"],
    },
  );
  const exited = once(child, "exit");

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) {
        throw new Error("Tiến trình API benchmark thoát sớm trước khi sẵn sàng; dùng --verbose để xem lỗi.");
      }
      ready = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })
        .then((res) => res.ok)
        .catch(() => false);
      if (ready) break;
      await sleep(500);
    }
    if (!ready) {
      throw new Error("Tiến trình API benchmark không sẵn sàng sau 30 giây.");
    }

    let profiles;
    if (options.mode === "profile" || options.mode === "all") {
      profiles = await runEndpointProfiles(child, baseUrl, dbInfo, options);
    }

    const warmups = [];
    const runs = [];
    if (options.mode === "suite" || options.mode === "all") {
      for (let w = 0; w < options.warmup; w += 1) {
        warmups.push(await runStandardizedWorkload(child, baseUrl, dbInfo, options, `warmup-${w + 1}`));
      }
      for (let r = 0; r < options.runs; r += 1) {
        runs.push(await runStandardizedWorkload(child, baseUrl, dbInfo, options, `run-${r + 1}`));
      }
    }

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      label: options.label,
      mode: options.mode,
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
        poolMax: options.poolMax,
        poolConnectionTimeoutMs: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 5000),
        statementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 15000),
        uvThreadpoolSize: options.uvThreadpoolSize,
        scryptMaxConcurrency: options.scryptMaxConcurrency ?? Math.max(1, Math.floor(options.uvThreadpoolSize / 2)),
        scryptMaxWaiting: options.scryptMaxWaiting ?? 256,
        concurrency: options.concurrency,
        iterations: options.iterations,
        warmupRounds: options.warmup,
        measuredRuns: options.runs,
        profileLoginConcurrency: options.profileLoginConcurrency,
      },
      postgres: dbInfo.postgres,
      fixture: dbInfo.fixture,
      profiles,
      warmups,
      runs,
      aggregate: aggregateSuiteRuns(runs),
      note: "Chạy trên API build cục bộ + PostgreSQL test riêng; đếm trực tiếp mọi câu SQL qua pg.Client.prototype.query, không dùng số pool queued thay thế.",
    };

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputPath: options.outputPath, aggregate: report.aggregate }, null, 2)}\n`);

    if (
      report.aggregate &&
      (report.aggregate.totalHttpErrors > 0 ||
        report.aggregate.totalNetworkErrors > 0 ||
        report.aggregate.totalFailedWorkers > 0)
    ) {
      process.exitCode = 1;
    }
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
