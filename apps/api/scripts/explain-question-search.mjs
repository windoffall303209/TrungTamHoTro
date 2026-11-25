import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
const { values } = parseArgs({ options: { database: { type: "string", default: "wind_review_20261123_test" },
  rows: { type: "string", default: "50000" }, verbose: { type: "boolean", default: false } }, strict: true });

/** Kiểm tra GIN có được dùng sau DISTINCT ON hay không, đồng thời chứng minh không được lọc trước chọn version. */
async function main() {
  const count = Number(values.rows);
  if (!/^[a-zA-Z0-9_]+_test$/.test(values.database) || values.database === process.env.DB_NAME)
    throw new Error("Chỉ chạy trên database test riêng.");
  if (!Number.isInteger(count) || count < 1000 || count > 1000000 || count % 5 !== 0)
    throw new Error("--rows phải từ 1000 đến 1000000 và chia hết cho 5.");
  const client = new pg.Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: values.database, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE question_search_probe (id int PRIMARY KEY, family_id int, version int, created_at timestamptz, content text, tags jsonb) ON COMMIT DROP");
    await client.query(`INSERT INTO question_search_probe SELECT n, (n-1)/5, (n-1)%5+1,
      '2026-01-01'::timestamptz + n * interval '1 second',
      CASE WHEN n % 1000 IN (0,1) THEN 'needletrigram ' ELSE 'Câu hỏi ' END || n, '[]'::jsonb
      FROM generate_series(1,$1::int) n`, [count]);
    await client.query("CREATE INDEX question_probe_family_idx ON question_search_probe(family_id,version)");
    await client.query("ANALYZE question_search_probe");
    const predicate = "(l.content ILIKE $1 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(l.tags) t(value) WHERE t.value ILIKE $1))";
    const cte = "WITH latest AS (SELECT DISTINCT ON (family_id) * FROM question_search_probe ORDER BY family_id,version DESC,created_at DESC,id ASC)";
    const original = `${cte} SELECT l.id FROM latest l WHERE ${predicate} ORDER BY l.version DESC,l.created_at DESC,l.id ASC`;
    const candidate = `${cte} SELECT l.id FROM latest l WHERE public.wind_material_search_text(l.content,'',l.tags) ILIKE $1 AND ${predicate} ORDER BY l.version DESC,l.created_at DESC,l.id ASC`;
    const params = ["%needletrigram%"];
    const before = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${original}`, params)).rows[0]["QUERY PLAN"][0];
    const expected = (await client.query(original, params)).rows;
    await client.query("CREATE INDEX question_probe_trgm_idx ON question_search_probe USING gin (public.wind_material_search_text(content,'',tags) gin_trgm_ops)");
    await client.query("ANALYZE question_search_probe");
    const after = (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${candidate}`, params)).rows[0]["QUERY PLAN"][0];
    const actual = (await client.query(candidate, params)).rows;
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Prefilter sau DISTINCT ON làm thay đổi kết quả.");
    const unsafe = (await client.query(`SELECT DISTINCT ON (family_id) id FROM question_search_probe
      WHERE public.wind_material_search_text(content,'',tags) ILIKE $1 ORDER BY family_id,version DESC,created_at DESC,id ASC`, params)).rows;
    if (unsafe.length <= actual.length) throw new Error("Fixture chưa phát hiện lỗi chọn phiên bản cũ.");
    process.stdout.write(JSON.stringify({ fixtureRows: count, sameResults: true, matchedLatest: actual.length,
      unsafePrefilterMatches: unsafe.length, candidateIndexUsed: JSON.stringify(after).includes("question_probe_trgm_idx"), before, after }, null, 2) + "\n");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write((values.verbose && error instanceof Error ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
