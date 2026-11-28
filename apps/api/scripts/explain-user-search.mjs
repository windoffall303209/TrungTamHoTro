import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: { database: { type: "string", default: "wind_review_20261123_test" },
  rows: { type: "string", default: "50000" }, verbose: { type: "boolean", default: false } }, strict: true });

/** So sánh cùng bộ lọc tài khoản trước/sau index trên bảng tạm và rollback toàn bộ fixture. */
async function main() {
  const count = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME)
    throw new Error("Chỉ chạy trên database test riêng.");
  if (!Number.isInteger(count) || count < 1000 || count > 1000000) throw new Error("--rows phải từ 1000 đến 1000000.");
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: values.database, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE user_search_probe (id int PRIMARY KEY, username text UNIQUE, display_name text, email text UNIQUE, status text, created_at timestamptz) ON COMMIT DROP");
    await client.query(`INSERT INTO user_search_probe SELECT n,
      CASE WHEN n % 3000 = 0 THEN 'needletrigram' ELSE 'learner' END || n,
      CASE WHEN n % 3000 = 1000 THEN 'NeedleTrigram ' ELSE 'Học viên ' END || n,
      CASE WHEN n % 3000 = 2000 THEN 'needletrigram' ELSE 'mail' END || n || '@example.test',
      CASE WHEN n % 7 = 0 THEN 'LOCKED' ELSE 'ACTIVE' END,
      '2026-01-01'::timestamptz + n * interval '1 second' FROM generate_series(1,$1::int) n`, [count]);
    await client.query("ANALYZE user_search_probe");
    const predicate = "username ILIKE $1 OR display_name ILIKE $1 OR email ILIKE $1";
    const queries = {
      page: `SELECT id FROM user_search_probe WHERE (${predicate}) ORDER BY created_at DESC,id ASC LIMIT 25`,
      total: `SELECT count(*) FROM user_search_probe WHERE (${predicate})`,
      active: `SELECT count(*) FROM user_search_probe WHERE (${predicate}) AND status='ACTIVE'`,
      locked: `SELECT count(*) FROM user_search_probe WHERE (${predicate}) AND status='LOCKED'`,
    };
    const results = {};
    for (const [name, sql] of Object.entries(queries)) {
      results[name] = { expected: (await client.query(sql, ["%needletrigram%"])).rows,
        before: (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ["%needletrigram%"])).rows[0]["QUERY PLAN"][0] };
    }
    await client.query("CREATE INDEX user_probe_search_trgm_idx ON user_search_probe USING gin (username gin_trgm_ops, display_name gin_trgm_ops, email gin_trgm_ops)");
    await client.query("ANALYZE user_search_probe");
    for (const [name, sql] of Object.entries(queries)) {
      const actual = (await client.query(sql, ["%needletrigram%"])).rows;
      if (JSON.stringify(results[name].expected) !== JSON.stringify(actual)) throw new Error(`Kết quả ${name} trước/sau khác nhau.`);
      results[name].after = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ["%needletrigram%"])).rows[0]["QUERY PLAN"][0];
    }
    process.stdout.write(JSON.stringify({ fixtureRows: count, sameResults: true, results }, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((values.verbose && error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
