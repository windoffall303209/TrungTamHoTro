import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_STATUSES,
  PERMISSIONS,
  ROLE_CODES,
  serializeBigIntId,
  toDecimalNumber,
  toSafeByteSize,
} from "../dist/index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test("xuất đầy đủ khai báo kiểu envelope và từng domain contracts sau khi build", () => {
  const declarationPath = path.resolve(currentDir, "../dist/index.d.ts");
  assert.equal(fs.existsSync(declarationPath), true);
  const content = fs.readFileSync(declarationPath, "utf8");
  assert.match(content, /export interface ApiEnvelope<T>/);
  assert.match(content, /export interface ApiErrorEnvelope/);
  assert.match(content, /export \* from "\.\/primitives\.js";/);
  assert.match(content, /export \* from "\.\/pagination\.js";/);
  assert.match(content, /export \* from "\.\/auth\.js";/);
  assert.match(content, /export \* from "\.\/exam\.js";/);
  assert.match(content, /export \* from "\.\/academic\.js";/);
  assert.match(content, /export \* from "\.\/learning\.js";/);
  assert.match(content, /export \* from "\.\/system\.js";/);
  assert.doesNotMatch(content, /TeachingModule/);

  assert.deepEqual([...ROLE_CODES], [
    "SYSTEM_ADMIN",
    "CENTER_MANAGER",
    "INSTRUCTOR",
    "LEARNER",
  ]);
  assert.ok(PERMISSIONS.includes("system:configure"));
  assert.ok(ACCOUNT_STATUSES.includes("PENDING_VERIFICATION"));
});

test("áp quy ước tuần tự hóa Decimal và BigInt rõ ràng, chặn giá trị không an toàn", () => {
  assert.equal(toDecimalNumber(8.756), 8.76);
  assert.equal(toDecimalNumber("9.50"), 9.5);
  assert.equal(toDecimalNumber({ toNumber: () => 7.125 }), 7.13);
  assert.throws(() => toDecimalNumber(Number.NaN), RangeError);
  assert.throws(() => toDecimalNumber(Number.POSITIVE_INFINITY), RangeError);

  assert.equal(toSafeByteSize(1024n), 1024);
  assert.equal(toSafeByteSize(0), 0);
  assert.throws(() => toSafeByteSize(-1), RangeError);
  assert.throws(() => toSafeByteSize(BigInt(Number.MAX_SAFE_INTEGER) + 1n), RangeError);

  assert.equal(serializeBigIntId(9007199254740993n), "9007199254740993");
  assert.equal(serializeBigIntId("42"), "42");
  assert.throws(() => serializeBigIntId("-5"), RangeError);
  assert.throws(() => serializeBigIntId("abc"), RangeError);
});
