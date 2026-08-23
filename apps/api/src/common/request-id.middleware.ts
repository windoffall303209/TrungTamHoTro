import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import type { RequestWithId } from "./request-context.js";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incomingId = request.header("x-request-id")?.trim();
    const requestId = incomingId && incomingId.length <= 100 ? incomingId : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  }
}

