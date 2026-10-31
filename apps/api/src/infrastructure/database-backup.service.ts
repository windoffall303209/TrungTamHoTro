import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { readFileHead } from "./file-streams.js";
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client, type ClientConfig } from "pg";
import type { Environment } from "../config/environment.js";

type RestoreSummary = { database: string; tableCount: number; rowCount: number };

@Injectable()
/** Tạo, kiểm chứng và phục hồi PostgreSQL custom-format backup bằng công cụ chính thức. */
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);
  private readonly connection: ClientConfig;
  private readonly databaseName: string;
  private readonly timeoutMs: number;
  private readonly pgDumpPath: string;
  private readonly pgRestorePath: string;

  /** Lưu cấu hình PostgreSQL và đường dẫn utility nhưng không mở connection khi khởi tạo service. */
  constructor(config: ConfigService<Environment, true>) {
    this.databaseName = config.get("DB_NAME", { infer: true });
    this.timeoutMs = config.get("DB_BACKUP_TIMEOUT_MS", { infer: true });
    this.pgDumpPath = config.get("PG_DUMP_PATH", { infer: true });
    this.pgRestorePath = config.get("PG_RESTORE_PATH", { infer: true });
    this.connection = {
      host: config.get("DB_HOST", { infer: true }),
      port: config.get("DB_PORT", { infer: true }),
      user: config.get("DB_USER", { infer: true }),
      password: config.get("DB_PASSWORD", { infer: true }),
      connectionTimeoutMillis: this.timeoutMs,
    };
  }

  /** Chụp toàn bộ schema và dữ liệu trong định dạng custom của pg_dump. */
  async createFullBackup(path: string): Promise<{ size: number }> {
    try {
      const file = await open(path, "wx", 0o600);
      await file.close();
      await this.runUtility(this.pgDumpPath, [
        "--format=custom",
        "--file", path,
        "--no-owner",
        "--no-privileges",
        ...this.connectionArguments(this.databaseName),
      ]);
      this.assertBackup(await readFileHead(path, 5));
      return { size: (await stat(path)).size };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Không thể tạo bản sao lưu PostgreSQL.");
    }
  }

  /** Phục hồi vào database tạm, kiểm đếm dữ liệu và luôn xóa database sau khi xác minh. */
  async verifyRestore(path: string): Promise<RestoreSummary> {
    this.assertBackup(await readFileHead(path, 5));
    const temporaryDatabase = `wind_restore_${randomUUID().replaceAll("-", "")}`;
    this.assertIdentifier(temporaryDatabase);
    const administrator = await this.open("postgres");
    let created = false;
    try {
      await this.createDatabase(administrator, temporaryDatabase);
      created = true;
      await this.restore(path, temporaryDatabase);
      return await this.readRestoreSummary(temporaryDatabase);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException("Phục hồi thử nghiệm PostgreSQL thất bại.");
    } finally {
      if (created) await this.dropDatabase(administrator, temporaryDatabase).catch((error: unknown) => {
        this.logger.warn(`Không thể xóa database kiểm chứng ${temporaryDatabase}: ${error instanceof Error ? error.message : String(error)}`);
      });
      await administrator.end().catch((error: unknown) => {
        this.logger.warn(`Không thể đóng kết nối quản trị sau kiểm chứng backup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /** Phục hồi backup vào database mới và không bao giờ ghi đè database đang vận hành. */
  async restoreToDatabase(path: string, targetDatabase: string): Promise<RestoreSummary> {
    this.assertBackup(await readFileHead(path, 5));
    this.assertIdentifier(targetDatabase);
    if (targetDatabase === this.databaseName) throw new BadRequestException("Không được khôi phục trực tiếp đè lên database đang vận hành.");
    const administrator = await this.open("postgres");
    let created = false;
    try {
      const existing = await administrator.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
      if (existing.rowCount) throw new BadRequestException("Database đích đã tồn tại; cần chọn tên database mới để tránh ghi đè dữ liệu.");
      await this.createDatabase(administrator, targetDatabase);
      created = true;
      await this.restore(path, targetDatabase);
      return await this.readRestoreSummary(targetDatabase);
    } catch (error) {
      if (created) await this.dropDatabase(administrator, targetDatabase).catch((cleanupError: unknown) => {
        this.logger.warn(`Không thể xóa database phục hồi thất bại ${targetDatabase}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      });
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Khôi phục vận hành PostgreSQL thất bại.");
    } finally {
      await administrator.end().catch((error: unknown) => {
        this.logger.warn(`Không thể đóng kết nối quản trị sau phục hồi backup: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /** Tạo database UTF-8 mới bằng identifier đã được kiểm tra. */
  private async createDatabase(connection: Client, database: string): Promise<void> {
    await connection.query(`CREATE DATABASE ${this.quoteIdentifier(database)} ENCODING 'UTF8' TEMPLATE template0`);
  }

  /** Ngắt các session còn lại rồi xóa đúng database tạm hoặc database restore lỗi. */
  private async dropDatabase(connection: Client, database: string): Promise<void> {
    this.assertIdentifier(database);
    await connection.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]);
    await connection.query(`DROP DATABASE IF EXISTS ${this.quoteIdentifier(database)} WITH (FORCE)`);
  }

  /** Chạy pg_restore từ tệp tạm riêng tư, không nạp toàn bộ backup vào RAM. */
  private async restore(path: string, database: string): Promise<void> {
    try {
      await this.runUtility(this.pgRestorePath, [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        ...this.connectionArguments(database),
        path,
      ]);
    } catch {
      throw new BadRequestException("Bản sao lưu PostgreSQL không thể phục hồi hoặc đã bị hỏng.");
    }
  }

  /** Đọc số bảng và tổng số dòng sau restore mà không tin tưởng tên bảng trả từ catalog. */
  private async readRestoreSummary(database: string): Promise<RestoreSummary> {
    const connection = await this.open(database);
    try {
      const result = await connection.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name");
      let rowCount = 0n;
      for (const row of result.rows) {
        this.assertIdentifier(row.table_name);
        const count = await connection.query<{ count: string }>(`SELECT COUNT(*)::bigint AS count FROM ${this.quoteIdentifier(row.table_name)}`);
        rowCount += BigInt(count.rows[0]?.count ?? "0");
      }
      if (rowCount > BigInt(Number.MAX_SAFE_INTEGER)) throw new ServiceUnavailableException("Số dòng phục hồi vượt giới hạn báo cáo an toàn.");
      return { database, tableCount: result.rows.length, rowCount: Number(rowCount) };
    } finally {
      await connection.end().catch((error: unknown) => {
        this.logger.warn(`Không thể đóng kết nối kiểm đếm database ${database}: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /** Chạy tiện ích không qua shell và không gom đầu ra vào bộ nhớ; đợi tiến trình thoát trước khi dọn tệp tạm. */
  private runUtility(executable: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env: { ...process.env, PGPASSWORD: String(this.connection.password ?? "") },
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      let timedOut = false;
      let failed = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, this.timeoutMs);
      child.on("error", () => { failed = true; });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (!timedOut && !failed && code === 0) resolve();
        else reject(new ServiceUnavailableException("PostgreSQL backup utility failed or timed out."));
      });
    });
  }

  /** Tạo tập tham số kết nối không chứa mật khẩu để tránh lộ bí mật trong process list. */
  private connectionArguments(database: string): string[] {
    this.assertIdentifier(database);
    return [
      "--host", String(this.connection.host),
      "--port", String(this.connection.port),
      "--username", String(this.connection.user),
      "--dbname", database,
    ];
  }

  /** Mở PostgreSQL client đến database chỉ định và chuẩn hóa lỗi kết nối. */
  private async open(database: string): Promise<Client> {
    const client = new Client({ ...this.connection, database });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch((error: unknown) => {
        this.logger.warn(`Không thể đóng kết nối PostgreSQL bị lỗi: ${error instanceof Error ? error.message : String(error)}`);
      });
      throw new ServiceUnavailableException("Không thể kết nối PostgreSQL để sao lưu hoặc phục hồi.");
    }
  }

  /** Từ chối dữ liệu không mang header custom-format chính thức của pg_dump. */
  private assertBackup(buffer: Buffer): void {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "PGDMP") throw new BadRequestException("Định dạng bản sao lưu PostgreSQL không hợp lệ.");
  }

  /** Chặn identifier chứa ký tự có thể thoát khỏi ngữ cảnh tên database, bảng hoặc cột. */
  private assertIdentifier(value: string): void {
    if (!/^[a-zA-Z0-9_]{1,63}$/.test(value)) throw new BadRequestException("Định danh database không hợp lệ.");
  }

  /** Quote identifier PostgreSQL chỉ sau khi đã xác thực whitelist ký tự. */
  private quoteIdentifier(value: string): string {
    this.assertIdentifier(value);
    return `"${value}"`;
  }
}
