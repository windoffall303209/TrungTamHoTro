import { spawnSync } from "node:child_process";
import { config as loadEnvironment } from "dotenv";
import mariadb from "mariadb";

loadEnvironment({ path: "../../.env" });
loadEnvironment();

const databaseName = process.env.WIND_TEST_DB_NAME ?? "trung_tam_giang_day_test";

// Xác nhận database đích có hậu tố test rõ ràng trước mọi thao tác tạo hoặc xóa.
function assertTestDatabaseName(value) {
  if (!/^[a-zA-Z0-9_]+_test$/.test(value)) throw new Error("WIND_TEST_DB_NAME phải kết thúc bằng _test và chỉ chứa chữ, số, dấu gạch dưới.");
  if (value === process.env.DB_NAME) throw new Error("Database test không được trùng database ứng dụng hiện tại.");
}

// Chạy Prisma bằng DB_NAME test và dừng ngay nếu migration hoặc seed thất bại.
function runPnpm(args) {
  const pnpmEntry = process.env.npm_execpath;
  const executable = pnpmEntry ? process.execPath : (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  const commandArgs = pnpmEntry ? [pnpmEntry, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: { ...process.env, DB_NAME: databaseName },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Lệnh pnpm thất bại với mã ${result.status ?? "unknown"}${result.error ? `: ${result.error.message}` : ""}.`);
}

// Tạo database test mới hoặc làm sạch có xác nhận, sau đó áp dụng migration và seed chuẩn.
async function prepare(reset) {
  assertTestDatabaseName(databaseName);
  const connection = await mariadb.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
  });
  try {
    if (reset) await connection.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
  runPnpm(["exec", "prisma", "migrate", "deploy"]);
  runPnpm(["db:seed"]);
  process.stdout.write(`Database test sẵn sàng: ${databaseName}\n`);
}

// Phân tích lệnh CLI và yêu cầu cờ xác nhận riêng cho thao tác reset phá hủy dữ liệu test.
async function main() {
  const command = process.argv[2] ?? "prepare";
  if (!["prepare", "reset"].includes(command)) throw new Error("Cách dùng: node scripts/test-database.mjs <prepare|reset> [--confirm]");
  if (command === "reset" && !process.argv.includes("--confirm")) throw new Error("Reset cần cờ --confirm.");
  await prepare(command === "reset");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
