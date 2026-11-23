import { CallHandler, ExecutionContext, HttpException, Injectable, type NestInterceptor } from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants.js";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import type { RequestWithId } from "../common/request-context.js";
import { MetricsService } from "./metrics.service.js";

@Injectable()
/** Đo thời gian và kết quả của mỗi handler rồi chuyển số liệu sang MetricsService. */
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  /**
   * Ghi metric ở cả nhánh thành công và lỗi bằng RxJS `tap`.
   * Route dùng tên controller/handler thay cho URL thật để tránh cardinality theo tham số.
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Luồng @Sse phát nhiều sự kiện trong nhiều phút: không phải một request, không đưa vào histogram độ trễ HTTP.
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true) return next.handle();
    const startedAt = performance.now();
    const request = context.switchToHttp().getRequest<Request & RequestWithId>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    let recorded = false;
    /** Ghi phương thức, tuyến, trạng thái và thời gian xử lý của yêu cầu vào số liệu vận hành. */
    const record = (statusCode: number): void => {
      if (recorded) return;
      recorded = true;
      this.metrics.record(request.method, route, statusCode, performance.now() - startedAt, request.requestId);
    };
    // Khi handler ném lỗi, exception filter chưa chạy nên response.statusCode vẫn là 200: lấy mã từ chính exception.
    return next.handle().pipe(tap({
      next: () => record(response.statusCode),
      complete: () => record(response.statusCode),
      error: (error: unknown) => record(error instanceof HttpException ? error.getStatus() : 500),
    }));
  }
}
