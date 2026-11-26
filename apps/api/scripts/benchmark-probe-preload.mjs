import pg from "pg";

const originalQuery = pg.Client.prototype.query;
const originalConnect = pg.Pool.prototype.connect;
const trackedPools = new Set();

let totalQueries = 0;
let totalQueryDurationMs = 0;
let queryErrors = 0;
let listenerQueries = 0;
const fingerprints = new Map();
const poolWaits = [];
let peakPoolQueue = 0;
let cpuBaseline = process.cpuUsage();

/** Rút gọn câu SQL thực tế thành dấu vân tay ổn định theo thao tác và bảng để thống kê truy vấn nóng. */
function fingerprintSql(rawSql) {
  const compact = String(rawSql ?? "").replace(/\s+/g, " ").trim();
  if (!compact) return "EMPTY";
  if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT)/i.test(compact)) {
    return compact.split(" ").slice(0, 2).join(" ").toUpperCase();
  }
  const normalized = compact
    .replace(/\$\d+(\s*,\s*\$\d+)+/g, "$...")
    .replace(/\$\d+/g, "$?")
    .replace(/'[^']*'/g, "'?'");
  const verbMatch = /^(SELECT|INSERT|UPDATE|DELETE|WITH|LISTEN|UNLISTEN|SET|DEALLOCATE)\b/i.exec(normalized);
  const verb = verbMatch ? verbMatch[1].toUpperCase() : "SQL";
  const tableMatch = /(?:FROM|INTO|UPDATE)\s+(?:"?public"?\.)?"?([a-zA-Z0-9_]+)"?/i.exec(normalized);
  const table = tableMatch ? tableMatch[1] : "";
  const prefix = table ? `${verb} ${table}` : verb;
  return `${prefix} :: ${normalized.slice(0, 140)}`;
}

/** Ghi nhận một truy vấn SQL hoàn tất cùng thời gian thực thi và dấu vân tay câu lệnh. */
function recordSqlSample(rawSql, durationMs, failed) {
  const safeMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  const compact = String(rawSql ?? "").replace(/\s+/g, " ").trim();
  if (/^(LISTEN|UNLISTEN)\b/i.test(compact)) {
    listenerQueries += 1;
    return;
  }
  totalQueries += 1;
  totalQueryDurationMs += safeMs;
  if (failed) queryErrors += 1;
  const key = fingerprintSql(compact);
  const entry = fingerprints.get(key) ?? {
    fingerprint: key,
    count: 0,
    errors: 0,
    totalMs: 0,
    maxMs: 0,
  };
  entry.count += 1;
  if (failed) entry.errors += 1;
  entry.totalMs += safeMs;
  if (safeMs > entry.maxMs) entry.maxMs = safeMs;
  fingerprints.set(key, entry);
}

/** Đặt lại toàn bộ bộ đếm SQL, hàng đợi pool và CPU giữa các pha warm-up hoặc lượt đo độc lập. */
function resetProbeMetrics() {
  totalQueries = 0;
  totalQueryDurationMs = 0;
  queryErrors = 0;
  listenerQueries = 0;
  fingerprints.clear();
  poolWaits.length = 0;
  peakPoolQueue = 0;
  cpuBaseline = process.cpuUsage();
}

/** Tính phân vị nearest-rank và làm tròn 2 chữ số thập phân cho mảng thời gian mili giây. */
function percentileMs(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1));
  return Math.round(sortedValues[index] * 100) / 100;
}

