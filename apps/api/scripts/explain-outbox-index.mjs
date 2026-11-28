import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: {
  database: { type: "string", default: "wind_review_20261123_test" },
  rows: { type: "string", default: "100000" },
  verbose: { type: "boolean", default: false },
}, strict: true });

/** So sánh kế hoạch và buffers trên bảng tạm có index hiện hành, không thay dữ liệu ứng dụng. */
async function main() {
  const rowCount = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME)
    throw new Error("Chỉ chạy trên database test riêng có hậu tố _test.");
  if (!Number.isInteger(rowCount) || rowCount < 10000 || rowCount > 1000000)
    throw new Error("--rows phải từ 10000 đến 1000000.");
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: values.database, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const installedIndex = (await client.query(`SELECT i.indisvalid AS valid, i.indisready AS ready,
      pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'outbox_deliveries_ready_available_at_idx'`)).rows[0] ?? null;
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE outbox_index_probe (LIKE public.outbox_deliveries INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING GENERATED) ON COMMIT DROP");
    // Dựng index baseline tường minh để phép so sánh lặp lại được cả sau khi migration mới đã cài.
    await client.query("CREATE INDEX outbox_probe_status_time_idx ON outbox_index_probe (status, available_at)");
    await client.query(`INSERT INTO outbox_index_probe
      (id,event_type,aggregate_type,aggregate_id,payload,recipient_id,channel,dedup_key,status,attempts,available_at,created_at,updated_at)
      SELECT 'probe-'||n,'TEST','CLASS','probe','{}'::jsonb,'probe','EMAIL','probe-'||n,
        CASE WHEN n % 50 = 0 THEN (ARRAY['PENDING','FAILED','PROCESSING'])[1 + (n % 3)] ELSE 'DELIVERED' END,
        0, timestamp '2026-01-01' + n * interval '1 second', now(), now()
      FROM generate_series(1, $1::int) n`, [rowCount]);
    await client.query("ANALYZE outbox_index_probe");
    const sql = `SELECT * FROM outbox_index_probe WHERE status IN ($1,$2,$3)
      AND available_at <= $4 ORDER BY available_at ASC LIMIT 25`;
    const params = ["PENDING", "FAILED", "PROCESSING", new Date("2027-01-01T00:00:00Z")];
    const beforeRows = (await client.query(sql, params)).rows;
    const before = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)).rows[0]["QUERY PLAN"][0];
    await client.query(`CREATE INDEX outbox_probe_ready_idx ON outbox_index_probe (available_at)
      WHERE status IN ('PENDING','FAILED','PROCESSING')`);
    await client.query("ANALYZE outbox_index_probe");
    const afterRows = (await client.query(sql, params)).rows;
    if (JSON.stringify(beforeRows) !== JSON.stringify(afterRows)) throw new Error("Kết quả trước/sau không khớp.");
    const after = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params)).rows[0]["QUERY PLAN"][0];
    const indexBytes = Number((await client.query("SELECT pg_relation_size('outbox_probe_ready_idx') AS bytes")).rows[0].bytes);
    process.stdout.write(JSON.stringify({ database: values.database, fixtureRows: rowCount, activeFraction: 0.02,
      sameResults: true, indexBytes, installedIndex, before, after }, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((values.verbose && error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
