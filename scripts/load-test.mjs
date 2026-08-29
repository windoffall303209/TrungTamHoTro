import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4000/api/v1/health" },
    requests: { type: "string", default: "500" },
    concurrency: { type: "string", default: "20" },
    "p95-limit-ms": { type: "string", default: "500" },
    verbose: { type: "boolean", default: false },
  },
  strict: true,
});

const total = Number(values.requests);
const concurrency = Number(values.concurrency);
const p95Limit = Number(values["p95-limit-ms"]);
if (!Number.isInteger(total) || total < 1 || total > 100_000) throw new Error("--requests phải là số nguyên từ 1 đến 100000.");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1_000) throw new Error("--concurrency phải là số nguyên từ 1 đến 1000.");
if (!Number.isFinite(p95Limit) || p95Limit < 1) throw new Error("--p95-limit-ms phải lớn hơn 0.");
const target = new URL(values.url);
if (!["http:", "https:"].includes(target.protocol)) throw new Error("--url chỉ chấp nhận HTTP hoặc HTTPS.");

const durations = [];
let nextIndex = 0;
let failed = 0;
async function worker() {
  while (nextIndex < total) {
    const index = nextIndex++;
    const started = performance.now();
    try {
      const response = await fetch(target, { signal: AbortSignal.timeout(10_000), headers: { "x-request-id": `load-${index}` } });
      if (!response.ok) failed += 1;
      await response.arrayBuffer();
      if (values.verbose) process.stdout.write(`${index + 1}\t${response.status}\n`);
    } catch {
      failed += 1;
    } finally {
      durations.push(performance.now() - started);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
durations.sort((a, b) => a - b);
const percentile = (value) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)] ?? 0;
const result = { url: target.toString(), requests: total, concurrency, failed, p50Ms: Math.round(percentile(0.5) * 100) / 100, p95Ms: Math.round(percentile(0.95) * 100) / 100, p99Ms: Math.round(percentile(0.99) * 100) / 100 };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failed > 0 || result.p95Ms > p95Limit) process.exitCode = 1;
