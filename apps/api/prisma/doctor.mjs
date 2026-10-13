import { config } from "dotenv";
import pg from "pg";
import { readDatabaseConnection } from "../src/config/database-connection.js";

config({ path: new URL("../../../.env", import.meta.url) });

const options = new Set(process.argv.slice(2));
const jsonOutput = options.has("--json");
const verbose = options.has("--verbose");
const supportedOptions = new Set(["--json", "--verbose"]);
const unknownOptions = [...options].filter((option) => !supportedOptions.has(option));

if (unknownOptions.length) {
  console.error(`Tùy chọn không hỗ trợ: ${unknownOptions.join(", ")}. Dùng --json hoặc --verbose.`);
  process.exit(2);
}

const checks = [];
/** Ghi kết quả từng bước để tổng hợp báo cáo chẩn đoán cơ sở dữ liệu. */
const record = (name, status, detail) => checks.push({ name, status, detail });
const seedPassword = process.env.SEED_DEFAULT_PASSWORD ?? "";

let database;
try {
  database = readDatabaseConnection(process.env);
  record("Cấu hình database", "PASSED", `${database.user}@${database.host}:${database.port}/${database.database}`);
} catch (error) {
  record("Cấu hình database", "FAILED", error instanceof Error ? error.message : "Bộ biến DB_* không hợp lệ.");
  finish(1);
}

if (seedPassword.length >= 12) record("SEED_DEFAULT_PASSWORD", "PASSED", `Đã cấu hình ${seedPassword.length} ký tự.`);
else record("SEED_DEFAULT_PASSWORD", "FAILED", `Cần ít nhất 12 ký tự; hiện có ${seedPassword.length}.`);

let connection;

try {
  connection = new pg.Client({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    connectionTimeoutMillis: 5_000,
  });
  await connection.connect();
  const serverRows = await connection.query("SELECT current_setting('server_version') AS \"serverVersion\", current_database() AS \"databaseName\"");
  const server = serverRows.rows[0] ?? {};
  record("Kết nối PostgreSQL", "PASSED", `PostgreSQL ${server.serverVersion ?? "không xác định"} · database ${server.databaseName ?? "không xác định"}.`);

  const tableRows = await connection.query("SELECT COUNT(*) AS \"tableCount\" FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
  const tableCount = Number(tableRows.rows[0]?.tableCount ?? 0);
  record("Schema", tableCount > 0 ? "PASSED" : "WARNING", tableCount > 0 ? `Đã có ${tableCount} bảng.` : "Database chưa có bảng; cần chạy pnpm db:deploy.");

  const migrationTable = await connection.query("SELECT COUNT(*) AS \"migrationTableCount\" FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_prisma_migrations'");
  if (Number(migrationTable.rows[0]?.migrationTableCount ?? 0) > 0) {
    const migrationRows = await connection.query("SELECT COUNT(*) AS \"appliedCount\" FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
    record("Migration", "PASSED", `Đã áp dụng ${Number(migrationRows.rows[0]?.appliedCount ?? 0)} migration.`);
  } else {
    record("Migration", "WARNING", "Chưa có bảng _prisma_migrations; cần chạy pnpm db:deploy.");
  }
} catch (error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = database.password ? rawMessage.replaceAll(database.password, "[REDACTED]") : rawMessage;
  const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const accessDenied = errorCode === "28P01" || /password authentication failed|authentication failed/i.test(message);
  const databaseMissing = errorCode === "3D000" || /database .* does not exist/i.test(message);
  record(
    "Kết nối PostgreSQL",
    "FAILED",
    accessDenied
      ? `PostgreSQL từ chối tài khoản ${database.user} tại ${database.host}; kiểm tra DB_USER và DB_PASSWORD.`
      : databaseMissing
        ? `Database ${database.database} chưa tồn tại.`
        : verbose
          ? message
          : "Không kết nối được. Chạy lại với --verbose để xem chi tiết từ trình điều khiển PostgreSQL.",
  );
} finally {
  await connection?.end().catch(() => undefined);
}

finish(checks.some((check) => check.status === "FAILED") ? 1 : 0);

/** Xuất báo cáo văn bản hoặc JSON và kết thúc bằng mã trạng thái tương ứng. */
function finish(exitCode) {
  if (jsonOutput) console.log(JSON.stringify({ ok: exitCode === 0, checks }, null, 2));
  else {
    for (const check of checks) console.log(`[${check.status}] ${check.name}: ${check.detail}`);
    console.log(exitCode === 0 ? "CSDL sẵn sàng cho migration và seed." : "CSDL chưa sẵn sàng; không chạy migration/seed.");
  }
  process.exit(exitCode);
}
