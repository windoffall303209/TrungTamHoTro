import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: { database: { type: "string", default: "wind_review_20261123_test" },
  rows: { type: "string", default: "50000" }, entity: { type: "string", default: "materials" },
  verbose: { type: "boolean", default: false } }, strict: true });

/** Đo prefilter học liệu/forum, giữ nguyên OR hai trường văn bản và từng tag. */
async function main() {
  const count = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME)
    throw new Error("Chỉ chạy trên database test riêng.");
  if (!Number.isInteger(count) || count < 1000 || count > 1000000) throw new Error("--rows phải từ 1000 đến 1000000.");
  if (!["materials", "forum"].includes(values.entity)) throw new Error("--entity phải là materials hoặc forum.");
  const [first, second] = values.entity === "forum" ? ["title", "body"] : ["name", "folder"];
  const ordering = values.entity === "forum" ? "is_pinned DESC,created_at DESC,id ASC" : "id";
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: values.database, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE material_search_probe (id int, ${first} text, ${second} text, tags jsonb, is_pinned boolean, created_at timestamptz) ON COMMIT DROP`);
    await client.query(`INSERT INTO material_search_probe SELECT n,
      CASE WHEN n % 3000 = 0 THEN 'needletrigram ' ELSE 'Tiêu đề ' END || n,
      CASE WHEN n % 3000 = 1000 THEN 'needletrigram ' ELSE 'Nội dung ' END || n,
      CASE WHEN n % 3000 = 2000 THEN '["needletrigram"]'::jsonb ELSE '["general"]'::jsonb END,
      n % 7 = 0, '2026-01-01'::timestamptz + n * interval '1 second'
      FROM generate_series(1,$1::int) n`, [count]);
    await client.query("ANALYZE material_search_probe");
    const predicate = `(${first} ILIKE $1 OR ${second} ILIKE $1 OR EXISTS
      (SELECT 1 FROM jsonb_array_elements_text(tags) t(value) WHERE t.value ILIKE $1))`;
    const original = `SELECT id FROM material_search_probe WHERE ${predicate} ORDER BY ${ordering}`;
    const optimized = `SELECT id FROM material_search_probe WHERE public.wind_material_search_text(${first},${second},tags) ILIKE $1 AND ${predicate} ORDER BY ${ordering}`;
    const params = ["%needletrigram%"];
    const before = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${original}`, params)).rows[0]["QUERY PLAN"][0];
    await client.query(`CREATE INDEX material_probe_trgm_idx ON material_search_probe USING gin (public.wind_material_search_text(${first},${second},tags) gin_trgm_ops)`);
    await client.query("ANALYZE material_search_probe");
    const after = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${optimized}`, params)).rows[0]["QUERY PLAN"][0];
    const expected = (await client.query(original, params)).rows;
    const actual = (await client.query(optimized, params)).rows;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Kết quả trước/sau khác nhau.");
    process.stdout.write(JSON.stringify({ entity: values.entity, fixtureRows: count, matched: actual.length, sameResults: true, before, after }, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((values.verbose && error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
