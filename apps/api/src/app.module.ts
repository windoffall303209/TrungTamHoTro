import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { validateEnvironment, type Environment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { LearningModule } from "./domains/learning/learning.module.js";
import { SystemModule } from "./domains/system/system.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { MaintenanceGuard } from "./domains/system/maintenance.guard.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
      validate: validateEnvironment,
      cache: true,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        throttlers: [{
          ttl: config.get("RATE_LIMIT_TTL_MS", { infer: true }),
          limit: config.get("RATE_LIMIT_MAX", { infer: true }),
        }],
      }),
    }),
    DatabaseModule,
    InfrastructureModule,
    ObservabilityModule,
    AuthModule,
    IdentityModule,
    LearningModule,
    HealthModule,
    SystemModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
  ],
})
/** Module gốc ghép cấu hình, hạ tầng và các miền nghiệp vụ của API. */
export class AppModule implements NestModule {
  /** Gắn request ID cho mọi route trước khi request đi qua guard/interceptor. */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*path}");
  }
}