/** Chụp ảnh toàn bộ số liệu truy vấn SQL thực, hàng đợi pool và tài nguyên tiến trình hiện tại. */
function buildProbeSnapshot() {
  const sortedWaits = [...poolWaits].sort((a, b) => a - b);
  const topFingerprints = [...fingerprints.values()]
    .sort((a, b) => b.count - a.count || b.totalMs - a.totalMs)
    .slice(0, 30)
    .map((item) => ({
      fingerprint: item.fingerprint,
      count: item.count,
      errors: item.errors,
      totalMs: Math.round(item.totalMs * 100) / 100,
      avgMs: item.count ? Math.round((item.totalMs / item.count) * 100) / 100 : 0,
      maxMs: Math.round(item.maxMs * 100) / 100,
    }));
  const pools = [...trackedPools].map((pool) => ({
    max: typeof pool.options?.max === "number" ? pool.options.max : 10,
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    activeCount: Math.max(0, pool.totalCount - pool.idleCount),
    waitingCount: pool.waitingCount,
  }));
  const memory = process.memoryUsage();
  const cpuDelta = process.cpuUsage(cpuBaseline);
  return {
    sql: {
      totalQueries,
      queryErrors,
      listenerQueries,
      totalDurationMs: Math.round(totalQueryDurationMs * 100) / 100,
      avgDurationMs: totalQueries ? Math.round((totalQueryDurationMs / totalQueries) * 100) / 100 : 0,
      uniqueFingerprints: fingerprints.size,
      topFingerprints,
    },
    pool: {
      queued: sortedWaits.length,
      peakQueue: peakPoolQueue,
      queuedP50Ms: percentileMs(sortedWaits, 0.5),
      queuedP95Ms: percentileMs(sortedWaits, 0.95),
      queuedMaxMs: sortedWaits.length ? Math.round(sortedWaits[sortedWaits.length - 1] * 100) / 100 : 0,
      live: pools,
    },
    process: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      rssMb: Math.round((memory.rss / (1024 * 1024)) * 100) / 100,
      heapUsedMb: Math.round((memory.heapUsed / (1024 * 1024)) * 100) / 100,
      cpuUserMs: Math.round((cpuDelta.user / 1000) * 100) / 100,
      cpuSystemMs: Math.round((cpuDelta.system / 1000) * 100) / 100,
    },
  };
}

/** Chặn lệnh query cấp driver pg.Client để đếm chính xác mọi câu SQL thật gửi xuống PostgreSQL. */
pg.Client.prototype.query = function instrumentedQuery(...args) {
  const first = args[0];
  const rawSql = typeof first === "string" ? first : first?.text ?? "";
  const startedAt = performance.now();
  let recorded = false;
  /** Ghi mẫu SQL đúng một lần khi promise hoặc sự kiện truy vấn kết thúc. */
  const finish = (failed) => {
    if (recorded) return;
    recorded = true;
    recordSqlSample(rawSql, performance.now() - startedAt, failed);
  };
  let result;
  try {
    result = originalQuery.apply(this, args);
  } catch (error) {
    finish(true);
    throw error;
  }
  if (result && typeof result.then === "function") {
    result.then(
      () => finish(false),
      () => finish(true),
    );
    return result;
  }
  if (result && typeof result.once === "function") {
    result.once("end", () => finish(false));
    result.once("error", () => finish(true));
    return result;
  }
  finish(false);
  return result;
};

/** Chặn lệnh lấy kết nối của pg.Pool để đo chính xác số lượt chờ và độ trễ hàng đợi pool. */
pg.Pool.prototype.connect = function instrumentedConnect(callback) {
  trackedPools.add(this);
  const maxConnections = typeof this.options?.max === "number" ? this.options.max : 10;
  if (this.idleCount > 0 || this.totalCount < maxConnections) {
    return originalConnect.call(this, callback);
  }
  const startedAt = performance.now();
  peakPoolQueue = Math.max(peakPoolQueue, this.waitingCount + 1);
  if (typeof callback === "function") {
    return originalConnect.call(this, (...cbArgs) => {
      poolWaits.push(performance.now() - startedAt);
      callback(...cbArgs);
    });
  }
  return originalConnect.call(this).finally(() => {
    poolWaits.push(performance.now() - startedAt);
  });
};

process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "probe-reset") {
    resetProbeMetrics();
    process.send?.({ type: "probe-reset-ok", id: message.id });
    return;
  }
  if (message.type === "probe-snapshot") {
    process.send?.({ type: "probe-snapshot-ok", id: message.id, data: buildProbeSnapshot() });
  }
});
