import "./threadpool.js";
import "reflect-metadata";
import { Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ResponseInterceptor } from "./common/response.interceptor.js";
import type { Environment } from "./config/environment.js";
import { parseTrustProxy } from "./config/trust-proxy.js";

/**
 * Khởi tạo HTTP API và lắp toàn bộ pipeline dùng chung của NestJS.
 *
 * Hàm đọc cấu hình đã được kiểm tra từ ConfigService, bật CORS/các middleware
 * bảo vệ, chuẩn hóa validation và response, dựng Swagger rồi mới mở cổng nghe.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Environment, true>);
  const prefix = config.get("API_PREFIX", { infer: true });
  const version = config.get("API_VERSION", { infer: true });
  const port = config.get("API_PORT", { infer: true });

  app.useLogger(new Logger());
  // Sau Nginx/Cloudflare/Ingress phải khai báo proxy tin cậy để req.ip là IP người dùng thay vì IP proxy.
  app.set("trust proxy", parseTrustProxy(config.get("TRUST_PROXY", { infer: true })));
  app.enableShutdownHooks();
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: version });
  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Accept-Language", "Content-Type", "X-Role-Code", "X-CSRF-Token", "Last-Event-ID"],
    exposedHeaders: ["Content-Disposition", "Content-Type", "Content-Length"],
  });
  app.use(helmet());
  // Không nén text/event-stream: compression giữ đệm từng sự kiện SSE cho tới khi đủ khối, làm trễ thông báo/chat.
  app.use(compression({
    filter: (request, response) =>
      request.headers.accept !== "text/event-stream" &&
      !String(response.getHeader("Content-Type") ?? "").includes("text/event-stream") &&
      compression.filter(request, response),
  }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Teaching Support Center API")
    .setDescription("API nền tảng cho trung tâm hỗ trợ giảng dạy")
    .setVersion("0.1.0")
    .build();
  // Không công khai sơ đồ API trên production; bật lại tường minh bằng SWAGGER_ENABLED=true khi cần.
  const swaggerEnabled = config.get("NODE_ENV", { infer: true }) !== "production" || process.env.SWAGGER_ENABLED === "true";
  if (swaggerEnabled) SwaggerModule.setup(`${prefix}/docs`, app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(port, "0.0.0.0");
  Logger.log(`API: http://localhost:${port}/${prefix}/v${version}`, "Bootstrap");
  if (swaggerEnabled) Logger.log(`Swagger: http://localhost:${port}/${prefix}/docs`, "Bootstrap");
}

void bootstrap();
