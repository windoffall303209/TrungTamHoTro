import "reflect-metadata";
import { Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/http-exception.filter.js";
import { ResponseInterceptor } from "./common/response.interceptor.js";
import type { Environment } from "./config/environment.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Environment, true>);
  const prefix = config.get("API_PREFIX", { infer: true });
  const version = config.get("API_VERSION", { infer: true });
  const port = config.get("API_PORT", { infer: true });

  app.useLogger(new Logger());
  app.enableShutdownHooks();
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: version });
  app.enableCors({
    origin: config.get("WEB_ORIGIN", { infer: true }),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Accept", "Content-Type", "X-Role-Code", "X-CSRF-Token"],
  });
  app.use(helmet());
  app.use(compression());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Teaching Support Center API")
    .setDescription("API nền tảng cho trung tâm hỗ trợ giảng dạy")
    .setVersion("0.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${prefix}/docs`, app, document);

  await app.listen(port, "0.0.0.0");
  Logger.log(`API: http://localhost:${port}/${prefix}/v${version}`, "Bootstrap");
  Logger.log(`Swagger: http://localhost:${port}/${prefix}/docs`, "Bootstrap");
}

void bootstrap();
