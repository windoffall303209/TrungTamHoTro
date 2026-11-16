import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

test("xuất đầy đủ khai báo kiểu ApiEnvelope và ApiErrorEnvelope sau khi build", () => {
  const declarationPath = path.resolve(currentDir, "../dist/index.d.ts");
  assert.equal(fs.existsSync(declarationPath), true);
  const content = fs.readFileSync(declarationPath, "utf8");
  assert.match(content, /export interface ApiEnvelope<T>/);
  assert.match(content, /export interface ApiErrorEnvelope/);
  assert.doesNotMatch(content, /TeachingModule/);
});
