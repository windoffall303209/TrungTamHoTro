import { BadRequestException, Controller, INestApplication, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { existsSync } from "node:fs";
import { AddressInfo } from "node:net";
import { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MaterialUploadInterceptor } from "../src/infrastructure/material-upload.interceptor.js";

let receivedPath = "";
@Controller()
class UploadTestController {
  @Post("upload")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Expose only spool metadata to verify Multer did not buffer the body. */
  upload(@UploadedFile() file: { path: string; size: number; buffer?: Buffer }): { size: number; buffered: boolean; exists: boolean } {
    receivedPath = file.path;
    return { size: file.size, buffered: Boolean(file.buffer), exists: existsSync(file.path) };
  }

  @Post("failure")
  @UseInterceptors(MaterialUploadInterceptor)
  /** Simulate business validation failure after multipart parsing. */
  failure(@UploadedFile() file: { path: string }): never {
    receivedPath = file.path;
    throw new BadRequestException("Rejected");
  }
}

describe("disk-backed material multipart", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [UploadTestController] }).compile();
    app = module.createNestApplication();
    await app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(app.getHttpServer<Server>().address() as AddressInfo).port}`;
  });
  afterAll(async () => { await app?.close(); });

  it("spools without a full buffer and removes scratch files before responding", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(1024 * 1024)]), "document.pdf");
    const response = await fetch(`${base}/upload`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ size: 1024 * 1024, buffered: false, exists: true });
    expect(existsSync(receivedPath)).toBe(false);
  });

  it("cleans up when business validation fails", async () => {
    const form = new FormData();
    form.append("file", new Blob(["payload"]), "document.pdf");
    expect((await fetch(`${base}/failure`, { method: "POST", body: form })).status).toBe(400);
    expect(existsSync(receivedPath)).toBe(false);
  });

  it("rejects excess multipart fields", async () => {
    const form = new FormData();
    for (let index = 0; index < 5; index++) form.append(`field${index}`, "value");
    expect((await fetch(`${base}/upload`, { method: "POST", body: form })).status).toBe(400);
  });
});
