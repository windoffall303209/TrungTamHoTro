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

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T> | StreamableFile> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T> | StreamableFile> {
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
