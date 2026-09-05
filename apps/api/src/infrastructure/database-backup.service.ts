import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import mariadb, { type Connection, type ConnectionConfig } from "mariadb";
import type { Environment } from "../config/environment.js";

type EncodedValue = null | boolean | number | string | { type: "bigint" | "buffer" | "date" | "json"; value: string };
interface BackupTable { name: string; createSql: string; columns: string[]; rows: EncodedValue[][] }
interface BackupBundle { format: "wind-edu-mariadb-backup"; version: 1; database: string; createdAt: string; tables: BackupTable[] }

@Injectable()
/** Tạo và kiểm chứng backup MariaDB ở định dạng JSON độc lập với công cụ hệ thống. */
export class DatabaseBackupService {
  private readonly connection: ConnectionConfig;
  private readonly databaseName: string;

  /** Lưu cấu hình kết nối nhưng không mở connection cho tới lúc chạy tác vụ backup. */
  constructor(config: ConfigService<Environment, true>) {
    this.databaseName = config.get("DB_NAME", { infer: true });
    this.connection = {
      host: config.get("DB_HOST", { infer: true }),
      port: config.get("DB_PORT", { infer: true }),
      user: config.get("DB_USER", { infer: true }),
      password: config.get("DB_PASSWORD", { infer: true }),
      connectTimeout: config.get("DB_BACKUP_TIMEOUT_MS", { infer: true }),
      bigIntAsNumber: false,
    };
  }

  /**
   * Chụp schema và dữ liệu của mọi bảng trong một transaction repeatable-read.
   * Giá trị đặc biệt được encode để JSON không làm mất BigInt, Buffer hoặc Date.
   */
  async createFullBackup(): Promise<Buffer> {
    const connection = await this.open(this.databaseName);
    try {
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await connection.beginTransaction();
      const listed = await connection.query<Record<string, unknown>[]>("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
      const tables: BackupTable[] = [];
      for (const entry of listed) {
        const nameValue = Object.values(entry)[0];
        const name = typeof nameValue === "string" ? nameValue : "";
        this.assertIdentifier(name);
        const createRows = await connection.query<Record<string, unknown>[]>(`SHOW CREATE TABLE ${this.quoteIdentifier(name)}`);
        const createValue = createRows[0]?.["Create Table"];
        const createSql = typeof createValue === "string" ? createValue : "";
        if (!createSql) throw new ServiceUnavailableException(`Không đọc được cấu trúc bảng ${name}.`);
        const data = await connection.query<Record<string, unknown>[]>(`SELECT * FROM ${this.quoteIdentifier(name)}`);
        const rows = data.map((row) => Object.values(row).map((value) => this.encode(value)));
        const columns = data.length ? Object.keys(data[0] ?? {}) : await this.tableColumns(connection, name);
        tables.push({ name, createSql, columns, rows });
      }
      await connection.commit();
      const bundle: BackupBundle = { format: "wind-edu-mariadb-backup", version: 1, database: this.databaseName, createdAt: new Date().toISOString(), tables };
      return Buffer.from(JSON.stringify(bundle), "utf8");
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException("Không thể tạo bản sao lưu MariaDB.");
    } finally {
      await connection.end().catch(() => undefined);
    }
  }

  /**
   * Phục hồi bundle vào database tạm để xác nhận schema và dữ liệu có thể đọc lại.
   * Database thử nghiệm luôn bị xóa trong `finally`, kể cả khi validation hay restore lỗi.
   */
  async verifyRestore(buffer: Buffer): Promise<{ database: string; tableCount: number; rowCount: number }> {
    const bundle = this.parseBundle(buffer);
    const temporaryDatabase = `wind_restore_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
    this.assertIdentifier(temporaryDatabase);
    const administrator = await this.open();
    try {
      await administrator.query(`CREATE DATABASE ${this.quoteIdentifier(temporaryDatabase)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      const target = await this.open(temporaryDatabase);
      try {
        await target.query("SET FOREIGN_KEY_CHECKS=0");
        for (const table of bundle.tables) {
          this.validateTable(table);
          await target.query(table.createSql);
        }
        for (const table of bundle.tables) await this.restoreRows(target, table);
        await target.query("SET FOREIGN_KEY_CHECKS=1");
        const rowCount = bundle.tables.reduce((sum, table) => sum + table.rows.length, 0);
        return { database: temporaryDatabase, tableCount: bundle.tables.length, rowCount };
      } finally {
        await target.end().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException("Phục hồi thử nghiệm MariaDB thất bại.");
    } finally {
      await administrator.query(`DROP DATABASE IF EXISTS ${this.quoteIdentifier(temporaryDatabase)}`).catch(() => undefined);
      await administrator.end().catch(() => undefined);
    }
  }

  /** Chèn dữ liệu theo batch 200 dòng để giới hạn kích thước mỗi câu lệnh MariaDB. */
  private async restoreRows(connection: Connection, table: BackupTable): Promise<void> {
    if (!table.rows.length) return;
    const columns = table.columns.map((column) => this.quoteIdentifier(column)).join(", ");
    const placeholders = table.columns.map(() => "?").join(", ");
    const sql = `INSERT INTO ${this.quoteIdentifier(table.name)} (${columns}) VALUES (${placeholders})`;
    for (let offset = 0; offset < table.rows.length; offset += 200) {
      const values = table.rows.slice(offset, offset + 200).map((row) => row.map((value) => this.decode(value)));
      await connection.batch(sql, values);
    }
  }

  /** Đọc tên cột cho bảng rỗng vì `SELECT *` không cung cấp metadata qua object row. */
  private async tableColumns(connection: Connection, table: string): Promise<string[]> {
    const rows = await connection.query<Array<{ Field: string }>>(`SHOW COLUMNS FROM ${this.quoteIdentifier(table)}`);
    return rows.map((row) => row.Field);
  }

  /** Parse và xác nhận version bao ngoài trước khi dữ liệu được dùng để tạo database. */
  private parseBundle(buffer: Buffer): BackupBundle {
    try {
      const value = JSON.parse(buffer.toString("utf8")) as Partial<BackupBundle>;
      if (value.format !== "wind-edu-mariadb-backup" || value.version !== 1 || !Array.isArray(value.tables)) throw new Error("invalid format");
      return value as BackupBundle;
    } catch {
      throw new BadRequestException("Định dạng bản sao lưu không hợp lệ.");
    }
  }

  /** Kiểm tra cấu trúc từng bảng và độ rộng row trước khi thực thi SQL từ bundle. */
  private validateTable(table: BackupTable): void {
    this.assertIdentifier(table.name);
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows) || !table.createSql.startsWith("CREATE TABLE")) throw new BadRequestException("Nội dung bảng trong bản sao lưu không hợp lệ.");
    table.columns.forEach((column) => this.assertIdentifier(column));
    if (table.rows.some((row) => row.length !== table.columns.length)) throw new BadRequestException("Số cột bản sao lưu không đồng nhất.");
  }

