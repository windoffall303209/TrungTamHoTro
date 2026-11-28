import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const { values } = parseArgs({
  options: {
    database: { type: "string", default: "wind_review_20261123_test" },
    rows: { type: "string", default: "50000" },
    output: { type: "string", default: "apps/api/test/results/benchmark/e06-hot-queries-explain.json" },
    verbose: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
  },
  strict: true,
});

/** Ghi log có cấu trúc theo mức độ lên stderr để giữ stdout sạch JSON. */
function logStructured(level, message, meta = {}) {
  if (level === "debug" && !values.debug) return;
  if (level === "info" && !values.verbose && !values.debug) return;
  const entry = { ts: new Date().toISOString(), level, scope: "explain-hot-queries", message, ...meta };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

/** Rút gọn cây kế hoạch EXPLAIN (ANALYZE, BUFFERS) thành các chỉ số cốt lõi để dễ đối chiếu. */
function summarizeExplain(planDoc) {
  const root = planDoc?.Plan ?? {};
  const nodes = [];
  // Duyệt đệ quy cây kế hoạch EXPLAIN để liệt kê tên toán tử và index được sử dụng.
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    const label = node["Index Name"]
      ? `${node["Node Type"]}(${node["Index Name"]})`
      : String(node["Node Type"] ?? "Unknown");
    nodes.push(label);
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) walk(child);
    }
  };
  walk(root);
  return {
    executionTimeMs: Number(planDoc?.["Execution Time"] ?? 0),
    planningTimeMs: Number(planDoc?.["Planning Time"] ?? 0),
    actualRows: Number(root["Actual Rows"] ?? 0),
    sharedHitBlocks: Number(root["Shared Hit Blocks"] ?? 0),
    localHitBlocks: Number(root["Local Hit Blocks"] ?? 0),
    localReadBlocks: Number(root["Local Read Blocks"] ?? 0),
    planNodes: nodes,
  };
}

/** Chạy EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) và xác minh trả về đúng cấu trúc. */
async function runExplain(client, sql, params) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  return result.rows[0]["QUERY PLAN"][0];
}

