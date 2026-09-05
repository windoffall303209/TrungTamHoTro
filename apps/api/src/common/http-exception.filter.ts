import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { RequestWithId } from "./request-context.js";

@Catch()
/** Chuẩn hóa mọi exception thành error envelope có request ID để truy vết. */
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * Chuyển exception thành HTTP response an toàn.
   * Lỗi phía server được ghi kèm stack nhưng không trả chi tiết nội bộ cho client;
   * lỗi 4xx giữ phần details để giao diện có thể hiển thị nguyên nhân hợp lệ.
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithId & Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.resolveMessage(raw, exception);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl} [${request.requestId}]`, exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      error: {
        code: `HTTP_${status}`,
        message,
        ...(status < 500 && typeof raw === "object" && raw !== null ? { details: raw } : {}),
      },
      meta: {
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /** Rút thông báo ổn định từ các dạng payload mà HttpException có thể mang theo. */
  private resolveMessage(raw: string | object | undefined, exception: unknown): string {
    if (typeof raw === "string") return raw;
    if (raw && "message" in raw) {
      const message = (raw as { message: unknown }).message;
      return Array.isArray(message) ? message.join("; ") : String(message);
    }
    return exception instanceof HttpException ? exception.message : "Hệ thống đang gặp sự cố. Vui lòng thử lại sau.";
  }
}
