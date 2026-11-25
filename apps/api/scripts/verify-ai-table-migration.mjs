import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const BACKFILL_STATEMENTS = [
  `INSERT INTO "ai_document_extractions" (
     "id", "owner_id", "state", "version", "pages", "lease_token", "lease_expires_at", "created_at", "updated_at"
   )
   SELECT
     SUBSTRING("key" FROM 8), "updated_by",
     CASE
       WHEN jsonb_typeof("value") = 'array' THEN 'READY'
       WHEN "value"->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY') THEN "value"->>'state'
       ELSE 'UNCERTAIN'
     END,
     "version",
     CASE
       WHEN jsonb_typeof("value") = 'array' THEN "value"
       WHEN "value"->>'state' = 'READY' THEN "value"->'pages'
       ELSE NULL
     END,
     CASE
       WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
         THEN LEFT("value"->>'leaseToken', 64)
       ELSE NULL
     END,
     CASE
       WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND ("value"->>'leaseExpiresAt') ~ '^\\d{4}-\\d{2}-\\d{2}T'
         THEN ("value"->>'leaseExpiresAt')::timestamptz
       ELSE NULL
     END,
     "effective_at", "updated_at"
   FROM "system_settings"
   WHERE "key" LIKE 'ai-doc:%'
   ON CONFLICT ("id") DO NOTHING`,
  `INSERT INTO "ai_document_answers" (
     "id", "owner_id", "material_id", "source_version", "question", "language",
     "state", "version", "result", "lease_token", "lease_expires_at", "created_at", "updated_at"
   )
   SELECT
     SUBSTRING("key" FROM 15), "updated_by",
     CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'materialId' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND jsonb_typeof("value"->'request'->'version') = 'number'
       THEN ("value"->'request'->>'version')::integer ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'question' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'request'->>'language' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' IN ('RETRY_AUTHORIZED', 'GENERATING', 'READY')
       THEN "value"->>'state' ELSE 'UNCERTAIN' END,
     "version",
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'READY' THEN "value"->'result' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
       THEN LEFT("value"->>'leaseToken', 64) ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND ("value"->>'leaseExpiresAt') ~ '^\\d{4}-\\d{2}-\\d{2}T'
       THEN ("value"->>'leaseExpiresAt')::timestamptz ELSE NULL END,
     "effective_at", "updated_at"
   FROM "system_settings"
   WHERE "key" LIKE 'ai-doc-answer:%'
   ON CONFLICT ("id") DO NOTHING`,
  `INSERT INTO "ai_generation_requests" (
     "id", "owner_id", "payload_hash", "state", "version", "prepared", "result",
     "lease_token", "lease_expires_at", "created_at", "updated_at"
   )
   SELECT
     SUBSTRING("key" FROM 15),
     COALESCE(NULLIF("value"->>'owner', ''), "updated_by"),
     COALESCE("value"->>'hash', ''),
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' IN ('CLAIMED', 'GENERATING', 'READY', 'SAVING', 'COMPLETED', 'UNCERTAIN')
       THEN "value"->>'state' ELSE 'UNCERTAIN' END,
     "version",
     CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'prepared' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' THEN "value"->'result' ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND jsonb_typeof("value"->'leaseToken') = 'string'
       THEN LEFT("value"->>'leaseToken', 64) ELSE NULL END,
     CASE WHEN jsonb_typeof("value") = 'object' AND "value"->>'state' = 'GENERATING' AND ("value"->>'leaseExpiresAt') ~ '^\\d{4}-\\d{2}-\\d{2}T'
       THEN ("value"->>'leaseExpiresAt')::timestamptz ELSE NULL END,
     "effective_at", "updated_at"
   FROM "system_settings"
   WHERE "key" LIKE 'ai-generation:%'
   ON CONFLICT ("id") DO NOTHING`,
  `INSERT INTO "ai_generation_bindings" (
     "fingerprint", "owner_id", "payload_hash", "canonical_request_id", "malformed", "created_at", "updated_at"
   )
   SELECT
     SUBSTRING("key" FROM 23),
     COALESCE(NULLIF("value"->>'owner', ''), "updated_by"),
     COALESCE("value"->>'hash', ''),
     CASE WHEN jsonb_typeof("value") = 'object' AND jsonb_typeof("value"->'canonicalRequestId') = 'string' AND CHAR_LENGTH(BTRIM("value"->>'canonicalRequestId')) > 0
       THEN LEFT("value"->>'canonicalRequestId', 177) ELSE NULL END,
     NOT (jsonb_typeof("value") = 'object' AND jsonb_typeof("value"->'canonicalRequestId') = 'string' AND CHAR_LENGTH(BTRIM("value"->>'canonicalRequestId')) > 0),
     "effective_at", "updated_at"
   FROM "system_settings"
   WHERE "key" LIKE 'ai-generation-content:%'
   ON CONFLICT ("fingerprint") DO NOTHING`,
];

