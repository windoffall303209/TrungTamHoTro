import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, scrypt as nodeScrypt } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { config } from "dotenv";
import pg from "pg";

const scrypt = promisify(nodeScrypt);
const apiDirectory = fileURLToPath(new URL("../", import.meta.url));
const repoDirectory = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: path.join(repoDirectory, ".env"), quiet: true });

const { values } = parseArgs({
  options: {
    database: { type: "string", default: process.env.WIND_TEST_DB_NAME ?? "wind_bench_review_20261123_test" },
    learners: { type: "string", default: "500" },
    concurrency: { type: "string", default: "100" },
    "login-concurrency": { type: "string", default: "50" },
    "pool-max": { type: "string", default: "30" },
    "uv-threadpool-size": { type: "string", default: "12" },
    "scrypt-max-concurrency": { type: "string", default: "6" },
    port: { type: "string", default: "4406" },
    label: { type: "string", default: "f04-exam-500-mixed" },
    output: { type: "string" },
    cleanup: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
  strict: true,
});

const FIXTURE_CLASS_ID = "f04-class-500";
const FIXTURE_QUESTION_PREFIX = "f04-q50-";

/** Ghi log có cấu trúc JSON ra stderr theo cờ verbose/debug. */
function logEvent(level, event, details = {}) {
  if (level === "debug" && !values.debug) return;
  if (level === "info" && !values.verbose && !values.debug) return;
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details })}\n`,
  );
}

/** Xác thực toàn bộ tham số dòng lệnh và khóa tuyệt đối mọi thao tác ngoài database _test. */
function parseAndValidateOptions() {
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
  const learners = Number(values.learners);
  const concurrency = Number(values.concurrency);
  const loginConcurrency = Number(values["login-concurrency"]);
  const poolMax = Number(values["pool-max"]);
  const uvThreadpoolSize = Number(values["uv-threadpool-size"]);
  const scryptMaxConcurrency = Number(values["scrypt-max-concurrency"]);
  const port = Number(values.port);
  if (!Number.isInteger(learners) || learners < 10 || learners > 2000) {
    throw new Error("--learners phải từ 10 đến 2000.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 500) {
    throw new Error("--concurrency phải từ 1 đến 500.");
  }
  if (!Number.isInteger(loginConcurrency) || loginConcurrency < 1 || loginConcurrency > 200) {
    throw new Error("--login-concurrency phải từ 1 đến 200.");
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
    learners,
    concurrency,
    loginConcurrency,
    poolMax,
    uvThreadpoolSize,
    scryptMaxConcurrency,
    port,
    label: values.label,
    outputPath,
    cleanup: values.cleanup,
  };
}

/** Đọc commit/nhánh Git hiện hành gắn vào artifact tái hiện. */
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

/** Mở kết nối trực tiếp tới PostgreSQL benchmark đã xác thực hậu tố _test ở múi giờ UTC. */
async function connectTestDatabase(database) {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  await client.query("SET TIME ZONE 'UTC'");
  return client;
}

/** Tạo một chuỗi băm mật khẩu scrypt hợp lệ chuẩn hệ thống dùng chung cho 500 tài khoản fixture. */
async function hashSeedPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/** Sinh danh sách cố định 50 câu hỏi hỗn hợp đủ 5 loại (tổng 100 điểm: 70 điểm khách quan + 30 điểm tự luận). */
function buildFiftyMixedQuestionsSpec() {
  const items = [];
  // 20 SINGLE_CHOICE (2.0 điểm/câu = 40.0 điểm)
  for (let i = 1; i <= 20; i += 1) {
    const correctIdx = (i - 1) % 4;
    const options = ["Phương án A", "Phương án B", "Phương án C", "Phương án D"];
    items.push({
      id: `${FIXTURE_QUESTION_PREFIX}sc-${String(i).padStart(2, "0")}`,
      type: "SINGLE_CHOICE",
      content: `[F04] Câu hỏi chọn một đáp án số ${i}: Xác định phương án đúng theo giáo trình chuẩn.`,
      options,
      correctAnswers: [options[correctIdx]],
      wrongAnswers: [options[(correctIdx + 1) % 4]],
      score: 2,
      difficulty: ((i - 1) % 3) + 1,
    });
  }
  // 10 MULTIPLE_CHOICE (2.0 điểm/câu = 20.0 điểm)
  for (let i = 1; i <= 10; i += 1) {
    const options = ["Nhận định 1", "Nhận định 2", "Nhận định 3", "Nhận định 4"];
    const first = (i - 1) % 4;
    const second = (i + 1) % 4;
    const wrong = (i + 2) % 4;
    items.push({
      id: `${FIXTURE_QUESTION_PREFIX}mc-${String(i).padStart(2, "0")}`,
      type: "MULTIPLE_CHOICE",
      content: `[F04] Câu hỏi nhiều lựa chọn số ${i}: Chọn tất cả các nhận định chính xác.`,
      options,
      correctAnswers: [options[first], options[second]],
      wrongAnswers: [options[first], options[wrong]],
      score: 2,
      difficulty: 2,
    });
  }
  // 10 TRUE_FALSE (1.0 điểm/câu = 10.0 điểm)
  for (let i = 1; i <= 10; i += 1) {
    const isTrue = i % 2 === 1;
    items.push({
      id: `${FIXTURE_QUESTION_PREFIX}tf-${String(i).padStart(2, "0")}`,
      type: "TRUE_FALSE",
      content: `[F04] Câu hỏi Đúng/Sai số ${i}: Đánh giá tính chính xác của phát biểu kỹ thuật.`,
      options: ["Đúng", "Sai"],
      correctAnswers: [isTrue ? "Đúng" : "Sai"],
      wrongAnswers: [isTrue ? "Sai" : "Đúng"],
      score: 1,
      difficulty: 1,
    });
  }
  // 5 SHORT_ANSWER (2.0 điểm/câu = 10.0 điểm — chờ chấm tay)
  for (let i = 1; i <= 5; i += 1) {
    items.push({
      id: `${FIXTURE_QUESTION_PREFIX}sa-${String(i).padStart(2, "0")}`,
      type: "SHORT_ANSWER",
      content: `[F04] Câu hỏi trả lời ngắn số ${i}: Nêu khái niệm cốt lõi ngắn gọn.`,
      options: [],
      correctAnswers: [`khai-niem-${i}`],
      wrongAnswers: [],
      score: 2,
      difficulty: 2,
    });
  }
  // 5 ESSAY (4.0 điểm/câu = 20.0 điểm — chờ chấm tay)
  for (let i = 1; i <= 5; i += 1) {
    items.push({
      id: `${FIXTURE_QUESTION_PREFIX}es-${String(i).padStart(2, "0")}`,
      type: "ESSAY",
      content: `[F04] Câu hỏi tự luận số ${i}: Phân tích kiến trúc, đánh đổi và phương án kiểm chứng.`,
      options: [],
      correctAnswers: [],
      wrongAnswers: [],
      score: 4,
      difficulty: 3,
    });
  }
  return items;
}

/** Tạo hoặc đồng bộ idempotent fixture lớp 500 học viên + 50 câu hỏi hỗn hợp + 1 đề kiểm tra mới cho lượt chạy. */
async function prepareExam500Fixture(options, questionsSpec) {
  const client = await connectTestDatabase(options.database);
  const startedAt = performance.now();
  try {
    const courseRes = await client.query(
      "SELECT id, version FROM courses WHERE status = 'PUBLISHED' ORDER BY id LIMIT 1",
    );
    if (!courseRes.rowCount) {
      throw new Error("Database benchmark chưa có khóa học PUBLISHED để gắn lớp fixture F04.");
    }
    const course = courseRes.rows[0];
    const roleRes = await client.query("SELECT id FROM roles WHERE code = 'LEARNER' LIMIT 1");
    if (!roleRes.rowCount) {
      throw new Error("Thiếu vai trò LEARNER trong bảng roles.");
    }
    const learnerRoleId = roleRes.rows[0].id;
    const passwordHash = await hashSeedPassword(process.env.SEED_DEFAULT_PASSWORD);
    const nowIso = new Date().toISOString();
    const classStartIso = new Date(Date.now() - 86_400_000).toISOString();
    const classEndIso = new Date(Date.now() + 86_400_000 * 180).toISOString();

    await client.query("BEGIN");
    // 1. Tạo lớp 500 học viên idempotent.
    await client.query(
      `INSERT INTO learning_classes (
        id, course_id, course_version, code, name, term, capacity, status, start_at, end_at, created_at, updated_at
      ) VALUES ($1::text, $2::text, $3::int, 'F04-CLASS-500', 'Lớp nghiệm thu tải 500 học viên (F04)', 'F04-2026', $4::int, 'ACTIVE', $5::timestamp, $6::timestamp, $7::timestamp, $7::timestamp)
      ON CONFLICT (id) DO UPDATE
        SET capacity = GREATEST(learning_classes.capacity, EXCLUDED.capacity),
            status = 'ACTIVE',
            start_at = EXCLUDED.start_at,
            end_at = EXCLUDED.end_at,
            updated_at = EXCLUDED.updated_at`,
      [FIXTURE_CLASS_ID, course.id, course.version, options.learners + 50, classStartIso, classEndIso, nowIso],
    );
    await client.query(
      `INSERT INTO class_instructors (class_id, instructor_id, role, assigned_by, assigned_at)
       VALUES ($1::text, 'usr-instructor', 'PRIMARY', 'usr-instructor', $2::timestamp)
       ON CONFLICT (class_id, instructor_id) DO NOTHING`,
      [FIXTURE_CLASS_ID, nowIso],
    );

    // 2. Tạo lô 500 tài khoản học viên + role LEARNER + ghi danh ACTIVE bằng unnest 1 lệnh mỗi bảng.
    const learnerIds = [];
    const usernames = [];
    const emails = [];
    const displayNames = [];
    for (let i = 1; i <= options.learners; i += 1) {
      const tag = String(i).padStart(4, "0");
      const id = `f04-learner-${tag}`;
      learnerIds.push(id);
      usernames.push(`f04.learner.${tag}@wind.edu.vn`);
      emails.push(`f04.learner.${tag}@wind.edu.vn`);
      displayNames.push(`Học viên F04 ${tag}`);
    }
    await client.query(
      `INSERT INTO users (
        id, username, email, email_verified_at, password_hash, display_name, status, locale, created_at, updated_at
      )
      SELECT u.id, u.username, u.email, $5::timestamp, $6::text, u.display_name, 'ACTIVE'::"UserStatus", 'vi-VN', $5::timestamp, $5::timestamp
      FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS u(id, username, email, display_name)
      ON CONFLICT (id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            status = 'ACTIVE'::"UserStatus",
            email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at),
            updated_at = EXCLUDED.updated_at`,
      [learnerIds, usernames, emails, displayNames, nowIso, passwordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, $2::text
       FROM unnest($1::text[]) AS u(id)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [learnerIds, learnerRoleId],
    );
    await client.query(
      `INSERT INTO class_enrollments (id, class_id, learner_id, status, source, joined_at)
       SELECT 'enr-' || u.id, $2::text, u.id, 'ACTIVE'::"EnrollmentStatus", 'F04_FIXTURE', $3::timestamp
       FROM unnest($1::text[]) AS u(id)
       ON CONFLICT (class_id, learner_id) DO UPDATE
         SET status = 'ACTIVE'::"EnrollmentStatus",
             removed_at = NULL`,
      [learnerIds, FIXTURE_CLASS_ID, nowIso],
    );

    // 3. Tạo 50 câu hỏi hỗn hợp idempotent.
    for (const q of questionsSpec) {
      const contentHash = createHash("sha256").update(q.content.toLowerCase()).digest("hex");
      await client.query(
        `INSERT INTO questions (
          id, course_id, author_id, type, content, options, correct_answers, difficulty, tags,
          status, version, family_id, content_hash, created_at, updated_at
        ) VALUES (
          $1::text, $2::text, 'usr-instructor', $3::"QuestionType", $4::text, $5::jsonb, $6::jsonb, $7::smallint, '["f04","mixed-50"]'::jsonb,
          'PUBLISHED'::"ContentStatus", 1, $1::text, $8::text, $9::timestamp, $9::timestamp
        )
        ON CONFLICT (id) DO UPDATE
          SET options = EXCLUDED.options,
              correct_answers = EXCLUDED.correct_answers,
              status = 'PUBLISHED'::"ContentStatus",
              updated_at = EXCLUDED.updated_at`,
        [q.id, course.id, q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.correctAnswers), q.difficulty, contentHash, nowIso],
      );
    }

    // 4. Tạo đề thi mới riêng cho lượt chạy này với đủ 50 câu hỗn hợp.
    const examId = `f04-exam-50-${randomUUID().slice(0, 8)}`;
    const openAtIso = new Date(Date.now() - 5 * 60_000).toISOString();
    const closeAtIso = new Date(Date.now() + 2 * 3_600_000).toISOString();
    await client.query(
      `INSERT INTO exams (
        id, class_id, title, duration_minutes, total_score, open_at, close_at,
        attempt_limit, shuffle_questions, status, version, created_at, updated_at
      ) VALUES (
        $1::text, $2::text, 'Đề hỗn hợp 50 câu nghiệm thu nộp bài hàng loạt (F04)', 90, 100, $3::timestamp, $4::timestamp,
        1, false, 'PUBLISHED'::"ExamStatus", 1, $5::timestamp, $5::timestamp
      )`,
      [examId, FIXTURE_CLASS_ID, openAtIso, closeAtIso, nowIso],
    );
    const qIds = questionsSpec.map((q) => q.id);
    const qPositions = questionsSpec.map((_, idx) => idx);
    const qScores = questionsSpec.map((q) => q.score);
    await client.query(
      `INSERT INTO exam_questions (exam_id, question_id, position, score)
       SELECT $1::text, q.id, q.pos, q.score
       FROM unnest($2::text[], $3::int[], $4::numeric[]) AS q(id, pos, score)`,
      [examId, qIds, qPositions, qScores],
    );
    await client.query("COMMIT");

    const seedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    logEvent("info", "fixture_ready", { classId: FIXTURE_CLASS_ID, examId, learners: learnerIds.length, questions: questionsSpec.length, seedMs });
    return {
      classId: FIXTURE_CLASS_ID,
      examId,
      seedMs,
      learners: learnerIds.map((id, idx) => ({ id, username: usernames[idx], index: idx })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Sinh bộ 50 đáp án xác định theo chỉ số học viên cùng điểm khách quan kỳ vọng để đối chiếu DB tuyệt đối. */
function buildExpectedAnswersForLearner(learnerIndex, questionsSpec) {
  // 5 mức độ đúng khách quan lặp theo modulo 5 (100%, 80%, 60%, 40%, 20%) giúp phát hiện mọi sai sót chấm điểm.
  const tier = learnerIndex % 5;
  const correctRatioMod = 5 - tier; // 5, 4, 3, 2, 1 trên mỗi chu kỳ 5 câu khách quan
  const answers = [];
  let expectedObjectiveScore = 0;
  const expectedPerQuestionScore = new Map();
  let objectiveCounter = 0;

  for (const q of questionsSpec) {
    if (q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
      const shouldBeCorrect = objectiveCounter % 5 < correctRatioMod;
      objectiveCounter += 1;
      const chosen = shouldBeCorrect ? q.correctAnswers : q.wrongAnswers;
      // Đảo thứ tự mảng với câu MULTIPLE_CHOICE ở học viên chẵn để kiểm tra logic chấm không phụ thuộc thứ tự.
      const submitted =
        q.type === "MULTIPLE_CHOICE" && learnerIndex % 2 === 0
          ? [...chosen].reverse()
          : [...chosen];
      answers.push({ questionId: q.id, answers: submitted });
      const awarded = shouldBeCorrect ? q.score : 0;
      expectedObjectiveScore += awarded;
      expectedPerQuestionScore.set(q.id, awarded);
    } else if (q.type === "SHORT_ANSWER") {
      answers.push({
        questionId: q.id,
        answers: [`Trả lời ngắn HV-${learnerIndex + 1} cho ${q.id}`],
      });
      expectedPerQuestionScore.set(q.id, null);
    } else {
      answers.push({
        questionId: q.id,
        answers: [`Bài tự luận HV-${learnerIndex + 1} (${q.id}): phân tích chi tiết các yêu cầu và giải pháp kỹ thuật.`],
      });
      expectedPerQuestionScore.set(q.id, null);
    }
  }
  return {
    answers,
    expectedObjectiveScore: Math.round(expectedObjectiveScore * 100) / 100,
    expectedPerQuestionScore,
  };
}

/** Thực thi danh sách tác vụ bất đồng bộ với giới hạn số lượng chạy song song cố định. */
async function runWithConcurrency(items, limit, workerFn) {
  const results = new Array(items.length);
  let cursor = 0;
  /** Lấy lần lượt từng chỉ số chưa chạy cho đến khi hết mảng. */
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

/** Tính phân vị nearest-rank làm tròn 2 chữ số thập phân. */
function percentile(valuesArr, fraction) {
  if (!valuesArr.length) return 0;
  const sorted = [...valuesArr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return Math.round(sorted[idx] * 100) / 100;
}

/** Gửi lệnh IPC tới preload đo SQL/pool trong tiến trình API benchmark. */
async function sendProbeMessage(child, type) {
  const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const expectedType = `${type}-ok`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error(`Timeout chờ IPC ${type}.`));
    }, 10_000);
    /** Khớp đúng gói phản hồi IPC theo id yêu cầu. */
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

/** Xác nhận cổng TCP nội bộ rảnh trước khi bật API benchmark. */
async function assertPortAvailable(port) {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise((resolve) => server.close(resolve));
}

/** Đối chiếu toàn bộ 500 lượt thi và 25.000 câu trả lời trực tiếp trên PostgreSQL với ground truth kỳ vọng. */
async function reconcileDatabaseResults(database, examId, learnersWithExpectation, questionsSpec) {
  const client = await connectTestDatabase(database);
  try {
    const attemptsRes = await client.query(
      `SELECT id, learner_id, status::text AS status, score::float8 AS score,
              submitted_at, grade_published_at
       FROM exam_attempts
       WHERE exam_id = $1`,
      [examId],
    );
    const answersRes = await client.query(
      `SELECT a.attempt_id, ea.learner_id, a.question_id, a.score::float8 AS score, a.answer_data
       FROM attempt_answers a
       JOIN exam_attempts ea ON ea.id = a.attempt_id
       WHERE ea.exam_id = $1`,
      [examId],
    );

    const expectedLearners = learnersWithExpectation.length;
    const expectedAnswers = expectedLearners * questionsSpec.length;
    const attemptsByLearner = new Map();
    const duplicateLearners = [];
    let submittedStatusCount = 0;
    let nonNullSubmittedAtCount = 0;
    let unpublishedGradeCount = 0;

    for (const row of attemptsRes.rows) {
      if (attemptsByLearner.has(row.learner_id)) duplicateLearners.push(row.learner_id);
      attemptsByLearner.set(row.learner_id, row);
      if (row.status === "SUBMITTED") submittedStatusCount += 1;
      if (row.submitted_at !== null) nonNullSubmittedAtCount += 1;
      if (row.grade_published_at === null) unpublishedGradeCount += 1;
    }

    const answersByLearner = new Map();
    for (const row of answersRes.rows) {
      const list = answersByLearner.get(row.learner_id) ?? [];
      list.push(row);
      answersByLearner.set(row.learner_id, list);
    }

    let exactAttemptScoreMatches = 0;
    let exactPerQuestionScoreMatches = 0;
    let subjectivePendingScoreMatches = 0;
    let nonEmptyAnswerDataCount = 0;
    const mismatches = [];

    for (const item of learnersWithExpectation) {
      const attempt = attemptsByLearner.get(item.id);
      if (!attempt) {
        mismatches.push({ learnerId: item.id, reason: "MISSING_ATTEMPT" });
        continue;
      }
      const actualScore = Math.round(Number(attempt.score ?? -1) * 100) / 100;
      if (actualScore === item.expectedObjectiveScore) {
        exactAttemptScoreMatches += 1;
      } else {
        mismatches.push({
          learnerId: item.id,
          reason: "ATTEMPT_SCORE_MISMATCH",
          expected: item.expectedObjectiveScore,
          actual: actualScore,
        });
      }

      const learnerAnswers = answersByLearner.get(item.id) ?? [];
      if (learnerAnswers.length !== questionsSpec.length) {
        mismatches.push({
          learnerId: item.id,
          reason: "ANSWER_COUNT_MISMATCH",
          expected: questionsSpec.length,
          actual: learnerAnswers.length,
        });
        continue;
      }

      let allQuestionsMatched = true;
      let subjectiveNullOk = true;
      let sumObjectiveFromAnswers = 0;
      for (const ans of learnerAnswers) {
        if (Array.isArray(ans.answer_data) && ans.answer_data.length > 0) {
          nonEmptyAnswerDataCount += 1;
        }
        const expectedQScore = item.expectedPerQuestionScore.get(ans.question_id);
        if (expectedQScore === null) {
          if (ans.score !== null) subjectiveNullOk = false;
        } else {
          const actualQScore = ans.score === null ? -1 : Math.round(Number(ans.score) * 100) / 100;
          if (actualQScore !== expectedQScore) allQuestionsMatched = false;
          sumObjectiveFromAnswers += actualQScore;
        }
      }
      sumObjectiveFromAnswers = Math.round(sumObjectiveFromAnswers * 100) / 100;
      if (allQuestionsMatched && sumObjectiveFromAnswers === actualScore) {
        exactPerQuestionScoreMatches += 1;
      } else {
        mismatches.push({
          learnerId: item.id,
          reason: "QUESTION_SCORE_MISMATCH",
          sumObjectiveFromAnswers,
          actualScore,
        });
      }
      if (subjectiveNullOk) subjectivePendingScoreMatches += 1;
    }

    const passed =
      attemptsRes.rowCount === expectedLearners &&
      duplicateLearners.length === 0 &&
      submittedStatusCount === expectedLearners &&
      nonNullSubmittedAtCount === expectedLearners &&
      unpublishedGradeCount === expectedLearners &&
      answersRes.rowCount === expectedAnswers &&
      exactAttemptScoreMatches === expectedLearners &&
      exactPerQuestionScoreMatches === expectedLearners &&
      subjectivePendingScoreMatches === expectedLearners &&
      nonEmptyAnswerDataCount === expectedAnswers &&
      mismatches.length === 0;

    return {
      passed,
      expectedLearners,
      actualAttempts: attemptsRes.rowCount,
      distinctLearners: attemptsByLearner.size,
      duplicateLearnerCount: duplicateLearners.length,
      submittedStatusCount,
      nonNullSubmittedAtCount,
      unpublishedGradeCount,
      expectedAnswers,
      actualAnswers: answersRes.rowCount,
      nonEmptyAnswerDataCount,
      exactAttemptScoreMatches,
      exactPerQuestionScoreMatches,
      subjectivePendingScoreMatches,
      mismatchCount: mismatches.length,
      sampleMismatches: mismatches.slice(0, 10),
    };
  } finally {
    await client.end();
  }
}

/** Chạy toàn bộ quy trình F04: dựng fixture 500 HV × 50 câu, mở lượt, nộp bài đồng loạt và đối chiếu DB. */
async function main() {
  const options = parseAndValidateOptions();
  const git = readGitMetadata();
  const questionsSpec = buildFiftyMixedQuestionsSpec();
  const fixture = await prepareExam500Fixture(options, questionsSpec);
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
        RATE_LIMIT_MAX: "500000",
        RATE_LIMIT_IP_MAX: "500000",
        AUTH_RATE_LIMIT_MAX: "500000",
        RESEND_API_KEY: "",
        RESEND_FROM: "",
        STORAGE_PROVIDER: "local",
        STORAGE_ROOT: path.join(apiDirectory, "test", "results", "benchmark", "storage"),
      },
      stdio: ["ignore", values.verbose ? "inherit" : "ignore", values.verbose ? "inherit" : "ignore", "ipc"],
    },
  );
  const exited = once(child, "exit");

  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (child.exitCode !== null) throw new Error("API dừng sớm trước khi sẵn sàng.");
      ready = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("API chưa sẵn sàng sau 30 giây.");

    // Pha 1: Đăng nhập 500 học viên và mở lượt làm bài.
    const setupStarted = performance.now();
    const prepared = await runWithConcurrency(
      fixture.learners,
      options.loginConcurrency,
      async (learner) => {
        const loginRes = await fetch(`${baseUrl}/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: learner.username,
            password: process.env.SEED_DEFAULT_PASSWORD,
            rememberMe: false,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!loginRes.ok) throw new Error(`LOGIN_HTTP_${loginRes.status}`);
        const loginJson = await loginRes.json();
        const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
        const headers = {
          cookie,
          "x-role-code": "LEARNER",
          "x-csrf-token": loginJson.data.csrfToken,
          "content-type": "application/json",
        };
        const attemptRes = await fetch(`${baseUrl}/learner/exams/${encodeURIComponent(fixture.examId)}/attempts`, {
          method: "POST",
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        if (!attemptRes.ok) throw new Error(`START_ATTEMPT_HTTP_${attemptRes.status}`);
        const attemptJson = await attemptRes.json();
        const expected = buildExpectedAnswersForLearner(learner.index, questionsSpec);
        return {
          ...learner,
          headers,
          attemptId: attemptJson.data.id,
          ...expected,
        };
      },
    );
    const setupSeconds = Math.round(((performance.now() - setupStarted) / 1000) * 100) / 100;
    const setupFailures = prepared.filter((r) => !r.ok);
    if (setupFailures.length) {
      throw new Error(`Chuẩn bị đăng nhập/mở lượt thất bại ${setupFailures.length} học viên: ${setupFailures[0].error}`);
    }
    const activeLearners = prepared.map((r) => r.value);
    logEvent("info", "attempts_opened", { count: activeLearners.length, setupSeconds });

    // Pha 2: Reset SQL/pool probe rồi bắn đồng loạt 500 bài nộp × 50 câu hỗn hợp.
    await sendProbeMessage(child, "probe-reset");
    const submitStarted = performance.now();
    const submitLatencies = [];
    const submitResults = await runWithConcurrency(
      activeLearners,
      options.concurrency,
      async (item) => {
        const t0 = performance.now();
        const res = await fetch(`${baseUrl}/learner/exam-attempts/${encodeURIComponent(item.attemptId)}/submit`, {
          method: "POST",
          headers: item.headers,
          body: JSON.stringify({ answers: item.answers }),
          signal: AbortSignal.timeout(30_000),
        });
        const bodyText = await res.text();
        const ms = performance.now() - t0;
        submitLatencies.push(ms);
        if (!res.ok) throw new Error(`SUBMIT_HTTP_${res.status}:${bodyText.slice(0, 160)}`);
        const data = JSON.parse(bodyText).data;
        if (!/^SUB-[A-F0-9]{20}$/.test(data?.submissionReceipt ?? "")) {
          throw new Error("Thiếu hoặc sai định dạng submissionReceipt.");
        }
        if (data.status !== "SUBMITTED") {
          throw new Error(`Mong đợi status=SUBMITTED cho đề có tự luận, nhận ${data.status}.`);
        }
        if (data.score !== undefined) {
          throw new Error("Phản hồi học viên không được lộ điểm khi đề còn câu tự luận chưa chấm.");
        }
        return { attemptId: item.attemptId, receipt: data.submissionReceipt, ms };
      },
    );
    const submitDurationSeconds = Math.round(((performance.now() - submitStarted) / 1000) * 1000) / 1000;
    const submitProbe = await sendProbeMessage(child, "probe-snapshot");
    const submitFailures = submitResults.filter((r) => !r.ok);

    // Pha 3: Kiểm tra idempotency khi gửi lại nộp bài trên 10 lượt đã nộp (phải trả cùng biên nhận, không đổi DB).
    const retrySubset = activeLearners.slice(0, 10);
    const retryChecks = await Promise.all(
      retrySubset.map(async (item, idx) => {
        const originalReceipt = submitResults[idx]?.ok ? submitResults[idx].value.receipt : "";
        const res = await fetch(`${baseUrl}/learner/exam-attempts/${encodeURIComponent(item.attemptId)}/submit`, {
          method: "POST",
          headers: item.headers,
          body: JSON.stringify({ answers: [] }),
          signal: AbortSignal.timeout(15_000),
        });
        const json = await res.json();
        return res.ok && json?.data?.submissionReceipt === originalReceipt;
      }),
    );

    // Đóng phiên gọn để không để tồn auth_sessions.
    await runWithConcurrency(activeLearners, 50, async (item) => {
      await fetch(`${baseUrl}/auth/logout`, {
        method: "POST",
        headers: item.headers,
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    });

    // Pha 4: Đối chiếu từng bản ghi trên PostgreSQL thật (500 attempts, 25.000 answers, 500 điểm khách quan).
    const reconciliation = await reconcileDatabaseResults(
      options.database,
      fixture.examId,
      activeLearners,
      questionsSpec,
    );

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
      },
      config: {
        database: options.database,
        learners: options.learners,
        questionsPerExam: questionsSpec.length,
        questionDistribution: {
          SINGLE_CHOICE: 20,
          MULTIPLE_CHOICE: 10,
          TRUE_FALSE: 10,
          SHORT_ANSWER: 5,
          ESSAY: 5,
        },
        submitConcurrency: options.concurrency,
        poolMax: options.poolMax,
        uvThreadpoolSize: options.uvThreadpoolSize,
        scryptMaxConcurrency: options.scryptMaxConcurrency,
      },
      fixture: {
        classId: fixture.classId,
        examId: fixture.examId,
        seedMs: fixture.seedMs,
        setupLoginAndStartSeconds: setupSeconds,
      },
      submitBurst: {
        totalSubmissions: activeLearners.length,
        succeeded: activeLearners.length - submitFailures.length,
        failed: submitFailures.length,
        sampleFailures: submitFailures.slice(0, 10).map((f) => f.error),
        durationSeconds: submitDurationSeconds,
        submissionsPerSecond:
          submitDurationSeconds > 0
            ? Math.round((activeLearners.length / submitDurationSeconds) * 100) / 100
            : 0,
        p50Ms: percentile(submitLatencies, 0.5),
        p95Ms: percentile(submitLatencies, 0.95),
        p99Ms: percentile(submitLatencies, 0.99),
        maxMs: submitLatencies.length ? Math.round(Math.max(...submitLatencies) * 100) / 100 : 0,
        idempotentRetryMatches: retryChecks.filter(Boolean).length,
        idempotentRetryTotal: retryChecks.length,
        sql: {
          totalQueries: submitProbe.sql.totalQueries,
          queriesPerSubmit: Math.round((submitProbe.sql.totalQueries / activeLearners.length) * 100) / 100,
          totalDurationMs: submitProbe.sql.totalDurationMs,
          topFingerprints: submitProbe.sql.topFingerprints.slice(0, 10),
        },
        pool: submitProbe.pool,
        process: submitProbe.process,
      },
      databaseReconciliation: reconciliation,
    };

    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ outputPath: options.outputPath, submitBurst: report.submitBurst, databaseReconciliation: report.databaseReconciliation }, null, 2)}\n`);

    if (
      submitFailures.length > 0 ||
      retryChecks.some((ok) => !ok) ||
      !reconciliation.passed
    ) {
      process.exitCode = 1;
    }
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
    if (options.cleanup) {
      const cleanupClient = await connectTestDatabase(options.database);
      try {
        await cleanupClient.query("DELETE FROM exams WHERE id = $1", [fixture.examId]);
      } finally {
        await cleanupClient.end();
      }
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
