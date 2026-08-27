import { createParamDecorator, ExecutionContext, InternalServerErrorException } from "@nestjs/common";
import type { AuthenticatedSession } from "./auth.service.js";
import type { RequestWithRole } from "./permission.guard.js";

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<RequestWithRole>().auth;
    if (!session) throw new InternalServerErrorException("Route chưa được cấu hình xác thực phiên.");
    return session;
  },
);
