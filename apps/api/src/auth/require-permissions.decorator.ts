import { SetMetadata } from "@nestjs/common";
import type { PermissionCode } from "./permissions.js";

export const REQUIRED_PERMISSIONS_KEY = "required_permissions";
export const AUTHENTICATION_REQUIRED_KEY = "authentication_required";

/** Khai báo các quyền mà PermissionGuard phải kiểm tra đồng thời trên class hoặc handler. */
export const RequirePermissions = (...permissions: PermissionCode[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Yêu cầu phiên hợp lệ cho route không cần một quyền nghiệp vụ cụ thể. */
export const RequireAuthentication = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATION_REQUIRED_KEY, true);
