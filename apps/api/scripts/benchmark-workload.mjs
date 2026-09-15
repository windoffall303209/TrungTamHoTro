import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "dotenv";
import pg from "pg";

const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: {
  concurrency: { type: "string", default: "10" }, iterations: { type: "string", default: "20" },
  label: { type: "string", default: "baseline" }, verbose: { type: "boolean", default: false },
  "fixture-exams": { type: "string", default: "0" },
}, strict: true });
const concurrency = Number(values.concurrency);
const iterations = Number(values.iterations);
const database = process.env.WIND_TEST_DB_NAME ?? "trung_tam_giang_day_benchmark_test";
const fixtureExams = Number(values["fixture-exams"]);
const base = "http://127.0.0.1:4401/api/v1";
const measurements = new Map();

/** Tạo bộ đề tổng hợp có khóa riêng trong database benchmark, không sửa đề seed hay dữ liệu ứng dụng. */
async function prepareFixture() {
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    const source = await client.query(`SELECT e.id FROM exams e
      JOIN class_instructors i ON i.class_id = e.class_id AND i.instructor_id = 'usr-instructor'
      JOIN class_enrollments l ON l.class_id = e.class_id AND l.learner_id = 'usr-learner'
      WHERE e.status = 'PUBLISHED' AND e.id NOT LIKE 'benchmark-load-%' ORDER BY e.id LIMIT 1`);
    if (!source.rowCount) throw new Error("Database benchmark chưa có đề seed phù hợp.");
    if (fixtureExams > 0) {
      await client.query("BEGIN");
      await client.query(`INSERT INTO exams (id, class_id, title, duration_minutes, total_score, open_at, close_at,
        attempt_limit, shuffle_questions, status, version, created_at, updated_at)
        SELECT 'benchmark-load-' || n, e.class_id, 'Benchmark load ' || n, e.duration_minutes, e.total_score,
          e.open_at, e.close_at, e.attempt_limit, false, e.status, 1, now(), now()
        FROM exams e CROSS JOIN generate_series(1, $2::int) n WHERE e.id = $1 ON CONFLICT (id) DO NOTHING`, [source.rows[0].id, fixtureExams]);
      await client.query(`INSERT INTO exam_questions (exam_id, question_id, position, score)
        SELECT 'benchmark-load-' || n, q.question_id, q.position, q.score
        FROM exam_questions q CROSS JOIN generate_series(1, $2::int) n
        WHERE q.exam_id = $1 ON CONFLICT DO NOTHING`, [source.rows[0].id, fixtureExams]);
      await client.query("COMMIT");
    }
    return Number((await client.query("SELECT count(*) AS count FROM exams")).rows[0].count);
  } finally { await client.end(); }
}

/** Chờ ngắn có giới hạn để kiểm tra tiến trình API riêng khởi động xong. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tổng hợp độ trễ, dung lượng và lỗi theo từng nghiệp vụ, không ghi cookie hoặc mật khẩu. */
function summarize(samples) {
  const times = samples.map((item) => item.ms).sort((a, b) => a - b);
  /** Lấy phân vị nearest-rank và làm tròn thời gian đến phần trăm mili giây. */
  const percentile = (fraction) => Math.round(times[Math.max(0, Math.ceil(times.length * fraction) - 1)] * 100) / 100;
  return { requests: samples.length, errors: samples.filter((item) => !item.ok).length,
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    averageBytes: Math.round(samples.reduce((sum, item) => sum + item.bytes, 0) / samples.length) };
}

/** Gửi một request có timeout, đo cả thời gian nhận body và ghi trạng thái lỗi ổn định. */
async function measure(name, path, options = {}) {
  const started = performance.now();
  let ok = false;
  let bytes = 0;
  try {
    const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(15_000) });
    const body = await response.text();
    bytes = Buffer.byteLength(body);
    ok = response.ok;
    if (!ok) throw new Error(`${name}: HTTP ${response.status}`);
    return { response, data: JSON.parse(body).data };
  } finally {
    const samples = measurements.get(name) ?? [];
    samples.push({ ms: performance.now() - started, bytes, ok });
    measurements.set(name, samples);
  }
}

