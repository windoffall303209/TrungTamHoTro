export interface DatabaseConnectionConfig {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
}

export function readDatabaseConnection(source: Record<string, unknown>): DatabaseConnectionConfig {
  const host = requiredString(source.DB_HOST, "DB_HOST");
  const user = requiredString(source.DB_USER, "DB_USER");
  const password = typeof source.DB_PASSWORD === "string" ? source.DB_PASSWORD : "";
  const database = requiredString(source.DB_NAME, "DB_NAME");
  const port = Number(source.DB_PORT ?? 3306);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("DB_PORT phải là số nguyên từ 1 đến 65535.");
  }
  if (!/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME chỉ được chứa chữ cái, chữ số và dấu gạch dưới.");
  }

  return { host, user, password, database, port };
}

export function buildDatabaseUrl(source: Record<string, unknown>): string {
  const connection = readDatabaseConnection(source);
  return `mysql://${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@${connection.host}:${connection.port}/${connection.database}`;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Thiếu ${name} trong .env.`);
  return value.trim();
}