  /** Chuyển giá trị MariaDB không biểu diễn trực tiếp được trong JSON sang dạng có type. */
  private encode(value: unknown): EncodedValue {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
    if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
    if (Buffer.isBuffer(value)) return { type: "buffer", value: value.toString("base64") };
    if (value instanceof Date) return { type: "date", value: value.toISOString() };
    return { type: "json", value: JSON.stringify(value) };
  }

  /** Khôi phục giá trị đã encode về kiểu mà MariaDB driver chấp nhận khi insert. */
  private decode(value: EncodedValue): unknown {
    if (value === null || typeof value !== "object") return value;
    if (value.type === "buffer") return Buffer.from(value.value, "base64");
    if (value.type === "date") return new Date(value.value);
    if (value.type === "bigint") return value.value;
    return JSON.parse(value.value) as unknown;
  }

  /** Mở connection quản trị hoặc connection trỏ tới database cụ thể và chuẩn hóa lỗi. */
  private async open(database?: string): Promise<Connection> {
    try { return await mariadb.createConnection({ ...this.connection, database }); }
    catch { throw new ServiceUnavailableException("Không thể kết nối MariaDB để sao lưu hoặc phục hồi."); }
  }

  /** Chặn identifier chứa ký tự có thể thoát khỏi ngữ cảnh tên database/bảng/cột. */
  private assertIdentifier(value: string): void {
    if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new BadRequestException("Định danh database không hợp lệ.");
  }

  /** Quote identifier chỉ sau khi đã xác thực whitelist ký tự. */
  private quoteIdentifier(value: string): string {
    this.assertIdentifier(value);
    return `\`${value}\``;
  }
}
