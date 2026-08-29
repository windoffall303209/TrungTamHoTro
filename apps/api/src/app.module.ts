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
import { LearningModule } from "./learning/learning.module.js";
import { SystemModule } from "./system/system.module.js";
import { InfrastructureModule } from "./infrastructure/infrastructure.module.js";

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
    AuthModule,
    IdentityModule,
    LearningModule,
    HealthModule,
    SystemModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("{*path}");
  }
}
