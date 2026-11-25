#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const DEFAULT_NEXT_DIR = path.resolve(process.cwd(), "apps/web/.next");
const KEY_ROUTES = [
  "/login/page",
  "/(workspace)/dashboard/page",
  "/(workspace)/courses/page",
  "/(workspace)/courses/classes/[classId]/page",
  "/(workspace)/exams/page",
  "/(workspace)/questions/page",
  "/(workspace)/messages/page",
  "/(workspace)/materials/page",
  "/(workspace)/admin/operations/page",
];

const FEATURE_PATTERNS = [
  { key: "katexJs", regex: /KaTeX|katex-mathml|katex-html|__katex/ },
  { key: "katexCss", regex: /\.katex(?:\s|\.|,|:|\{)|KaTeX_Main/ },
  { key: "markdown", regex: /react-markdown|remarkMath|rehypeKatex|micromark|mdast-util|hast-util/ },
  {
    key: "enI18nCatalog",
    regex: /A unified, high-performance workspace|curatedEnglishCatalog|Manage courses and classes|Teaching operations|Assign primary instructor/
  },
  { key: "instructorWorkspace", regex: /\/instructor\/classes\/|\/assignments\/.*\/submissions/ },
];

// Phân tích tham số dòng lệnh và trả về cấu hình đo bundle.
function parseArgs(argv) {
  const options = {
    nextDir: DEFAULT_NEXT_DIR,
    output: null,
    compare: null,
    top: 15,
    verbose: false,
    debug: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--next-dir" && argv[i + 1]) {
      options.nextDir = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === "--output" && argv[i + 1]) {
      options.output = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === "--compare" && argv[i + 1]) {
      options.compare = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === "--top" && argv[i + 1]) {
      const parsed = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Tham số --top không hợp lệ: ${argv[i]}`);
      }
      options.top = parsed;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else if (arg === "--debug") {
      options.debug = true;
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Cách dùng: node apps/web/scripts/measure-bundle.mjs [--next-dir <dir>] [--output <json>] [--compare <baseline.json>] [--top <n>] [--verbose] [--debug]",
      );
      process.exit(0);
    } else {
      throw new Error(`Tham số không hỗ trợ: ${arg}`);
    }
  }
  return options;
}

// Ghi log có cấu trúc dạng JSON sang stderr khi bật chế độ verbose/debug.
function logStructured(enabled, level, event, payload = {}) {
  if (!enabled) return;
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...payload }));
}

// Đọc mã commit Git hiện tại để lưu kèm artifact benchmark.
function readGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// Chuẩn hóa đường dẫn chunk tương đối trong .next để tránh đếm trùng giữa manifest.
function normalizeChunkPath(relativePath) {
  return relativePath.replace(/^\/?_next\//, "").replace(/^\/+/, "").replace(/\\/g, "/");
}

// Đọc kích thước raw và gzip của một tệp tĩnh trong thư mục .next.
function inspectStaticFile(nextDir, relativePath, cache) {
  const normalized = normalizeChunkPath(relativePath);
  if (cache.has(normalized)) return cache.get(normalized);
  const absolutePath = path.join(nextDir, normalized);
  if (!existsSync(absolutePath)) {
    const missing = { path: normalized, exists: false, bytes: 0, gzipBytes: 0, features: [] };
    cache.set(normalized, missing);
    return missing;
  }
  const buffer = readFileSync(absolutePath);
  const gzipBytes = gzipSync(buffer, { level: 9 }).length;
  const text = buffer.toString("utf8");
  const features = [];
  for (const pattern of FEATURE_PATTERNS) {
    if (pattern.regex.test(text)) features.push(pattern.key);
  }
  const info = {
    path: normalized,
    exists: true,
    bytes: buffer.length,
    gzipBytes,
    features,
  };
  cache.set(normalized, info);
  return info;
}

// Nạp client-reference manifest của một App Router route bằng sandbox VM an toàn.
function loadRouteManifest(nextDir, routeKey) {
  const manifestPath = path.join(nextDir, "server/app", `${routeKey}_client-reference-manifest.js`);
  if (!existsSync(manifestPath)) return null;
  const code = readFileSync(manifestPath, "utf8");
  const sandbox = { globalThis: {} };
  vm.runInNewContext(code, sandbox, { filename: manifestPath });
  return sandbox.globalThis.__RSC_MANIFEST?.[routeKey] ?? null;
}

// Thu thập toàn bộ tệp JS và CSS khởi tạo mà một route nạp ban đầu.
function measureRoute(nextDir, routeKey, publicRoute, buildManifest, fileCache) {
  const manifest = loadRouteManifest(nextDir, routeKey);
  if (!manifest) return null;

  const jsFiles = new Set([
    ...(buildManifest.polyfillFiles ?? []).map(normalizeChunkPath),
    ...(buildManifest.rootMainFiles ?? []).map(normalizeChunkPath),
  ]);
  const cssFiles = new Set();

  for (const list of Object.values(manifest.entryJSFiles ?? {})) {
    for (const file of list) {
      if (file.endsWith(".js")) jsFiles.add(normalizeChunkPath(file));
    }
  }
  for (const mod of Object.values(manifest.clientModules ?? {})) {
    for (const chunk of mod.chunks ?? []) {
      if (chunk.endsWith(".js")) jsFiles.add(normalizeChunkPath(chunk));
      if (chunk.endsWith(".css")) cssFiles.add(normalizeChunkPath(chunk));
    }
  }
  for (const list of Object.values(manifest.entryCSSFiles ?? {})) {
    for (const entry of list) {
      const filePath = typeof entry === "string" ? entry : entry.path;
      if (filePath && filePath.endsWith(".css")) cssFiles.add(normalizeChunkPath(filePath));
    }
  }

  const jsEntries = [...jsFiles].map((file) => inspectStaticFile(nextDir, file, fileCache));
  const cssEntries = [...cssFiles].map((file) => inspectStaticFile(nextDir, file, fileCache));
  const detectedFeatures = new Set();
  for (const entry of [...jsEntries, ...cssEntries]) {
    for (const feat of entry.features) detectedFeatures.add(feat);
  }

  const jsBytes = jsEntries.reduce((sum, item) => sum + item.bytes, 0);
  const jsGzipBytes = jsEntries.reduce((sum, item) => sum + item.gzipBytes, 0);
  const cssBytes = cssEntries.reduce((sum, item) => sum + item.bytes, 0);
  const cssGzipBytes = cssEntries.reduce((sum, item) => sum + item.gzipBytes, 0);

  return {
    route: publicRoute,
    appPath: routeKey,
    jsCount: jsEntries.length,
    jsBytes,
    jsGzipBytes,
    cssCount: cssEntries.length,
    cssBytes,
    cssGzipBytes,
    totalBytes: jsBytes + cssBytes,
    totalGzipBytes: jsGzipBytes + cssGzipBytes,
    features: [...detectedFeatures].sort(),
    largestJs: [...jsEntries].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
  };
}

// Quét toàn bộ static/chunks để tính tổng dung lượng build và danh sách chunk lớn nhất.
function scanStaticChunks(nextDir, fileCache, topLimit) {
  const chunksDir = path.join(nextDir, "static/chunks");
  if (!existsSync(chunksDir)) {
    throw new Error(`Không tìm thấy thư mục chunk tại: ${chunksDir}`);
  }
  const files = [];
  // Duyệt đệ quy thư mục static/chunks để thu thập các tệp JS và CSS.
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        walk(fullPath);
      } else if (st.isFile() && (entry.endsWith(".js") || entry.endsWith(".css"))) {
        const rel = path.relative(nextDir, fullPath).replace(/\\/g, "/");
        files.push(inspectStaticFile(nextDir, rel, fileCache));
      }
    }
  };
  walk(chunksDir);

  const jsFiles = files.filter((f) => f.path.endsWith(".js"));
  const cssFiles = files.filter((f) => f.path.endsWith(".css"));
  return {
    jsChunkCount: jsFiles.length,
    cssChunkCount: cssFiles.length,
    totalJsBytes: jsFiles.reduce((sum, f) => sum + f.bytes, 0),
    totalJsGzipBytes: jsFiles.reduce((sum, f) => sum + f.gzipBytes, 0),
    totalCssBytes: cssFiles.reduce((sum, f) => sum + f.bytes, 0),
    totalCssGzipBytes: cssFiles.reduce((sum, f) => sum + f.gzipBytes, 0),
    topChunks: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, topLimit),
  };
}

// Định dạng kích thước byte sang chuỗi KB dễ đọc cho báo cáo terminal.
function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// In bảng so sánh chênh lệch dung lượng với artifact baseline nếu có --compare.
function printComparison(current, baseline) {
  console.log("\n=== SO SÁNH VỚI BASELINE ===");
  const baseByRoute = new Map((baseline.routes ?? []).map((r) => [r.route, r]));
  for (const route of current.routes) {
    const prev = baseByRoute.get(route.route);
    if (!prev) continue;
    const jsDiff = route.jsBytes - prev.jsBytes;
    const cssDiff = route.cssBytes - prev.cssBytes;
    const gzipDiff = route.totalGzipBytes - prev.totalGzipBytes;
    // Định dạng độ lệch byte có dấu +/- theo đơn vị KB.
    const sign = (n) => (n >= 0 ? `+${formatKb(n)}` : `-${formatKb(Math.abs(n))}`);
    console.log(
      `${route.route.padEnd(32)} JS: ${formatKb(prev.jsBytes)} -> ${formatKb(route.jsBytes)} (${sign(jsDiff)}) | CSS: ${formatKb(prev.cssBytes)} -> ${formatKb(route.cssBytes)} (${sign(cssDiff)}) | Gzip: ${sign(gzipDiff)} | Feat: [${route.features.join(",")}]`,
    );
  }
}

// Điểm vào chính thực thi đo production bundle và xuất báo cáo JSON/terminal.
function main() {
  const options = parseArgs(process.argv.slice(2));
  logStructured(options.verbose, "info", "measure_bundle_start", { nextDir: options.nextDir });

  const buildManifestPath = path.join(options.nextDir, "build-manifest.json");
  const appRoutesPath = path.join(options.nextDir, "app-path-routes-manifest.json");
  if (!existsSync(buildManifestPath) || !existsSync(appRoutesPath)) {
    throw new Error(`Thư mục .next chưa được build production: ${options.nextDir}`);
  }

  const buildManifest = JSON.parse(readFileSync(buildManifestPath, "utf8"));
  const appRoutes = JSON.parse(readFileSync(appRoutesPath, "utf8"));
  const fileCache = new Map();

  const summary = scanStaticChunks(options.nextDir, fileCache, options.top);
  const routes = [];
  for (const routeKey of KEY_ROUTES) {
    const publicRoute = appRoutes[routeKey];
    if (!publicRoute) continue;
    const measured = measureRoute(options.nextDir, routeKey, publicRoute, buildManifest, fileCache);
    if (measured) routes.push(measured);
  }

  const report = {
    measuredAt: new Date().toISOString(),
    commit: readGitCommit(),
    nextDir: path.relative(process.cwd(), options.nextDir).replace(/\\/g, "/"),
    summary,
    routes,
  };

  if (options.output) {
    mkdirSync(path.dirname(options.output), { recursive: true });
    writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    logStructured(options.verbose, "info", "measure_bundle_saved", { output: options.output });
  }

  console.log(`Commit: ${report.commit} | Total JS: ${formatKb(summary.totalJsBytes)} (gzip ${formatKb(summary.totalJsGzipBytes)}, ${summary.jsChunkCount} files) | Total CSS: ${formatKb(summary.totalCssBytes)} (gzip ${formatKb(summary.totalCssGzipBytes)}, ${summary.cssChunkCount} files)`);
  console.log("\n=== TOP CHUNKS ===");
  for (const chunk of summary.topChunks.slice(0, 10)) {
    console.log(
      `${chunk.path.padEnd(38)} ${formatKb(chunk.bytes).padStart(10)} (gzip ${formatKb(chunk.gzipBytes).padStart(9)}) [${chunk.features.join(", ")}]`,
    );
  }
  console.log("\n=== INITIAL ROUTE PAYLOAD ===");
  for (const route of routes) {
    console.log(
      `${route.route.padEnd(32)} JS: ${formatKb(route.jsBytes).padStart(10)} (gzip ${formatKb(route.jsGzipBytes).padStart(9)}) | CSS: ${formatKb(route.cssBytes).padStart(9)} | Feat: [${route.features.join(", ")}]`,
    );
  }

  if (options.compare) {
    if (!existsSync(options.compare)) {
      throw new Error(`Không tìm thấy file baseline để so sánh: ${options.compare}`);
    }
    const baseline = JSON.parse(readFileSync(options.compare, "utf8"));
    printComparison(report, baseline);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
