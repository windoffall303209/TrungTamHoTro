import {
  CallHandler,
  ExecutionContext,
  Injectable,
  StreamableFile,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";
import type { RequestWithId } from "./request-context.js";

interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string; timestamp: string };
}

const SSE_METADATA_KEY = "__sse__";

@Injectable()
/** Bọc dữ liệu thành công trong envelope thống nhất mà không can thiệp file stream. */
export class ResponseInterceptor<T> implements NestInterceptor<T, T | ApiEnvelope<T> | StreamableFile> {
  /** Giữ nguyên sự kiện SSE và file stream; chỉ bọc phản hồi JSON thành envelope. */
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T | ApiEnvelope<T> | StreamableFile> {
    if (Reflect.getMetadata(SSE_METADATA_KEY, context.getHandler())) return next.handle();
    const request = context.switchToHttp().getRequest<RequestWithId>();

    return next.handle().pipe(
      map((data) => data instanceof StreamableFile ? data : ({
        data,
        meta: {
          requestId: request.requestId,
          timestamp: new Date().toISOString(),
        },
      })),
    );
  }
}
