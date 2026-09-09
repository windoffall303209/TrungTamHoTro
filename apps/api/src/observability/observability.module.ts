import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { MetricsInterceptor } from "./metrics.interceptor.js";
import { MetricsService } from "./metrics.service.js";
import { ObservabilityController } from "./observability.controller.js";

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
  exports: [MetricsService],
})
/** Đăng ký metrics singleton và interceptor toàn cục cho mọi HTTP handler. */
export class ObservabilityModule {}
