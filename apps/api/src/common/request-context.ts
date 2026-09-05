import type { Request } from "express";

/** Express request sau khi RequestIdMiddleware gắn mã tương quan. */
export interface RequestWithId extends Request {
  requestId: string;
}

