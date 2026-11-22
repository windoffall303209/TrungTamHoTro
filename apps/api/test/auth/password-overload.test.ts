import { ArgumentsHost, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { HttpExceptionFilter } from "../../src/common/http-exception.filter.js";

describe("Quá tải băm mật khẩu trả 503 có Retry-After", () => {
  it("exception filter chuyển retryAfterSeconds thành header Retry-After", () => {
    const setHeader = vi.fn();
    const json = vi.fn();
    const response = { setHeader, status: vi.fn(() => ({ json })) };
    const request = { headers: {}, method: "POST", originalUrl: "/auth/login", requestId: "req-1" };
    const host = {
      switchToHttp: (): object => ({ getResponse: (): typeof response => response, getRequest: (): typeof request => request }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(new ServiceUnavailableException({ message: "Quá tải", retryAfterSeconds: 2 }), host);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "2");
    expect(response.status).toHaveBeenCalledWith(503);
  });
});
