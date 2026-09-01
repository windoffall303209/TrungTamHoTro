import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createConnection } from "node:net";
import type { Environment } from "../config/environment.js";

export interface AntivirusScanResult {
  clean: boolean;
  engine: "disabled" | "clamav";
  signature?: string;
}

@Injectable()
export class AntivirusService {
  constructor(private readonly config: ConfigService<Environment, true>) {}

  async scan(buffer: Buffer): Promise<AntivirusScanResult> {
    if (this.config.get("ANTIVIRUS_PROVIDER", { infer: true }) === "disabled") {
      return { clean: true, engine: "disabled" };
    }

    const host = this.config.get("CLAMAV_HOST", { infer: true });
    const port = this.config.get("CLAMAV_PORT", { infer: true });
    const timeout = this.config.get("CLAMAV_TIMEOUT_MS", { infer: true });
    const response = await this.sendInstream(host, port, timeout, buffer);
    if (response.endsWith("OK")) return { clean: true, engine: "clamav" };
    const match = response.match(/stream:\s+(.+)\s+FOUND$/i);
    if (match?.[1]) return { clean: false, engine: "clamav", signature: match[1].trim() };
    throw new ServiceUnavailableException("ClamAV trả về phản hồi không hợp lệ.");
  }

  private sendInstream(host: string, port: number, timeout: number, buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      const chunks: Buffer[] = [];
      let settled = false;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ServiceUnavailableException("Không thể quét tệp bằng ClamAV."));
      };
      socket.setTimeout(timeout, fail);
      socket.on("error", fail);
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim());
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < buffer.length; offset += chunkSize) {
          const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
