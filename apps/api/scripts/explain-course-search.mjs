import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: { database: { type: "string", default: "wind_review_20261123_test" },
  rows: { type: "string", default: "50000" }, entity: { type: "string", default: "courses" },
  verbose: { type: "boolean", default: false } }, strict: true });

/** Đo bộ lọc khóa học/lớp trước-sau GIN trên bảng tạm, giữ nguyên thứ tự trang tương ứng. */
async function main() {
  const count = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME)
    throw new Error("Chỉ chạy trên database test riêng.");
  if (!Number.isInteger(count) || count < 1000 || count > 1000000) throw new Error("--rows phải từ 1000 đến 1000000.");
  if (!["courses", "classes"].includes(values.entity)) throw new Error("--entity phải là courses hoặc classes.");
  const thirdColumn = values.entity === "classes" ? "term" : "description";
  const orderColumn = values.entity === "classes" ? "start_at" : "created_at";
  const uniqueColumns = values.entity === "classes" ? "code, term" : "code";
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: values.database, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE course_search_probe (id int PRIMARY KEY, code text, name text, ${thirdColumn} text, ${orderColumn} timestamptz, UNIQUE (${uniqueColumns})) ON COMMIT DROP`);
    await client.query(`INSERT INTO course_search_probe SELECT n,
      CASE WHEN n % 3000 = 0 THEN 'needletrigram' ELSE 'course' END || n,
      CASE WHEN n % 3000 = 1000 THEN 'NeedleTrigram ' ELSE 'Khóa học ' END || n,
      CASE WHEN n % 3000 = 2000 THEN 'needletrigram' ELSE 'Nội dung học tập ' END || n,
      '2026-01-01'::timestamptz + n * interval '1 second' FROM generate_series(1,$1::int) n`, [count]);
    await client.query("ANALYZE course_search_probe");
    const predicate = `code ILIKE $1 OR name ILIKE $1 OR ${thirdColumn} ILIKE $1`;
    const queries = { page: `SELECT id FROM course_search_probe WHERE (${predicate}) ORDER BY ${orderColumn} DESC,id ASC LIMIT 20`,
      total: `SELECT count(*) FROM course_search_probe WHERE (${predicate})` };
    const results = {};
    for (const [name, sql] of Object.entries(queries)) {
      results[name] = { expected: (await client.query(sql, ["%needletrigram%"])).rows,
        before: (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ["%needletrigram%"])).rows[0]["QUERY PLAN"][0] };
    }
    await client.query(`CREATE INDEX course_probe_search_trgm_idx ON course_search_probe USING gin (code gin_trgm_ops, name gin_trgm_ops, ${thirdColumn} gin_trgm_ops)`);
    await client.query("ANALYZE course_search_probe");
    for (const [name, sql] of Object.entries(queries)) {
      const actual = (await client.query(sql, ["%needletrigram%"])).rows;
      if (JSON.stringify(results[name].expected) !== JSON.stringify(actual)) throw new Error(`Kết quả ${name} trước/sau khác nhau.`);
      results[name].after = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, ["%needletrigram%"])).rows[0]["QUERY PLAN"][0];
    }
    process.stdout.write(JSON.stringify({ entity: values.entity, fixtureRows: count, sameResults: true, results }, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((values.verbose && error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