/** Mở kết nối tới database mục tiêu sau khi kiểm tra tên database hợp lệ. */
async function connectDatabase(database) {
  if (!/^[a-zA-Z0-9_]+$/.test(database) || database.length > 63) {
    throw new Error("Tên database không hợp lệ.");
  }
  const client = new pg.Client({
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

/** Đối chiếu đầy đủ các bản ghi cũ trong system_settings với 4 bảng AI chuyên dụng để phát hiện thiếu dữ liệu. */
async function verifyParity(client) {
  const checks = [
    { name: "extractions", legacyPrefix: "ai-doc:%", offset: 8, table: "ai_document_extractions", idColumn: "id" },
    { name: "documentAnswers", legacyPrefix: "ai-doc-answer:%", offset: 15, table: "ai_document_answers", idColumn: "id" },
    { name: "generationRequests", legacyPrefix: "ai-generation:%", offset: 15, table: "ai_generation_requests", idColumn: "id" },
    { name: "generationBindings", legacyPrefix: "ai-generation-content:%", offset: 23, table: "ai_generation_bindings", idColumn: "fingerprint" },
  ];
  const report = {};
  for (const check of checks) {
    const legacy = await client.query(
      `SELECT count(*)::int AS total FROM system_settings WHERE "key" LIKE $1`,
      [check.legacyPrefix],
    );
    const dedicated = await client.query(`SELECT count(*)::int AS total FROM "${check.table}"`);
    const missing = await client.query(
      `SELECT count(*)::int AS missing
       FROM system_settings s
       WHERE s."key" LIKE $1
         AND NOT EXISTS (
           SELECT 1 FROM "${check.table}" t WHERE t."${check.idColumn}" = SUBSTRING(s."key" FROM ${check.offset})
         )`,
      [check.legacyPrefix],
    );
    report[check.name] = {
      legacyCount: legacy.rows[0].total,
      dedicatedCount: dedicated.rows[0].total,
      missingInDedicated: missing.rows[0].missing,
    };
  }
  return report;
}

/** Chạy backfill tùy chọn, kiểm chứng đối chiếu dữ liệu và chỉ dọn bản ghi cũ khi có cờ --prune-legacy --confirm. */
async function main() {
  const { values } = parseArgs({
    options: {
      database: { type: "string", default: process.env.WIND_TEST_DB_NAME ?? "" },
      backfill: { type: "boolean", default: false },
      "prune-legacy": { type: "boolean", default: false },
      confirm: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      "Dùng: node apps/api/scripts/verify-ai-table-migration.mjs --database <ten_db> [--backfill] [--prune-legacy --confirm] [--json]\nKiểm chứng đối chiếu dữ liệu AI giữa system_settings và 4 bảng chuyên dụng (D03).",
    );
    return;
  }
  if (!values.database) {
    throw new Error("Cần truyền --database <ten_db> rõ ràng để tránh chạy nhầm database.");
  }
  if (values["prune-legacy"] && !values.confirm) {
    throw new Error("Cần kèm --confirm khi dùng --prune-legacy để dọn bản ghi cũ trong system_settings.");
  }

  const client = await connectDatabase(values.database);
  try {
    if (values.backfill) {
      await client.query("BEGIN");
      try {
        for (const sql of BACKFILL_STATEMENTS) await client.query(sql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const parity = await verifyParity(client);
    const totalMissing = Object.values(parity).reduce((sum, item) => sum + item.missingInDedicated, 0);
    let prunedLegacyRows = 0;

    if (values["prune-legacy"]) {
      if (totalMissing > 0) {
        throw new Error(`Từ chối dọn system_settings vì còn ${totalMissing} bản ghi chưa có trong bảng AI chuyên dụng.`);
      }
      const deleted = await client.query(
        `DELETE FROM system_settings
         WHERE "key" LIKE 'ai-doc:%'
            OR "key" LIKE 'ai-doc-answer:%'
            OR "key" LIKE 'ai-generation:%'
            OR "key" LIKE 'ai-generation-content:%'`,
      );
      prunedLegacyRows = deleted.rowCount ?? 0;
    }

    const summary = {
      database: values.database,
      backfillApplied: values.backfill,
      verified: totalMissing === 0,
      prunedLegacyRows,
      parity,
    };
    console.log(values.json ? JSON.stringify(summary, null, 2) : JSON.stringify(summary));
    if (totalMissing > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Lỗi kiểm chứng migration bảng AI: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
