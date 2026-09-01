import { config } from "dotenv";
import mariadb from "mariadb";
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
  connection = await mariadb.createConnection({
    host: database.host,
    port: database.port,
    user: database.user,
    password: database.password,
    database: database.database,
    connectTimeout: 5_000,
    allowPublicKeyRetrieval: true,
  });
  const serverRows = await connection.query("SELECT VERSION() AS serverVersion, DATABASE() AS databaseName");
  const server = serverRows[0] ?? {};
  record("Kết nối MySQL", "PASSED", `MySQL ${server.serverVersion ?? "không xác định"} · database ${server.databaseName ?? "không xác định"}.`);

  const tableRows = await connection.query("SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE()");
  const tableCount = Number(tableRows[0]?.tableCount ?? 0);
  record("Schema", tableCount > 0 ? "PASSED" : "WARNING", tableCount > 0 ? `Đã có ${tableCount} bảng.` : "Database chưa có bảng; cần chạy pnpm db:deploy.");

  const migrationTable = await connection.query("SELECT COUNT(*) AS migrationTableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '_prisma_migrations'");
  if (Number(migrationTable[0]?.migrationTableCount ?? 0) > 0) {
    const migrationRows = await connection.query("SELECT COUNT(*) AS appliedCount FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
    record("Migration", "PASSED", `Đã áp dụng ${Number(migrationRows[0]?.appliedCount ?? 0)} migration.`);
  } else {
    record("Migration", "WARNING", "Chưa có bảng _prisma_migrations; cần chạy pnpm db:deploy.");
  }
} catch (error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = database.password ? rawMessage.replaceAll(database.password, "[REDACTED]") : rawMessage;
  const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const errorNumber = typeof error === "object" && error !== null && "errno" in error ? Number(error.errno) : 0;
  const accessDenied = errorCode === "ER_ACCESS_DENIED_ERROR" || errorNumber === 1045 || /access denied|authentication failed|1045/i.test(message);
  const databaseMissing = errorCode === "ER_BAD_DB_ERROR" || errorNumber === 1049 || /unknown database|1049/i.test(message);
  record(
    "Kết nối MySQL",
    "FAILED",
    accessDenied
      ? `MySQL từ chối tài khoản ${database.user} tại ${database.host}; kiểm tra DB_USER và DB_PASSWORD.`
      : databaseMissing
        ? `Database ${database.database} chưa tồn tại.`
        : verbose
          ? message
          : "Không kết nối được. Chạy lại với --verbose để xem chi tiết từ trình điều khiển MySQL.",
  );
} finally {
  await connection?.end().catch(() => undefined);
}

finish(checks.some((check) => check.status === "FAILED") ? 1 : 0);

function finish(exitCode) {
  if (jsonOutput) console.log(JSON.stringify({ ok: exitCode === 0, checks }, null, 2));
  else {
    for (const check of checks) console.log(`[${check.status}] ${check.name}: ${check.detail}`);
    console.log(exitCode === 0 ? "CSDL sẵn sàng cho migration và seed." : "CSDL chưa sẵn sàng; không chạy migration/seed.");
  }
  process.exit(exitCode);
}