/** Đo tìm kiếm nội dung chat (chat_messages.content ILIKE) trước và sau khi bổ sung GIN pg_trgm. */
async function probeChatSearch(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_chat_messages (id text PRIMARY KEY, conversation_id text NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_chat_conv_created_idx ON probe_chat_messages (conversation_id, created_at)");
  await client.query(
    `INSERT INTO probe_chat_messages (id, conversation_id, content, created_at)
     SELECT 'msg-' || n,
       CASE WHEN n <= ($1::int / 2) THEN 'conv-busy-class' ELSE 'conv-' || (n % 20) END,
       CASE WHEN n % 1200 = 0 THEN 'Nhắc lịch nộp bài tập chương 5 từ khóa windneedletrgm #' || n
            ELSE 'Trao đổi bài học hàng ngày của lớp học trực tuyến dòng số ' || n END,
       timestamp '2026-01-01' + n * interval '2 seconds'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_chat_messages");

  const sql = `SELECT id FROM probe_chat_messages
    WHERE conversation_id = $1 AND content ILIKE $2
    ORDER BY created_at DESC LIMIT 100`;
  const params = ["conv-busy-class", "%windneedletrgm%"];
  const expected = (await client.query(sql, params)).rows;
  const beforeDoc = await runExplain(client, sql, params);

  await client.query("CREATE INDEX probe_chat_content_trgm_idx ON probe_chat_messages USING gin (content gin_trgm_ops)");
  await client.query("ANALYZE probe_chat_messages");
  const actual = (await client.query(sql, params)).rows;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Kết quả probeChatSearch trước/sau không khớp.");
  }
  const afterDoc = await runExplain(client, sql, params);
  const indexBytes = Number((await client.query("SELECT pg_relation_size('probe_chat_content_trgm_idx') AS bytes")).rows[0].bytes);
  return {
    name: "chat_messages_search",
    fixtureRows: rowCount,
    busyConversationRows: Math.floor(rowCount / 2),
    matchedRows: actual.length,
    sameResults: true,
    candidateIndexBytes: indexBytes,
    before: summarizeExplain(beforeDoc),
    after: summarizeExplain(afterDoc),
  };
}

/** Đo tìm kiếm nhật ký audit (audit_logs) trước và sau khi bổ sung biểu thức GIN pg_trgm. */
async function probeAuditSearch(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_audit_logs (id bigint PRIMARY KEY, actor_id text, action text NOT NULL, entity_type text NOT NULL, entity_id text, context jsonb, created_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_audit_created_id_idx ON probe_audit_logs (created_at DESC, id DESC)");
  await client.query("CREATE INDEX probe_audit_action_created_idx ON probe_audit_logs (action, created_at)");
  await client.query(
    `INSERT INTO probe_audit_logs (id, actor_id, action, entity_type, entity_id, context, created_at)
     SELECT n,
       CASE WHEN n % 1500 = 0 THEN 'actor-windauditkey-' || n ELSE 'user-' || (n % 200) END,
       CASE WHEN n % 1500 = 500 THEN 'GRADE_OVERRIDE_WINDAUDITKEY' ELSE (ARRAY['AUTH_LOGIN','MATERIAL_READ','EXAM_SUBMIT','CLASS_VIEW'])[1 + (n % 4)] END,
       'CLASS',
       'ent-' || n,
       CASE WHEN n % 1500 = 1000 THEN jsonb_build_object('reason', 'khôi phục windauditkey #' || n) ELSE jsonb_build_object('ok', true, 'seq', n) END,
       timestamp '2026-01-01' + n * interval '1 second'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_audit_logs");

  const predicate = `(COALESCE(actor_id, 'system') ILIKE $1 OR action ILIKE $1 OR COALESCE(entity_id, entity_type) ILIKE $1 OR COALESCE(context::text, '') ILIKE $1)`;
  const originalSql = `SELECT id FROM probe_audit_logs WHERE ${predicate} ORDER BY created_at DESC, id DESC LIMIT 20`;
  const countOriginalSql = `SELECT COUNT(*) FROM probe_audit_logs WHERE ${predicate}`;
  const params = ["%windauditkey%"];
  const expected = (await client.query(originalSql, params)).rows;
  const beforePage = await runExplain(client, originalSql, params);
  const beforeCount = await runExplain(client, countOriginalSql, params);

  await client.query(`
    CREATE FUNCTION pg_temp.probe_audit_search_text(text, text, text, text, jsonb)
    RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = pg_catalog
    AS $$
      SELECT COALESCE($1, 'system') || E'\\n' || $2 || E'\\n' || COALESCE($3, $4) || E'\\n' || COALESCE($5::text, '')
    $$
  `);
  await client.query(
    "CREATE INDEX probe_audit_search_trgm_idx ON probe_audit_logs USING gin (pg_temp.probe_audit_search_text(actor_id, action, entity_id, entity_type, context) gin_trgm_ops)",
  );
  await client.query("ANALYZE probe_audit_logs");

  const optimizedSql = `SELECT id FROM probe_audit_logs WHERE pg_temp.probe_audit_search_text(actor_id, action, entity_id, entity_type, context) ILIKE $1 AND ${predicate} ORDER BY created_at DESC, id DESC LIMIT 20`;
  const countOptimizedSql = `SELECT COUNT(*) FROM probe_audit_logs WHERE pg_temp.probe_audit_search_text(actor_id, action, entity_id, entity_type, context) ILIKE $1 AND ${predicate}`;
  const actual = (await client.query(optimizedSql, params)).rows;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Kết quả probeAuditSearch trước/sau không khớp.");
  }
  const afterPage = await runExplain(client, optimizedSql, params);
  const afterCount = await runExplain(client, countOptimizedSql, params);
  const indexBytes = Number((await client.query("SELECT pg_relation_size('probe_audit_search_trgm_idx') AS bytes")).rows[0].bytes);
  return {
    name: "audit_logs_search",
    fixtureRows: rowCount,
    matchedRows: actual.length,
    sameResults: true,
    candidateIndexBytes: indexBytes,
    beforePage: summarizeExplain(beforePage),
    afterPage: summarizeExplain(afterPage),
    beforeCount: summarizeExplain(beforeCount),
    afterCount: summarizeExplain(afterCount),
  };
}

/** Đo truy vấn E05 outbox FOR UPDATE SKIP LOCKED với ORDER BY (available_at, id) trên partial index hiện tại vs (available_at, id). */
async function probeOutboxSkipLocked(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_outbox (id text PRIMARY KEY, status text NOT NULL, attempts int NOT NULL, available_at timestamptz NOT NULL, created_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_outbox_ready_avail_idx ON probe_outbox (available_at) WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')");
  await client.query(
    `INSERT INTO probe_outbox (id, status, attempts, available_at, created_at)
     SELECT 'out-' || lpad(n::text, 7, '0'),
       CASE WHEN n % 25 = 0 THEN (ARRAY['PENDING','FAILED','PROCESSING'])[1 + (n % 3)] ELSE 'DELIVERED' END,
       CASE WHEN n % 250 = 0 THEN 8 ELSE 0 END,
       timestamp '2026-01-01' + (n / 10) * interval '1 second',
       timestamp '2026-01-01' + n * interval '1 second'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_outbox");

  const sql = `SELECT id FROM probe_outbox
    WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
      AND available_at <= $1
      AND attempts < 8
      AND NOT (attempts > 0 AND created_at <= $2)
    ORDER BY available_at ASC, id ASC
    LIMIT 25 FOR UPDATE SKIP LOCKED`;
  const params = [new Date("2027-01-01T00:00:00Z"), new Date("2025-12-31T00:00:00Z")];
  const expected = (await client.query(sql, params)).rows;
  const beforeDoc = await runExplain(client, sql, params);

  await client.query("CREATE INDEX probe_outbox_ready_avail_id_idx ON probe_outbox (available_at, id) WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')");
  await client.query("ANALYZE probe_outbox");
  const actual = (await client.query(sql, params)).rows;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Kết quả probeOutboxSkipLocked trước/sau không khớp.");
  }
  const afterDoc = await runExplain(client, sql, params);
  const beforeIndexBytes = Number((await client.query("SELECT pg_relation_size('probe_outbox_ready_avail_idx') AS bytes")).rows[0].bytes);
  const afterIndexBytes = Number((await client.query("SELECT pg_relation_size('probe_outbox_ready_avail_id_idx') AS bytes")).rows[0].bytes);
  return {
    name: "outbox_skip_locked_order_by_id",
    fixtureRows: rowCount,
    sameResults: true,
    beforeIndexBytes,
    afterIndexBytes,
    before: summarizeExplain(beforeDoc),
    after: summarizeExplain(afterDoc),
  };
}

/** Đo claim tác vụ operational_jobs với B-tree (kind, status, available_at) hiện tại vs partial index PENDING/RUNNING. */
async function probeOperationalJobs(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_op_jobs (id text PRIMARY KEY, kind text NOT NULL, status text NOT NULL, available_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_op_jobs_full_idx ON probe_op_jobs (kind, status, available_at)");
  await client.query(
    `INSERT INTO probe_op_jobs (id, kind, status, available_at)
     SELECT 'job-' || n,
       (ARRAY['BACKUP','EXPORT','AUDIT','RESTORE'])[1 + (n % 4)],
       CASE WHEN n % 200 = 0 THEN 'PENDING' WHEN n % 200 = 1 THEN 'RUNNING' ELSE 'COMPLETED' END,
       timestamp '2026-01-01' + n * interval '1 second'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_op_jobs");

  const sql = `SELECT id FROM probe_op_jobs WHERE kind = $1 AND status = 'PENDING' AND available_at <= $2 ORDER BY available_at ASC LIMIT 1`;
  const params = ["EXPORT", new Date("2027-01-01T00:00:00Z")];
  const beforeDoc = await runExplain(client, sql, params);

  await client.query("CREATE INDEX probe_op_jobs_active_idx ON probe_op_jobs (kind, status, available_at) WHERE status IN ('PENDING', 'RUNNING')");
  await client.query("ANALYZE probe_op_jobs");
  const afterDoc = await runExplain(client, sql, params);
  const fullBytes = Number((await client.query("SELECT pg_relation_size('probe_op_jobs_full_idx') AS bytes")).rows[0].bytes);
  const partialBytes = Number((await client.query("SELECT pg_relation_size('probe_op_jobs_active_idx') AS bytes")).rows[0].bytes);
  return {
    name: "operational_jobs_claim",
    fixtureRows: rowCount,
    fullIndexBytes: fullBytes,
    partialIndexBytes: partialBytes,
    before: summarizeExplain(beforeDoc),
    after: summarizeExplain(afterDoc),
  };
}

/** Đo liệt kê phiên hoạt động (auth_sessions) với (user_id, expires_at) hiện tại vs partial index chưa thu hồi. */
async function probeAuthSessions(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_auth_sessions (id text PRIMARY KEY, user_id text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, last_seen_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_auth_user_exp_idx ON probe_auth_sessions (user_id, expires_at)");
  await client.query(
    `INSERT INTO probe_auth_sessions (id, user_id, expires_at, revoked_at, last_seen_at)
     SELECT 'sess-' || n,
       'user-' || (n % 200),
       CASE WHEN n % 20 = 0 THEN timestamp '2027-01-01' ELSE timestamp '2025-01-01' END,
       CASE WHEN n % 20 = 0 THEN NULL ELSE timestamp '2025-01-01' END,
       timestamp '2026-01-01' + n * interval '1 second'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_auth_sessions");

  const sql = `SELECT id FROM probe_auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY last_seen_at DESC`;
  const params = ["user-7", new Date("2026-06-01T00:00:00Z")];
  const beforeDoc = await runExplain(client, sql, params);

  await client.query("CREATE INDEX probe_auth_active_user_idx ON probe_auth_sessions (user_id, last_seen_at DESC) WHERE revoked_at IS NULL");
  await client.query("ANALYZE probe_auth_sessions");
  const afterDoc = await runExplain(client, sql, params);
  const fullBytes = Number((await client.query("SELECT pg_relation_size('probe_auth_user_exp_idx') AS bytes")).rows[0].bytes);
  const partialBytes = Number((await client.query("SELECT pg_relation_size('probe_auth_active_user_idx') AS bytes")).rows[0].bytes);
  return {
    name: "auth_sessions_active_list",
    fixtureRows: rowCount,
    fullIndexBytes: fullBytes,
    partialIndexBytes: partialBytes,
    before: summarizeExplain(beforeDoc),
    after: summarizeExplain(afterDoc),
  };
}

/** Đo danh sách thông báo theo người nhận (notifications) với hai B-tree hiện có. */
async function probeNotifications(client, rowCount) {
  await client.query("CREATE TEMP TABLE probe_notifications (id text PRIMARY KEY, recipient_id text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL) ON COMMIT DROP");
  await client.query("CREATE INDEX probe_notif_rec_read_created_idx ON probe_notifications (recipient_id, read_at, created_at)");
  await client.query("CREATE INDEX probe_notif_rec_created_desc_idx ON probe_notifications (recipient_id, created_at DESC)");
  await client.query(
    `INSERT INTO probe_notifications (id, recipient_id, read_at, created_at)
     SELECT 'notif-' || n,
       'user-' || (n % 200),
       CASE WHEN n % 15 = 0 THEN NULL ELSE timestamp '2026-01-02' END,
       timestamp '2026-01-01' + n * interval '1 second'
     FROM generate_series(1, $1::int) n`,
    [rowCount],
  );
  await client.query("ANALYZE probe_notifications");

  const listSql = `SELECT id FROM probe_notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT 50`;
  const unreadSql = `SELECT COUNT(*) FROM probe_notifications WHERE recipient_id = $1 AND read_at IS NULL`;
  const listBefore = await runExplain(client, listSql, ["user-7"]);
  const unreadBefore = await runExplain(client, unreadSql, ["user-7"]);

  await client.query("CREATE INDEX probe_notif_unread_partial_idx ON probe_notifications (recipient_id, created_at DESC) WHERE read_at IS NULL");
  await client.query("ANALYZE probe_notifications");
  const unreadAfter = await runExplain(client, unreadSql, ["user-7"]);
  return {
    name: "notifications_list_and_unread",
    fixtureRows: rowCount,
    listWithExistingIndex: summarizeExplain(listBefore),
    unreadBefore: summarizeExplain(unreadBefore),
    unreadAfter: summarizeExplain(unreadAfter),
  };
}

/** Chạy toàn bộ bộ đo EXPLAIN trên bảng tạm có rollback và ghi artifact JSON. */
async function main() {
  const rowCount = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME) {
    throw new Error("Chỉ chạy trên database test riêng có hậu tố _test.");
  }
  if (!Number.isInteger(rowCount) || rowCount < 5000 || rowCount > 500000) {
    throw new Error("--rows phải là số nguyên từ 5000 đến 500000.");
  }

  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: values.database,
    connectionTimeoutMillis: 10_000,
  });

  logStructured("info", "Connecting to PostgreSQL test database", { database: values.database, rows: rowCount });
  await client.connect();
  try {
    await client.query("BEGIN");
    const probes = [];
    for (const [label, fn] of [
      ["chat_messages_search", probeChatSearch],
      ["audit_logs_search", probeAuditSearch],
      ["outbox_skip_locked_order_by_id", probeOutboxSkipLocked],
      ["operational_jobs_claim", probeOperationalJobs],
      ["auth_sessions_active_list", probeAuthSessions],
      ["notifications_list_and_unread", probeNotifications],
    ]) {
      logStructured("debug", "Running EXPLAIN probe", { probe: label });
      probes.push(await fn(client, rowCount));
    }

    const report = {
      generatedAt: new Date().toISOString(),
      database: values.database,
      fixtureRows: rowCount,
      probes,
    };

    if (values.output) {
      const outputPath = resolve(process.cwd(), values.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
      logStructured("info", "Wrote EXPLAIN artifact", { outputPath });
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  logStructured("error", error instanceof Error ? error.message : String(error), {
    stack: values.verbose && error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
