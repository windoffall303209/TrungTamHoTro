import { spawn } from "node:child_process";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client, type ClientConfig } from "pg";
import type { Environment } from "../config/environment.js";

type RestoreSummary = { database: string; tableCount: number; rowCount: number };

@Injectable()
/** Tạo, kiểm chứng và phục hồi PostgreSQL custom-format backup bằng công cụ chính thức. */
export class DatabaseBackupService {
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
  async createFullBackup(): Promise<Buffer> {
    try {
      const content = await this.runUtility(this.pgDumpPath, [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        ...this.connectionArguments(this.databaseName),
      ]);
      this.assertBackup(content);
      return content;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Không thể tạo bản sao lưu PostgreSQL.");
    }
  }

  /** Phục hồi vào database tạm, kiểm đếm dữ liệu và luôn xóa database sau khi xác minh. */
  async verifyRestore(buffer: Buffer): Promise<RestoreSummary> {
    this.assertBackup(buffer);
    const temporaryDatabase = `wind_restore_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    this.assertIdentifier(temporaryDatabase);
    const administrator = await this.open("postgres");
    try {
      await this.createDatabase(administrator, temporaryDatabase);
      await this.restore(buffer, temporaryDatabase);
      return await this.readRestoreSummary(temporaryDatabase);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException("Phục hồi thử nghiệm PostgreSQL thất bại.");
    } finally {
      await this.dropDatabase(administrator, temporaryDatabase).catch(() => undefined);
      await administrator.end().catch(() => undefined);
    }
  }

  /** Phục hồi backup vào database mới và không bao giờ ghi đè database đang vận hành. */
  async restoreToDatabase(buffer: Buffer, targetDatabase: string): Promise<RestoreSummary> {
    this.assertBackup(buffer);
    this.assertIdentifier(targetDatabase);
    if (targetDatabase === this.databaseName) throw new BadRequestException("Không được khôi phục trực tiếp đè lên database đang vận hành.");
    const administrator = await this.open("postgres");
    let created = false;
    try {
      const existing = await administrator.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDatabase]);
      if (existing.rowCount) throw new BadRequestException("Database đích đã tồn tại; cần chọn tên database mới để tránh ghi đè dữ liệu.");
      await this.createDatabase(administrator, targetDatabase);
      created = true;
      await this.restore(buffer, targetDatabase);
      return await this.readRestoreSummary(targetDatabase);
    } catch (error) {
      if (created) await this.dropDatabase(administrator, targetDatabase).catch(() => undefined);
      if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Khôi phục vận hành PostgreSQL thất bại.");
    } finally {
      await administrator.end().catch(() => undefined);
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

  /** Chạy pg_restore với bundle qua stdin để không ghi tệp backup nhạy cảm xuống đĩa. */
  private async restore(buffer: Buffer, database: string): Promise<void> {
    try {
      await this.runUtility(this.pgRestorePath, [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        ...this.connectionArguments(database),
      ], buffer);
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
      await connection.end().catch(() => undefined);
    }
  }

  /** Chạy PostgreSQL utility không qua shell, giới hạn thời gian và trả stdout dạng Buffer. */
  private runUtility(executable: string, args: string[], input?: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        env: { ...process.env, PGPASSWORD: String(this.connection.password ?? "") },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const output: Buffer[] = [];
      const errors: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new ServiceUnavailableException(`PostgreSQL utility vượt quá giới hạn ${this.timeoutMs} ms.`));
      }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ServiceUnavailableException(`Không chạy được PostgreSQL utility: ${error.message}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(output));
        else reject(new ServiceUnavailableException(Buffer.concat(errors).toString("utf8").trim() || `PostgreSQL utility kết thúc với mã ${code ?? "unknown"}.`));
      });
      child.stdin.end(input);
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
    try {
      const client = new Client({ ...this.connection, database });
      await client.connect();
      return client;
    } catch {
      throw new ServiceUnavailableException("Không thể kết nối PostgreSQL để sao lưu hoặc phục hồi.");
    }
  }

  /** Từ chối dữ liệu không mang header custom-format chính thức của pg_dump. */
  private assertBackup(buffer: Buffer): void {
    if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "PGDMP") throw new BadRequestException("Định dạng bản sao lưu PostgreSQL không hợp lệ.");
  }

  /** Chặn identifier chứa ký tự có thể thoát khỏi ngữ cảnh tên database, bảng hoặc cột. */
  private assertIdentifier(value: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new BadRequestException("Định danh database không hợp lệ.");
  }

  /** Quote identifier PostgreSQL chỉ sau khi đã xác thực whitelist ký tự. */
  private quoteIdentifier(value: string): string {
    this.assertIdentifier(value);
    return `"${value}"`;
  }
}