/** Tạo phiên riêng cho mỗi người dùng ảo rồi tải luân phiên danh sách lớp và đề. */
async function worker(index) {
  const learner = index % 2 === 0;
  const username = learner ? "learner@wind.edu.vn" : "instructor@wind.edu.vn";
  const role = learner ? "LEARNER" : "INSTRUCTOR";
  const { response, data } = await measure("login", "/auth/login", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: process.env.SEED_DEFAULT_PASSWORD, rememberMe: false }),
  });
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  if (!cookie || !data.csrfToken) throw new Error("Benchmark không nhận được phiên seed hợp lệ.");
  const headers = { cookie, "x-role-code": role, "x-csrf-token": data.csrfToken };
  try {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await measure("classes", "/classes", { headers });
      await measure(learner ? "learner-exams" : "instructor-exams",
        learner ? "/learner/exams?page=1&pageSize=20" : "/exams?page=1&pageSize=20", { headers });
    }
  } finally {
    await fetch(base + "/auth/logout", { method: "POST", headers, signal: AbortSignal.timeout(10_000) });
  }
}

/** Chạy API build riêng trên database test, đo tải và luôn dừng đúng tiến trình do script tạo. */
async function main() {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) throw new Error("Concurrency phải từ 1 đến 50.");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200) throw new Error("Iterations phải từ 1 đến 200.");
  if (!Number.isInteger(fixtureExams) || fixtureExams < 0 || fixtureExams > 10000) throw new Error("Fixture phải từ 0 đến 10000 đề.");
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(values.label)) throw new Error("Label chỉ nhận tối đa 50 chữ, số, gạch nối.");
  if (!/^[a-zA-Z0-9_]+_test$/.test(database) || database === process.env.DB_NAME) throw new Error("Cần database test riêng, không trùng database ứng dụng.");
  if (!process.env.SEED_DEFAULT_PASSWORD) throw new Error("Thiếu SEED_DEFAULT_PASSWORD.");
  const examCount = await prepareFixture();
  const probe = createServer();
  probe.listen(4401, "127.0.0.1");
  await once(probe, "listening");
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["dist/src/main.js"], { cwd: apiDirectory, windowsHide: true,
    env: { ...process.env, DB_NAME: database, API_PORT: "4401", NODE_ENV: "test", DATABASE_CONNECT_ON_START: "true",
      RATE_LIMIT_MAX: "100000", RESEND_API_KEY: "", RESEND_FROM: "", STORAGE_PROVIDER: "local", STORAGE_ROOT: "../../output/benchmark/storage" },
    stdio: ["ignore", values.verbose ? "inherit" : "ignore", values.verbose ? "inherit" : "ignore"],
  });
  const exited = once(child, "exit");
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (child.exitCode !== null) throw new Error("API benchmark dừng trước khi sẵn sàng; chạy --verbose để chẩn đoán.");
      ready = await fetch(base + "/health", { signal: AbortSignal.timeout(500) }).then((response) => response.ok).catch(() => false);
      if (ready) break;
      await pause(500);
    }
    if (!ready) throw new Error("API benchmark chưa sẵn sàng sau 30 giây.");
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: concurrency }, (_, index) => worker(index)));
    const seconds = (performance.now() - started) / 1000;
    const metrics = Object.fromEntries([...measurements].map(([name, samples]) => [name, summarize(samples)]));
    const report = { label: values.label, database, examCount, concurrency, iterations, seconds, node: process.version,
      note: "Local API build, test DB; read workload with independent authenticated sessions; not a production capacity guarantee.",
      requestsPerSecond: [...measurements.values()].reduce((sum, items) => sum + items.length, 0) / seconds,
      failedWorkers: results.filter((result) => result.status === "rejected").map((result) => result.reason.message), metrics };
    const output = new URL(`../../../output/benchmark/${values.label}.json`, import.meta.url);
    await mkdir(new URL(".", output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.failedWorkers.length || Object.values(metrics).some((metric) => metric.errors)) process.exitCode = 1;
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
