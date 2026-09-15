import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createConnection } from "node:net";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Environment } from "../config/environment.js";

export interface AntivirusScanResult {
  clean: boolean;
  engine: "disabled" | "clamav";
  signature?: string;
}

@Injectable()
/** Adapter quét buffer qua ClamAV INSTREAM hoặc bỏ qua theo cấu hình môi trường. */
export class AntivirusService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  /**
   * Quét một tệp trong bộ nhớ và chuẩn hóa phản hồi của ClamAV.
   * Chế độ disabled chỉ dùng khi môi trường chủ động tắt engine; phản hồi lạ được
   * coi là lỗi dịch vụ thay vì mặc định cho phép tệp đi tiếp.
   */
  async scan(buffer: Buffer): Promise<AntivirusScanResult> {
    return this.scanSource(() => Readable.from([buffer]));
  }

  /** Scan disk-backed uploads without allocating their entire payload. */
  async scanFile(path: string): Promise<AntivirusScanResult> {
    return this.scanSource(() => createReadStream(path, { highWaterMark: 64 * 1024 }));
  }

  /** Normalize engine results and open the source only when scanning is enabled. */
  private async scanSource(source: () => Readable): Promise<AntivirusScanResult> {
    if (this.config.get("ANTIVIRUS_PROVIDER", { infer: true }) === "disabled") {
      return { clean: true, engine: "disabled" };
    }

    const host = this.config.get("CLAMAV_HOST", { infer: true });
    const port = this.config.get("CLAMAV_PORT", { infer: true });
    const timeout = this.config.get("CLAMAV_TIMEOUT_MS", { infer: true });
    const response = await this.sendInstream(host, port, timeout, source());
    if (response.endsWith("OK")) return { clean: true, engine: "clamav" };
    const match = response.match(/stream:\s+(.+)\s+FOUND$/i);
    if (match?.[1]) return { clean: false, engine: "clamav", signature: match[1].trim() };
    throw new ServiceUnavailableException("ClamAV trả về phản hồi không hợp lệ.");
  }

  /** Gửi buffer theo giao thức INSTREAM dạng chunk có độ dài big-endian tới ClamAV. */
  private sendInstream(host: string, port: number, timeout: number, input: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const chunks: Buffer[] = [];
      let settled = false;
      let responseBytes = 0;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        input.destroy();
        socket.destroy();
        reject(new ServiceUnavailableException("Không thể quét tệp bằng ClamAV."));
      };
      const deadline = setTimeout(fail, timeout);
      input.on("error", fail);
      socket.setTimeout(timeout, fail);
      socket.on("error", fail);
      socket.on("data", (chunk: Buffer) => {
        responseBytes += chunk.length;
        if (responseBytes > 8192) fail();
        else chunks.push(chunk);
      });
      socket.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        input.destroy();
        resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim());
      });
      socket.on("close", (): void => { if (!settled) fail(); });
      socket.on("connect", () => {
        // Await write callbacks so a slow scanner cannot accumulate the file in socket buffers.
        const write = (chunk: Buffer | string): Promise<void> => new Promise((done, failed) => socket.write(chunk, (error) => error ? failed(error) : done()));
        void (async (): Promise<void> => {
          await write("zINSTREAM\0");
          for await (const raw of input) {
            const buffer = raw as Buffer;
            for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
              const chunk = buffer.subarray(offset, offset + 64 * 1024);
              const length = Buffer.alloc(4);
              length.writeUInt32BE(chunk.length);
              await write(length);
              await write(chunk);
            }
          }
          socket.end(Buffer.alloc(4));
        })().catch(fail);
      });
    });
  }
}
