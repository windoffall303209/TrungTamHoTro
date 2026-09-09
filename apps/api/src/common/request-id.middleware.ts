import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { RequestWithId } from "./request-context.js";

@Injectable()
/** Tạo mã tương quan cho request và phản chiếu mã đó qua response header. */
export class RequestIdMiddleware implements NestMiddleware {
  /**
   * Giữ `x-request-id` do upstream gửi nếu giá trị hợp lệ, nếu không sinh UUID mới.
   * Request ID sau đó được filter, metrics và response envelope dùng chung.
   */
  use(request: Request, response: Response, next: NextFunction): void {
    const incomingId = request.header("x-request-id")?.trim();
    const requestId = incomingId && incomingId.length <= 100 ? incomingId : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}

