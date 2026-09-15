import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
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
    const startedAt = performance.now();
    const request = context.switchToHttp().getRequest<Request & RequestWithId>();
    const response = context.switchToHttp().getResponse<Response>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    /** Ghi phương thức, tuyến, trạng thái và thời gian xử lý của yêu cầu vào số liệu vận hành. */
    const record = (): void => {
      this.metrics.record(request.method, route, response.statusCode, performance.now() - startedAt, request.requestId);
    };
    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
